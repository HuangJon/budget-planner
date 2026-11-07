import test from 'node:test'; import assert from 'node:assert/strict';
import {
  addMonths, monthOf, isValidTransaction, monthSummary, moveMoney, coverOverspending, fundTargets,
  neededForTarget, groupedCategories,
} from '../../js/core/budget.js';

const budget = (assigned = {}) => ({
  categories: {
    rent: { name: 'Rent', group: 'Bills', order: 0, target: { amount: 150000, dueDay: 1 } },
    phone: { name: 'Phone', group: 'Bills', order: 1, target: { amount: 5000, dueDay: 15 } },
    food: { name: 'Groceries', group: 'Everyday', order: 2 },
    fun: { name: 'Fun', group: 'Fun', order: 3 },
  },
  assigned,
});
let n = 0;
const tx = (kind, amount, date, categoryId, extra = {}) => ({ id: `t${n++}`, kind, amount, date, ...(categoryId ? { categoryId } : {}), ...extra });

test('months step across years', () => {
  assert.equal(addMonths('2026-11', 1), '2026-12');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2027-01', -1), '2026-12');
  assert.equal(addMonths('2026-03', -15), '2024-12');
  assert.equal(monthOf('2026-11-06'), '2026-11');
});

test('checks transactions', () => {
  assert.ok(isValidTransaction(tx('income', 100, '2026-11-01')));
  assert.ok(isValidTransaction(tx('spend', 100, '2026-11-01', 'food')));
  assert.ok(!isValidTransaction(tx('spend', 100, '2026-11-01')), 'spending needs a category');
  assert.ok(!isValidTransaction(tx('spend', 0, '2026-11-01', 'food')));
  assert.ok(!isValidTransaction(tx('spend', 1.5, '2026-11-01', 'food')), 'whole cents only');
  assert.ok(!isValidTransaction(tx('spend', 100, '2026-13-01', 'food')));
  assert.ok(!isValidTransaction(tx('gift', 100, '2026-11-01')));
});

test('income lands in ready to assign, assigning takes it out', () => {
  const s = monthSummary(budget({ '2026-11': { rent: 150000, food: 40000 } }), [tx('income', 300000, '2026-11-01')], '2026-11');
  assert.equal(s.readyToAssign, 110000);
  assert.equal(s.incomeThisMonth, 300000);
  assert.equal(s.assignedThisMonth, 190000);
  assert.equal(s.categories.food.available, 40000);
});

test('spending and refunds change the category', () => {
  const t = [tx('income', 100000, '2026-11-01'), tx('spend', 12345, '2026-11-03', 'food'), tx('refund', 2345, '2026-11-04', 'food')];
  const s = monthSummary(budget({ '2026-11': { food: 40000 } }), t, '2026-11');
  assert.equal(s.categories.food.activity, -10000);
  assert.equal(s.categories.food.available, 30000);
  assert.equal(s.activityThisMonth, -10000);
  assert.equal(s.readyToAssign, 60000, 'spending does not touch ready to assign');
});

test('leftovers carry into next month', () => {
  const t = [tx('income', 100000, '2026-10-01'), tx('spend', 15000, '2026-10-10', 'food')];
  const s = monthSummary(budget({ '2026-10': { food: 40000 }, '2026-11': { food: 20000 } }), t, '2026-11');
  assert.equal(s.categories.food.carried, 25000);
  assert.equal(s.categories.food.available, 45000);
});

test('overspending carries forward and is flagged until covered', () => {
  const t = [tx('income', 100000, '2026-10-01'), tx('spend', 50000, '2026-10-10', 'food')];
  const oct = monthSummary(budget({ '2026-10': { food: 40000, fun: 30000 } }), t, '2026-10');
  assert.deepEqual(oct.overspent, ['food']);
  const nov = monthSummary(budget({ '2026-10': { food: 40000, fun: 30000 } }), t, '2026-11');
  assert.equal(nov.categories.food.carried, -10000);
  assert.deepEqual(nov.overspent, ['food']);
});

test('future income does not count yet; assigning ahead does', () => {
  const t = [tx('income', 100000, '2026-11-01'), tx('income', 999999, '2026-12-01')];
  const s = monthSummary(budget({ '2026-12': { rent: 50000 } }), t, '2026-11');
  assert.equal(s.readyToAssign, 50000);
});

