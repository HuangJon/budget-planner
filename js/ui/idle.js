/**
 * Signing out after a while without use, like a banking app. Each device remembers when it was
 * last used and how long it may sit idle (Settings → Sign out after). Coming back after longer
 * than that signs out, which also clears this device's copy of the budgets.
 */
import { A, changes } from './state.js';

const LAST = 'wmm:lastActive', LIMIT = 'wmm:idleMinutes', NOTICE = 'wmm:idleOut';
export const IDLE_CHOICES = [[5, '5 minutes'], [15, '15 minutes'], [60, '1 hour'], [1440, '1 day'], [10080, '1 week']];
const DEFAULT_MINUTES = 15;

// Storage can be missing or throw (private browsing, previews), so every use is guarded.
const read = (k, session) => { try { return (session ? sessionStorage : localStorage).getItem(k); } catch { return null; } };
const write = (k, v, session) => { try { const s = session ? sessionStorage : localStorage; if (v === null) s.removeItem(k); else s.setItem(k, String(v)); } catch { /* no timeout memory */ } };

export const idleMinutes = () => {
  const n = Number(read(LIMIT));
  return IDLE_CHOICES.some(([m]) => m === n) ? n : DEFAULT_MINUTES;
};
/** Whether this device sat unused for longer than allowed. No record yet means a fresh sign-in. */
export const isIdleTooLong = (now = Date.now()) => {
  const last = Number(read(LAST));
  return Boolean(last) && now - last > idleMinutes() * 60000;
};
const touch = () => write(LAST, Date.now());
/** Shown once on the sign-in screen after an automatic sign-out. */
export const idleNotice = () => {
  const m = Number(read(NOTICE, true));
  if (!m) return '';
  const label = IDLE_CHOICES.find(([x]) => x === m)?.[1] || `${m} minutes`;
  return `Signed out after ${label} without use, to keep your budget private.`;
};

let watching = false, lastWrite = 0;
async function signOutIdle() {
  if (!watching) return;
  watching = false;
  write(NOTICE, idleMinutes(), true);
  write(LAST, null);
  try { await A.repo.auth.signOut(); } catch { /* the reload still shows sign-in */ }
  location.hash = '#home';
  location.reload();
}
const check = () => { if (watching && isIdleTooLong()) signOutIdle(); };
const active = () => {
  if (!watching) return;
  if (isIdleTooLong()) { signOutIdle(); return; }
  const now = Date.now();
  if (now - lastWrite > 15000) { lastWrite = now; touch(); }
};

/**
 * Call once someone is signed in. Returns false (and signs out) if this device was left too long.
 * The preview never times out.
 */
export function startIdleWatch() {
  if (A.preview || watching) return true;
  watching = true;
  if (isIdleTooLong()) { signOutIdle(); return false; }
  touch();
  write(NOTICE, null, true);
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'scroll']) addEventListener(ev, active, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); else if (watching && !isIdleTooLong()) touch(); });
  setInterval(check, 30000);
  return true;
}
/** Signing out by hand starts the next sign-in fresh. */
export const forgetActivity = () => write(LAST, null);

export const idlePicker = () => `<label class="form-row bordered"><span class="form-row-label">Sign out after</span>
  <select data-change="idle-minutes" aria-label="Sign out after this long without use">${IDLE_CHOICES.map(([m, label]) => `<option value="${m}" ${m === idleMinutes() ? 'selected' : ''}>${label} without use</option>`).join('')}</select></label>`;
changes['idle-minutes'] = el => { write(LIMIT, Number(el.value)); touch(); };
