import test from 'node:test'; import assert from 'node:assert/strict';
import { allocate, fromCents, money, toCents } from '../../js/core/money.js';
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

test('reads typed amounts', () => {
  assert.equal(toCents('12.34'), 1234);
  assert.equal(toCents('$1,200'), 120000);
  assert.equal(toCents('19.99'), 1999);
  assert.equal(toCents('abc'), 0);
  assert.equal(toCents(undefined), 0);
  assert.equal(fromCents(1234), '12.34');
});
test('formats money with a real minus sign', () => {
  assert.equal(money(123456), '$1,234.56');
  assert.equal(money(-1200), '−$12.00');
  assert.equal(money(0), '$0.00');
});
test('allocate always sums exactly', () => {
  assert.deepEqual(allocate(100, { a: 1, b: 1, c: 1 }), { a: 34, b: 33, c: 33 });
  for (let k = 0; k < 2000; k++) {
    const total = 1 + Math.floor(Math.random() * 1e7), w = {};
    for (let j = 0; j < 1 + k % 12; j++) w[`p${j}`] = Math.random() * 100;
    assert.equal(sum(allocate(total, w)), total);
  }
});
