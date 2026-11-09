/**
 * The owner page: whether people use the app and what's breaking. Counts and scrubbed error
 * reports only. The database rules don't let the owner read any budget, and this page never tries.
 */
import { A, actions, render } from './state.js';
import { esc, svg, ICON, fmtDate } from './dom.js';
import { recentWeeks } from '../core/usage.js';
import { APP_VERSION } from '../config/app.js';

export const isOwnerAccount = ownerUid => Boolean(ownerUid) && A.user?.uid === ownerUid;

export function ownerScreen() {
  const O = A.owner || {};
  if (!O.loaded) return '<section class="panel empty"><h2>Loading counts</h2><p class="muted">One moment.</p></section>';
  if (O.error) return `<section class="panel empty"><h2>Couldn’t load the owner page</h2><p class="muted">${esc(O.error)}</p>${isOwnerAccount(A.ownerUid) ? '<button type="button" class="btn" data-action="owner-refresh">Try again</button><button type="button" class="btn" data-action="sign-out">Sign out</button>' : '<a class="btn" href="#home">Back</a>'}</section>`;
  const s = O.stats || {};
  const weeks = recentWeeks(new Date(), 8);
  const counts = weeks.map(w => ({ w, n: s.weeks?.[w] || 0 }));
  const max = Math.max(1, ...counts.map(c => c.n));
  const errors = O.errors || [];
  // On the owner account this is the home screen: settings (to sign out) instead of a back arrow.
  const own = isOwnerAccount(A.ownerUid);
  return `<header class="topbar">${own ? '' : `<a class="icon-btn" href="#home" aria-label="Back">${svg(ICON.back)}</a>`}<h1 class="grow">Owner page</h1>${own ? `<button type="button" class="icon-btn" data-action="account" aria-label="You and settings">${svg(ICON.people)}</button>` : ''}</header>
    <p class="screen-tip">Counts and error reports only. You can't see anyone's budgets, and this page never asks for them.</p>
    <section class="panel pad owner-counts">
      <div><span class="label">People</span><span class="big-amt">${s.people || 0}</span></div>
      <div><span class="label">Budgets</span><span class="big-amt">${s.budgets || 0}</span></div>
      <div><span class="label">Active this week</span><span class="big-amt">${counts[0].n}</span></div>
    </section>
    <section class="panel pad stack">
      <h2>People active each week</h2>
      <div class="week-bars" role="img" aria-label="People active in each of the last ${weeks.length} weeks">${counts.slice().reverse().map(c => `<div class="week-bar"><span class="tiny">${c.n}</span><i style="height:${Math.round((c.n / max) * 100)}%"></i><span class="tiny muted">${esc(c.w.slice(5))}</span></div>`).join('')}</div>
    </section>
    <section class="panel pad stack">
      <div class="row between"><h2>Error reports</h2><button type="button" class="link small" data-action="owner-refresh">Refresh</button></div>
      ${errors.length ? `<ul class="error-list">${errors.map(e => `<li><div class="row between"><strong>${esc(e.kind)}</strong><span class="tiny muted">${esc(fmtDate(new Date(e.at).toISOString().slice(0, 10)))}</span></div><span class="small">${esc(e.message)}</span><span class="tiny muted">${esc(e.screen)} · ${esc(e.platform)} · ${esc(e.version)}</span></li>`).join('')}</ul>` : '<p class="small muted">No errors reported. Reports never include amounts, names, emails or anything typed.</p>'}
    </section>
    <p class="tiny muted">This version: ${esc(APP_VERSION)}</p>`;
}

export async function loadOwner() {
  A.owner = { loaded: false };
  render();
  try {
    const [stats, errors] = await Promise.all([A.repo.readStats(), A.repo.listErrors()]);
    A.owner = { loaded: true, stats: stats || {}, errors };
  } catch (e) {
    A.owner = { loaded: true, error: e?.code === 'permission-denied' ? 'This account isn’t the owner.' : 'Check your connection and try again.' };
  }
  render();
}
actions['owner-refresh'] = () => loadOwner();
