/**
 * Trends for one budget, worked out on the device from its transactions and plan.
 * Spending here means spending minus refunds; income and transfers in are counted apart.
 */
import { addMonths, monthOf, liveTransactions, monthSummary, targetType } from './budget.js';

const dayOf = date => Number(date.slice(8, 10));
const net = t => (t.kind === 'spend' ? t.amount : t.kind === 'refund' ? -t.amount : 0);

/** Spending per category per month: { 'YYYY-MM': { catId: cents } }, optionally only up to a day of the month. */
function byMonthCategory(transactions, uptoDay = 31) {
  const out = {};
  for (const t of transactions) {
    if (t.kind === 'income' || dayOf(t.date) > uptoDay) continue;
    const m = monthOf(t.date);
    out[m] ??= {};
    out[m][t.categoryId] = (out[m][t.categoryId] || 0) + net(t);
  }
  return out;
}

/** Income and spending for each of the last `count` months, oldest first. */
export function monthTotals(transactionList, month, count = 6) {
  const transactions = liveTransactions(transactionList);
  const rows = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const m = addMonths(month, -i);
    let income = 0, spent = 0;
    for (const t of transactions) {
      if (monthOf(t.date) !== m) continue;
      if (t.kind === 'income') income += t.amount; else spent += net(t);
    }
    rows.push({ month: m, income, spent: Math.max(0, spent) });
  }
  return rows;
}

/**
 * This month by category, next to what's usual: the average of the previous `back` months that
 * have any spending. For the current month, "usual" only counts spending up to the same day,
 * so a half-finished month is compared fairly.
 */
export function categoryCompare(budget, transactionList, month, today, back = 3) {
  const transactions = liveTransactions(transactionList);
  const partial = today && monthOf(today) === month ? dayOf(today) : 31;
  const here = byMonthCategory(transactions.filter(t => monthOf(t.date) === month), partial)[month] || {};
  const earlier = byMonthCategory(transactions.filter(t => monthOf(t.date) < month && monthOf(t.date) >= addMonths(month, -back)), partial);
  const months = Object.keys(earlier).filter(m => Object.values(earlier[m]).some(v => v > 0));
  const ids = new Set([...Object.keys(here), ...months.flatMap(m => Object.keys(earlier[m]))]);
  const rows = [...ids].filter(id => budget.categories?.[id]).map(id => {
    const usual = months.length ? Math.round(months.reduce((a, m) => a + Math.max(0, earlier[m][id] || 0), 0) / months.length) : 0;
    return { id, name: budget.categories[id].name, group: budget.categories[id].group, spent: Math.max(0, here[id] || 0), usual };
  }).filter(r => r.spent > 0 || r.usual > 0);
  rows.sort((a, b) => b.spent - a.spent || b.usual - a.usual);
  return { rows, monthsCompared: months.length, partial: partial < 31, total: rows.reduce((a, r) => a + r.spent, 0) };
}

/**
 * Changes worth a look: categories at least 25% and $20 away from usual, biggest first.
 * Needs at least two earlier months, so one odd month doesn't set "usual". Saving categories
 * are left out: moving money to savings on a different day isn't a change in spending.
 */
