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

import { pace, upcomingBills, categoryHistory, biggestPurchases, byPerson, categoryTotals, headlines, rangeMonths, daysInMonth } from '../../js/core/trends.js';

test('ranges and days in a month', () => {
  assert.deepEqual(rangeMonths('3', '2026-02'), ['2025-12', '2026-01', '2026-02']);
  assert.deepEqual(rangeMonths('year', '2026-03'), ['2026-01', '2026-02', '2026-03']);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29);
});

test('pace compares spending with how far through the month we are', () => {
  const b = { categories: { eat: { name: 'Eating out', group: 'Everyday' }, em: { name: 'Emergency', group: 'Saving for' } }, assigned: { '2026-11': { eat: 30000, em: 50000 } } };
  const list = [{ id: 'a', kind: 'spend', amount: 15000, date: '2026-11-05', categoryId: 'eat' }];
  const p = pace(b, list, '2026-11', '2026-11-06');
  assert.equal(p.budgeted, 30000, 'saving is left out');
  assert.equal(p.spent, 15000);
  assert.equal(p.elapsed, 0.2);
  assert.equal(p.projected, 75000);
  assert.deepEqual(p.ahead.map(x => x.id), ['eat'], 'half the money gone a fifth of the way in');
  const done = pace(b, list, '2026-11', '2026-12-02');
  assert.equal(done.elapsed, 1);
  assert.equal(done.projected, 15000);
  assert.deepEqual(done.ahead, []);
});

test('upcoming bills list the next 30 days and say whether money is there for them', () => {
  const b = {
    categories: { rent: { name: 'Rent' }, ph: { name: 'Phone' } },
    assigned: { '2026-11': { ph: 3000 } },
    recurring: {
      ph: { id: 'ph', kind: 'spend', amount: 6500, categoryId: 'ph', day: 18, start: '2026-10' },
      rent: { id: 'rent', kind: 'spend', amount: 180000, categoryId: 'rent', day: 1, start: '2026-10' },
      pay: { id: 'pay', kind: 'income', amount: 260000, day: 1, start: '2026-10' },
      old: { id: 'old', kind: 'spend', amount: 100, categoryId: 'ph', day: 20, start: '2026-10', stopped: true },
    },
  };
  const u = upcomingBills(b, [{ id: 'r-rent-2026-11', kind: 'spend', amount: 180000, date: '2026-11-01', categoryId: 'rent' }], '2026-11-07');
  assert.deepEqual(u.list.map(x => [x.ruleId, x.date]), [['ph', '2026-11-18'], ['pay', '2026-12-01'], ['rent', '2026-12-01']]);
  assert.equal(u.list[0].covered, false, 'only $30 of $65 is there');
  assert.equal(u.list.find(x => x.ruleId === 'rent').covered, null, 'next month is not planned yet');
  assert.equal(u.out, 186500);
  assert.equal(u.incoming, 260000);
  assert.equal(u.uncovered, 1);
});

test('category history, biggest purchases, by person and totals', () => {
  const b = { categories: { g: { name: 'Groceries' } }, members: { u1: { name: 'You' }, u2: { name: 'Sam' } } };
  const list = [
    { id: '1', kind: 'spend', amount: 5000, date: '2026-09-02', categoryId: 'g', createdBy: 'u1' },
    { id: '2', kind: 'spend', amount: 12000, date: '2026-11-02', categoryId: 'g', createdBy: 'u2' },
    { id: '3', kind: 'refund', amount: 2000, date: '2026-11-03', categoryId: 'g', createdBy: 'u2' },
    { id: '4', kind: 'spend', amount: 3000, date: '2026-11-04', categoryId: 'g', createdBy: 'u1' },
    { id: '5', kind: 'spend', amount: 9999, date: '2026-11-01', categoryId: 'g', createdBy: 'u1', automatic: true },
  ];
  const h = categoryHistory(list, 'g', rangeMonths('3', '2026-11'));
  assert.deepEqual(h.rows.map(r => r.spent), [5000, 0, 22999]);
  assert.equal(h.average, 14000, 'months with no spending are left out of the average');
  assert.equal(h.biggest[0].id, '2');
  assert.deepEqual(biggestPurchases(list, '2026-11', 2).map(t => t.id), ['2', '5']);
  assert.deepEqual(byPerson(b, list, '2026-11').map(p => [p.name, p.spent]), [['Sam', 10000], ['You', 3000]], 'automatic repeats belong to no one');
  assert.deepEqual(categoryTotals(b, list, ['2026-09', '2026-11']).map(r => [r.id, r.spent, r.perMonth]), [['g', 27999, 14000]]);
});

test('headlines put the most useful lines first', () => {
  const lines = headlines(budget, transactions, '2026-11', '2026-11-06');
  assert.equal(lines[0].text, 'Groceries is down 70% on usual');
  assert.equal(lines[1].text, 'pace');
  assert.equal(lines[2].text, 'leftover');
  assert.equal(lines[2].amount, 300000 - 42000);
});

test('pace leaves bills out, so rent on the 1st does not blow up the projection', () => {
  const b = {
    categories: { rent: { name: 'Rent', group: 'Housing' }, ph: { name: 'Phone', group: 'Bills' }, gym: { name: 'Gym', target: { type: 'monthly', amount: 5000 } }, eat: { name: 'Eating out', group: 'Everyday' } },
    assigned: { '2026-11': { rent: 180000, ph: 6500, gym: 5000, eat: 30000 } },
    recurring: { r: { id: 'r', kind: 'spend', amount: 180000, categoryId: 'rent', day: 1, start: '2026-10' } },
  };
  const list = [
    { id: 'a', kind: 'spend', amount: 180000, date: '2026-11-01', categoryId: 'rent' },
    { id: 'b', kind: 'spend', amount: 6500, date: '2026-11-02', categoryId: 'ph' },
    { id: 'c', kind: 'spend', amount: 5000, date: '2026-11-02', categoryId: 'gym' },
    { id: 'd', kind: 'spend', amount: 6000, date: '2026-11-05', categoryId: 'eat' },
  ];
  const p = pace(b, list, '2026-11', '2026-11-06');
  assert.equal(p.budgeted, 30000);
  assert.equal(p.spent, 6000);
  assert.equal(p.projected, 30000);
});
