/** Made-up budgets for the preview, dated around the current month so it always looks lived in. */
import { addMonths, thisMonth } from '../core/budget.js';
import { recurringId } from '../core/recurring.js';

export function exampleData(uid, now = new Date()) {
  const m = thisMonth(now), last = addMonths(m, -1);
  const day = Math.min(now.getDate(), 28);
  const d = (month, dd) => `${month}-${String(Math.min(dd, month === m ? day : 28)).padStart(2, '0')}`;
  const cat = (name, group, order, target) => ({ name, group, order, ...(target ? { target } : {}) });
  const categories = {
    rent: cat('Rent', 'Bills', 0, { amount: 180000, dueDay: 1 }),
    power: cat('Utilities', 'Bills', 1, { amount: 12000, dueDay: 12 }),
    phone: cat('Phone', 'Bills', 2, { amount: 6500, dueDay: 18 }),
    subs: cat('Subscriptions', 'Bills', 3, { amount: 3500, dueDay: 22 }),
    groceries: cat('Groceries', 'Everyday', 4, { amount: 60000 }),
    eating: cat('Eating out', 'Everyday', 5),
    transport: cat('Transport', 'Everyday', 6, { amount: 13200 }),
    household: cat('Household', 'Everyday', 7),
    fun: cat('Entertainment', 'Fun', 8),
    clothes: cat('Clothes', 'Fun', 9, { type: 'yearly', amount: 200000 }),
    gifts: cat('Gifts', 'Fun', 10, { type: 'yearly', amount: 60000 }),
    unplanned: cat('Stuff I didn\u2019t plan for', 'Saving for', 11, { type: 'monthly', amount: 10000 }),
    emergency: cat('Emergency fund', 'Saving for', 12, { type: 'monthly', amount: 25000 }),
    travel: cat('Vacation', 'Saving for', 13, { type: 'byDate', amount: 300000, date: addMonths(m, 7) }),
    investing: cat('Investing', 'Saving for', 14),
  };
  const id = 'examplebudgethome0000000';
  const budget = {
    id, schemaVersion: 1, name: 'Home', kind: 'shared', categories, createdAt: 0, changedBy: uid,
    members: { [uid]: { name: 'You', admin: true, joinedAt: 0 }, sam: { name: 'Sam', joinedAt: 1 } },
    invite: { code: 'examplepreviewinvite01', at: 0 },
    requests: { alexrequest: { name: 'Alex', at: 2, invite: 'examplepreviewinvite01' } },
    recurring: {
      pay: { id: 'pay', kind: 'income', amount: 260000, description: 'Paycheck', day: 1, start: last },
      sampay: { id: 'sampay', kind: 'income', amount: 180000, description: 'Sam\u2019s paycheck', day: 1, start: last },
      rent: { id: 'rent', kind: 'spend', amount: 180000, description: 'Rent', categoryId: 'rent', day: 1, start: last },
      phone: { id: 'phone', kind: 'spend', amount: 6500, description: 'Phone bill', categoryId: 'phone', day: 18, start: last },
      stream: { id: 'stream', kind: 'spend', amount: 3499, description: 'Streaming', categoryId: 'subs', day: 22, start: last },
    },
    assigned: {
      [addMonths(m, -3)]: { clothes: 120000 },
      [last]: { rent: 180000, power: 12000, phone: 6500, subs: 3500, groceries: 55000, eating: 20000, transport: 13200, household: 8000, fun: 10000, gifts: 5000, unplanned: 10000, emergency: 25000, travel: 60000, investing: 30000 },
      [m]: { rent: 180000, power: 12000, groceries: 60000, eating: 15000, transport: 13200, household: 5000, fun: 8000 },
    },
  };
  let n = 0;
  const t = (kind, amount, date, categoryId, description, by = uid, rule = null) => ({
    id: rule ? recurringId(rule, date.slice(0, 7)) : `ex${String(n++).padStart(3, '0')}`, budgetId: id, kind, amount, date,
    categoryId: categoryId || null, description, createdBy: by, createdAt: n++, ...(rule ? { recurringId: rule } : {}),
  });
  const transactions = [
    t('income', 260000, `${last}-01`, null, 'Paycheck', uid, 'pay'),
    t('income', 180000, `${last}-01`, null, 'Sam\u2019s paycheck', 'sam', 'sampay'),
    t('spend', 180000, `${last}-01`, 'rent', 'Rent', uid, 'rent'),
    t('spend', 11240, d(last, 12), 'power', 'Con Edison'),
    t('spend', 6500, `${last}-18`, 'phone', 'Phone bill', uid, 'phone'),
    t('spend', 3499, `${last}-22`, 'subs', 'Streaming', uid, 'stream'),
    t('spend', 48211, d(last, 15), 'groceries', 'Trader Joe\'s', 'sam'),
    t('spend', 23850, d(last, 20), 'eating', 'Dinner out'),
    t('spend', 13200, d(last, 2), 'transport', 'MetroCard'),
    t('spend', 4120, d(last, 9), 'household', 'Target'),
    t('spend', 6800, d(last, 25), 'fun', 'Concert tickets', 'sam'),
    t('spend', 98000, d(addMonths(m, -3), 12), 'clothes', 'Winter coat and boots'),
    t('spend', 30000, d(last, 3), 'investing', 'Transfer to brokerage'),
    t('income', 260000, `${m}-01`, null, 'Paycheck', uid, 'pay'),
    t('income', 180000, `${m}-01`, null, 'Sam\u2019s paycheck', 'sam', 'sampay'),
    t('spend', 180000, `${m}-01`, 'rent', 'Rent', uid, 'rent'),
    t('spend', 13200, d(m, 2), 'transport', 'MetroCard'),
    t('spend', 21456, d(m, 3), 'groceries', 'Whole Foods', 'sam'),
    t('spend', 6235, d(m, 4), 'groceries', 'Trader Joe\'s'),
    t('spend', 4280, d(m, 3), 'eating', 'Tacos'),
    t('spend', 12600, d(m, 5), 'eating', 'Birthday dinner', 'sam'),
    t('spend', 1899, d(m, 5), 'household', 'Paper towels'),
    t('refund', 1500, d(m, 6), 'household', 'Returned lamp bulbs'),
  ];
  // Three earlier months so Trends has something to compare against.
  for (const [back, k] of [[4, 0.95], [3, 1.05], [2, 0.9]]) {
    const mm = addMonths(m, -back);
    const cents = v => Math.round(v * k);
    budget.assigned[mm] = { ...(budget.assigned[mm] || {}), rent: 180000, power: 12000, phone: 6500, subs: 3500, groceries: 55000, eating: 15000, transport: 13200, household: 6000, fun: 8000 };
    transactions.push(
      t('income', 260000, `${mm}-01`, null, 'Paycheck'), t('income', 180000, `${mm}-01`, null, 'Sam\u2019s paycheck', 'sam'),
      t('spend', 180000, `${mm}-01`, 'rent', 'Rent'), t('spend', cents(10800), `${mm}-12`, 'power', 'Con Edison'),
      t('spend', 6500, `${mm}-18`, 'phone', 'Phone bill'), t('spend', 3499, `${mm}-22`, 'subs', 'Streaming'),
      t('spend', cents(21000), `${mm}-04`, 'groceries', 'Trader Joe\'s'), t('spend', cents(26500), `${mm}-17`, 'groceries', 'Whole Foods', 'sam'),
      t('spend', cents(5200), `${mm}-03`, 'eating', 'Tacos'), t('spend', cents(13800), `${mm}-21`, 'eating', 'Dinner out', 'sam'),
      t('spend', 13200, `${mm}-02`, 'transport', 'MetroCard'), t('spend', cents(4600), `${mm}-09`, 'household', 'Target'),
      t('spend', cents(5400), `${mm}-14`, 'fun', 'Movies'),
    );
  }
  const docs = {
    [`budgets/${id}`]: budget,
    [`users/${uid}/budgets/${id}`]: { budgetId: id, at: 0 },
    'invites/examplepreviewinvite01': { code: 'examplepreviewinvite01', budgetId: id, budgetName: 'Home', by: uid, at: 0 },
  };
  for (const x of transactions) docs[`budgets/${id}/transactions/${x.id}`] = x;
  return docs;
}
