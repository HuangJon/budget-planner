/** Starts the app: picks the backend, follows the link, keeps data live and draws the screens. */
import { A, actions, inputs, changes, setRender } from './ui/state.js';
import { esc, svg, ICON, closeSheet, sheetBack, today, refreshOpenSheet, redrawKeeping } from './ui/dom.js';
import { applyLook } from './ui/look.js';
import { homeScreen, accountButton } from './ui/home.js';
import { budgetScreen } from './ui/budget.js';
import { transactionsScreen } from './ui/transactions.js';
import { planScreen } from './ui/plan.js';
import { trendsScreen } from './ui/trends.js';
import { peopleScreen, joinScreen, openJoin } from './ui/people.js';
import { helpButton, describe } from './ui/help.js';
import { openTxForm } from './ui/tx-form.js';
import './ui/import.js';
import './ui/report.js';
import './ui/arrange.js';
import './ui/search.js';
import './ui/accounts.js';
import './ui/imports.js';
import './ui/closeout.js';
import { startIdleWatch, forgetActivity } from './ui/idle.js';
import { openCatEditor } from './ui/cat-edit.js';
import { createLocalBackend } from './data/backend-local.js';
import { createFirebaseBackend, loadFirebaseSdk } from './data/backend-firebase.js';
import { createRepository } from './data/repository.js';
import { signInView, verifyView } from './ui/account.js';
import { ownerScreen, loadOwner } from './ui/owner.js';
import { setUpErrorLog } from './ui/error-log.js';
import { watchForUpdates } from './ui/updates.js';
import { maybeStartTour, drawTour } from './ui/tour.js';
import { exampleData } from './data/example.js';
import { thisMonth } from './core/budget.js';
import { dueTransactions } from './core/recurring.js';
import { APP_NAME } from './config/app.js';

applyLook();
// The preview build runs on this device only; the real site uses Firebase and real sign-in.
A.preview = Boolean(globalThis.__WMM_PREVIEW__);
A.month = thisMonth();

/* ---------- Live data ---------- */
const stops = new Map();
/** Adds any repeats that are due, once both the budget and its transactions have arrived. */
const adding = new Set();
function addDueCopies(id) {
  const b = A.budgets[id], list = A.transactions[id];
  if (!b || b.deleted || !list || !b.members?.[A.user?.uid] || adding.has(id)) return;
  const due = dueTransactions(b.recurring, list.map(t => t.id), today());
  if (!due.length) return;
  adding.add(id);
  A.repo.addRecurringCopies(id, due).catch(() => {}).finally(() => adding.delete(id));
}
/**
 * Watches one budget and its transactions. A refused read is tried again a few times before the
 * budget shows as "can't be opened": a brand-new budget can be watched a moment before the server
 * has it, and a phone coming back online can be briefly refused.
 */
function follow(id) {
  if (!started || stops.has(id)) return;
  const watch = (start, onData, onGone, tries = 0) => {
    let stop = start(onData, () => {
      if (tries >= 3) { onGone(); return; }
      setTimeout(() => { stop = watch(start, onData, onGone, tries + 1); }, 800 * (tries + 1));
    });
    return () => stop();
  };
  const s1 = watch((ok, err) => A.repo.watchBudget(id, ok, err), b => { A.budgets[id] = b; addDueCopies(id); render(); }, () => { A.budgets[id] = null; render(); });
  const s2 = watch((ok, err) => A.repo.watchTransactions(id, ok, err), list => { A.transactions[id] = list; addDueCopies(id); render(); }, () => {});
  // Imports too, so one made on another phone shows up here right away.
  const s3 = watch((ok, err) => A.repo.watchImports(id, ok, err), list => { A.imports = { ...A.imports, [id]: [...list].sort((x, y) => y.at - x.at) }; render(); if (A.sheet) refreshOpenSheet(); }, () => {});
  stops.set(id, () => { s1(); s2(); s3(); });
}

let started = false;
/** Once someone is signed in and verified: follow their budgets and requests, and count the visit. */
function startData() {
  if (started) return;
  started = true;
  A.repo.watchMyPending(list => { A.pending = list; render(); }, () => {});
  A.repo.watchMyBudgets(ids => {
    A.budgetIds = ids;
    ids.forEach(follow);
    A.status = 'ready';
    render();
  }, () => { A.status = 'ready'; render(); });
  readRoute();
  if (!A.preview) {
    A.repo.noteVisit().catch(() => {});
    // The owner page link shows only for the account listed as owner in the database.
    A.repo.amOwner().then(yes => { if (yes) { A.isOwner = true; render(); } });
  }
  setUpErrorLog();
}

