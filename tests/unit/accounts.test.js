import test from 'node:test'; import assert from 'node:assert/strict';
import { budgetMoney, accountsMoney, accountCheck } from '../../js/core/accounts.js';

const list = [
  { id: 's', kind: 'income', amount: 500000, date: '2026-11-01', description: 'Starting money' },
  { id: 'a', kind: 'spend', amount: 12000, date: '2026-11-03', categoryId: 'g' },
  { id: 'b', kind: 'refund', amount: 2000, date: '2026-11-04', categoryId: 'g' },
  { id: 'c', kind: 'spend', amount: 99999, date: '2026-11-05', categoryId: 'g', deleted: true },
  { id: 'r', kind: 'spend', amount: 180000, date: '2026-12-01', categoryId: 'r', recurringId: 'x' },
];

test('the budget holds what came in less what went out, up to today', () => {
  assert.equal(budgetMoney(list, '2026-11-09'), 500000 - 12000 + 2000);
});

test('accounts add up, with what is owed on cards taken off', () => {
  assert.equal(accountsMoney({ a: { kind: 'cash', balance: 400000 }, v: { kind: 'cash', balance: 10000 }, c: { kind: 'card', balance: 20000 } }), 390000);
  assert.equal(accountsMoney(undefined), 0);
});

test('the check shows the gap between the two', () => {
  const b = { accounts: { a: { name: 'Checking', kind: 'cash', balance: 500000, updatedAt: 5 }, c: { name: 'Card', kind: 'card', balance: 10000, updatedAt: 3 } } };
  const r = accountCheck(b, list, '2026-11-09');
  assert.equal(r.inAccounts, 490000);
  assert.equal(r.inBudget, 490000);
  assert.equal(r.gap, 0);
  assert.equal(r.oldest, 3);
  assert.equal(accountCheck({}, list, '2026-11-09').accounts.length, 0);
});

test('an account without a balance yet is left out and asked for', () => {
  const b = { accounts: { a: { name: 'Checking', kind: 'cash', balance: 500000 }, c: { name: 'Card', kind: 'card', balance: null } } };
  const r = accountCheck(b, [], '2026-11-09');
  assert.equal(r.inAccounts, 500000);
  assert.deepEqual(r.missing.map(m => m.name), ['Card']);
});
