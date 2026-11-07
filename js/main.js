/** Starts the app: picks the backend, follows the link, keeps data live and draws the screens. */
import { A, actions, inputs, changes, setRender } from './ui/state.js';
import { esc, svg, ICON, closeSheet, sheetBack, today } from './ui/dom.js';
import { applyLook } from './ui/look.js';
import { homeScreen } from './ui/home.js';
import { budgetScreen, catSheet } from './ui/budget.js';
import { transactionsScreen } from './ui/transactions.js';
import { planScreen } from './ui/plan.js';
import { trendsScreen } from './ui/trends.js';
import { peopleScreen, joinScreen, openJoin } from './ui/people.js';
import { helpButton, describe } from './ui/help.js';
import { openTxForm } from './ui/tx-form.js';
import { openCatEditor } from './ui/cat-edit.js';
import { createLocalBackend } from './data/backend-local.js';
import { createRepository } from './data/repository.js';
import { exampleData } from './data/example.js';
import { thisMonth } from './core/budget.js';
import { dueTransactions } from './core/recurring.js';
import { APP_NAME } from './config/app.js';

applyLook();
A.preview = Boolean(globalThis.__WMM_PREVIEW__) || !globalThis.__WMM_FIREBASE__;
A.month = thisMonth();

const backend = createLocalBackend();
A.repo = createRepository(backend);
A.user = backend.user();
if (A.preview && backend.isEmpty()) backend.reset(exampleData(A.user.uid));

/* ---------- Live data ---------- */
const stops = new Map();
/** Adds any monthly copies that are due, once both the budget and its transactions have arrived. */
const adding = new Set();
function addDueCopies(id) {
  const b = A.budgets[id], list = A.transactions[id];
  if (!b || !list || !b.members?.[A.user?.uid] || adding.has(id)) return;
  const due = dueTransactions(b.recurring, list.map(t => t.id), today());
  if (!due.length) return;
  adding.add(id);
  A.repo.addRecurringCopies(id, due).catch(() => {}).finally(() => adding.delete(id));
}
function follow(id) {
  if (stops.has(id)) return;
  const s1 = A.repo.watchBudget(id, b => { A.budgets[id] = b; addDueCopies(id); render(); });
  const s2 = A.repo.watchTransactions(id, list => { A.transactions[id] = list; addDueCopies(id); render(); });
  stops.set(id, () => { s1(); s2(); });
}
A.repo.watchMyPending(list => { A.pending = list; render(); });
A.repo.watchMyBudgets(ids => {
  A.budgetIds = ids;
  ids.forEach(follow);
  A.status = 'ready';
  render();
});

/* ---------- Routes ---------- */
function readRoute() {
  const join = /^#join-([a-z0-9]{12,40})$/.exec(location.hash);
  if (join) { A.route = { name: 'join', code: join[1] }; openJoin(join[1]); return; }
  const m = /^#b-([a-z0-9]{20,40})(?:-(activity|plan|trends|people))?$/.exec(location.hash);
  const names = { activity: 'transactions', plan: 'plan', trends: 'trends', people: 'people' };
  A.route = m ? { name: names[m[2]] || 'budget', id: m[1] } : { name: 'home' };
  A.confirmRemove = null; A.confirmLeave = false;
  // Plan money starts each visit with a fresh undo point and no open preview.
  if (A.route.name === 'plan') { A.planSnapshot = null; A.fundPreview = false; }
  if (m) follow(m[1]);
}
addEventListener('hashchange', () => { closeSheet(); readRoute(); render(); scrollTo(0, 0); });
readRoute();

/* ---------- Drawing ---------- */
const app = document.getElementById('app'), tabs = document.getElementById('tabs');

function topbar(b) {
  return `<header class="topbar">
    <a class="icon-btn" href="#home" aria-label="All budgets">${svg(ICON.home)}</a>
    <h1 class="grow">${esc(b.name)}</h1>
    ${helpButton(A.route.name)}
    <button type="button" class="icon-btn ava-btn" data-action="account" aria-label="You and settings"><span class="ava" style="background:var(--m1)">${esc([...(A.user?.displayName || 'Y')][0].toUpperCase())}</span></button>
  </header>`;
}