/** Called whenever the signed-in account changes or gets verified. */
A.onUser = user => {
  A.user = user;
  // Signed out: the next sign-in starts a fresh session, whatever was recorded before.
  if (!user) { forgetActivity(); A.status = 'signed-out'; render(); return; }
  if (!user.verified) { A.status = 'verify'; render(); return; }
  // Left unused too long on this device: sign out before showing anything.
  if (!startIdleWatch()) return;
  startData();
};

async function boot() {
  if (A.preview) {
    const backend = createLocalBackend();
    A.repo = createRepository(backend);
    if (backend.isEmpty()) backend.reset(exampleData(backend.user().uid));
    A.onUser({ ...backend.user(), verified: true });
    return;
  }
  try {
    const { firebaseConfig, appCheckSiteKey, appCheckProvider, FIREBASE_VERSION } = await import('./config/firebase.js');
    const sdk = await loadFirebaseSdk(FIREBASE_VERSION, { appCheck: Boolean(appCheckSiteKey) });
    const backend = await createFirebaseBackend(firebaseConfig, sdk, { appCheckSiteKey, appCheckProvider });
    A.repo = createRepository(backend);
    A.onUser(backend.auth.current());
    backend.auth.onChange(user => { if (user?.uid !== A.user?.uid || user?.verified !== A.user?.verified) A.onUser(user); });
  } catch {
    document.getElementById('app').innerHTML = '<section class="panel empty"><h2>Can\u2019t reach the app</h2><p class="muted">Check your connection, then reload this page.</p><button type="button" class="btn" data-action="reload">Reload</button></section>';
  }
}

/* ---------- Routes ---------- */
function readRoute() {
  if (location.hash === '#owner') { A.route = { name: 'owner' }; if (started) loadOwner(); return; }
  const join = /^#join-([a-z0-9]{12,40})$/.exec(location.hash);
  if (join) { A.route = { name: 'join', code: join[1] }; if (started) openJoin(join[1]); return; }
  const m = /^#b-([a-z0-9]{20,40})(?:-(activity|plan|trends|people))?$/.exec(location.hash);
  const names = { activity: 'transactions', plan: 'plan', trends: 'trends', people: 'people' };
  A.route = m ? { name: names[m[2]] || 'budget', id: m[1] } : { name: 'home' };
  A.confirmRemove = null; A.confirmLeave = false; A.confirmDelete = false;
  // Plan money starts each visit with a fresh undo point and no open preview.
  if (A.route.name === 'plan') { A.planSnapshot = null; A.fundPreview = false; }
  if (m) follow(m[1]);
}
addEventListener('hashchange', () => { closeSheet(); A.arrange = null; readRoute(); render(); scrollTo(0, 0); });
readRoute();

/* ---------- Drawing ---------- */
const app = document.getElementById('app'), tabs = document.getElementById('tabs');

function topbar(b) {
  return `<header class="topbar">
    <a class="icon-btn" href="#home" aria-label="All budgets">${svg(ICON.home)}</a>
    <h1 class="grow">${esc(b.name)}</h1>
    <button type="button" class="icon-btn" data-action="open-search" aria-label="Search transactions">${svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>')}</button>
    ${helpButton(A.route.name)}
    ${accountButton()}
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
    <button type="button" class="tab add-tab spend-tab" data-action="add-tx">${svg(ICON.plus)}<span>Spent</span></button>
    ${tab('trends', '-trends', ICON.chart, 'Trends')}
    ${tab('people', '-people', ICON.people, 'People')}
  </div>`;
}