export function notableChanges(compare, { minPct = 0.25, minCents = 2000, limit = 4 } = {}) {
  if (compare.monthsCompared < 2) return [];
  return compare.rows
    .filter(r => !isSavingGroup(r.group) && r.usual > 0 && Math.abs(r.spent - r.usual) >= minCents && Math.abs(r.spent - r.usual) / r.usual >= minPct)
    .map(r => ({ ...r, change: r.spent - r.usual, pct: Math.round(((r.spent - r.usual) / r.usual) * 100) }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, limit);
}

/**
 * Categories that spend more than planned in most of the last `back` finished months, with
 * how much they usually spend, so the plan can match real life.
 */
export function planVsReal(budget, transactionList, month, back = 3) {
  const transactions = liveTransactions(transactionList);
  const spent = byMonthCategory(transactions);
  const out = [];
  for (const [id, c] of Object.entries(budget.categories || {})) {
    if (c.hidden) continue;
    let over = 0, totalSpent = 0, totalPlanned = 0, counted = 0;
    for (let i = 1; i <= back; i += 1) {
      const m = addMonths(month, -i);
      const s = Math.max(0, spent[m]?.[id] || 0), p = budget.assigned?.[m]?.[id] || 0;
      if (!s && !p) continue;
      counted += 1; totalSpent += s; totalPlanned += p;
      if (s > p) over += 1;
    }
    if (counted >= 2 && over >= 2) out.push({ id, name: c.name, over, counted, usualSpent: Math.round(totalSpent / counted), usualPlanned: Math.round(totalPlanned / counted) });
  }
  return out.sort((a, b) => (b.usualSpent - b.usualPlanned) - (a.usualSpent - a.usualPlanned));
}

/** Categories in groups whose name starts with "Sav" count as saving. */
export const isSavingGroup = name => /^sav/i.test(String(name || '').trim());

/** How much of this month's income was planned into saving categories. */
export function savingThisMonth(budget, transactionList, month) {
  const s = monthSummary(budget, transactionList, month);
  let saved = 0;
  for (const [id, c] of Object.entries(budget.categories || {})) if (!c.hidden && isSavingGroup(c.group)) saved += Math.max(0, s.categories[id]?.assigned || 0);
  return { income: s.incomeThisMonth, saved, rate: s.incomeThisMonth > 0 ? saved / s.incomeThisMonth : null };
}

/** Yearly and save-by-a-date targets with how far along they are. */
export function targetProgress(budget, transactionList, month) {
  const s = monthSummary(budget, transactionList, month);
  return Object.entries(budget.categories || {})
    .filter(([, c]) => !c.hidden && ['yearly', 'byDate'].includes(targetType(c.target)))
    .map(([id, c]) => {
      const t = s.categories[id].target;
      return t.type === 'yearly'
        ? { id, name: c.name, type: 'yearly', amount: t.amount, done: t.spentThisYear, label: 'spent this year' }
        : { id, name: c.name, type: 'byDate', amount: t.amount, done: t.saved, date: t.date, label: 'saved' };
    });
}

/* ---------- Round 5 ---------- */

export const daysInMonth = month => { const [y, m] = month.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const isSpendingCat = c => c && !c.hidden && !isSavingGroup(c.group);
/**
 * Bills are paid in one go, so they'd make a pace projection run wild: a $1,800 rent on the 1st
 * isn't $54,000 a month. A bill is a category with a monthly target, one a monthly repeat pays
 * from, or one in a group whose name starts with "Bill".
 */
export const isBillCategory = (budget, id) => {
  const c = budget.categories?.[id];
  if (!c) return false;
  if (/^bill/i.test(String(c.group || '').trim()) || targetType(c.target) === 'monthly') return true;
  return Object.values(budget.recurring || {}).some(r => r && !r.stopped && r.kind === 'spend' && r.categoryId === id);
};

/** Months for a range: '3', '6', '12' back from `month`, or 'year' for January through `month`. */
export function rangeMonths(range, month) {
  if (range === 'year') { const n = Number(month.slice(5, 7)); return Array.from({ length: n }, (_, i) => `${month.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`); }
  const n = Number(range) || 6;
  return Array.from({ length: n }, (_, i) => addMonths(month, i - n + 1));
}

/**
 * How everyday spending is going against the plan this month, leaving bills and saving out.
 * `budgeted` is what spending categories had to spend this month (carried in plus planned).
 * For a month that's over, the whole month counts as gone.
 */
export function pace(budget, transactionList, month, today, { minCents = 2000, margin = 0.25 } = {}) {
  const s = monthSummary(budget, transactionList, month);
  const days = daysInMonth(month);
  const elapsed = !today || monthOf(today) > month ? 1 : monthOf(today) < month ? 0 : dayOf(today) / days;
  let budgeted = 0, spent = 0;
  const ahead = [];
  for (const [id, c] of Object.entries(budget.categories || {})) {
    if (!isSpendingCat(c) || isBillCategory(budget, id)) continue;
    const x = s.categories[id];
    const funds = Math.max(0, x.carried + x.assigned), used = Math.max(0, -x.activity);
    budgeted += funds; spent += used;
    if (elapsed < 1 && funds > 0 && used >= minCents && used / funds > elapsed + margin) {
      ahead.push({ id, name: c.name, used, funds, share: used / funds });
    }
  }
  ahead.sort((a, b) => b.share - a.share);
  return {
    elapsed, budgeted, spent, usedShare: budgeted ? spent / budgeted : null,
    projected: elapsed > 0 && elapsed < 1 ? Math.round(spent / elapsed) : spent,
    ahead: ahead.slice(0, 4),
  };
}

/**
 * Repeats coming up in the next `days` days, oldest first, each marked covered when its category
 * has enough to spend for it (counting earlier upcoming bills in the same category first).
 */
export function upcomingBills(budget, transactionList, today, days = 30) {
  const have = new Set((transactionList || []).map(t => t.id));
  const end = new Date(`${today}T12:00:00`); end.setDate(end.getDate() + days);
  const endDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  const list = [];
  for (const r of Object.values(budget.recurring || {})) {
    if (!r || r.stopped || !Number.isInteger(r.amount) || !r.day) continue;
    for (let m = monthOf(today); ; m = addMonths(m, 1)) {
      const date = `${m}-${String(r.day).padStart(2, '0')}`;
      if (date > endDate) break;
      if (date < today || m < r.start || have.has(`r-${r.id}-${m}`)) continue;
      list.push({ ruleId: r.id, date, kind: r.kind, amount: r.amount, description: r.description || '', categoryId: r.categoryId || null });
    }
  }
  list.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  const s = monthSummary(budget, transactionList, monthOf(today));
  const left = Object.fromEntries(Object.entries(s.categories).map(([id, x]) => [id, x.available]));
  for (const b of list) {
    if (b.kind !== 'spend') continue;
    // Only this month's money is known; next month's bills are covered once next month is planned.
    if (monthOf(b.date) !== monthOf(today)) { b.covered = null; continue; }
    b.covered = (left[b.categoryId] ?? 0) >= b.amount;
    left[b.categoryId] = (left[b.categoryId] ?? 0) - b.amount;
  }
  const out = list.filter(x => x.kind === 'spend').reduce((a, x) => a + x.amount, 0);
  const incoming = list.filter(x => x.kind === 'income').reduce((a, x) => a + x.amount, 0);
  return { list, out, incoming, uncovered: list.filter(x => x.covered === false).length };
}

/** One category over a range of months: spending each month, the average of active months, and its biggest purchases. */
export function categoryHistory(transactionList, catId, months, biggest = 5) {
  const transactions = liveTransactions(transactionList).filter(t => t.categoryId === catId && months.includes(monthOf(t.date)));
  const byMonth = Object.fromEntries(months.map(m => [m, 0]));
  for (const t of transactions) byMonth[monthOf(t.date)] += net(t);
  const rows = months.map(m => ({ month: m, spent: Math.max(0, byMonth[m]) }));
  const active = rows.filter(r => r.spent > 0);
  return {
    rows, total: rows.reduce((a, r) => a + r.spent, 0),
    average: active.length ? Math.round(active.reduce((a, r) => a + r.spent, 0) / active.length) : 0,
    biggest: transactions.filter(t => t.kind === 'spend').sort((a, b) => b.amount - a.amount).slice(0, biggest),
  };
}

/** The largest single purchases in a month. */
export const biggestPurchases = (transactionList, month, n = 5) =>
  liveTransactions(transactionList).filter(t => t.kind === 'spend' && monthOf(t.date) === month).sort((a, b) => b.amount - a.amount).slice(0, n);

/** Spending in a month by who added it, biggest first. */
export function byPerson(budget, transactionList, month) {
  const out = {};
  for (const t of liveTransactions(transactionList)) {
    if (t.kind === 'income' || monthOf(t.date) !== month || t.automatic) continue;
    out[t.createdBy] = (out[t.createdBy] || 0) + net(t);
  }
  return Object.entries(out).filter(([, v]) => v > 0).map(([uid, spent]) => ({ uid, name: budget.members?.[uid]?.name || 'Former member', spent })).sort((a, b) => b.spent - a.spent);
}

/** Spending by category over several months, biggest first. */
export function categoryTotals(budget, transactionList, months) {
  const out = {};
  for (const t of liveTransactions(transactionList)) {
    if (t.kind === 'income' || !months.includes(monthOf(t.date)) || !budget.categories?.[t.categoryId]) continue;
    out[t.categoryId] = (out[t.categoryId] || 0) + net(t);
  }
  return Object.entries(out).filter(([, v]) => v > 0).map(([id, spent]) => ({ id, name: budget.categories[id].name, spent, perMonth: Math.round(spent / months.length) })).sort((a, b) => b.spent - a.spent);
}

/**
 * Up to three short lines for the top of Trends, most useful first: a big change against usual,
 * where spending is heading this month, and what was left over last month.
 */
export function headlines(budget, transactionList, month, today) {
  const out = [];
  const change = notableChanges(categoryCompare(budget, transactionList, month, today))[0];
  if (change) out.push({ kind: change.change > 0 ? 'up' : 'down', text: `${change.name} is ${change.change > 0 ? 'up' : 'down'} ${Math.abs(change.pct)}% on usual`, id: change.id });
  const p = pace(budget, transactionList, month, today);
  if (p.elapsed > 0 && p.elapsed < 1 && p.spent > 0) out.push({ kind: p.budgeted && p.projected > p.budgeted ? 'up' : 'pace', text: 'pace', projected: p.projected, budgeted: p.budgeted });
  const [prev] = monthTotals(transactionList, addMonths(month, -1), 1);
  if (prev && (prev.income || prev.spent)) out.push({ kind: prev.income - prev.spent >= 0 ? 'left' : 'short', text: 'leftover', month: prev.month, amount: prev.income - prev.spent });
  return out.slice(0, 3);
}