test('deleted and damaged transactions are ignored', () => {
  const t = [tx('income', 100000, '2026-11-01'), tx('spend', 5000, '2026-11-02', 'food', { deleted: true }), { id: 'bad', kind: 'spend' }];
  const s = monthSummary(budget({ '2026-11': { food: 10000 } }), t, '2026-11');
  assert.equal(s.categories.food.available, 10000);
});

test('spending in a removed category is reported, not lost', () => {
  const s = monthSummary(budget(), [tx('spend', 700, '2026-11-02', 'gone')], '2026-11');
  assert.equal(s.unknownActivity, -700);
});

test('moving money keeps the total the same', () => {
  const m = moveMoney({ food: 10000, fun: 5000 }, 'fun', 'food', 2000);
  assert.deepEqual(m, { food: 12000, fun: 3000 });
  assert.deepEqual(moveMoney({}, 'ready', 'food', 500), { food: 500 });
  assert.deepEqual(moveMoney({ food: 500 }, 'food', 'ready', 500), { food: 0 });
  assert.deepEqual(moveMoney({ food: 1 }, 'food', 'fun', -5), { food: 1 }, 'ignores bad amounts');
});

test('covering overspending takes from the biggest leftovers first, never below zero', () => {
  const t = [tx('income', 200000, '2026-11-01'), tx('spend', 60000, '2026-11-02', 'food')];
  const b = budget({ '2026-11': { food: 40000, fun: 5000, phone: 30000 } });
  const s = monthSummary(b, t, '2026-11');
  const { assigned, covered } = coverOverspending(s, b.assigned['2026-11'], 'food', ['fun', 'phone', 'rent']);
  assert.equal(covered, 20000);
  assert.deepEqual(assigned, { food: 60000, fun: 5000, phone: 10000 });
  const after = monthSummary({ ...b, assigned: { '2026-11': assigned } }, t, '2026-11');
  assert.deepEqual(after.overspent, []);
  assert.equal(after.readyToAssign, s.readyToAssign, 'covering never touches ready to assign');
});

test('covering stops when there is not enough', () => {
  const t = [tx('income', 200000, '2026-11-01'), tx('spend', 60000, '2026-11-02', 'food')];
  const b = budget({ '2026-11': { food: 40000, fun: 5000 } });
  const s = monthSummary(b, t, '2026-11');
  assert.equal(coverOverspending(s, b.assigned['2026-11'], 'food', ['fun']).covered, 5000);
});

test('targets say what is still needed', () => {
  assert.equal(neededForTarget({ target: { amount: 5000 } }, 2000), 3000);
  assert.equal(neededForTarget({ target: { amount: 5000 } }, 9000), 0);
  assert.equal(neededForTarget({}, 0), 0);
});

test('funding targets pays bills by due day until money runs out', () => {
  const b = budget({ '2026-11': { phone: 1000 } });
  const s = monthSummary(b, [tx('income', 152000, '2026-11-01')], '2026-11');
  const { assigned, funded } = fundTargets(b, s, b.assigned['2026-11']);
  assert.deepEqual(funded, { rent: 150000, phone: 1000 });
  assert.deepEqual(assigned, { phone: 2000, rent: 150000 });
});

test('categories come back grouped and in order, hidden ones left out', () => {
  const b = budget();
  b.categories.fun.hidden = true;
  assert.deepEqual(groupedCategories(b).map(g => [g.name, g.categories.map(c => c.id)]), [['Bills', ['rent', 'phone']], ['Everyday', ['food']]]);
});

test('totals never drift (random months)', () => {
  for (let k = 0; k < 300; k++) {
    const t = [], assigned = {};
    let income = 0, given = 0;
    for (let j = 0; j < 40; j++) {
      const month = addMonths('2026-01', Math.floor(Math.random() * 12));
      const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
      const amt = 1 + Math.floor(Math.random() * 100000);
      const cat = ['rent', 'phone', 'food', 'fun'][j % 4];
      if (j % 3 === 0) { t.push(tx('income', amt, `${month}-${day}`)); income += amt; }
      else t.push(tx(j % 5 === 0 ? 'refund' : 'spend', amt, `${month}-${day}`, cat));
      assigned[month] ??= {};
      assigned[month][cat] = (assigned[month][cat] || 0) + amt; given += amt;
    }
    const s = monthSummary(budget(assigned), t, '2026-12');
    const spent = t.filter(x => x.kind !== 'income').reduce((a, x) => a + (x.kind === 'spend' ? -x.amount : x.amount), 0);
    const inCats = Object.values(s.categories).reduce((a, c) => a + c.available, 0);
    // Every dollar is either ready to assign or sitting in a category.
    assert.equal(s.readyToAssign + inCats, income + spent);
    assert.equal(s.readyToAssign, income - given);
  }
});

