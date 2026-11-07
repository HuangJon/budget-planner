import test from 'node:test'; import assert from 'node:assert/strict';
import { createLocalBackend } from '../../js/data/backend-local.js';
import { createRepository } from '../../js/data/repository.js';
import { monthSummary } from '../../js/core/budget.js';

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const fresh = () => { const backend = createLocalBackend({ area: memory() }); return { backend, repo: createRepository(backend, () => 1000) }; };

test('creating a budget lists it as yours with starter categories', async () => {
  const { backend, repo } = fresh();
  const { budget, written } = repo.createBudget({ name: 'Mine' });
  await written;
  assert.ok(Object.keys(budget.categories).length > 5);
  assert.ok((await backend.get(`users/preview-you/budgets/${budget.id}`)));
  assert.equal(budget.members['preview-you'].admin, true);
});

test('assigning only changes the categories named', async () => {
  const { backend, repo } = fresh();
  const { budget, written } = repo.createBudget({ name: 'Mine', categories: { a: { name: 'A' }, b: { name: 'B' } } });
  await written;
  await repo.setAssigned(budget.id, '2026-11', { a: 500 });
  await repo.setAssigned(budget.id, '2026-11', { b: 300 });
  assert.deepEqual((await backend.get(`budgets/${budget.id}`)).assigned, { '2026-11': { a: 500, b: 300 } });
});

test('edits keep the old version and deletes only mark', async () => {
  const { backend, repo } = fresh();
  const { budget, written } = repo.createBudget({ name: 'Mine', categories: { a: { name: 'A' } } });
  await written;
  const { transaction, written: w } = repo.addTransaction(budget.id, { kind: 'spend', amount: 1200, date: '2026-11-02', categoryId: 'a', description: 'Lunch' });
  await w;
  await repo.updateTransaction(budget.id, transaction, { amount: 1500 });
  const path = `budgets/${budget.id}/transactions/${transaction.id}`;
  assert.equal((await backend.get(path)).amount, 1500);
  let revisions;
  backend.watchCollection(`${path}/revisions`, list => { revisions = list; });
  await new Promise(r => setTimeout(r));
  assert.equal(revisions[0].transaction.amount, 1200);
  await repo.deleteTransaction(budget.id, transaction.id);
  assert.equal((await backend.get(path)).deleted, true);
  let list;
  repo.watchTransactions(budget.id, l => { list = l; });
  await new Promise(r => setTimeout(r));
  const b = await backend.get(`budgets/${budget.id}`);
  assert.equal(monthSummary(b, list, '2026-11').categories.a.activity, 0, 'deleted spending stops counting');
});

test('starting money goes in as income, ready to assign', async () => {
  const { backend, repo } = fresh();
  const { budget, written } = repo.createBudget({ name: 'New', startingMoney: 123456, today: '2026-11-06' });
  await written;
  let list;
  repo.watchTransactions(budget.id, l => { list = l; });
  await new Promise(r => setTimeout(r));
  const b = await backend.get(`budgets/${budget.id}`);
  assert.equal(monthSummary(b, list, '2026-11').readyToAssign, 123456);
});

test('the starter checklist picks the ticked categories by default, or exactly the ones given', async () => {
  const { starterCategories } = await import('../../js/data/repository.js');
  const names = c => Object.values(c).map(x => x.name);
  assert.ok(names(starterCategories()).includes('Rent'));
  assert.ok(!names(starterCategories()).includes('Pets'));
  assert.deepEqual(names(starterCategories(['Pets', 'Rent'])), ['Rent', 'Pets']);
});

test('recurring copies have fixed ids, so adding twice makes one', async () => {
  const { backend, repo } = fresh();
  const { budget, written } = repo.createBudget({ name: 'Mine', categories: { r: { name: 'Rent' } } });
  await written;
  const copy = { id: 'r-rule1-2026-11', kind: 'spend', amount: 100, date: '2026-11-01', categoryId: 'r', recurringId: 'rule1' };
  await repo.addRecurringCopies(budget.id, [copy]);
  await repo.addRecurringCopies(budget.id, [copy]);
  let list;
  repo.watchTransactions(budget.id, l => { list = l; });
  await new Promise(r => setTimeout(r));
  assert.equal(list.length, 1);
  assert.equal(list[0].automatic, true);
});

test('an invite link adds you to the budget, and resetting it cuts the old link off', async () => {
  const { backend, repo } = fresh();
  const { budget, written } = repo.createBudget({ name: 'Home', kind: 'shared' });
  await written;
  const first = await repo.resetInvite(budget.id);
  const second = await repo.resetInvite(budget.id, first);
  assert.equal(await repo.lookUpInvite(first), null);
  assert.equal((await repo.lookUpInvite(second)).budgetId, budget.id);
  await assert.rejects(repo.joinWithCode(first, 'Sam'), { code: 'not-found' });
});

test('leaving removes the budget from your list', async () => {
  const { backend, repo } = fresh();
  const { budget, written } = repo.createBudget({ name: 'Home' });
  await written;
  await repo.leaveBudget(budget.id);
  assert.equal(await backend.get(`users/preview-you/budgets/${budget.id}`), null);
  assert.equal((await backend.get(`budgets/${budget.id}`)).members['preview-you'], undefined);
});

test('deleting a category moves its transactions, plan and repeats somewhere else first', async () => {
  const { backend, repo } = fresh();
  const { budget, written } = repo.createBudget({ name: 'Mine', categories: { a: { name: 'Coffee' }, b: { name: 'Eating out' } } });
  await written;
  await repo.setAssigned(budget.id, '2026-11', { a: 2000, b: 5000 });
  await repo.saveRule(budget.id, { id: 'r1', kind: 'spend', amount: 500, categoryId: 'a', day: 3, start: '2026-11' });
  const { written: w } = repo.addTransaction(budget.id, { kind: 'spend', amount: 450, date: '2026-11-02', categoryId: 'a', description: 'Latte' });
  await w;
  let list;
  repo.watchTransactions(budget.id, l => { list = l; });
  await new Promise(r => setTimeout(r));
  const before = monthSummary(await backend.get(`budgets/${budget.id}`), list, '2026-11');
  await repo.deleteCategory(budget.id, 'a', 'b', list);
  await new Promise(r => setTimeout(r));
  const after = await backend.get(`budgets/${budget.id}`);
  assert.equal(after.categories.a, undefined);
  assert.deepEqual(after.assigned['2026-11'], { b: 7000 });
  assert.equal(after.recurring.r1.categoryId, 'b');
  assert.equal(list[0].categoryId, 'b');
  const s = monthSummary(after, list, '2026-11');
  assert.equal(s.readyToAssign, before.readyToAssign, 'deleting never changes Ready to assign');
  assert.equal(s.categories.b.available, before.categories.a.available + before.categories.b.available);
});

test('an unused category can be deleted outright, a used one needs somewhere to go', async () => {
  const { backend, repo } = fresh();
  const { budget, written } = repo.createBudget({ name: 'Mine', categories: { a: { name: 'A' }, b: { name: 'B' } } });
  await written;
  await repo.deleteCategory(budget.id, 'a');
  assert.equal((await backend.get(`budgets/${budget.id}`)).categories.a, undefined);
  await assert.rejects(repo.deleteCategory(budget.id, 'b', null, [{ id: 't', categoryId: 'b' }]), { code: 'in-use' });
});
