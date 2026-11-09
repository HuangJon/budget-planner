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

test('doctors, dentists, glasses and therapy are Health; the gym is Fitness when there is one', async () => {
  const { suggestCategory } = await import('../../js/core/categorize.js');
  const withFit = { h: { name: 'Health' }, f: { name: 'Fitness' }, t: { name: 'Transport' } };
  const noFit = { h: { name: 'Health' }, t: { name: 'Transport' } };
  for (const d of ['SAMPLE OPTICAL 0001', 'SAMPLE THERAPY GROUP', 'Sample Dental', 'CVS/PHARMACY #123', 'Dr. Lee']) assert.equal(suggestCategory(d, withFit), 'h', d);
  assert.equal(suggestCategory('SAMPLE CLIMBING GYM', withFit), 'f');
  assert.equal(suggestCategory('Planet Fitness', withFit), 'f');
  assert.equal(suggestCategory('SAMPLE CLIMBING GYM', noFit), 'h', 'no Fitness category: the gym goes to Health');
});

test('with the Health group: Medical, Fitness and Personal care each get theirs', async () => {
  const { suggestCategory } = await import('../../js/core/categorize.js');
  const cats = { m: { name: 'Medical', group: 'Health' }, f: { name: 'Fitness', group: 'Health' }, p: { name: 'Personal care', group: 'Health' } };
  assert.equal(suggestCategory('Park Slope Dental', cats), 'm');
  assert.equal(suggestCategory('SAMPLE THERAPY GROUP', cats), 'm');
  assert.equal(suggestCategory('SAMPLE CLIMBING GYM', cats), 'f');
  assert.equal(suggestCategory('Sam the Barber', cats), 'p');
  assert.equal(suggestCategory('SEPHORA 123', cats), 'p');
});
