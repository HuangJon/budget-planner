/**
 * "Every dollar a job" budget math. Pure functions, no screen or storage code.
 *
 * - Income goes into Ready to assign. You hand that money out to categories, month by month.
 * - A category's available money = what it carried in + what you assigned this month
 *   − what you spent this month (+ refunds).
 * - Leftovers carry into next month. So does overspending: a category left below zero stays
 *   below zero (shown red) until you cover it, so nothing quietly disappears.
 * - Ready to assign = income received through the month − everything ever assigned.
 *   Assigning ahead to a later month uses today's money, so it counts straight away.
 *
 * Shapes:
 *   budget.categories: { [id]: { name, group, order, target?: { amount, dueDay? }, hidden? } }
 *   budget.assigned:   { 'YYYY-MM': { [categoryId]: cents } }   (any integer; negative moves money out)
 *   transaction:       { id, kind: 'income'|'spend'|'refund', amount (cents > 0), date 'YYYY-MM-DD',
 *                        categoryId (spend and refund), description, deleted? }
 */

const isMap = v => v && typeof v === 'object' && !Array.isArray(v);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const isMonth = m => typeof m === 'string' && MONTH.test(m);
export const monthOf = date => String(date).slice(0, 7);
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}
export const thisMonth = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export function isValidTransaction(t) {
  if (!isMap(t) || typeof t.id !== 'string' || !['income', 'spend', 'refund'].includes(t.kind)) return false;
  if (!Number.isInteger(t.amount) || t.amount <= 0 || typeof t.date !== 'string' || !DATE.test(t.date)) return false;
  if (t.kind !== 'income' && typeof t.categoryId !== 'string') return false;
  return true;
}

export const liveTransactions = list => (list || []).filter(t => !t.deleted && isValidTransaction(t));

/** The effect of one transaction on its category: spending lowers it, a refund raises it. */
const categoryEffect = t => (t.kind === 'spend' ? -t.amount : t.kind === 'refund' ? t.amount : 0);

/** The first month anything happened in, so carry-over can start there. */
function firstMonth(budget, transactions, month) {
  let first = month;
  for (const m of Object.keys(budget.assigned || {})) if (isMonth(m) && m < first) first = m;
  for (const t of transactions) { const m = monthOf(t.date); if (m < first) first = m; }
  return first;
}

/** Activity per month per category: { 'YYYY-MM': { catId: cents } }. */
function activityByMonth(transactions) {
  const out = {};
  for (const t of transactions) {
    if (t.kind === 'income') continue;
    const m = monthOf(t.date);
    out[m] ??= {};
    out[m][t.categoryId] = (out[m][t.categoryId] || 0) + categoryEffect(t);
  }
  return out;
}

/**
 * Everything one month's budget screen needs.
 * Returns { month, readyToAssign, incomeThisMonth, assignedThisMonth, activityThisMonth,
 *           categories: { [id]: { carried, assigned, activity, available, needed } },
 *           overspent: [ids], unknownActivity }
 */
