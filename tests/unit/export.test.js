import test from 'node:test'; import assert from 'node:assert/strict';
import { transactionsCsv, planCsv, exportName } from '../../js/core/export.js';

const budget = {
  categories: { g: { name: 'Groceries', group: 'Everyday', order: 1 }, r: { name: 'Rent, flat', group: 'Bills', order: 0 } },
  members: { u1: { name: 'Jon' } },
  assigned: { '2026-11': { g: 40000, r: 180000 }, '2026-10': { g: 35000 } },
};
const list = [
  { id: 'b', kind: 'spend', amount: 1850, date: '2026-11-03', description: 'Trader Joe\'s "big" shop', categoryId: 'g', createdBy: 'u1', note: '=SUM(A1)' },
  { id: 'a', kind: 'income', amount: 260000, date: '2026-11-01', description: 'Paycheck', categoryId: null, createdBy: 'u1', recurringId: 'p' },
  { id: 'c', kind: 'spend', amount: 99, date: '2026-11-04', description: 'gone', categoryId: 'g', deleted: true },
];

test('transactions export oldest first, signed, with deleted ones left out', () => {
  const lines = transactionsCsv(budget, list).trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[1], '2026-11-01,Income,Paycheck,Ready to assign,,2600.00,,Jon,Yes');
  assert.ok(lines[2].startsWith('2026-11-03,Spending,"Trader Joe\'s ""big"" shop",Groceries,Everyday,-18.50,'));
  assert.ok(lines[2].includes(`"'=SUM(A1)"`), 'formulas are defused so a spreadsheet never runs them');
});

test('the plan exports months as columns', () => {
  const lines = planCsv(budget).trim().split('\r\n');
  assert.equal(lines[0], 'Group,Category,2026-10,2026-11');
  assert.equal(lines[1], 'Bills,"Rent, flat",0.00,1800.00');
  assert.equal(lines[2], 'Everyday,Groceries,350.00,400.00');
});

test('file names are safe', () => assert.equal(exportName("Jon's Home!", 'transactions', '2026-11-07'), 'jon-s-home-transactions-2026-11-07.csv'));
