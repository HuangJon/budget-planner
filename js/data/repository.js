/**
 * Every read and write of budget data, on top of either backend. Writes change only the fields
 * they mean to, so two people in a shared budget don't undo each other.
 *
 * Paths:
 *   budgets/{id}                         name, kind, members, categories, assigned
 *   budgets/{id}/transactions/{tid}      one transaction; deleting only marks it
 *   budgets/{id}/transactions/{tid}/revisions/{rid}   the version an edit replaced
 *   users/{uid}/budgets/{id}             your own list of budgets
 */
import { SCHEMA_VERSION, STARTER_CATEGORIES } from '../config/app.js';
import { randomId } from '../core/ids.js';
import { isValidTransaction } from '../core/budget.js';

const budgetPath = id => `budgets/${id}`;
const txCol = id => `budgets/${id}/transactions`;
const txPath = (id, tid) => `${txCol(id)}/${tid}`;

/** Categories for a new budget: the ticked starter ones, or the given names, in checklist order. */
export function starterCategories(picked = null) {
  const out = {};
  let order = 0;
  for (const g of STARTER_CATEGORIES) {
    for (const item of g.items) {
      if (picked ? picked.includes(item.name) : item.on) out[randomId(8)] = { name: item.name, group: g.group, order: order++ };
    }
  }
  return out;
}

export function createRepository(backend, now = () => Date.now()) {
  const uid = () => backend.uid?.() || 'none';
  const mine = id => `users/${uid()}/budgets/${id}`;

  return {
    kind: backend.kind,
    watchMyBudgets: (cb, err) => backend.watchCollection(`users/${uid()}/budgets`, list => cb(list.map(b => b.budgetId)), err),
    watchBudget: (id, cb, err) => backend.watchDoc(budgetPath(id), cb, err),
    /** Calls back with readable transactions and how many were too damaged to use. */
    watchTransactions: (id, cb, err) => backend.watchCollection(txCol(id), list => {
      const good = list.filter(isValidTransaction);
      cb(good, list.length - good.length);
    }, err),

    createBudget({ name, kind = 'personal', myName = 'You', categories = starterCategories(), startingMoney = 0, today = '' }) {
      const id = randomId(24);
      const budget = {
        id, schemaVersion: SCHEMA_VERSION, name, kind, categories, assigned: {},
        members: { [uid()]: { name: myName, admin: true, joinedAt: now() } }, createdAt: now(), changedBy: uid(),
      };
      const writes = [backend.set(budgetPath(id), budget), backend.set(mine(id), { budgetId: id, at: now() })];
      // Money already in the bank goes in as income, so it's ready to assign straight away.
      if (Number.isInteger(startingMoney) && startingMoney > 0 && today) {
        const tid = randomId();
        writes.push(backend.set(txPath(id, tid), { id: tid, budgetId: id, kind: 'income', amount: startingMoney, date: today, description: 'Starting money', categoryId: null, createdBy: uid(), createdAt: now() }));
      }
      return { budget, written: Promise.all(writes) };
    },
    renameBudget: (id, name) => backend.update(budgetPath(id), { name, changedBy: uid() }),

    /** Sets what's assigned to some categories in one month. Pass { catId: cents }. */
    setAssigned: (id, month, byCategory) => backend.update(budgetPath(id), {
      ...Object.fromEntries(Object.entries(byCategory).map(([cat, v]) => [`assigned.${month}.${cat}`, v])),
      changedBy: uid(),
    }),
    updateCategory: (id, catId, fields) => backend.update(budgetPath(id), {
      ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [`categories.${catId}.${k}`, v])),
      changedBy: uid(),
    }),
    addCategory(id, { name, group, order }) {
      const catId = randomId(8);
      return { catId, written: backend.update(budgetPath(id), { [`categories.${catId}`]: { name, group, order }, changedBy: uid() }) };
    },

    addTransaction(id, fields) {
      const tid = randomId();
      const t = { ...fields, id: tid, budgetId: id, createdBy: uid(), createdAt: now() };
      return { transaction: t, written: backend.set(txPath(id, tid), t) };
    },
    /** Keeps the version it replaces, so any edit can be undone. */
    async updateTransaction(id, before, fields) {
      const rid = randomId();
      await backend.set(`${txPath(id, before.id)}/revisions/${rid}`, { id: rid, at: now(), by: uid(), transaction: before });
      return backend.update(txPath(id, before.id), { ...fields, updatedAt: now(), updatedBy: uid() });
    },
    /** Only marks it, so it can be restored. */
    deleteTransaction: (id, tid) => backend.update(txPath(id, tid), { deleted: true, deletedAt: now(), deletedBy: uid() }),
    restoreTransaction: (id, tid) => backend.update(txPath(id, tid), { deleted: false, restoredAt: now(), restoredBy: uid() }),
  };
}
