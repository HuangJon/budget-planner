/** Your budgets, starting a new one, and your account menu. */
import { A, actions, render } from './state.js';
import { esc, openSheet, closeSheet, sheetHead, toast, send, val } from './dom.js';
import { lookPicker, setLook } from './look.js';
import { summaryFor } from './budget.js';
import { money } from '../core/money.js';
import { LIMITS, APP_NAME } from '../config/app.js';

export function homeScreen() {
  const ids = A.budgetIds.filter(id => A.budgets[id]);
  return `<header class="home-head"><h1>${esc(APP_NAME)}</h1><p class="muted">Every dollar gets a job.</p></header>
    ${ids.length ? `<section class="panel">${ids.map(id => {
      const b = A.budgets[id];
      const s = summaryFor(b);
      const people = Object.keys(b.members || {}).length;
      return `<a class="tap budget-row" href="#b-${id}"><span class="grow stack tight"><strong class="wrap-any two-lines">${esc(b.name)}</strong><span class="tiny muted">${people > 1 ? `Shared · ${people} people` : 'Just you'}${s.overspent.length ? ` · <span class="owe">${s.overspent.length} overspent</span>` : ''}</span></span><span class="stack tight right"><span class="amt ${s.readyToAssign < 0 ? 'owe' : ''}">${money(s.readyToAssign)}</span><span class="tiny muted">to assign</span></span></a>`;
    }).join('')}</section>`
    : `<section class="panel empty"><h2>No budgets yet</h2><p class="muted">Start one for yourself, or one to share with your household.</p></section>`}
    <button type="button" class="btn primary" data-action="new-budget">Start a budget</button>
    ${A.user ? `<p class="small muted signed-in">Signed in as ${esc(A.user.email)}${A.preview ? ' (preview)' : ''}. <button type="button" class="link small" data-action="sign-out">Sign out</button></p>` : ''}`;
}

actions['new-budget'] = () => {
  A.sheet = { kind: 'new-budget', type: 'personal' };
  drawNewBudget();
};
function drawNewBudget() {
  const t = A.sheet.type;
  openSheet(`<form class="sheet" id="newBudgetForm" novalidate>${sheetHead('New budget')}<div class="sheet-body">
    <label class="f"><span>Name</span><input id="nbName" maxlength="${LIMITS.budgetName}" placeholder="${t === 'shared' ? 'Home, Family…' : 'My money'}" autocomplete="off"></label>
    <div class="seg" role="group" aria-label="Who uses it"><button type="button" data-action="nb-type" data-id="personal" aria-pressed="${t === 'personal'}">Just me</button><button type="button" data-action="nb-type" data-id="shared" aria-pressed="${t === 'shared'}">Shared</button></div>
    <p class="small muted">${t === 'shared' ? 'Everyone you invite sees and changes the same budget. You can invite people after it’s made.' : 'Only you can see it. You can share it later.'}</p>
  </div><div class="sheet-foot"><button type="submit" class="btn primary" data-action="nb-save">Start it</button></div></form>`);
  setTimeout(() => document.getElementById('nbName')?.focus(), 50);
}
actions['nb-type'] = el => { const name = val('nbName'); A.sheet.type = el.dataset.id; drawNewBudget(); document.getElementById('nbName').value = name; };
actions['nb-save'] = () => {
  const name = val('nbName').trim().slice(0, LIMITS.budgetName);
  if (!name) { toast('Give it a name.'); return; }
  const { budget, written } = A.repo.createBudget({ name, kind: A.sheet.type, myName: A.user?.displayName || 'You' });
  send(written);
  closeSheet();
  location.hash = `#b-${budget.id}`;
};

actions.account = () => {
  A.sheet = { kind: 'account' };
  const b = A.route.id ? A.budgets[A.route.id] : null;
  openSheet(`<div class="sheet">${sheetHead('You', '', 'Done')}<div class="sheet-body">
    <section class="panel pad stack">
      <strong>${esc(A.user?.displayName || 'You')}</strong>
      <span class="small muted">${esc(A.user?.email || '')}</span>
    </section>
    <section class="panel pad stack">${lookPicker()}</section>
    ${b ? `<section class="panel pad stack"><h3>${esc(b.name)}</h3><button type="button" class="btn" data-action="edit-cats">Edit categories</button></section>` : ''}
    <section class="panel pad stack">
      <h3>Your privacy</h3>
      <p class="small muted">Only people in a budget can see it in the app. The app's owner sees only counts, like how many people use it, and error reports with amounts and anything you typed removed. The owner runs the database, so they could technically look inside it, but the app never shows them your budget.</p>
    </section>
    ${A.preview ? '<button type="button" class="btn" data-action="preview-reset">Start the preview over</button>' : ''}
  </div></div>`);
};
actions['set-look'] = el => { setLook(el.dataset.id); actions.account(); };
actions['sign-out'] = () => { if (A.preview) toast('Sign out works in the real app.'); };
export const refreshAccount = () => render();
