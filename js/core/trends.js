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
