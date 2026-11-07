import test from 'node:test'; import assert from 'node:assert/strict';
import { defaultDateFor } from '../../js/core/budget.js';

test('spending defaults to the month being viewed', () => {
  assert.equal(defaultDateFor('2026-11-07', '2026-11'), '2026-11-07');
  assert.equal(defaultDateFor('2026-11-07', '2026-10'), '2026-10-07');
  assert.equal(defaultDateFor('2026-03-31', '2026-02'), '2026-02-28', 'clamped to the end of a short month');
  assert.equal(defaultDateFor('2026-11-07', undefined), '2026-11-07');
});
