import test from 'node:test'; import assert from 'node:assert/strict';

const store = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
globalThis.localStorage = store();
globalThis.sessionStorage = store();
const { isIdleTooLong, idleMinutes, forgetActivity } = await import('../../js/ui/idle.js');

test('signs out after the chosen time without use, 15 minutes unless changed', () => {
  assert.equal(idleMinutes(), 15);
  const now = Date.now();
  localStorage.setItem('wmm:lastActive', now - 14 * 60000);
  assert.equal(isIdleTooLong(now), false);
  localStorage.setItem('wmm:lastActive', now - 16 * 60000);
  assert.equal(isIdleTooLong(now), true);
  localStorage.setItem('wmm:idleMinutes', '60');
  assert.equal(isIdleTooLong(now), false, 'an hour allowed');
  localStorage.setItem('wmm:idleMinutes', '7');
  assert.equal(idleMinutes(), 15, 'only the offered choices count');
});

test('a fresh sign-in (no record) is never too long', () => {
  forgetActivity();
  assert.equal(isIdleTooLong(), false);
});
