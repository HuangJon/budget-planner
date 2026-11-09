/**
 * The owner page: whether people use the app and what's breaking. Counts and scrubbed error
 * reports only. The database rules don't let the owner read any budget, and this page never tries.
 */
import { A, actions, render } from './state.js';
import { esc, svg, ICON, fmtDate } from './dom.js';
import { recentWeeks } from '../core/usage.js';
import { APP_VERSION } from '../config/app.js';


export function ownerScreen() {
  const O = A.owner || {};
  if (!O.loaded) return '<section class="panel empty"><h2>Loading counts</h2><p class="muted">One moment.</p></section>';
  if (O.error) return `<section class="panel empty"><h2>Couldn’t load the owner page</h2><p class="muted">${esc(O.error)}</p><a class="btn" href="#home">Back</a></section>`;
  const s = O.stats || {};
  const weeks = recentWeeks(new Date(), 8);
  const counts = weeks.map(w => ({ w, n: s.weeks?.[w] || 0 }));
  const max = Math.max(1, ...counts.map(c => c.n));
  const errors = O.errors || [];
  return `<header class="topbar"><a class="icon-btn" href="#home" aria-label="Back">${svg(ICON.back)}</a><h1 class="grow">Usage and feedback</h1></header>
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
    ${reportsSection(O)}
    <section class="panel pad stack">
      <div class="row between"><h2>Error reports</h2><button type="button" class="link small" data-action="owner-refresh">Refresh</button></div>
      ${errors.length ? `<ul class="error-list">${errors.map(e => `<li><div class="row between"><strong>${esc(e.kind)}</strong><span class="tiny muted">${esc(fmtDate(new Date(e.at).toISOString().slice(0, 10)))}</span></div><span class="small">${esc(e.message)}</span><span class="tiny muted">${esc(e.screen)} · ${esc(e.platform)} · ${esc(e.version)}</span></li>`).join('')}</ul>` : '<p class="small muted">No errors reported. Reports never include amounts, names, emails or anything typed.</p>'}
    </section>
    <p class="tiny muted">This version: ${esc(APP_VERSION)}</p>`;
}

const when = at => esc(fmtDate(new Date(at).toISOString().slice(0, 10)));
/** Problems and ideas people sent in their own words, newest first. Done ones fold away. */
function reportsSection(O) {
  const all = [...(O.reports || [])].sort((a, b) => b.at - a.at);
  const open = all.filter(r => !r.done), done = all.filter(r => r.done);
  const item = r => `<li><div class="row between"><span class="tiny muted"><strong class="${r.kind === 'idea' ? 'owed' : 'owe'}">${r.kind === 'idea' ? 'Idea' : 'Problem'}</strong> · ${when(r.at)} · ${esc(r.screen)} · ${esc(r.platform)} · ${esc(r.version)}</span>
      <button type="button" class="link small" data-action="report-done" data-id="${esc(r.id)}">${r.done ? 'Reopen' : 'Mark done'}</button></div>
    <span class="small pre-wrap">${esc(r.text)}</span>
    ${r.email ? `<a class="tiny" href="mailto:${esc(r.email)}?subject=${encodeURIComponent('Your Where\u2019s my money report')}">Reply to ${esc(r.email)}</a>` : '<span class="tiny muted">No email included</span>'}</li>`;
  return `<section class="panel pad stack">
    <div class="row between"><h2>Feedback${open.length ? ` (${open.length})` : ''}</h2><button type="button" class="link small" data-action="owner-refresh">Refresh</button></div>
    ${open.length ? `<ul class="error-list">${open.map(item).join('')}</ul>` : '<p class="small muted">Nothing open. People send these from Settings, the “?” help, or the Report button when something fails.</p>'}
    ${done.length ? `<button type="button" class="link small" data-action="report-show-done">${O.showDone ? 'Hide done' : `Show ${done.length} done`}</button>${O.showDone ? `<ul class="error-list">${done.map(item).join('')}</ul>` : ''}` : ''}
  </section>`;
}
actions['report-done'] = el => {
  const r = (A.owner?.reports || []).find(x => x.id === el.dataset.id);
  if (!r) return;
  r.done = !r.done;
  render();
  A.repo.markReport(r.id, r.done).catch(() => { r.done = !r.done; render(); });
};
actions['report-show-done'] = () => { A.owner.showDone = !A.owner.showDone; render(); };

export async function loadOwner() {
  A.owner = { loaded: false };
  render();
  try {
    const [stats, errors, reports] = await Promise.all([A.repo.readStats(), A.repo.listErrors(), A.repo.listReports()]);
    A.owner = { loaded: true, stats: stats || {}, errors, reports, showDone: A.owner?.showDone };
  } catch (e) {
    A.owner = { loaded: true, error: e?.code === 'permission-denied' ? 'This account isn’t the owner.' : 'Check your connection and try again.' };
  }
  render();
}
actions['owner-refresh'] = () => loadOwner();
