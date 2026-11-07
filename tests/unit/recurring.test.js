import test from 'node:test'; import assert from 'node:assert/strict';
import { dueTransactions, recurringId, nextDate, isValidRule } from '../../js/core/recurring.js';

const rent = { id: 'rent', kind: 'spend', amount: 180000, description: 'Rent', categoryId: 'r', day: 1, start: '2026-09' };
const pay = { id: 'pay', kind: 'income', amount: 260000, description: 'Paycheck', day: 15, start: '2026-11' };

test('rules are checked', () => {
  assert.ok(isValidRule(rent));
  assert.ok(isValidRule(pay));
  assert.ok(!isValidRule({ ...rent, day: 31 }), 'days stop at 28 so every month has one');
  assert.ok(!isValidRule({ ...rent, categoryId: undefined }), 'spending needs a category');
  assert.ok(!isValidRule({ ...rent, amount: 0 }));
});

test('adds the copies that are due and missing, up to today', () => {
  const due = dueTransactions({ rent, pay }, [recurringId('rent', '2026-09')], '2026-11-06');
  assert.deepEqual(due.map(t => t.id), ['r-rent-2026-10', 'r-rent-2026-11']);
  assert.equal(due[0].date, '2026-10-01');
  assert.equal(due[0].categoryId, 'r');
});

test('a day later this month is not due yet', () => {
  assert.deepEqual(dueTransactions({ pay }, [], '2026-11-14'), []);
  assert.deepEqual(dueTransactions({ pay }, [], '2026-11-15').map(t => t.id), ['r-pay-2026-11']);
});

test('deleted copies are not added again, and stopped rules add nothing', () => {
  assert.deepEqual(dueTransactions({ rent }, ['r-rent-2026-09', 'r-rent-2026-10', 'r-rent-2026-11'], '2026-11-06'), []);
  assert.deepEqual(dueTransactions({ rent: { ...rent, stopped: true } }, [], '2026-11-06'), []);
});

test('a long break only catches up a few months', () => {
  const due = dueTransactions({ rent: { ...rent, start: '2025-01' } }, [], '2026-11-06');
  assert.deepEqual(due.map(t => t.date), ['2026-09-01', '2026-10-01', '2026-11-01']);
});

test('income copies have no category', () => {
  assert.equal(dueTransactions({ pay }, [], '2026-11-20')[0].categoryId, null);
});

test('next date skips copies already added', () => {
  assert.equal(nextDate(pay, '2026-11-06'), '2026-11-15');
  assert.equal(nextDate(rent, '2026-11-06', ['r-rent-2026-11']), '2026-12-01');
  assert.equal(nextDate({ ...rent, stopped: true }, '2026-11-06'), null);
});