export function monthSummary(budget, transactionList, month) {
  const transactions = liveTransactions(transactionList);
  const cats = budget.categories || {};
  const assignedAll = budget.assigned || {};
  const activity = activityByMonth(transactions);
  const ids = Object.keys(cats);

  // Carry each category forward month by month up to the one shown.
  const available = Object.fromEntries(ids.map(id => [id, 0]));
  let carried = { ...available };
  for (let m = firstMonth(budget, transactions, month); m <= month; m = addMonths(m, 1)) {
    carried = { ...available };
    for (const id of ids) available[id] += (assignedAll[m]?.[id] || 0) + (activity[m]?.[id] || 0);
  }

  const assignedHere = assignedAll[month] || {};
  const activityHere = activity[month] || {};
  const categories = {};
  for (const id of ids) {
    const assigned = assignedHere[id] || 0;
    categories[id] = {
      carried: carried[id], assigned, activity: activityHere[id] || 0, available: available[id],
      needed: neededForTarget(cats[id], assigned),
    };
  }

  // Spending in a category that no longer exists still came out of your money.
  const unknownActivity = Object.entries(activityHere).filter(([id]) => !cats[id]).reduce((a, [, v]) => a + v, 0);

  const endOfMonth = `${month}-31`;
  let income = 0, incomeThisMonth = 0;
  for (const t of transactions) {
    if (t.kind !== 'income' || t.date > endOfMonth) continue;
    income += t.amount;
    if (monthOf(t.date) === month) incomeThisMonth += t.amount;
  }
  let everAssigned = 0;
  for (const [m, byCat] of Object.entries(assignedAll)) {
    if (!isMonth(m)) continue;
    for (const v of Object.values(byCat || {})) if (Number.isInteger(v)) everAssigned += v;
  }

  return {
    month,
    readyToAssign: income - everAssigned,
    incomeThisMonth,
    assignedThisMonth: Object.values(assignedHere).reduce((a, v) => a + (Number.isInteger(v) ? v : 0), 0),
    activityThisMonth: Object.values(activityHere).reduce((a, v) => a + v, 0),
    categories,
    overspent: ids.filter(id => available[id] < 0),
    unknownActivity,
  };
}

/** How much more needs assigning this month to meet a category's monthly target. */
export function neededForTarget(category, assignedThisMonth) {
  const goal = category?.target?.amount;
  if (!Number.isInteger(goal) || goal <= 0) return 0;
  return Math.max(0, goal - (assignedThisMonth || 0));
}

/**
 * Moves money in one month. `from` or `to` may be 'ready' (Ready to assign).
 * Returns a new assigned map for that month; the input is not changed.
 */
export function moveMoney(assignedMonth, from, to, amount) {
  if (!Number.isInteger(amount) || amount <= 0 || from === to) return { ...(assignedMonth || {}) };
  const out = { ...(assignedMonth || {}) };
  if (from !== 'ready') out[from] = (out[from] || 0) - amount;
  if (to !== 'ready') out[to] = (out[to] || 0) + amount;
  return out;
}

/**
 * Covers an overspent category from others, biggest leftovers first, never taking a donor below
 * zero. Returns { assigned, covered } where covered may be less than asked if money runs short.
 */
export function coverOverspending(summary, assignedMonth, targetId, donorIds) {
  let short = -Math.min(0, summary.categories[targetId]?.available ?? 0);
  let out = { ...(assignedMonth || {}) };
  let covered = 0;
  const donors = donorIds
    .filter(id => id !== targetId && (summary.categories[id]?.available ?? 0) > 0)
    .sort((a, b) => summary.categories[b].available - summary.categories[a].available);
  for (const id of donors) {
    if (short <= 0) break;
    const take = Math.min(short, summary.categories[id].available);
    out = moveMoney(out, id, targetId, take);
    short -= take;
    covered += take;
  }
  return { assigned: out, covered };
}

/**
 * Assigns what each target still needs this month, bills first by due day, until Ready to assign
 * runs out. Returns { assigned, funded: { id: cents } }.
 */
export function fundTargets(budget, summary, assignedMonth) {
  let left = Math.max(0, summary.readyToAssign);
  let out = { ...(assignedMonth || {}) };
  const funded = {};
  const order = Object.entries(budget.categories || {})
    .filter(([id, c]) => !c.hidden && summary.categories[id]?.needed > 0)
    .sort(([, a], [, b]) => (a.target.dueDay ?? 99) - (b.target.dueDay ?? 99) || (a.order ?? 0) - (b.order ?? 0));
  for (const [id] of order) {
    if (left <= 0) break;
    const give = Math.min(left, summary.categories[id].needed);
    out = moveMoney(out, 'ready', id, give);
    funded[id] = give;
    left -= give;
  }
  return { assigned: out, funded };
}

/** Categories grouped and in order, for drawing the budget screen. */
export function groupedCategories(budget) {
  const groups = new Map();
  for (const [id, c] of Object.entries(budget.categories || {}).sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0))) {
    if (c.hidden) continue;
    const g = c.group || 'Other';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ id, ...c });
  }
  return [...groups].map(([name, categories]) => ({ name, categories }));
}
