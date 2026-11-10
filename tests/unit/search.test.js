import test from 'node:test'; import assert from 'node:assert/strict';
import { searchTransactions, searchTotals } from '../../js/core/search.js';

const list = [
  { id: 'a', kind: 'spend', amount: 4000, date: '2026-01-10', description: 'AMZN Mktp US*2K4', categoryId: 's' },
  { id: 'b', kind: 'spend', amount: 2500, date: '2026-03-02', description: 'Amazon.com', note: 'phone case', categoryId: 's' },
  { id: 'c', kind: 'refund', amount: 500, date: '2026-03-09', description: 'AMZN Mktp refund', categoryId: 's' },
  { id: 'd', kind: 'spend', amount: 14630, date: '2026-03-01', description: 'SAMPLE CLIMBING GYM', categoryId: 'f' },
  { id: 'e', kind: 'income', amount: 500000, date: '2026-03-04', description: 'Payroll', categoryId: null },
  { id: 'x', kind: 'spend', amount: 999, date: '2026-03-05', description: 'AMZN deleted', categoryId: 's', deleted: true },
];

test('finds by words in the description or note, every word, any case', () => {
  assert.deepEqual(searchTransactions(list, { text: 'amzn' }).map(t => t.id), ['c', 'a']);
  assert.deepEqual(searchTransactions(list, { text: 'phone case' }).map(t => t.id), ['b']);
  assert.deepEqual(searchTransactions(list, { text: 'amzn refund' }).map(t => t.id), ['c']);
});

test('filters by category, kind and dates', () => {
  assert.deepEqual(searchTransactions(list, { categoryId: 'f' }).map(t => t.id), ['d']);
  assert.deepEqual(searchTransactions(list, { kind: 'income' }).map(t => t.id), ['e']);
  assert.deepEqual(searchTransactions(list, { from: '2026-03-01', to: '2026-03-03', kind: 'spend' }).map(t => t.id), ['b', 'd']);
});

test('totals: spending less refunds, months covered, a monthly average, biggest categories', () => {
  const t = searchTotals(searchTransactions(list, { kind: 'spend' }));
  assert.equal(t.count, 4);
  assert.equal(t.spent, 4000 + 2500 - 500 + 14630);
  assert.equal(t.months, 3);
  assert.equal(t.perMonth, Math.round(t.spent / 3));
  assert.deepEqual(t.byCategory.map(c => c.id), ['f', 's']);
});

test('filters by the account an import came from', () => {
  const l = [{ id: 'p', kind: 'spend', amount: 100, date: '2026-01-01', description: 'X', categoryId: 's', accountId: 'card' }, { id: 'q', kind: 'spend', amount: 100, date: '2026-01-01', description: 'X', categoryId: 's', accountId: 'bank' }];
  assert.deepEqual(searchTransactions(l, { accountId: 'card' }).map(t => t.id), ['p']);
});
