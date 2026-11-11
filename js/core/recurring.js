/**
 * Transactions that repeat: rent, subscriptions, paychecks.
 *
 * A monthly rule: { id, kind, amount, description, categoryId?, every: 'month' (or absent), day (1-28), start 'YYYY-MM', stopped? }
 * A weekly rule:  { ..., every: 'week' | '2weeks', anchor: 'YYYY-MM-DD' (the first date), stopped? }
 *
 * Each copy gets a fixed id: `r-{ruleId}-{YYYY-MM}` for monthly rules, `r-{ruleId}-{YYYY-MM-DD}` for
 * weekly ones. Two phones adding it at the same moment write the same record instead of a
 * duplicate, and a deleted copy (only marked deleted) is never added again.
 */
import { addMonths, isMonth } from './budget.js';

export const DAY_MAX = 28;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const EVERY = { month: 'Every month', '2weeks': 'Every 2 weeks', week: 'Every week' };
export const every = r => (r?.every === 'week' || r?.every === '2weeks' ? r.every : 'month');
export const recurringId = (ruleId, when) => `r-${ruleId}-${when}`;

export function isValidRule(r) {
  if (!r || typeof r.id !== 'string' || !['income', 'spend'].includes(r.kind) || !Number.isInteger(r.amount) || r.amount <= 0) return false;
  if (r.kind !== 'income' && typeof r.categoryId !== 'string') return false;
  return every(r) === 'month'
    ? Number.isInteger(r.day) && r.day >= 1 && r.day <= DAY_MAX && isMonth(r.start)
    : typeof r.anchor === 'string' && DATE.test(r.anchor);
}

/* Dates as plain day numbers, so stepping by 7 or 14 never trips over time zones or daylight saving. */
const toDay = iso => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 864e5;
const fromDay = n => new Date(n * 864e5).toISOString().slice(0, 10);

/** Every date the rule lands on between `from` and `to` (inclusive), with each copy's id. */
export function occurrences(r, from, to) {
  if (!isValidRule(r)) return [];
  const out = [];
  if (every(r) === 'month') {
    for (let m = r.start > from.slice(0, 7) ? r.start : from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m, 1)) {
      const date = `${m}-${String(r.day).padStart(2, '0')}`;
      if (date >= from && date <= to) out.push({ date, id: recurringId(r.id, m) });
    }
    return out;
  }
  const step = every(r) === 'week' ? 7 : 14;
  const a = toDay(r.anchor), lo = toDay(from), hi = toDay(to);
  let d = lo <= a ? a : a + Math.ceil((lo - a) / step) * step;
  for (; d <= hi; d += step) out.push({ date: fromDay(d), id: recurringId(r.id, fromDay(d)) });
  return out;
}

/**
 * Copies that are due by `today` ('YYYY-MM-DD') and don't exist yet, oldest first.
 * Looks back at most `maxMonths`, so a phone opened after a long break doesn't flood the list.
 */
export function dueTransactions(rules, existingIds, today, maxMonths = 3) {
  const have = existingIds instanceof Set ? existingIds : new Set(existingIds);
  const from = `${addMonths(today.slice(0, 7), -(maxMonths - 1))}-01`;
  const out = [];
  for (const r of Object.values(rules || {})) {
    if (!isValidRule(r) || r.stopped) continue;
    for (const o of occurrences(r, from, today)) {
      if (have.has(o.id)) continue;
      out.push({ id: o.id, kind: r.kind, amount: r.amount, date: o.date, description: r.description || '', categoryId: r.kind === 'income' ? null : r.categoryId, recurringId: r.id });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The next date a rule adds a copy on or after today, for showing "next Dec 1". */
export function nextDate(rule, today, existingIds = []) {
  if (!isValidRule(rule) || rule.stopped) return null;
  const have = new Set(existingIds);
  const far = fromDay(toDay(today) + 800);
  return occurrences(rule, today, far).find(o => !have.has(o.id))?.date ?? null;
}

/** How often, in words: "the 1st", "every 2 weeks", "every week". */
export function howOften(rule, ordinal) {
  if (every(rule) === 'month') return `monthly on the ${ordinal(rule.day)}`;
  const weekday = new Date(`${rule.anchor}T12:00:00`).toLocaleDateString('en', { weekday: 'long' });
  return every(rule) === 'week' ? `every ${weekday}` : `every other ${weekday}`;
}

/** A plain key for a payee, so "NETFLIX.COM 866-579" and "Netflix.com 1234" group together. */
export const payeeKey = s => String(s || '').toLowerCase().replace(/[0-9#*]+/g, ' ').replace(/\b(com|inc|llc|www|pos|purchase|debit|card|ach|the)\b/g, ' ').replace(/[^a-z]+/g, ' ').trim().split(' ').slice(0, 3).join(' ');

/**
 * Things that look like they repeat every month (a subscription, rent, a paycheck) and aren't a
 * repeat yet: seen in at least 3 of the last 6 months, about the same amount, and seen lately.
 * Each comes with a ready rule to add (it starts with the next copy that isn't in yet).
 */
export function suggestRepeats(list, rules, today, dismissed = []) {
  const month = today.slice(0, 7), first = addMonths(month, -5);
  const have = new Set(Object.values(rules || {}).filter(r => !r.stopped).map(r => payeeKey(r.description)));
  const no = new Set(dismissed);
  const groups = new Map();
  for (const t of list || []) {
    if (t.deleted || t.recurringId || !t.date || t.date.slice(0, 7) < first || t.date > today) continue;
    if (t.kind !== 'spend' && t.kind !== 'income') continue;
    const key = `${t.kind}:${payeeKey(t.description)}`;
    if (key.endsWith(':')) continue;
    (groups.get(key) || groups.set(key, []).get(key)).push(t);
  }
  const out = [];
  for (const [key, ts] of groups) {
    if (no.has(key) || have.has(key.split(':')[1])) continue;
    const byMonth = new Map();
    for (const t of ts.sort((a, b) => a.date.localeCompare(b.date))) byMonth.set(t.date.slice(0, 7), t);
    // Once a month: at least 3 months, and never more than one in a month.
    if (byMonth.size < 3 || ts.length > byMonth.size) continue;
    const last = ts.at(-1);
    if (last.date.slice(0, 7) < addMonths(month, -1)) continue;
    const amounts = [...byMonth.values()].map(t => t.amount);
    if (Math.max(...amounts) > Math.min(...amounts) * 1.15) continue;
    const days = [...byMonth.values()].map(t => Number(t.date.slice(8, 10))).sort((a, b) => a - b);
    if (days.at(-1) - days[0] > 8) continue;
    const day = Math.min(days[Math.floor(days.length / 2)], DAY_MAX);
    // Start with the next copy that isn't in yet: this month if it's still to come, else next month.
    const start = byMonth.has(month) || Number(today.slice(8, 10)) >= day ? addMonths(month, 1) : month;
    out.push({
      key, count: byMonth.size, last,
      rule: { kind: last.kind, amount: last.amount, description: last.description || '', ...(last.kind === 'income' ? {} : { categoryId: last.categoryId }), every: 'month', day, start },
    });
  }
  return out.sort((a, b) => b.count - a.count || b.last.amount - a.last.amount).slice(0, 5);
}
