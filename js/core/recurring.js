/**
 * Transactions that repeat every month: rent, subscriptions, paychecks.
 *
 * A rule: { id, kind, amount, description, categoryId?, day (1-28), start 'YYYY-MM', stopped? }
 * Each month's copy gets the id `r-{ruleId}-{YYYY-MM}`, so two phones adding it at the same
 * moment write the same record instead of a duplicate, and a deleted copy (only marked deleted)
 * is never added again.
 */
import { addMonths, isMonth } from './budget.js';

export const DAY_MAX = 28;
export const recurringId = (ruleId, month) => `r-${ruleId}-${month}`;

export function isValidRule(r) {
  return Boolean(r) && typeof r.id === 'string' && ['income', 'spend'].includes(r.kind)
    && Number.isInteger(r.amount) && r.amount > 0 && Number.isInteger(r.day) && r.day >= 1 && r.day <= DAY_MAX
    && isMonth(r.start) && (r.kind === 'income' || typeof r.categoryId === 'string');
}

/**
 * Copies that are due by `today` ('YYYY-MM-DD') and don't exist yet, oldest first.
 * Looks back at most `maxMonths`, so a phone opened after a long break doesn't flood the list.
 */
export function dueTransactions(rules, existingIds, today, maxMonths = 3) {
  const have = existingIds instanceof Set ? existingIds : new Set(existingIds);
  const month = today.slice(0, 7), day = Number(today.slice(8, 10));
  const out = [];
  for (const r of Object.values(rules || {})) {
    if (!isValidRule(r) || r.stopped) continue;
    let m = r.start > addMonths(month, -(maxMonths - 1)) ? r.start : addMonths(month, -(maxMonths - 1));
    for (; m <= month; m = addMonths(m, 1)) {
      if (m === month && r.day > day) break;
      const id = recurringId(r.id, m);
      if (have.has(id)) continue;
      out.push({
        id, kind: r.kind, amount: r.amount, date: `${m}-${String(r.day).padStart(2, '0')}`,
        description: r.description || '', categoryId: r.kind === 'income' ? null : r.categoryId, recurringId: r.id,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The next date a rule adds a copy on or after today, for showing "Next on Dec 1". */
export function nextDate(rule, today, existingIds = []) {
  if (!isValidRule(rule) || rule.stopped) return null;
  const have = new Set(existingIds);
  for (let m = rule.start > today.slice(0, 7) ? rule.start : today.slice(0, 7), i = 0; i < 24; m = addMonths(m, 1), i += 1) {
    const date = `${m}-${String(rule.day).padStart(2, '0')}`;
    if (date >= today && !have.has(recurringId(rule.id, m))) return date;
  }
  return null;
}
