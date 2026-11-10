/**
 * Every read and write of budget data, on top of either backend. Writes change only the fields
 * they mean to, so two people in a shared budget don't undo each other. Changes that belong
 * together go in one batch, so they land together or not at all.
 *
 * Paths:
 *   budgets/{id}                         name, kind, members, requests, categories, assigned, recurring
 *   budgets/{id}/transactions/{tid}      one transaction; deleting only marks it
 *   budgets/{id}/transactions/{tid}/revisions/{rid}   the version an edit replaced
 *   users/{uid}                          first seen and the last week you used the app (for counting)
 *   users/{uid}/budgets/{id}             your own list of budgets
 *   users/{uid}/pending/{id}             budgets you've asked to join
 *   invites/{code}                       which budget an invite link opens; the code can be reset
 *   stats/usage                          counts only: people, budgets, people active each week
 *   errorLog/{id}                        scrubbed error reports, readable only by the app's owner
 */
import { SCHEMA_VERSION, STARTER_CATEGORIES } from '../config/app.js';
import { randomId } from '../core/ids.js';
import { isValidTransaction } from '../core/budget.js';
import { isoWeek } from '../core/usage.js';
import { increment } from './fields.js';

const budgetPath = id => `budgets/${id}`;
const txCol = id => `budgets/${id}/transactions`;
const txPath = (id, tid) => `${txCol(id)}/${tid}`;
export const STATS = 'stats/usage';
/** A deleted budget can be brought back for this long. */
export const RESTORE_DAYS = 30;

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
  const batch = writes => backend.batch(writes);

  return {
    kind: backend.kind,
    auth: backend.auth,
    watchMyBudgets: (cb, err) => backend.watchCollection(`users/${uid()}/budgets`, list => cb(list.map(b => b.budgetId)), err),
    watchBudget: (id, cb, err) => backend.watchDoc(budgetPath(id), cb, err),
    /** Calls back with readable transactions and how many were too damaged to use. */
    watchTransactions: (id, cb, err) => backend.watchCollection(txCol(id), list => {
      const good = list.filter(isValidTransaction);
      cb(good, list.length - good.length);
    }, err),

    /* ---------- Counting, for the owner page ---------- */
    /**
     * The first time an account is seen it counts as one more person; the first time each week it
     * counts as active that week. Nothing else about the person is recorded.
     */
    async noteVisit(date = new Date()) {
      const week = isoWeek(date);
      const me = `users/${uid()}`;
      const profile = await backend.get(me).catch(() => null);
      if (!profile) {
        return batch([
          { op: 'set', path: me, value: { uid: uid(), at: now(), lastWeek: week } },
          { op: 'merge', path: STATS, value: { people: increment(1), weeks: { [week]: increment(1) } } },
        ]);
      }
      if (profile.lastWeek === week) return null;
      return batch([
        { op: 'update', path: me, value: { lastWeek: week } },
        { op: 'merge', path: STATS, value: { weeks: { [week]: increment(1) } } },
      ]);
    },
    readStats: () => backend.get(STATS),
    listErrors: () => backend.list('errorLog', { orderBy: 'at', limit: 100 }),
    /** Whether this account is the app's owner (listed in /developers by hand in the Firebase console). */
    amOwner: async () => Boolean(await backend.get(`developers/${uid()}`).catch(() => null)),
    logError: record => backend.set(`errorLog/${record.id}`, record),
    /** A problem someone reports in their own words; their email only if they chose to include it. */
    sendReport: record => backend.set(`reports/${record.id}`, record),
    listReports: () => backend.list('reports', { orderBy: 'at', limit: 200 }),
    markReport: (id, done) => backend.update(`reports/${id}`, { done }),

    /* ---------- Budgets ---------- */
    createBudget({ name, kind = 'personal', myName = 'You', categories = starterCategories(), startingMoney = 0, today = '' }) {
      const id = randomId(24);
      const budget = {
        id, schemaVersion: SCHEMA_VERSION, name, kind, categories, assigned: {}, recurring: {}, requests: {},
        // The budget starts today: anything imported from earlier is history, not money to plan.
        settings: /^\d{4}-\d{2}-\d{2}$/.test(today) ? { startDate: today } : {},
        members: { [uid()]: { name: myName, admin: true, joinedAt: now() } }, createdAt: now(), changedBy: uid(), deleted: false,
      };
      const writes = [
        { op: 'set', path: budgetPath(id), value: budget },
        { op: 'set', path: mine(id), value: { budgetId: id, at: now() } },
        // One more budget for the owner's count; the rules check this budget is really new.
        { op: 'merge', path: STATS, value: { budgets: increment(1), lastBudget: id } },
      ];
      // Money already in the bank goes in as income, so it's ready to assign straight away.
      if (Number.isInteger(startingMoney) && startingMoney > 0 && today) {
        const tid = randomId();
        writes.push({ op: 'set', path: txPath(id, tid), value: { id: tid, budgetId: id, kind: 'income', amount: startingMoney, date: today, description: 'Starting money', note: '', categoryId: null, createdBy: uid(), createdAt: now() } });
      }
      return { budget, written: batch(writes) };
    },
    renameBudget: (id, name) => backend.update(budgetPath(id), { name, changedBy: uid() }),
    /** Budget-wide settings everyone in it shares, like showing spending by person. */
    setSetting: (id, key, value) => backend.update(budgetPath(id), { [`settings.${key}`]: value, changedBy: uid() }),
    /** Admins only. Marks it deleted; it can be restored for RESTORE_DAYS. */
    deleteBudget: id => backend.update(budgetPath(id), { deleted: true, deletedAt: now(), deletedBy: uid(), changedBy: uid() }),
    restoreBudget: id => backend.update(budgetPath(id), { deleted: false, deletedAt: undefined, deletedBy: undefined, changedBy: uid() }),

    /** Sets what's assigned to some categories in one month. Pass { catId: cents }. */
    setAssigned: (id, month, byCategory) => backend.update(budgetPath(id), {
      ...Object.fromEntries(Object.entries(byCategory).map(([cat, v]) => [`assigned.${month}.${cat}`, v])),
      changedBy: uid(),
    }),
    /** New order (and group, when dragged to another one) for several categories in one save: { catId: { order, group } }. */
    arrangeCategories: (id, changes) => backend.update(budgetPath(id), {
      ...Object.fromEntries(Object.entries(changes).flatMap(([catId, f]) => Object.entries(f).map(([k, v]) => [`categories.${catId}.${k}`, v]))),
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
      const moving = transactions.filter(t => t.categoryId === catId);
      if (moving.length && !moveTo) throw Object.assign(new Error('Category still has transactions'), { code: 'in-use' });
      // Batches hold up to 500 writes; move transactions in chunks, then remove the category.
      for (let i = 0; i < moving.length; i += 400) {
        await batch(moving.slice(i, i + 400).map(t => ({ op: 'update', path: txPath(id, t.id), value: { categoryId: moveTo, movedFrom: catId, updatedAt: now(), updatedBy: uid() } })));
      }
      await backend.update(budgetPath(id), fields);
    },
    /** Renames a group by moving every category in it, hidden ones included. */
    async renameGroup(id, from, to) {
      const b = await backend.get(budgetPath(id));
      const fields = Object.fromEntries(Object.entries(b?.categories || {}).filter(([, c]) => (c.group || 'Other') === from).map(([cid]) => [`categories.${cid}.group`, to]));
      if (Object.keys(fields).length) await backend.update(budgetPath(id), { ...fields, changedBy: uid() });
    },
    /** An account to check against: its name, whether it's a card, and its balance in cents (a card's is what's owed). */
    saveAccount(id, accountId, { name, kind, balance }) {
      return backend.update(budgetPath(id), { [`accounts.${accountId}`]: { name, kind, balance, updatedAt: now(), updatedBy: uid() }, changedBy: uid() });
    },
    /** A transaction's earlier versions, oldest first (every edit keeps one). */
    revisions: (id, tid) => backend.list(`${txPath(id, tid)}/revisions`, { orderBy: 'at' }),
    renameAccount: (id, accountId, name) => backend.update(budgetPath(id), { [`accounts.${accountId}.name`]: name, changedBy: uid() }),
    removeAccount: (id, accountId) => backend.update(budgetPath(id), { [`accounts.${accountId}`]: undefined, changedBy: uid() }),
    addCategory(id, { name, group, order }) {
      const catId = randomId(8);
      return { catId, written: backend.update(budgetPath(id), { [`categories.${catId}`]: { name, group, order }, changedBy: uid() }) };
    },

    /* ---------- Transactions ---------- */
    addTransaction(id, fields, tid = randomId()) {
      const t = { note: '', ...fields, id: tid, budgetId: id, createdBy: uid(), createdAt: now() };
      return { transaction: t, written: backend.set(txPath(id, tid), t) };
    },
    /** Keeps the version it replaces, so any edit can be undone. */
    updateTransaction(id, before, fields) {
      const rid = randomId();
      return batch([
        { op: 'set', path: `${txPath(id, before.id)}/revisions/${rid}`, value: { id: rid, at: now(), by: uid(), transaction: before } },
        { op: 'update', path: txPath(id, before.id), value: { ...fields, updatedAt: now(), updatedBy: uid() } },
      ]);
    },
    /**
     * Moves many transactions to another category at once (a search's results, or everything from
     * one place). Each keeps its old version, like any edit. Goes in groups to stay within limits.
     */
    async recategorize(id, transactions, categoryId) {
      for (let i = 0; i < transactions.length; i += 100) {
        await batch(transactions.slice(i, i + 100).flatMap(before => {
          const rid = randomId();
          return [
            { op: 'set', path: `${txPath(id, before.id)}/revisions/${rid}`, value: { id: rid, at: now(), by: uid(), transaction: before } },
            { op: 'update', path: txPath(id, before.id), value: { categoryId, updatedAt: now(), updatedBy: uid() } },
          ];
        }));
      }
    },
    /** Only marks it, so it can be restored. */
    deleteTransaction: (id, tid) => backend.update(txPath(id, tid), { deleted: true, deletedAt: now(), deletedBy: uid() }),
    restoreTransaction: (id, tid) => backend.update(txPath(id, tid), { deleted: false, restoredAt: now(), restoredBy: uid() }),

    /**
     * Saves reviewed rows from a bank file. Each keeps the id made from its bank line, so the same
     * line imported again is recognised. One deleted earlier comes back instead of being made twice.
     * Writes go in groups so a large file stays inside the database's limits.
     */
    async importTransactions(id, list, deletedIds = new Set(), { file = '', accountId = null } = {}) {
      // Every row remembers which import (and which account) it came from, and the import itself
      // is recorded, so it can be taken back out later as a whole.
      const importId = randomId(16);
      const tag = { importId, accountId: accountId || null };
      for (let i = 0; i < list.length; i += 100) {
        await batch(list.slice(i, i + 100).map(t => (deletedIds.has(t.id)
          ? { op: 'update', path: txPath(id, t.id), value: { kind: t.kind, amount: t.amount, date: t.date, description: t.description, categoryId: t.categoryId ?? null, ...tag, deleted: false, restoredAt: now(), restoredBy: uid() } }
          : { op: 'set', path: txPath(id, t.id), value: { note: '', ...t, ...tag, categoryId: t.categoryId ?? null, budgetId: id, createdBy: uid(), createdAt: now() } })));
      }
      await batch([
        { op: 'set', path: `${budgetPath(id)}/imports/${importId}`, value: { id: importId, at: now(), by: uid(), file: String(file).slice(0, 80), accountId: accountId || null, count: list.length, ids: list.map(t => t.id), undone: false } },
        { op: 'update', path: budgetPath(id), value: { 'settings.lastImport': now(), changedBy: uid() } },
      ]);
      return importId;
    },
    listImports: id => backend.list(`${budgetPath(id)}/imports`, { orderBy: 'at' }),
    /** Takes a past import back out, or brings it back, as a whole. */
    async undoImport(id, rec) {
      await this.unimport(id, rec.ids);
      await backend.update(`${budgetPath(id)}/imports/${rec.id}`, { undone: true });
    },
    async redoImport(id, rec) {
      for (let i = 0; i < rec.ids.length; i += 100) {
        await batch(rec.ids.slice(i, i + 100).map(tid => ({ op: 'update', path: txPath(id, tid), value: { deleted: false, restoredAt: now(), restoredBy: uid() } })));
      }
      await backend.update(`${budgetPath(id)}/imports/${rec.id}`, { undone: false });
    },
    /** Takes a whole import back out (only marks them, like any delete). */
    async unimport(id, ids) {
      for (let i = 0; i < ids.length; i += 100) {
        await batch(ids.slice(i, i + 100).map(tid => ({ op: 'update', path: txPath(id, tid), value: { deleted: true, deletedAt: now(), deletedBy: uid() } })));
      }
    },

    /* ---------- Repeats ---------- */
    newRuleId: () => randomId(10),
    saveRule: (id, rule) => backend.update(budgetPath(id), { [`recurring.${rule.id}`]: rule, changedBy: uid() }),
    stopRule: (id, ruleId) => backend.update(budgetPath(id), { [`recurring.${ruleId}.stopped`]: true, changedBy: uid() }),
    /** Starting again from `month` means months it was stopped aren't filled in afterwards. */
    resumeRule: (id, ruleId, month) => backend.update(budgetPath(id), { [`recurring.${ruleId}.stopped`]: false, ...(month ? { [`recurring.${ruleId}.start`]: month } : {}), changedBy: uid() }),
    /** Adds the copies that are due. Each has a fixed id, so two phones doing this at once agree. */
    addRecurringCopies: (id, list) => batch(list.slice(0, 400).map(t => ({ op: 'set', path: txPath(id, t.id), value: { note: '', ...t, budgetId: id, createdBy: uid(), createdAt: now(), automatic: true } }))),

    /* ---------- People ---------- */
    /** Makes a new invite link and retires the old one, so a shared link can be cut off. */
    async resetInvite(id, oldCode, budgetName = '') {
      const code = randomId(20);
      await batch([
        ...(oldCode ? [{ op: 'remove', path: `invites/${oldCode}` }] : []),
        // The budget's name rides along so the join screen can say what you're joining before you're in.
        { op: 'set', path: `invites/${code}`, value: { code, budgetId: id, budgetName: String(budgetName).slice(0, 60), by: uid(), at: now() } },
        { op: 'update', path: budgetPath(id), value: { invite: { code, at: now() }, changedBy: uid() } },
      ]);
      return code;
    },
    lookUpInvite: code => backend.get(`invites/${code}`),
    /**
     * Asks to join with an invite code. Nothing in the budget is visible until an admin lets you in;
     * your own list keeps the request so you can see it's waiting.
     */
    async requestToJoin(code, myName) {
      const invite = await backend.get(`invites/${code}`);
      if (!invite) throw Object.assign(new Error('No such invite'), { code: 'not-found' });
      await batch([
        { op: 'update', path: budgetPath(invite.budgetId), value: { [`requests.${uid()}`]: { name: myName, at: now(), invite: code } } },
        { op: 'set', path: `users/${uid()}/pending/${invite.budgetId}`, value: { budgetId: invite.budgetId, budgetName: invite.budgetName || '', at: now() } },
      ]);
      return invite.budgetId;
    },
    watchMyPending: (cb, err) => backend.watchCollection(`users/${uid()}/pending`, cb, err),
    async cancelRequest(id) {
      await backend.update(budgetPath(id), { [`requests.${uid()}`]: undefined }).catch(() => {});
      await backend.remove(`users/${uid()}/pending/${id}`);
    },
    dismissPending: id => backend.remove(`users/${uid()}/pending/${id}`),
    /** An admin lets someone in: they become a member and the budget appears in their list. */
    async approveRequest(id, memberUid) {
      const b = await backend.get(budgetPath(id));
      const req = b?.requests?.[memberUid];
      if (!req) throw Object.assign(new Error('No such request'), { code: 'not-found' });
      await batch([
        { op: 'update', path: budgetPath(id), value: { [`members.${memberUid}`]: { name: req.name, joinedAt: now(), invite: req.invite, approvedBy: uid() }, [`requests.${memberUid}`]: undefined, changedBy: uid() } },
        { op: 'set', path: `users/${memberUid}/budgets/${id}`, value: { budgetId: id, at: now() } },
        { op: 'remove', path: `users/${memberUid}/pending/${id}` },
      ]);
    },
    async declineRequest(id, memberUid) {
      await batch([
        { op: 'update', path: budgetPath(id), value: { [`requests.${memberUid}`]: undefined, changedBy: uid() } },
        { op: 'merge', path: `users/${memberUid}/pending/${id}`, value: { declined: true } },
      ]);
    },
    /** Removes someone and takes the budget off their list; what they added stays. */
    removeMember: (id, memberUid) => batch([
      { op: 'update', path: budgetPath(id), value: { [`members.${memberUid}`]: undefined, [`removed.${memberUid}`]: now(), changedBy: uid() } },
      { op: 'remove', path: `users/${memberUid}/budgets/${id}` },
    ]),
    setAdmin: (id, memberUid, admin) => backend.update(budgetPath(id), { [`members.${memberUid}.admin`]: admin, changedBy: uid() }),
    renameMe: (id, name) => backend.update(budgetPath(id), { [`members.${uid()}.name`]: name, changedBy: uid() }),
    leaveBudget: id => batch([
      { op: 'update', path: budgetPath(id), value: { [`members.${uid()}`]: undefined, changedBy: uid() } },
      { op: 'remove', path: mine(id) },
    ]),
  };
}
