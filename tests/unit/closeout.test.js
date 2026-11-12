import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeOut } from '../../js/core/closeout.js';

const budget = { categories: { g: { name: 'Groceries' }, f: { name: 'Fun' }, h: { name: 'Hidden', hidden: true } }, accounts: { c: { name: 'Chase' }, a: { name: 'Ally' } } };
const grid = { columns: ['a', 'c', ''], at: (m, c) => (c === 'c' ? [{ id: 'r1' }] : c === 'a' ? [{ id: 'r2', undone: true }] : []) };

test('closing out a month lists what still needs doing', () => {
  const r = closeOut({
    budget, month: '2026-10', grid, suggested: 2,
    txs: [{ id: 't', kind: 'spend', date: '2026-10-04', amount: 5, categoryId: 'gone' }],
    summary: { readyToAssign: 1500, categories: { g: { available: -200 }, f: { available: 300 }, h: { available: -5 } } },
    check: { accounts: [{}], missing: [], gap: 0 },
  });
  const by = Object.fromEntries(r.items.map(i => [i.key, i]));
  assert.equal(by.statements.done, false);
  assert.match(by.statements.detail, /Ally/, 'a taken-out statement still counts as missing');
  assert.equal(by.accounts.done, true);
  assert.equal(by.overspent.title, 'Cover 1 overspent category', 'hidden categories are left out');
  assert.equal(by.uncategorized.title, 'Pick a category for 1');
  assert.equal(by.repeats.done, false);
  assert.equal(by.assign.amount, 1500);
  assert.equal(r.left, 5);
});

test('a tidy month is all done, and items with nothing to say stay away', () => {
  const r = closeOut({ budget, month: '2026-10', grid: { columns: [], at: () => [] }, txs: [], summary: { readyToAssign: 0, categories: {} }, check: { accounts: [] } });
  assert.deepEqual(r.items.map(i => i.key), ['overspent', 'assign']);
  assert.equal(r.left, 0);
});
