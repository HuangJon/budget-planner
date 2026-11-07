/**
 * Signing in. Everyone proves an email address or Google account before seeing anything, and
 * signing out clears this device's copy of the budgets. Ported from Trip Tab.
 */
import { A, actions, render } from './state.js';
import { esc, toast, val } from './dom.js';
import { LIMITS, APP_NAME } from '../config/app.js';

const friendly = code => ({
  'auth/email-already-in-use': 'That email already has an account. Sign in instead.',
  'auth/invalid-credential': "That email and password don't match.",
  'auth/wrong-password': "That email and password don't match.",
  'auth/user-not-found': "That email and password don't match.",
  'auth/invalid-email': "That doesn't look like an email address.",
  'auth/weak-password': 'Use a password of at least 6 characters.',
  'auth/too-many-requests': 'Too many tries. Wait a few minutes, then try again.',
  'auth/network-request-failed': 'Signing in needs a connection. Check yours and try again.',
  'auth/popup-blocked': 'Your browser blocked the Google window. Use email below, or open this page in Safari instead of the home-screen app.',
  'auth/popup-closed-by-user': 'The Google window closed before you finished.',
  'auth/operation-not-supported-in-this-environment': "Google sign-in doesn't work here. Use email below.",
}[code] || "That didn't work. Check your connection and try again.");

export function signInView() {
  const mode = A.authMode || 'in', joining = /^#join-/.test(location.hash);
  return `<header class="home-head"><h1>${joining ? 'Sign in to join a budget' : esc(APP_NAME)}</h1>
    <p class="muted">${joining ? 'Someone invited you to share a budget. Sign in first; they let you in after that.' : 'A budget where every dollar gets a job. Sign in with Google or an email address.'}</p></header>
  <section class="panel pad stack">
    <button type="button" class="btn primary" data-action="auth-google">Continue with Google</button>
    <div class="or small muted">or use email</div>
    <div class="seg" role="group" aria-label="Sign in or create an account"><button type="button" data-action="auth-mode" data-id="in" aria-pressed="${mode === 'in'}">Sign in</button><button type="button" data-action="auth-mode" data-id="up" aria-pressed="${mode === 'up'}">Create account</button></div>
    <form class="stack" id="authForm" novalidate>
      ${mode === 'up' ? `<label class="f"><span>Your name</span><input id="authName" required maxlength="${LIMITS.personName}" autocomplete="name"></label>` : ''}
      <label class="f"><span>Email</span><input id="authEmail" type="email" required autocomplete="email" value="${esc(A.authEmail || '')}"></label>
      <label class="f"><span>Password</span><input id="authPassword" type="password" required minlength="6" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}"></label>
      <button type="submit" class="btn" data-action="${mode === 'up' ? 'auth-up' : 'auth-in'}">${mode === 'up' ? 'Create account' : 'Sign in'}</button>
    </form>
    ${mode === 'in' ? '<button type="button" class="link small" data-action="auth-reset">Forgot your password?</button>' : ''}
  </section>
  <p class="small muted">Your budgets follow your account to any phone or computer. Only the people in a budget can see it.</p>`;
}

export function verifyView(user) {
  return `<header class="home-head"><h1>Check your email</h1>
    <p class="muted">We sent a link to <strong class="wrap-any">${esc(user.email)}</strong>. Tap it to verify your account, then come back here.</p></header>
  <section class="panel pad stack">
    <p class="small muted">It can take a minute to arrive. If you don't see it, check your spam or junk folder.</p>
    <button type="button" class="btn primary" data-action="auth-check">I tapped the link</button>
    <button type="button" class="btn" data-action="auth-resend">Send the email again</button>
    <button type="button" class="link small" data-action="sign-out">Use a different account</button>
  </section>`;
}

/** Runs a sign-in step and turns failure into a plain message. */
async function attempt(step) {
  const app = document.getElementById('app');
  app.classList.add('busy');
  try { await step(); } catch (e) { toast(friendly(e?.code)); }
  app.classList.remove('busy');
}
actions['auth-mode'] = el => { A.authEmail = val('authEmail'); A.authMode = el.dataset.id; render(); };
actions['auth-google'] = () => attempt(async () => A.onUser(await A.repo.auth.google()));
actions['auth-in'] = () => attempt(async () => A.onUser(await A.repo.auth.signIn(val('authEmail'), val('authPassword'))));
actions['auth-up'] = () => {
  const name = val('authName').trim().slice(0, LIMITS.personName);
  if (!name) { toast('Type your name.'); return; }
  attempt(async () => A.onUser(await A.repo.auth.signUp(name, val('authEmail'), val('authPassword'))));
};
actions['auth-check'] = () => attempt(async () => {
  const user = await A.repo.auth.refresh();
  if (!user?.verified) toast("It isn't verified yet. Tap the link in the email, then try again.");
  else toast("You're verified. Welcome!");
  A.onUser(user);
});
actions['auth-resend'] = () => attempt(async () => { await A.repo.auth.sendVerification(); toast('Sent. Check your email.'); });
actions['auth-reset'] = () => {
  const email = val('authEmail').trim();
  if (!email) { toast('Type your email first.'); return; }
  attempt(async () => { await A.repo.auth.resetPassword(email); toast('If that email has an account, a reset link is on its way.'); });
};
actions['sign-out'] = () => {
  if (A.preview) { toast('Signing out works in the real app.'); return; }
  attempt(async () => {
    try { localStorage.removeItem('wmm:tourDone'); } catch { /* the tutorial just won't run again */ }
    await A.repo.auth.signOut();
    location.hash = '#home';
    location.reload();
  });
};