function render() {
  if (A.status === 'signed-out' || A.status === 'verify') {
    document.title = APP_NAME;
    app.innerHTML = A.status === 'verify' ? verifyView(A.user) : signInView();
    tabs.hidden = true;
    return;
  }
  if (A.status !== 'ready') return;
  // New data can arrive while someone is typing on the page (Plan money, a name). Redrawing the
  // same screen keeps what they typed and their cursor; a different screen starts fresh.
  const where = `${A.route.name}:${A.route.id || ''}`;
  // While categories are being arranged, the screen holds still: new data would undo the moves
  // on screen. It catches up when Done is tapped.
  if (A.arrange?.drawn && where === lastDrawn) { drawTabs(A.route.id ? A.budgets[A.route.id] : null); refreshOpenSheet(); return; }
  if (A.arrange) A.arrange.drawn = A.route.name === 'budget' && A.arrange.budgetId === A.route.id;
  if (where !== lastDrawn) { lastDrawn = where; drawScreen(); }
  else {
    redrawKeeping(app, drawScreen);
    const el = document.activeElement;
    if (el && app.contains(el) && el.dataset.input) inputs[el.dataset.input]?.(el);
  }
  drawTabs(A.route.id ? A.budgets[A.route.id] : null);
  if (A.tour) requestAnimationFrame(drawTour);
  else if (A.route.name === 'budget' && A.budgets[A.route.id] && !A.budgets[A.route.id].deleted && !A.noTour) requestAnimationFrame(maybeStartTour);
  // Keep an open popup up to date with the latest data too.
  refreshOpenSheet();
}
let lastDrawn = null;
function drawScreen() {
  const b = A.route.id ? A.budgets[A.route.id] : null;
  if (A.route.name === 'owner') {
    document.title = `Usage and feedback · ${APP_NAME}`;
    app.innerHTML = ownerScreen();
  } else if (A.route.name === 'join') {
    document.title = APP_NAME;
    app.innerHTML = joinScreen();
  } else if (A.route.name === 'home') {
    document.title = APP_NAME;
    app.innerHTML = homeScreen();
  } else if (b === undefined) {
    app.innerHTML = '<section class="panel empty"><h2>Opening the budget</h2><p class="muted">One moment.</p></section>';
  } else if (b && b.deleted) {
    const admin = b.members?.[A.user?.uid]?.admin;
    app.innerHTML = `<section class="panel empty"><h2>${esc(b.name)} was deleted</h2><p class="muted">${admin ? 'You can bring it back for 30 days after it was deleted.' : 'An admin can bring it back.'}</p>${admin ? `<button type="button" class="btn primary" data-action="budget-restore" data-id="${b.id}">Restore it</button>` : ''}<a class="btn" href="#home">See your budgets</a></section>`;
  } else if (!b) {
    app.innerHTML = `<section class="panel empty"><h2>This budget can't be opened</h2><p class="muted">It may have been removed, or you weren't added to it.</p><a class="btn" href="#home">See your budgets</a></section>`;
  } else {
    document.title = `${b.name} · ${APP_NAME}`;
    app.innerHTML = A.route.name === 'plan' ? planScreen(b) : topbar(b) + describe(A.route.name) + ({ transactions: transactionsScreen, trends: trendsScreen, people: peopleScreen }[A.route.name] || budgetScreen)(b);
  }
}
setRender(render);

/* ---------- Events ---------- */
actions['close-sheet'] = () => closeSheet();
actions.reload = () => location.reload();
actions['sheet-back'] = () => sheetBack();
// The header's Save (shown while typing on a phone) presses the footer's button.
actions['head-save'] = el => el.closest('dialog')?.querySelector('.sheet-foot .btn.primary')?.click();
// Pressing it mustn't close the keyboard first, or it would hide before the tap lands.
document.addEventListener('pointerdown', e => { if (e.target.closest?.('.head-save')) e.preventDefault(); });
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
// The close event arrives a moment after closing. If another popup has opened since (an import
// going straight on to the accounts check), it belongs to that one, so leave it alone.
dlg.addEventListener('close', () => { if (dlg.open) return; A.sheet = null; A.form = null; A.sheetStack = []; });

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

boot();

/* A new version: keep the phone's copy fresh, and offer a reload when one is ready. */
if (!A.preview && 'serviceWorker' in navigator) {
  watchForUpdates({
    sw: navigator.serviceWorker, doc: document, win: window,
    onUpdate: () => {
      if (document.getElementById('updateBar')) return;
      const bar = document.createElement('div');
      bar.id = 'updateBar';
      bar.className = 'update-bar';
      bar.setAttribute('role', 'status');
      bar.innerHTML = '<span>A new version is ready.</span><button type="button" class="btn small primary" data-action="reload">Update</button>';
      document.body.appendChild(bar);
    },
  });
}

export { openTxForm };