function drawTabs(b) {
  if (!b || A.route.name === 'plan') { tabs.hidden = true; return; }
  const here = A.route.name;
  tabs.hidden = false;
  const tab = (route, suffix, icon, label) => `<a class="tab" href="#b-${b.id}${suffix}" ${here === route ? 'aria-current="page"' : ''}>${svg(icon)}<span>${label}</span></a>`;
  tabs.innerHTML = `<div class="tabs-in">
    ${tab('budget', '', ICON.wallet, 'Budget')}
    ${tab('transactions', '-activity', ICON.list, 'Activity')}
    <button type="button" class="tab add-tab spend-tab" data-action="add-tx">${svg(ICON.plus)}<span>Spend</span></button>
    ${tab('trends', '-trends', ICON.chart, 'Trends')}
    ${tab('people', '-people', ICON.people, 'People')}
  </div>`;
}

function render() {
  if (A.status !== 'ready') return;
  // Someone may be typing on the page (Plan money). Keep their box, cursor and unsaved text.
  const active = document.activeElement;
  const keep = active && app.contains(active) && active.id && /INPUT|TEXTAREA/.test(active.tagName)
    ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
  const b = A.route.id ? A.budgets[A.route.id] : null;
  if (A.route.name === 'join') {
    document.title = APP_NAME;
    app.innerHTML = joinScreen();
  } else if (A.route.name === 'home') {
    document.title = APP_NAME;
    app.innerHTML = homeScreen();
  } else if (b === undefined) {
    app.innerHTML = '<section class="panel empty"><h2>Opening the budget</h2><p class="muted">One moment.</p></section>';
  } else if (!b) {
    app.innerHTML = `<section class="panel empty"><h2>This budget can't be opened</h2><p class="muted">It may have been removed, or you weren't added to it.</p><a class="btn" href="#home">See your budgets</a></section>`;
  } else {
    document.title = `${b.name} · ${APP_NAME}`;
    app.innerHTML = A.route.name === 'plan' ? planScreen(b) : topbar(b) + describe(A.route.name) + ({ transactions: transactionsScreen, trends: trendsScreen, people: peopleScreen }[A.route.name] || budgetScreen)(b);
  }
  drawTabs(b);
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      el.value = keep.value;
      el.focus({ preventScroll: true });
      try { el.setSelectionRange(keep.start, keep.end); } catch { /* some boxes have no cursor */ }
      if (el.dataset.input) inputs[el.dataset.input]?.(el);
    }
  }
  // Keep an open category up to date, unless someone is typing in it.
  const typing = document.activeElement?.closest?.('dialog') && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (A.sheet?.kind === 'cat' && !typing) catSheet();
}
setRender(render);

/* ---------- Events ---------- */
actions['close-sheet'] = () => closeSheet();
actions['sheet-back'] = () => sheetBack();
actions['edit-cats'] = () => openCatEditor();
actions['preview-reset'] = () => { backend.reset(exampleData(A.user.uid)); closeSheet(); location.hash = '#home'; location.reload(); };
actions.undo = () => { const u = A.undo; A.undo = null; document.getElementById('toast').hidden = true; u?.(); };

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  fn(el, e);
});
document.addEventListener('submit', e => {
  e.preventDefault();
  const btn = e.target.querySelector('[type=submit][data-action]');
  if (btn) actions[btn.dataset.action]?.(btn, e);
});
document.addEventListener('input', e => { const el = e.target.closest('[data-input]'); if (el) inputs[el.dataset.input]?.(el, e); });
document.addEventListener('change', e => { const el = e.target.closest('[data-change]'); if (el) changes[el.dataset.change]?.(el, e); });

// Tapping the dimmed area outside a sheet closes it, like the menus.
const dlg = document.getElementById('dlg');
dlg.addEventListener('click', e => { if (e.target === dlg) closeSheet(); });
dlg.addEventListener('close', () => { A.sheet = null; A.form = null; A.sheetStack = []; });

/*
 * A new month while the app sits open (or in the background overnight): if you were looking at
 * the month that just ended, move to the new one, and add any repeats that came due.
 */
let seenMonth = thisMonth();
function catchUp() {
  const now = thisMonth();
  if (now !== seenMonth) {
    if (A.month === seenMonth) A.month = now;
    seenMonth = now;
  }
  A.budgetIds.forEach(addDueCopies);
  render();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') catchUp(); });
setInterval(() => { if (document.visibilityState === 'visible' && thisMonth() !== seenMonth) catchUp(); }, 60000);

/** On a phone, tapping away from a box closes the keyboard, which brings the save button back. */
document.addEventListener('pointerdown', ev => {
  const typing = document.activeElement;
  if (!matchMedia('(pointer:coarse)').matches || !typing?.closest?.('dialog') || !typing.matches('input,textarea')) return;
  if (!ev.target.closest?.('input,textarea,select,label')) typing.blur();
});

export { openTxForm };
