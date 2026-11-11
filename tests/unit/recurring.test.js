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

import { occurrences, howOften } from '../../js/core/recurring.js';

const biweekly = { id: 'pay2', kind: 'income', amount: 150000, description: 'Paycheck', every: '2weeks', anchor: '2026-10-02' };
const weekly = { id: 'kid', kind: 'spend', amount: 2000, categoryId: 'k', description: 'Allowance', every: 'week', anchor: '2026-11-02' };

test('weekly and every-2-weeks rules need a first date instead of a day', () => {
  assert.ok(isValidRule(biweekly));
  assert.ok(!isValidRule({ ...biweekly, anchor: '2026-13-01' }));
  assert.ok(!isValidRule({ ...weekly, categoryId: undefined }));
});

test('every 2 weeks lands on the right Fridays, across months', () => {
  assert.deepEqual(occurrences(biweekly, '2026-10-01', '2026-11-30').map(o => o.date), ['2026-10-02', '2026-10-16', '2026-10-30', '2026-11-13', '2026-11-27']);
  assert.equal(occurrences(biweekly, '2026-11-01', '2026-11-30')[0].id, 'r-pay2-2026-11-13');
});

test('weekly copies come due one at a time and are never added twice', () => {
  const due = dueTransactions({ weekly }, ['r-kid-2026-11-02'], '2026-11-17');
  assert.deepEqual(due.map(t => t.date), ['2026-11-09', '2026-11-16']);
  assert.equal(due[0].categoryId, 'k');
});

test('every 2 weeks across daylight saving and a year end stays on the same weekday', () => {
  const d = occurrences(biweekly, '2026-12-20', '2027-03-31').map(o => new Date(`${o.date}T12:00:00Z`).getUTCDay());
  assert.ok(d.length >= 7 && d.every(x => x === 5), 'always a Friday');
});

test('next date and how often, in words', () => {
  assert.equal(nextDate(biweekly, '2026-11-07'), '2026-11-13');
  assert.equal(howOften(biweekly, n => `${n}th`), 'every other Friday');
  assert.equal(howOften(weekly, n => `${n}th`), 'every Monday');
  assert.equal(howOften(rent, n => (n === 1 ? '1st' : `${n}th`)), 'monthly on the 1st');
});

test('spots things that come every month and are not repeats yet', async () => {
  const { suggestRepeats, payeeKey } = await import('../../js/core/recurring.js');
  const tx = (id, date, amount, description, kind = 'spend') => ({ id, date, amount, description, kind, categoryId: 'c1' });
  const list = [
    tx('a', '2026-08-12', 1549, 'NETFLIX.COM 866-579'), tx('b', '2026-09-12', 1549, 'Netflix.com 1234'), tx('c', '2026-10-13', 1549, 'NETFLIX.COM'),
    tx('d', '2026-08-03', 900, 'COFFEE'), tx('e', '2026-08-09', 450, 'COFFEE'), tx('f', '2026-09-04', 700, 'COFFEE'), tx('g', '2026-10-02', 600, 'COFFEE'),
    tx('h', '2026-08-01', 200000, 'RENT', 'spend'), tx('i', '2026-09-01', 200000, 'RENT'), tx('j', '2026-10-01', 200000, 'RENT'), tx('k', '2026-11-01', 200000, 'RENT'),
    tx('l', '2026-05-20', 999, 'OLD GYM'), tx('m', '2026-06-20', 999, 'OLD GYM'), tx('n', '2026-07-20', 999, 'OLD GYM'),
  ];
  const s = suggestRepeats(list, {}, '2026-11-07');
  assert.deepEqual(s.map(x => x.key), ['spend:rent', 'spend:netflix']);
  const netflix = s.find(x => x.key === 'spend:netflix').rule;
  assert.equal(netflix.day, 12); assert.equal(netflix.start, '2026-11'); assert.equal(netflix.amount, 1549);
  assert.equal(s.find(x => x.key === 'spend:rent').rule.start, '2026-12', 'this month is in already');
  assert.deepEqual(suggestRepeats(list, { r: { description: 'Netflix', stopped: false } }, '2026-11-07').map(x => x.key), ['spend:rent'], 'already a repeat');
  assert.deepEqual(suggestRepeats(list, {}, '2026-11-07', ['spend:rent']).map(x => x.key), ['spend:netflix'], 'dismissed');
  assert.equal(payeeKey('POS DEBIT SPOTIFY USA #123'), 'spotify usa');
});
