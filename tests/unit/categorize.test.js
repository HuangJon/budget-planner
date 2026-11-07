import test from 'node:test'; import assert from 'node:assert/strict';
import { suggestCategory } from '../../js/core/categorize.js';

const cats = { g: { name: 'Groceries' }, e: { name: 'Eating out' }, t: { name: 'Transport' }, x: { name: 'Old', hidden: true } };

test('common words find the right category', () => {
  assert.equal(suggestCategory("Trader Joe's", cats), 'g');
  assert.equal(suggestCategory('tacos with sam', cats), 'e');
  assert.equal(suggestCategory('Uber home', cats), 't');
});
test('past transactions win over common words', () => {
  const past = [{ kind: 'spend', description: 'uber home', categoryId: 'e' }];
  assert.equal(suggestCategory('Uber home', cats, past), 'e');
});
test('category names match too', () => assert.equal(suggestCategory('groceries', cats), 'g'));
test('hidden categories and short text suggest nothing', () => {
  assert.equal(suggestCategory('old', cats), null);
  assert.equal(suggestCategory('a', cats), null);
  assert.equal(suggestCategory('zzzz', cats), null);
});
