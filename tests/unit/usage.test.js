import test from 'node:test'; import assert from 'node:assert/strict';
import { isoWeek, recentWeeks, scrubMessage, errorRecord, platformOf } from '../../js/core/usage.js';

test('ISO weeks start on Monday and cross the year correctly', () => {
  assert.equal(isoWeek(new Date(2026, 10, 7)), '2026-W45');
  assert.equal(isoWeek(new Date(2026, 10, 9)), '2026-W46', 'Monday starts a new week');
  assert.equal(isoWeek(new Date(2027, 0, 1)), '2026-W53', 'Jan 1 2027 is a Friday in the last week of 2026');
  assert.equal(isoWeek(new Date(2026, 0, 1)), '2026-W01');
  assert.equal(recentWeeks(new Date(2026, 10, 7), 3).join(','), '2026-W45,2026-W44,2026-W43');
});

test('error messages lose emails, digits, quoted text and ids', () => {
  const m = scrubMessage('Failed to save "Trader Joe\'s 18.50" for jon@example.com at budgets/abcdefghijklmnopqrstuvwxyz1234');
  assert.ok(!/[0-9@]/.test(m), m);
  assert.ok(!m.includes('Trader'), 'quoted text is dropped');
  assert.ok(m.includes('[email]'));
  assert.equal(scrubMessage(''), 'Unknown problem');
  assert.ok(scrubMessage('x'.repeat(500)).length <= 200);
});

test('an error record carries no account, budget or amounts', () => {
  const r = errorRecord({ id: 'abc', kind: 'weird', message: 'Missing 12 rows', screen: 'nowhere', version: 'wmm-v3 <b>', platform: 'fridge', at: 1 });
  assert.deepEqual(Object.keys(r).sort(), ['at', 'id', 'kind', 'message', 'platform', 'screen', 'version']);
  assert.equal(r.kind, 'app-error');
  assert.equal(r.screen, 'other');
  assert.equal(r.version, 'wmm-v3b', 'the app version keeps only plain characters');
  assert.equal(r.platform, 'computer');
  assert.equal(r.message, 'Missing # rows');
});

test('platform in one word', () => {
  assert.equal(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'iphone');
  assert.equal(platformOf('Mozilla/5.0 (Linux; Android 15)'), 'android');
  assert.equal(platformOf('Mozilla/5.0 (Macintosh)'), 'computer');
});
