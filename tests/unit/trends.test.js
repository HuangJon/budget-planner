import test from 'node:test'; import assert from 'node:assert/strict';
import { monthTotals, categoryCompare, notableChanges, planVsReal, savingThisMonth, targetProgress, isSavingGroup } from '../../js/core/trends.js';

let n = 0;
const tx = (kind, amount, date, categoryId) => ({ id: `t${n++}`, kind, amount, date, ...(categoryId ? { categoryId } : {}) });
const budget = {
  categories: {
    food: { name: 'Groceries', group: 'Everyday' }, eat: { name: 'Eating out', group: 'Everyday' },
    em: { name: 'Emergency fund', group: 'Saving for' },
    clothes: { name: 'Clothes', group: 'Fun', target: { type: 'yearly', amount: 200000 } },
  },
  assigned: {
    '2026-08': { food: 40000, eat: 10000 }, '2026-09': { food: 40000, eat: 10000 }, '2026-10': { food: 40000, eat: 10000 },
    '2026-11': { em: 50000, clothes: 30000 },
  },
};
const transactions = [
  tx('income', 300000, '2026-08-01'), tx('income', 300000, '2026-09-01'), tx('income', 300000, '2026-10-01'), tx('income', 400000, '2026-11-01'),
  tx('spend', 30000, '2026-08-03', 'food'), tx('spend', 20000, '2026-08-05', 'eat'),
  tx('spend', 36000, '2026-09-04', 'food'), tx('spend', 16000, '2026-09-05', 'eat'), tx('spend', 4000, '2026-09-25', 'eat'),
  tx('spend', 33000, '2026-10-02', 'food'), tx('spend', 9000, '2026-10-05', 'eat'),
  tx('spend', 10000, '2026-11-03', 'food'), tx('spend', 30000, '2026-11-04', 'eat'), tx('refund', 2000, '2026-11-05', 'eat'),
];

test('month totals count income and spending minus refunds', () => {
  const rows = monthTotals(transactions, '2026-11', 4);
  assert.deepEqual(rows.map(r => r.month), ['2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(rows.at(-1), { month: '2026-11', income: 400000, spent: 38000 });
  assert.equal(rows[0].spent, 50000);
});

test('a half-finished month is compared with earlier months up to the same day', () => {
  const c = categoryCompare(budget, transactions, '2026-11', '2026-11-06');
  const eat = c.rows.find(r => r.id === 'eat');
  // Up to the 6th: Aug 200, Sep 160 (the 25th is left out), Oct 90 → usual 150.
  assert.equal(eat.usual, 15000);
  assert.equal(eat.spent, 28000);
  assert.equal(c.partial, true);
  assert.equal(c.monthsCompared, 3);
});

test('a finished month is compared with whole months', () => {
  const c = categoryCompare(budget, transactions, '2026-10', '2026-11-06');
  assert.equal(c.rows.find(r => r.id === 'eat').usual, 20000);
  assert.equal(c.partial, false);
});

test('notable changes need a real difference and enough history', () => {
  const c = categoryCompare(budget, transactions, '2026-11', '2026-11-06');
  const changes = notableChanges(c);
  // Groceries fell $230 against usual, Eating out rose $130: biggest change first.
  assert.deepEqual(changes.map(x => [x.id, x.pct]), [['food', -70], ['eat', 87]]);
  assert.deepEqual(notableChanges({ ...c, monthsCompared: 1 }), []);
});

test('plan vs real finds categories that usually run over', () => {
  const rows = planVsReal(budget, transactions, '2026-11');
  assert.deepEqual(rows.map(r => r.id), ['eat']);
  assert.equal(rows[0].over, 2);
  assert.equal(rows[0].usualSpent, 16333);
});

test('saving counts what was planned into saving groups', () => {
  assert.ok(isSavingGroup('Saving for') && isSavingGroup('savings') && !isSavingGroup('Fun'));
  const s = savingThisMonth(budget, transactions, '2026-11');
  assert.equal(s.saved, 50000);
  assert.equal(s.rate, 0.125);
});

test('target progress lists yearly and save-by-a-date targets', () => {
  const p = targetProgress(budget, transactions, '2026-11');
  assert.deepEqual(p.map(x => [x.id, x.type, x.amount, x.done]), [['clothes', 'yearly', 200000, 0]]);
});

test('saving categories are left out of notable changes', () => {
  const c = { monthsCompared: 3, rows: [{ id: 'inv', name: 'Investing', group: 'Saving for', spent: 0, usual: 30000 }, { id: 'eat', name: 'Eating out', group: 'Everyday', spent: 30000, usual: 10000 }] };
  assert.deepEqual(notableChanges(c).map(r => r.id), ['eat']);
});