test('a target with no type counts as monthly', () => {
  const b = { categories: { r: { name: 'Rent', target: { amount: 1000 } } }, assigned: { '2026-11': { r: 400 } } };
  const s = monthSummary(b, [], '2026-11');
  assert.equal(s.categories.r.needed, 600);
  assert.equal(s.categories.r.target.type, 'monthly');
});

test('a yearly target spreads what is left over the rest of the year', () => {
  // $2,000 a year for clothes. Nothing assigned before November: 2 months left, so $1,000 each.
  const clothes = { name: 'Clothes', target: { type: 'yearly', amount: 200000 } };
  let s = monthSummary({ categories: { c: clothes }, assigned: {} }, [], '2026-11');
  assert.equal(s.categories.c.needed, 100000);
  assert.equal(s.categories.c.target.perMonth, 100000);
  // In January the full year is ahead: $166.67 a month, rounded up so the year is never short.
  s = monthSummary({ categories: { c: clothes }, assigned: {} }, [], '2027-01');
  assert.equal(s.categories.c.needed, 16667);
  // Assigned $1,500 so far this year by November: $250 a month for the last two.
  const assigned = { '2026-03': { c: 100000 }, '2026-06': { c: 50000 }, '2025-12': { c: 99999 } };
  s = monthSummary({ categories: { c: clothes }, assigned }, [], '2026-11');
  assert.equal(s.categories.c.needed, 25000, 'last year does not count');
});

test('yearly targets report spending this year, lumpy or not', () => {
  const clothes = { name: 'Clothes', target: { type: 'yearly', amount: 200000 } };
  const t = [
    { id: 'a', kind: 'spend', amount: 100000, date: '2026-02-10', categoryId: 'c' },
    { id: 'b', kind: 'spend', amount: 2500, date: '2026-09-01', categoryId: 'c' },
    { id: 'c', kind: 'refund', amount: 500, date: '2026-09-03', categoryId: 'c' },
    { id: 'd', kind: 'spend', amount: 9999, date: '2025-12-24', categoryId: 'c' },
  ];
  const s = monthSummary({ categories: { c: clothes }, assigned: { '2026-01': { c: 200000 } } }, t, '2026-11');
  assert.equal(s.categories.c.target.spentThisYear, 102000);
  assert.equal(s.categories.c.needed, 0, 'fully funded in January');
});

test('save by a date spreads what is missing up to the date', () => {
  // $3,000 by June 2027, starting November 2026 with $600 saved: 8 months (Nov..Jun) for $2,400.
  const trip = { name: 'Vacation', target: { type: 'byDate', amount: 300000, date: '2027-06' } };
  const b = { categories: { v: trip }, assigned: { '2026-10': { v: 60000 } } };
  const s = monthSummary(b, [], '2026-11');
  assert.equal(s.categories.v.target.perMonth, 30000);
  assert.equal(s.categories.v.needed, 30000);
  assert.equal(s.categories.v.target.saved, 60000);
});

test('save by a date asks for nothing once the date has passed', () => {
  const trip = { name: 'Vacation', target: { type: 'byDate', amount: 300000, date: '2026-06' } };
  const s = monthSummary({ categories: { v: trip }, assigned: {} }, [], '2026-11');
  assert.equal(s.categories.v.needed, 0);
  assert.equal(s.categories.v.target.past, true);
});

test('save by a date in the current month asks for all of what is missing', () => {
  const trip = { name: 'Vacation', target: { type: 'byDate', amount: 50000, date: '2026-11' } };
  const s = monthSummary({ categories: { v: trip }, assigned: { '2026-11': { v: 10000 } } }, [], '2026-11');
  assert.equal(s.categories.v.needed, 40000);
});
