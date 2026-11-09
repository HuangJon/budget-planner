/** Your budgets, starting a new one, and your account menu. */
import { A, actions, render } from './state.js';
import { esc, openSheet, closeSheet, sheetHead, toast, send, val, today, registerSheet, downloadFile } from './dom.js';
import { transactionsCsv, planCsv, exportName } from '../core/export.js';
import { RESTORE_DAYS } from '../data/repository.js';
import { lookPicker, setLook } from './look.js';
import { summaryFor } from './budget.js';
import { money, toCents } from '../core/money.js';
import { LIMITS, APP_NAME, STARTER_CATEGORIES } from '../config/app.js';
import { starterCategories } from '../data/repository.js';
import { helpButton } from './help.js';
import { idlePicker } from './idle.js';

/** Your initial in a circle: opens You and settings, on home and in every budget. */
export const accountButton = () => `<button type="button" class="icon-btn ava-btn" data-action="account" aria-label="You and settings"><span class="ava" style="background:var(--m1)">${esc([...(A.user?.displayName || 'Y')][0].toUpperCase())}</span></button>`;

export function homeScreen() {
  const all = A.budgetIds.filter(id => A.budgets[id]);
  const ids = all.filter(id => !A.budgets[id].deleted);
  const daysLeft = b => Math.max(0, RESTORE_DAYS - Math.floor((Date.now() - (b.deletedAt || 0)) / 864e5));
  const deleted = all.filter(id => A.budgets[id].deleted && A.budgets[id].members?.[A.user?.uid]?.admin && daysLeft(A.budgets[id]) > 0);
  return `<header class="home-head"><div class="row between gap8"><h1 class="grow">${esc(APP_NAME)}</h1>${helpButton('home')}${accountButton()}</div><p class="muted">Every dollar gets a job. Start a budget for yourself, or one to share.</p></header>
    ${ids.length ? `<section class="panel">${ids.map(id => {
      const b = A.budgets[id];
      const s = summaryFor(b);
      const people = Object.keys(b.members || {}).length;
      return `<a class="tap budget-row" href="#b-${id}"><span class="grow stack tight"><strong class="wrap-any two-lines">${esc(b.name)}</strong><span class="tiny muted">${people > 1 ? `Shared · ${people} people` : 'Just you'}${s.overspent.length ? ` · <span class="owe">${s.overspent.length} overspent</span>` : ''}</span></span><span class="stack tight right"><span class="amt ${s.readyToAssign < 0 ? 'owe' : ''}">${money(s.readyToAssign)}</span><span class="tiny muted">to assign</span></span></a>`;
    }).join('')}</section>`
    : `<section class="panel empty"><h2>No budgets yet</h2><p class="muted">Start one for yourself, or one to share with your household.</p></section>`}
    ${(A.pending || []).length ? `<section class="panel pending-list">${A.pending.map(p => `<div class="request-row"><span class="grow stack tight"><strong class="wrap-any">${esc(p.budgetName || 'A shared budget')}</strong><span class="tiny ${p.declined ? 'owe' : 'muted'}">${p.declined ? 'The admin didn\u2019t let you in' : 'Waiting for an admin to let you in'}</span></span>${p.declined ? `<button type="button" class="btn small" data-action="pending-dismiss" data-id="${p.budgetId}">Dismiss</button>` : `<button type="button" class="btn small" data-action="pending-cancel" data-id="${p.budgetId}">Cancel</button>`}</div>`).join('')}</section>` : ''}
    <button type="button" class="btn primary" data-action="new-budget">Start a budget</button>
    ${deleted.length ? `<section class="panel pending-list" aria-label="Deleted budgets"><span class="label">Deleted</span>${deleted.map(id => `<div class="request-row"><span class="grow stack tight"><strong class="wrap-any">${esc(A.budgets[id].name)}</strong><span class="tiny muted">Can be restored for ${daysLeft(A.budgets[id])} more days</span></span><button type="button" class="btn small" data-action="budget-restore" data-id="${id}">Restore</button></div>`).join('')}</section>` : ''}
    ${A.user ? `<p class="small muted signed-in">Signed in as ${esc(A.user.email)}${A.preview ? ' (preview)' : ''}. <button type="button" class="link small" data-action="sign-out">Sign out</button></p>` : ''}`;
}

