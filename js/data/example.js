/** Made-up budgets for the preview, dated around the current month so it always looks lived in. */
import { addMonths, thisMonth } from '../core/budget.js';

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
    assigned: {
      [addMonths(m, -3)]: { clothes: 120000 },
      [last]: { rent: 180000, power: 12000, phone: 6500, subs: 3500, groceries: 55000, eating: 20000, transport: 13200, household: 8000, fun: 10000, gifts: 5000, unplanned: 10000, emergency: 25000, travel: 60000, investing: 30000 },
      [m]: { rent: 180000, power: 12000, groceries: 60000, eating: 15000, transport: 13200, household: 5000, fun: 8000 },
    },
  };
  let n = 0;
  const t = (kind, amount, date, categoryId, description, by = uid) => ({ id: `ex${String(n++).padStart(3, '0')}`, budgetId: id, kind, amount, date, ...(categoryId ? { categoryId } : {}), description, createdBy: by, createdAt: n });
  const transactions = [
    t('income', 260000, d(last, 1), null, 'Paycheck'),
    t('income', 180000, d(last, 1), null, 'Sam paycheck', 'sam'),
    t('spend', 180000, d(last, 1), 'rent', 'Rent'),
    t('spend', 11240, d(last, 12), 'power', 'Con Edison'),
    t('spend', 6500, d(last, 18), 'phone', 'Phone bill'),
    t('spend', 3499, d(last, 22), 'subs', 'Streaming'),
    t('spend', 48211, d(last, 15), 'groceries', 'Trader Joe\'s', 'sam'),
    t('spend', 23850, d(last, 20), 'eating', 'Dinner out'),
    t('spend', 13200, d(last, 2), 'transport', 'MetroCard'),
    t('spend', 4120, d(last, 9), 'household', 'Target'),
    t('spend', 6800, d(last, 25), 'fun', 'Concert tickets', 'sam'),
    t('spend', 98000, d(addMonths(m, -3), 12), 'clothes', 'Winter coat and boots'),
    t('spend', 30000, d(last, 3), 'investing', 'Transfer to brokerage'),
    t('income', 260000, d(m, 1), null, 'Paycheck'),
    t('income', 180000, d(m, 1), null, 'Sam paycheck', 'sam'),
    t('spend', 180000, d(m, 1), 'rent', 'Rent'),
    t('spend', 13200, d(m, 2), 'transport', 'MetroCard'),
    t('spend', 21456, d(m, 3), 'groceries', 'Whole Foods', 'sam'),
    t('spend', 6235, d(m, 4), 'groceries', 'Trader Joe\'s'),
    t('spend', 4280, d(m, 3), 'eating', 'Tacos'),
    t('spend', 12600, d(m, 5), 'eating', 'Birthday dinner', 'sam'),
    t('spend', 1899, d(m, 5), 'household', 'Paper towels'),
    t('refund', 1500, d(m, 6), 'household', 'Returned lamp bulbs'),
  ];
  const docs = {
    [`budgets/${id}`]: budget,
    [`users/${uid}/budgets/${id}`]: { budgetId: id, at: 0 },
  };
  for (const x of transactions) docs[`budgets/${id}/transactions/${x.id}`] = x;
  return docs;
}
