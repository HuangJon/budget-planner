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
/** The date a new entry starts with: today, or the same day in the month being viewed (clamped to its length). */
export function defaultDateFor(todayIso, viewing) {
  if (!viewing || viewing === todayIso.slice(0, 7)) return todayIso;
  const [y, m] = viewing.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${viewing}-${String(Math.min(Number(todayIso.slice(8, 10)), last)).padStart(2, '0')}`;
}
export const thisMonth = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export function isValidTransaction(t) {
  if (!isMap(t) || typeof t.id !== 'string' || !['income', 'spend', 'refund'].includes(t.kind)) return false;
  if (!Number.isInteger(t.amount) || t.amount <= 0 || typeof t.date !== 'string' || !DATE.test(t.date)) return false;
  if (t.kind !== 'income' && typeof t.categoryId !== 'string') return false;
  return true;
}

export const liveTransactions = list => (list || []).filter(t => !t.deleted && isValidTransaction(t));

/**
 * When the budget starts (YYYY-MM-DD), or null for "from the beginning". Anything dated earlier is
 * history: it shows in Trends and search, but doesn't move any money in the budget. Starting money
 * always counts, whatever its date.
 */
export const budgetStart = budget => (/^\d{4}-\d{2}-\d{2}$/.test(budget?.settings?.startDate || '') ? budget.settings.startDate : null);
export const isStartingMoney = t => t.kind === 'income' && t.description === 'Starting money';
export const isHistory = (budget, t) => { const s = budgetStart(budget); return Boolean(s) && t.date < s && !isStartingMoney(t); };
/** The transactions that move money in the budget: live, and not history. */
export const budgetTransactions = (budget, list) => liveTransactions(list).filter(t => !isHistory(budget, t));

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
 *           categories: { [id]: { carried, assigned, activity, available, needed, target } },
 *           overspent: [ids], unknownActivity }
 */
export function monthSummary(budget, transactionList, month) {
  const transactions = budgetTransactions(budget, transactionList);
  const cats = budget.categories || {};
  const assignedAll = budget.assigned || {};
  const activity = activityByMonth(transactions);
  const ids = Object.keys(cats);

  // Carry each category forward month by month up to the one shown.
  const available = Object.fromEntries(ids.map(id => [id, 0]));
  let carried = { ...available };
  // For yearly targets: what was assigned earlier this year, and what was spent this year so far.
  const year = month.slice(0, 4);
  const assignedEarlierThisYear = { ...available }, spentThisYear = { ...available };
  for (let m = firstMonth(budget, transactions, month); m <= month; m = addMonths(m, 1)) {
    carried = { ...available };
    for (const id of ids) {
      const a = assignedAll[m]?.[id] || 0, act = activity[m]?.[id] || 0;
      available[id] += a + act;
      if (m.startsWith(year)) {
        spentThisYear[id] -= act;
        if (m < month) assignedEarlierThisYear[id] += a;
      }
    }
  }

  const assignedHere = assignedAll[month] || {};
  const activityHere = activity[month] || {};
  const categories = {};
  for (const id of ids) {
    const assigned = assignedHere[id] || 0;
    categories[id] = {
      carried: carried[id], assigned, activity: activityHere[id] || 0, available: available[id],
      ...targetStatus(cats[id], { month, assigned, carried: carried[id], available: available[id], assignedEarlierThisYear: assignedEarlierThisYear[id], spentThisYear: spentThisYear[id] }),
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

/**
 * Target kinds (category.target):
 *   { type: 'monthly', amount, dueDay? }   needs `amount` assigned every month (bills, groceries)
 *   { type: 'yearly', amount }              a yearly allowance, spread over the months left in the year;
 *                                           money builds up and gets spent whenever (clothes, gifts)
 *   { type: 'byDate', amount, date: 'YYYY-MM' }  save up `amount` by the end of that month (vacation)
 * A target with no type is monthly, which is how round 1 stored them.
 */
export const targetType = t => (t && Number.isInteger(t.amount) && t.amount > 0 ? (['monthly', 'yearly', 'byDate'].includes(t.type) ? t.type : 'monthly') : null);

const monthsBetween = (from, to) => {
  const [a, b] = [from, to].map(m => m.split('-').map(Number));
  return (b[0] - a[0]) * 12 + (b[1] - a[1]);
};

/**
 * What a category still needs this month, and how far along it is.
 * Returns { needed, target: null | { type, amount, ...progress } }.
 */
export function targetStatus(category, { month, assigned = 0, carried = 0, available = 0, assignedEarlierThisYear = 0, spentThisYear = 0 }) {
  const t = category?.target, type = targetType(t);
  if (!type) return { needed: 0, target: null };
  if (type === 'monthly') {
    return { needed: Math.max(0, t.amount - assigned), target: { type, amount: t.amount, dueDay: t.dueDay || null } };
  }
  if (type === 'yearly') {
    // A yearly target can wait for a later month (usually next January) instead of asking
    // for the whole year's amount in what's left of this one.
    if (isMonth(t.start) && month < t.start) return { needed: 0, target: { type, amount: t.amount, start: t.start, notStarted: true, perMonth: 0, spentThisYear: 0 } };
    const monthsLeft = 13 - Number(month.slice(5, 7));
    const perMonth = Math.ceil(Math.max(0, t.amount - assignedEarlierThisYear) / monthsLeft);
    return { needed: Math.max(0, perMonth - assigned), target: { type, amount: t.amount, perMonth, spentThisYear: Math.max(0, spentThisYear) } };
  }
  // byDate: save toward the amount, spreading what's missing over the months up to and including the date.
  const date = isMonth(t.date) ? t.date : month;
  const monthsLeft = monthsBetween(month, date) + 1;
  const saved = Math.max(0, available);
  if (monthsLeft <= 0) return { needed: 0, target: { type, amount: t.amount, date, saved, perMonth: 0, past: true } };
  const perMonth = Math.ceil(Math.max(0, t.amount - carried) / monthsLeft);
  return { needed: Math.max(0, perMonth - assigned), target: { type, amount: t.amount, date, saved, perMonth, past: false } };
}

/** Kept for older callers: what a monthly target still needs. */
export const neededForTarget = (category, assignedThisMonth) => targetStatus(category, { month: '2000-01', assigned: assignedThisMonth }).needed;

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

/**
 * Last month's plan copied into this one, for categories that have nothing planned yet.
 * Categories already planned this month keep their amount. Returns { assigned, copied: { id: cents } }.
 */
export function copyLastMonth(budget, month) {
  const prev = budget.assigned?.[addMonths(month, -1)] || {};
  const out = { ...(budget.assigned?.[month] || {}) };
  const copied = {};
  for (const [id, c] of Object.entries(budget.categories || {})) {
    if (c.hidden || (out[id] || 0) !== 0 || !(prev[id] > 0)) continue;
    out[id] = prev[id];
    copied[id] = prev[id];
  }
  return { assigned: out, copied };
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