/* ---------- Starting a budget: who it's for, money you have now, categories, then Plan money ---------- */
actions['new-budget'] = () => {
  const picked = new Set(STARTER_CATEGORIES.flatMap(g => g.items.filter(i => i.on).map(i => i.name)));
  A.sheet = { kind: 'new-budget', step: 1, type: 'personal', name: '', money: '', picked };
  drawNewBudget();
};
const STEPS = ['Name', 'Money', 'Categories'];
const keepTyped = () => {
  const S = A.sheet;
  if (document.getElementById('nbName')) S.name = val('nbName');
  if (document.getElementById('nbMoney')) S.money = val('nbMoney');
};
function drawNewBudget() {
  const S = A.sheet, t = S.type;
  const steps = `<ol class="steps">${STEPS.map((label, i) => `<li class="${i + 1 < S.step ? 'done' : ''}" ${i + 1 === S.step ? 'aria-current="step"' : ''}><span>${i + 1}</span>${label}</li>`).join('')}</ol>`;
  let body, button;
  if (S.step === 1) {
    body = `<label class="f"><span>Name</span><input id="nbName" maxlength="${LIMITS.budgetName}" placeholder="${t === 'shared' ? 'Home, Family…' : 'My money'}" autocomplete="off" value="${esc(S.name)}"></label>
      <div class="seg" role="group" aria-label="Who uses it"><button type="button" data-action="nb-type" data-id="personal" aria-pressed="${t === 'personal'}">Just me</button><button type="button" data-action="nb-type" data-id="shared" aria-pressed="${t === 'shared'}">Shared</button></div>
      <p class="small muted">${t === 'shared' ? 'Everyone you invite sees and changes the same budget. You can invite people once it\u2019s made.' : 'Only you can see it. You can share it later.'}</p>`;
    button = 'Next';
  } else if (S.step === 2) {
    body = `<h3>How much money do you have right now?</h3>
      <ul class="small muted start-how">
        <li><strong>Add</strong> what's in checking, and savings you want to plan with (like an emergency fund).</li>
        <li><strong>Take off</strong> what you owe on credit cards today. It's already spent, so it isn't free to plan.</li>
        <li><strong>Leave out</strong> retirement and investments you won't touch, and pay that hasn't arrived yet.</li>
      </ul>
      <label class="money-in big"><span class="sr">Money you have now</span><span aria-hidden="true">$</span><input id="nbMoney" class="amount-input" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(S.money)}"></label>
      <p class="small muted">It goes into Ready to assign, so you can give it jobs straight away. Paychecks go in when they land: tap Ready to assign, then Add income, or set them to repeat.</p>`;
    button = 'Next';
  } else {
    body = `<h3>Pick your categories</h3><p class="small muted">Tap to add or remove. You can rename them and add your own any time.</p>
      ${STARTER_CATEGORIES.map(g => `<section class="stack tight"><span class="label">${esc(g.group)}</span><div class="chips">${g.items.map(i => `<button type="button" class="chip" data-action="nb-pick" data-id="${esc(i.name)}" aria-pressed="${S.picked.has(i.name)}">${esc(i.name)}</button>`).join('')}</div></section>`).join('')}`;
    button = `Start with ${S.picked.size} ${S.picked.size === 1 ? 'category' : 'categories'}`;
  }
  openSheet(`<form class="sheet" id="newBudgetForm" novalidate>${S.step > 1 ? sheetHead('New budget').replace('data-action="sheet-back"', 'data-action="nb-back"') : sheetHead('New budget')}<div class="sheet-body">
    ${steps}${body}
  </div><div class="sheet-foot"><button type="submit" class="btn primary" data-action="nb-next">${button}</button></div></form>`);
  if (S.step < 3) document.getElementById(S.step === 1 ? 'nbName' : 'nbMoney')?.focus();
}
actions['nb-type'] = el => { keepTyped(); A.sheet.type = el.dataset.id; drawNewBudget(); };
actions['nb-back'] = () => { keepTyped(); A.sheet.step -= 1; drawNewBudget(); };
actions['nb-pick'] = el => {
  const p = A.sheet.picked, n = el.dataset.id;
  if (p.has(n)) p.delete(n); else p.add(n);
  el.setAttribute('aria-pressed', String(p.has(n)));
  document.querySelector('[data-action=nb-next]').textContent = `Start with ${p.size} ${p.size === 1 ? 'category' : 'categories'}`;
};
actions['nb-next'] = () => {
  keepTyped();
  const S = A.sheet;
  if (S.step === 1) {
    S.name = S.name.trim().slice(0, LIMITS.budgetName);
    if (!S.name) { toast('Give it a name.'); return; }
  }
  if (S.step < 3) { S.step += 1; drawNewBudget(); return; }
  const { budget, written } = A.repo.createBudget({
    name: S.name, kind: S.type, myName: A.user?.displayName || 'You',
    categories: starterCategories([...S.picked]), startingMoney: toCents(S.money), today: today(),
  });
  send(written);
  closeSheet();
  location.hash = `#b-${budget.id}-plan`;
};

