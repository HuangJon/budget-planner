/**
 * Every read and write of budget data, on top of either backend. Writes change only the fields
 * they mean to, so two people in a shared budget don't undo each other.
 *
 * Paths:
 *   budgets/{id}                         name, kind, members, categories, assigned
 *   budgets/{id}/transactions/{tid}      one transaction; deleting only marks it
 *   budgets/{id}/transactions/{tid}/revisions/{rid}   the version an edit replaced
 *   users/{uid}/budgets/{id}             your own list of budgets
 *   invites/{code}                       which budget an invite link opens; the code can be reset
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
    /** Budget-wide settings everyone in it shares, like showing spending by person. */
    setSetting: (id, key, value) => backend.update(budgetPath(id), { [`settings.${key}`]: value, changedBy: uid() }),

    /** Sets what's assigned to some categories in one month. Pass { catId: cents }. */
    setAssigned: (id, month, byCategory) => backend.update(budgetPath(id), {
      ...Object.fromEntries(Object.entries(byCategory).map(([cat, v]) => [`assigned.${month}.${cat}`, v])),
      changedBy: uid(),
    }),
    updateCategory: (id, catId, fields) => backend.update(budgetPath(id), {
      ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [`categories.${catId}.${k}`, v])),
      changedBy: uid(),
    }),
    /**
     * Deletes a category for good. Its transactions, planned money and repeats move to `moveTo`
     * first, so totals stay right and nothing goes missing. With no `moveTo` it must be unused.
     */
    async deleteCategory(id, catId, moveTo = null, transactions = []) {
      const b = await backend.get(budgetPath(id));
      const fields = { [`categories.${catId}`]: undefined, changedBy: uid() };
      for (const [m, byCat] of Object.entries(b?.assigned || {})) {
        if (!byCat?.[catId]) continue;
        if (moveTo) fields[`assigned.${m}.${moveTo}`] = (byCat[moveTo] || 0) + byCat[catId];
        fields[`assigned.${m}.${catId}`] = undefined;
      }
      for (const [rid, r] of Object.entries(b?.recurring || {})) if (r.categoryId === catId) fields[moveTo ? `recurring.${rid}.categoryId` : `recurring.${rid}.stopped`] = moveTo || true;
      const mine = transactions.filter(t => t.categoryId === catId);
      if (mine.length && !moveTo) throw Object.assign(new Error('Category still has transactions'), { code: 'in-use' });
      await Promise.all(mine.map(t => backend.update(txPath(id, t.id), { categoryId: moveTo, movedFrom: catId, updatedAt: now(), updatedBy: uid() })));
      await backend.update(budgetPath(id), fields);
    },
    /** Renames a group by moving every category in it, hidden ones included. */
    async renameGroup(id, from, to) {
      const b = await backend.get(budgetPath(id));
      const fields = Object.fromEntries(Object.entries(b?.categories || {}).filter(([, c]) => (c.group || 'Other') === from).map(([cid]) => [`categories.${cid}.group`, to]));
      if (Object.keys(fields).length) await backend.update(budgetPath(id), { ...fields, changedBy: uid() });
    },
    addCategory(id, { name, group, order }) {
      const catId = randomId(8);
      return { catId, written: backend.update(budgetPath(id), { [`categories.${catId}`]: { name, group, order }, changedBy: uid() }) };
    },

    addTransaction(id, fields, tid = randomId()) {
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

    /* ---------- Repeating every month ---------- */
    newRuleId: () => randomId(10),
    saveRule: (id, rule) => backend.update(budgetPath(id), { [`recurring.${rule.id}`]: rule, changedBy: uid() }),
    stopRule: (id, ruleId) => backend.update(budgetPath(id), { [`recurring.${ruleId}.stopped`]: true, changedBy: uid() }),
    /** Starting again from `month` means months it was stopped aren't filled in afterwards. */
    resumeRule: (id, ruleId, month) => backend.update(budgetPath(id), { [`recurring.${ruleId}.stopped`]: false, ...(month ? { [`recurring.${ruleId}.start`]: month } : {}), changedBy: uid() }),
    /** Adds this month's copies. Each has a fixed id, so two phones doing this at once agree. */
    addRecurringCopies: (id, list) => Promise.all(list.map(t => backend.set(txPath(id, t.id), { ...t, budgetId: id, createdBy: uid(), createdAt: now(), automatic: true }))),

    /* ---------- People ---------- */
    /** Makes a new invite link and retires the old one, so a shared link can be cut off. */
    async resetInvite(id, oldCode, budgetName = '') {
      const code = randomId(20);
      if (oldCode) await backend.remove(`invites/${oldCode}`);
      // The budget's name rides along so the join screen can say what you're joining before you're in.
      await backend.set(`invites/${code}`, { code, budgetId: id, budgetName, by: uid(), at: now() });
      await backend.update(budgetPath(id), { invite: { code, at: now() }, changedBy: uid() });
      return code;
    },
    lookUpInvite: code => backend.get(`invites/${code}`),
    async joinWithCode(code, myName) {
      const invite = await backend.get(`invites/${code}`);
      if (!invite) throw Object.assign(new Error('No such invite'), { code: 'not-found' });
      await backend.update(budgetPath(invite.budgetId), { [`members.${uid()}`]: { name: myName, joinedAt: now(), invite: code }, changedBy: uid() });
      await backend.set(mine(invite.budgetId), { budgetId: invite.budgetId, at: now() });
      return invite.budgetId;
    },
    removeMember: (id, memberUid) => backend.update(budgetPath(id), { [`members.${memberUid}`]: undefined, [`removed.${memberUid}`]: now(), changedBy: uid() }),
    setAdmin: (id, memberUid, admin) => backend.update(budgetPath(id), { [`members.${memberUid}.admin`]: admin, changedBy: uid() }),
    renameMe: (id, name) => backend.update(budgetPath(id), { [`members.${uid()}.name`]: name, changedBy: uid() }),
    async leaveBudget(id) {
      await backend.update(budgetPath(id), { [`members.${uid()}`]: undefined, changedBy: uid() });
      await backend.remove(mine(id));
    },
  };
}