actions.account = () => {
  A.sheet = { kind: 'account' };
  const b = A.route.id ? A.budgets[A.route.id] : null;
  openSheet(`<div class="sheet">${sheetHead('You and settings')}<div class="sheet-body">
    <section class="panel pad stack">
      <strong>${esc(A.user?.displayName || 'You')}</strong>
      <span class="small muted">${esc(A.user?.email || '')}</span>
    </section>
    <section class="panel pad stack">${lookPicker()}</section>
    ${b ? `<section class="panel pad stack"><h3>${esc(b.name)}</h3><button type="button" class="btn" data-action="edit-cats">Edit categories</button><button type="button" class="btn" data-action="open-accounts">Check against your accounts</button>
      <span class="label">Export to a spreadsheet</span>
      <div class="two-btns"><button type="button" class="btn" data-action="export-tx">Transactions</button><button type="button" class="btn" data-action="export-plan">Plan by month</button></div>
      <p class="tiny muted">CSV files that open in Numbers, Excel or Google Sheets. A good backup too.</p></section>` : ''}
    <section class="panel pad stack">
      <h3>Signing out</h3>
      ${idlePicker()}
      <p class="tiny muted">For this device. After that long without use, the app signs out and clears its copy of your budgets.</p>
    </section>
    <section class="panel pad stack">
      <h3>Your privacy</h3>
      <p class="small muted">Only people in a budget can see it in the app. The developer sees only counts, like how many people use it, and error reports with amounts and anything you typed removed. The owner runs the database, so they could technically look inside it, but the app never shows them your budget.</p>
    </section>
        ${A.isOwner ? '<a class="btn owner-link" href="#owner">Usage and feedback</a>' : ''}
        <button type="button" class="btn" data-action="feedback-open">Send feedback</button>
        <button type="button" class="btn" data-action="sign-out">Sign out</button>
    ${A.preview ? '<button type="button" class="btn" data-action="preview-reset">Start the preview over</button>' : ''}
  </div></div>`);
};
registerSheet('account', () => actions.account());
actions['export-tx'] = () => { const b = A.budgets[A.route.id]; downloadFile(exportName(b.name, 'transactions', today()), transactionsCsv(b, A.transactions[b.id] || [])); };
actions['export-plan'] = () => { const b = A.budgets[A.route.id]; downloadFile(exportName(b.name, 'plan', today()), planCsv(b)); };
actions['set-look'] = el => { setLook(el.dataset.id); actions.account(); };
export const refreshAccount = () => render();
actions['budget-restore'] = el => { send(A.repo.restoreBudget(el.dataset.id)); toast('Budget restored'); };
