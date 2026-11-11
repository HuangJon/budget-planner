/** The budget screen: Ready to assign, anything overspent, and every category with what's left. */
import { A, actions, changes, render } from './state.js';
import { esc, svg, ICON, fmtMonth, ordinal, openSheet, closeSheet, sheetHead, toast, send, val, fmtDate, registerSheet, openChild } from './dom.js';
import { monthSummary, groupedCategories, fundTargets, coverOverspending, moveMoney, addMonths, thisMonth, monthOf, liveTransactions, targetType } from '../core/budget.js';
import { money, toCents, fromCents } from '../core/money.js';
import { openTxForm } from './tx-form.js';
import { syncBar } from './accounts.js';
import { arranging, arrangeList } from './arrange.js';

export const summaryFor = (b, month = A.month) => monthSummary(b, A.transactions[b.id] || [], month);
const shortMonth = m => fmtMonth(m).split(' ')[0];

export function monthBar() {
  const now = thisMonth();
  return `<div class="monthbar">
    <button type="button" class="icon-btn" data-action="month" data-id="-1" aria-label="Previous month">${svg(ICON.back)}</button>
    <div class="monthbar-mid"><h2><button type="button" class="month-title" data-action="month-pick" aria-label="${esc(fmtMonth(A.month))}. Pick a month">${esc(fmtMonth(A.month))}</button></h2>${A.month !== now ? `<button type="button" class="away-pill" data-action="month" data-id="now">${A.month < now ? 'Past' : 'Future'} month · Back to ${esc(shortMonth(now))}</button>` : ''}</div>
    <button type="button" class="icon-btn" data-action="month" data-id="1" aria-label="Next month">${svg(ICON.next)}</button>
  </div>`;
}

export const hasTargets = b => Object.values(b.categories || {}).some(c => !c.hidden && targetType(c.target));
export const totalNeeded = (b, s) => Object.entries(s.categories).filter(([id]) => !b.categories[id]?.hidden).reduce((a, [, c]) => a + c.needed, 0);

function hero(b, s) {
  const needed = totalNeeded(b, s);
  const negative = s.readyToAssign < 0;
  // A fresh month with money waiting and nothing planned yet gets a nudge to plan it.
  const fresh = A.month === thisMonth() && s.assignedThisMonth === 0 && s.readyToAssign > 0 && !showNewMonth(b, s);
  const say = negative
    ? `You've assigned ${money(-s.readyToAssign)} more than you have. Take some back from a category.`
    : fresh ? `It's ${shortMonth(A.month)}. Time to give this month's money its jobs.`
      : s.readyToAssign === 0 ? 'Every dollar has a job.' : 'Give these dollars a job.';
  return `<section class="hero ${negative ? 'is-owing' : ''} ${fresh ? 'is-fresh' : ''}" aria-label="Ready to assign">
    <span class="label">Ready to assign</span>
    <span class="big ${negative ? 'down' : ''}" data-testid="ready">${money(s.readyToAssign)}</span>
    <p>${esc(say)}</p>
    <div class="hero-line"><span>${needed > 0 ? `Bills and targets need <strong class="amt">${money(needed)}</strong>` : hasTargets(b) ? 'Bills and targets are covered' : 'Decide where it all goes'}</span></div>
    <div class="hero-actions"><button type="button" class="hero-btn ghost" data-action="add-income">Add income</button><a class="hero-btn" href="#b-${b.id}-plan">${negative ? 'Take it back' : fresh ? `Plan ${esc(shortMonth(A.month))}` : 'Plan money'}</a></div>
  </section>`;
}

/**
 * The first visit in a new month gets a short checklist: add this month's income, then plan it.
 * Each step ticks itself off; the list goes away when both are done or when dismissed.
 */
const NM_KEY = (id, m) => `wmm:newmonth:${id}:${m}`;
export function showNewMonth(b, s) {
  if (A.month !== thisMonth()) return false;
  if (s.incomeThisMonth > 0 && s.assignedThisMonth > 0) return false;
  try { if (localStorage.getItem(NM_KEY(b.id, A.month))) return false; } catch { if (A[`mem:${NM_KEY(b.id, A.month)}`]) return false; }
  return true;
}
function newMonthCard(b, s) {
  if (!showNewMonth(b, s)) return '';
  const step = (done, label, action) => `<li class="${done ? 'done' : ''}"><span class="tick" aria-hidden="true">${done ? svg(ICON.check) : ''}</span><span class="grow">${label}</span>${done ? '<span class="sr">Done</span>' : action}</li>`;
  return `<section class="panel new-month" aria-label="New month">
    <div class="row between"><h3>New month: ${esc(fmtMonth(A.month))}</h3><button type="button" class="link small" data-action="new-month-dismiss">Dismiss</button></div>
    <ol class="nm-steps">
      ${step(s.incomeThisMonth > 0, 'Add this month\u2019s income', '<button type="button" class="btn small" data-action="add-income">Add income</button>')}
      ${step(s.assignedThisMonth > 0, 'Plan money: give every dollar a job', `<a class="btn small primary" href="#b-${b.id}-plan">Plan money</a>`)}
    </ol>
    <p class="tiny muted">Leftovers and overspending from last month are already carried over.</p>
  </section>`;
}
actions['new-month-dismiss'] = () => {
  const key = NM_KEY(A.route.id, A.month);
  try { localStorage.setItem(key, '1'); } catch { A[`mem:${key}`] = true; }
  render();
};

/* Filters and compact rows, remembered on this device. */
const pref = (key, fallback) => { try { return localStorage.getItem(key) ?? A[`mem:${key}`] ?? fallback; } catch { return A[`mem:${key}`] ?? fallback; } };
const setPref = (key, value) => { try { localStorage.setItem(key, value); } catch { A[`mem:${key}`] = value; } };
const FILTERS = { all: () => true, needs: x => x.needed > 0, over: x => x.available < 0 };

function filterBar(b, s) {
  const f = pref('wmm:budgetFilter', 'all'), compact = pref('wmm:compact', 'no') === 'yes';
  const ids = Object.keys(b.categories).filter(id => !b.categories[id].hidden);
  const count = k => ids.filter(id => FILTERS[k](s.categories[id])).length;
  const chip = (k, label) => `<button type="button" data-action="budget-filter" data-id="${k}" aria-pressed="${f === k}">${label}</button>`;
  return `<div class="filter-row">
    <div class="seg" role="group" aria-label="Show">${chip('all', 'All')}${chip('needs', `Needs money${count('needs') ? ` (${count('needs')})` : ''}`)}${chip('over', `Over${count('over') ? ` (${count('over')})` : ''}`)}</div>
    <button type="button" class="btn small view-toggle" data-action="budget-compact" aria-pressed="${compact}">${compact ? 'Roomy' : 'Compact'}</button>
    <button type="button" class="btn small" data-action="arrange-start">Arrange</button>
  </div>`;
}
actions['budget-filter'] = el => { setPref('wmm:budgetFilter', el.dataset.id); render(); };
actions['budget-compact'] = () => { setPref('wmm:compact', pref('wmm:compact', 'no') === 'yes' ? 'no' : 'yes'); render(); };

function overspentNotice(b, s) {
  const over = s.overspent.filter(id => !b.categories[id]?.hidden);
  if (!over.length) return '';
  return `<section class="panel over" aria-label="Overspent">
    <div class="over-head"><span class="owe-dot" aria-hidden="true"></span><h3>${over.length === 1 ? 'One category is' : `${over.length} categories are`} overspent</h3></div>
    ${over.map(id => `<div class="over-row"><span class="grow wrap-any">${esc(b.categories[id].name)} is <strong class="owe amt">${money(-s.categories[id].available)}</strong> over</span><button type="button" class="btn small" data-action="open-cat" data-id="${id}">Cover it</button></div>`).join('')}
  </section>`;
}

/** One line under a category's name: what needs attention first, then progress. */
export function catStatus(c, x) {
  const t = x.target;
  const spent = Math.max(0, -x.activity);
  if (x.available < 0) return '<span class="owe">Overspent</span>';
  if (x.needed > 0) {
    const when = t?.type === 'monthly' && t.dueDay ? ` by the ${ordinal(t.dueDay)}` : t?.type === 'monthly' ? '' : ' this month';
    return `<span class="nudge">Needs ${money(x.needed)}${t?.type === 'monthly' ? ' more' : ''}${when}</span>`;
  }
  if (t?.type === 'yearly' && t.notStarted) return `<span class="muted">Yearly target starts in ${shortMonth(t.start)}</span>`;
  if (t?.type === 'yearly') return `<span class="muted">${money(t.spentThisYear)} of ${money(t.amount)} spent this year</span>`;
  if (t?.type === 'byDate') return `<span class="muted">${t.saved >= t.amount ? 'Goal reached · ' : ''}${money(t.saved)} of ${money(t.amount)} saved</span>`;
  if (t?.type === 'monthly') return `<span class="muted">${spent ? `${money(spent)} spent · ` : ''}Target met</span>`;
  const funds = x.carried + x.assigned;
  return `<span class="muted">${spent ? `${money(spent)} spent` : funds > 0 ? 'Nothing spent yet' : 'Nothing assigned'}</span>`;
}

function catBar(x) {
  const t = x.target;
  if (t?.type === 'byDate') return `<span class="bar save" aria-hidden="true"><i style="width:${Math.min(100, Math.round((Math.max(0, t.saved) / t.amount) * 100))}%"></i></span>`;
  const funds = Math.max(0, x.carried + x.assigned);
  const spent = Math.max(0, -x.activity);
  if (!funds && !spent) return '';
  const pct = x.available < 0 ? 100 : funds ? Math.min(100, Math.round((spent / funds) * 100)) : 0;
  return `<span class="bar ${x.available < 0 ? 'is-over' : ''}" aria-hidden="true"><i style="width:${pct}%"></i></span>`;
}

function catLine(c, s) {
  const x = s.categories[c.id];
  return `<button type="button" class="tap cat-row" data-action="open-cat" data-id="${c.id}">
    <span class="grow stack tight"><strong class="cat-name">${esc(c.name)}</strong><span class="small">${catStatus(c, x)}</span>${catBar(x)}</span>
    <span class="cat-avail"><span class="amt ${x.available < 0 ? 'owe' : ''}">${money(Math.abs(x.available))}</span><span class="tiny ${x.available < 0 ? 'owe' : 'muted'}">${x.available < 0 ? 'over' : 'to spend'}</span></span>
  </button>`;
}

/** A group's name on a tab above its card, so groups are easy to tell apart. */
export const groupTab = (name, right = '', { toggle = false, folded = false, level = 3 } = {}) => toggle
  ? `<button type="button" class="group-tab" data-action="group-fold" data-id="${esc(name)}" aria-expanded="${!folded}"><span class="fold-chev" aria-hidden="true">${svg('<path d="M6 9l6 6 6-6"/>')}</span><h${level}>${esc(name)}</h${level}>${right ? `<span class="small">${right}</span>` : ''}</button>`
  : `<div class="group-tab"><h${level}>${esc(name)}</h${level}>${right ? `<span class="small">${right}</span>` : ''}</div>`;

/** Which groups are folded, remembered on this device for each budget. */
const FOLD_KEY = id => `wmm:folded:${id}`;
const readFolds = id => { if (A.foldFallback) return A.foldFallback; try { return JSON.parse(localStorage.getItem(FOLD_KEY(id)) || '[]'); } catch { return []; } };
export const isFolded = (id, name) => readFolds(id).includes(name);
actions['group-fold'] = el => {
  const id = A.route.id, name = el.dataset.id, list = readFolds(id);
  const next = list.includes(name) ? list.filter(n => n !== name) : [...list, name];
  try { localStorage.setItem(FOLD_KEY(id), JSON.stringify(next)); } catch { A.foldFallback = next; }
  render();
};

export function budgetScreen(b) {
  const s = summaryFor(b);
  const f = pref('wmm:budgetFilter', 'all'), compact = pref('wmm:compact', 'no') === 'yes';
  const keepIt = FILTERS[f] || FILTERS.all;
  const groups = groupedCategories(b).map(g => ({ ...g, all: g.categories, categories: g.categories.filter(c => keepIt(s.categories[c.id])) })).filter(g => f === 'all' || g.categories.length);
  return `${monthBar()}
    ${hero(b, s)}
    ${syncBar(b)}
    ${newMonthCard(b, s)}
    ${b.members?.[A.user?.uid]?.admin && Object.keys(b.requests || {}).length ? `<a class="panel request-note" href="#b-${b.id}-people"><span class="grow">${esc(Object.values(b.requests).map(r => r.name || 'Someone').join(', '))} asked to join</span><span class="small link">Review</span></a>` : ''}
    ${overspentNotice(b, s)}
    ${s.unknownActivity ? `<p class="notice">${money(-s.unknownActivity)} was spent in a category that has since been removed.</p>` : ''}
    ${arranging() ? arrangeList(b) : `${Object.keys(b.categories).length ? filterBar(b, s) : ''}
    <div class="groups ${compact ? 'compact' : ''}">
    ${groups.map(g => {
      const left = g.all.reduce((a, c) => a + s.categories[c.id].available, 0);
      const over = g.all.filter(c => s.categories[c.id].available < 0).length;
      const needs = g.all.filter(c => s.categories[c.id].needed > 0).length;
      // A filter shows what matches even inside folded groups.
      const folded = f === 'all' && isFolded(b.id, g.name);
      const summary = `${g.all.length} ${g.all.length === 1 ? 'category' : 'categories'}${over ? ` · <span class="owe">${over} over</span>` : ''}${needs ? ` · <span class="nudge">${needs} need money</span>` : ''}`;
      return `<section class="group ${folded ? 'folded' : ''}" aria-label="${esc(g.name)}">${groupTab(g.name, `${money(left)} to spend`, { toggle: f === 'all', folded })}<div class="panel group-card">${folded
        ? `<button type="button" class="tap fold-line" data-action="group-fold" data-id="${esc(g.name)}"><span class="grow small muted">${summary}</span><span class="small link">Show</span></button>`
        : `${g.categories.map(c => catLine(c, s)).join('')}${f === 'all' ? `<button type="button" class="add-cat" data-action="add-cat-here" data-id="${esc(g.name)}">+ Add category</button>` : ''}`}</div></section>`;
    }).join('')}
    </div>
    ${f !== 'all' && !groups.length ? `<section class="panel empty"><h2>${f === 'over' ? 'Nothing is over' : 'Nothing needs money'}</h2><p class="muted">${f === 'over' ? 'Every category has money left.' : 'Every bill and target has what it needs this month.'}</p><button type="button" class="btn" data-action="budget-filter" data-id="all">Show all</button></section>` : ''}
    ${Object.keys(b.categories).length && f === 'all' ? '<button type="button" class="link edit-cats-link" data-action="edit-cats">Edit categories</button>' : ''}`}
    ${Object.keys(b.categories).length ? '' : '<section class="panel empty"><h2>No categories yet</h2><p class="muted">Add one from the menu behind your icon.</p></section>'}`;
}

/* ---------- One category ---------- */

export const amountBox = (id, cents, label, extra = '') => `<label class="money-in"><span class="sr">${esc(label)}</span><span aria-hidden="true">$</span><input id="${id}" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${cents ? esc(fromCents(cents)) : ''}"${extra}></label>`;

const KINDS = [['none', 'None'], ['monthly', 'Monthly'], ['yearly', 'Yearly'], ['byDate', 'By a date']];
const KIND_HELP = {
  none: 'No target. Add money whenever you have extra.',
  monthly: 'The same amount every month, like rent or groceries.',
  yearly: 'A yearly limit, like $2,000 for clothes. It asks for a share each month, and the money builds up until you spend it. Late in the year, starting in January keeps this year from asking for a lot at once.',
  byDate: 'Save up an amount by a month, like a trip. It works out how much to add each month.',
};
const futureMonths = (from, n = 48) => Array.from({ length: n }, (_, i) => addMonths(from, i));

function targetEditor(c) {
  const kind = A.sheet.targetKind ?? targetType(c.target) ?? 'none';
  const t = c.target || {};
  const rows = kind === 'none' ? '' : `<div class="form-rows">
    <div class="form-row"><span class="form-row-label">${kind === 'yearly' ? 'Per year' : kind === 'byDate' ? 'Goal' : 'Per month'}</span>${amountBox('targetAmt', t.amount || 0, 'Target amount')}</div>
    ${kind === 'monthly' ? `<label class="form-row"><span class="form-row-label">Due day</span><select id="targetDue"><option value="">No due day</option>${Array.from({ length: 28 }, (_, i) => i + 1).map(n => `<option value="${n}" ${String(t.dueDay || '') === String(n) ? 'selected' : ''}>The ${ordinal(n)}</option>`).join('')}</select></label>` : ''}
    ${kind === 'yearly' && thisMonth().slice(5) !== '01' ? `<label class="form-row"><span class="form-row-label">Starts</span><select id="targetStart"><option value="now" ${t.start && t.start > thisMonth() ? '' : 'selected'}>This month</option><option value="jan" ${t.start && t.start > thisMonth() ? 'selected' : ''}>January ${Number(thisMonth().slice(0, 4)) + 1}</option></select></label>` : ''}
    ${kind === 'byDate' ? `<label class="form-row"><span class="form-row-label">By</span><select id="targetDate">${futureMonths(thisMonth()).map(m => `<option value="${m}" ${(t.date || addMonths(thisMonth(), 6)) === m ? 'selected' : ''}>${esc(fmtMonth(m))}</option>`).join('')}</select></label>` : ''}
  </div>`;
  return `<div class="seg" role="group" aria-label="Target kind">${KINDS.map(([k, label]) => `<button type="button" data-action="target-kind" data-id="${k}" aria-pressed="${kind === k}">${label}</button>`).join('')}</div>
    <p class="small muted">${KIND_HELP[kind]}</p>${rows}
    <button type="button" class="btn" data-action="target-save">Save target</button>`;
}

export function catSheet() {
  const { budgetId, id } = A.sheet;
  const b = A.budgets[budgetId];
  const c = b?.categories[id];
  if (!c) { closeSheet(); return; }
  const s = summaryFor(b);
  const x = s.categories[id];
  const others = Object.entries(b.categories).filter(([o, oc]) => o !== id && !oc.hidden).sort(([, p], [, q]) => (p.order ?? 0) - (q.order ?? 0));
  const donors = others.filter(([o]) => s.categories[o].available > 0);
  const recent = liveTransactions(A.transactions[budgetId]).filter(t => t.categoryId === id && monthOf(t.date) === A.month).sort((p, q) => q.date.localeCompare(p.date));
  const open = A.sheet.open || {};
  openSheet(`<div class="sheet">${sheetHead(c.name, '<button type="button" class="btn small" data-action="edit-this-cat">Edit</button>')}<div class="sheet-body">
    <section class="panel pad stack">
      <div class="row between"><span class="label">${x.available < 0 ? 'Over in' : 'To spend in'} ${esc(shortMonth(A.month))}</span><span class="big-amt amt ${x.available < 0 ? 'owe' : ''}">${money(Math.abs(x.available))}</span></div>
      <p class="small">${catStatus(c, x)}</p>
      <dl class="mini-stats">
        <div><dt>Carried from last month</dt><dd class="amt ${x.carried < 0 ? 'owe' : ''}">${money(x.carried)}</dd></div>
        <div><dt>Planned this month</dt><dd class="amt">${money(x.assigned)}</dd></div>
        <div><dt>Spent this month</dt><dd class="amt ${x.activity < 0 ? 'owe' : x.activity > 0 ? 'owed' : ''}">${money(-x.activity)}</dd></div>
      </dl>
    </section>

    ${x.available < 0 ? `<section class="panel pad stack over-panel">
      <h3>Cover the ${money(-x.available)}</h3>
      <p class="small muted">Move money in from somewhere with some left.</p>
      ${donors.length || s.readyToAssign > 0 ? '<button type="button" class="btn primary" data-action="cover-auto">Cover it for me</button>' : '<p class="small">No category has money left to move. Add income, or plan less somewhere next month.</p>'}
      ${s.readyToAssign > 0 ? `<button type="button" class="btn row between" data-action="cover-from" data-id="ready"><span>From Ready to assign</span><span class="amt muted">${money(s.readyToAssign)}</span></button>` : ''}
      ${donors.slice(0, 6).map(([o, oc]) => `<button type="button" class="btn row between" data-action="cover-from" data-id="${o}"><span>From ${esc(oc.name)}</span><span class="amt muted">${money(s.categories[o].available)} to spend</span></button>`).join('')}
    </section>` : ''}

    <div class="two-btns">
      <button type="button" class="btn primary" data-action="cat-spend">Add spending</button>
      <button type="button" class="btn" data-action="cat-plan" aria-expanded="${Boolean(open.plan)}">Change plan</button>
    </div>
    ${open.plan ? `<section class="panel pad stack">
      <label class="flabel" for="assignAmt">Planned for ${esc(shortMonth(A.month))}</label>
      <div class="row gap8">${amountBox('assignAmt', x.assigned, 'Planned this month')}<button type="button" class="btn primary" data-action="assign-save">Save</button></div>
      ${x.needed > 0 ? `<button type="button" class="btn" data-action="assign-needed">Add the ${money(x.needed)} it needs</button>` : ''}
      <p class="small muted">${money(Math.max(0, s.readyToAssign))} ready to assign.</p>
    </section>` : ''}

    <div class="panel more-list">
      <button type="button" class="form-row" data-action="cat-open" data-id="target" aria-expanded="${Boolean(open.target)}"><span class="form-row-label">Target</span><span class="form-row-value">${esc(targetLabel(c))}</span></button>
      ${open.target ? `<div class="more-body stack">${targetEditor(c)}</div>` : ''}
      <button type="button" class="form-row" data-action="cat-trend" data-id="${id}"><span class="form-row-label">See trend</span><span class="form-row-value muted">Past months and biggest purchases</span></button>
      <button type="button" class="form-row" data-action="edit-this-cat"><span class="form-row-label">Edit category</span><span class="form-row-value muted">Rename, change group, hide or delete</span></button>
      <button type="button" class="form-row" data-action="cat-open" data-id="move" aria-expanded="${Boolean(open.move)}"><span class="form-row-label">Move money</span><span class="form-row-value muted">To another category</span></button>
      ${open.move ? `<div class="more-body stack">
        <div class="row gap8">${amountBox('moveAmt', 0, 'Amount to move')}</div>
        <div class="form-rows"><label class="form-row"><span class="form-row-label">To</span><select id="moveTo">${others.map(([o, oc]) => `<option value="${o}">${esc(oc.name)}</option>`).join('')}<option value="ready">Ready to assign</option></select></label></div>
        <button type="button" class="btn" data-action="move-save">Move</button>
      </div>` : ''}
    </div>

    <section class="stack tight">
      <h3 class="date-head">Spending in ${esc(shortMonth(A.month))}</h3>
      ${recent.length ? `<div class="panel tx-list">${recent.map(t => `<button type="button" class="tap tx-row" data-action="edit-tx" data-id="${t.id}"><span class="grow stack tight"><strong class="wrap-any two-lines">${esc(t.description || (t.kind === 'refund' ? 'Refund' : 'Spending'))}</strong><span class="tiny muted">${fmtDate(t.date)}</span></span><span class="amt ${t.kind === 'refund' ? 'owed' : 'owe'}">${t.kind === 'refund' ? '+' : '−'}${money(t.amount)}</span></button>`).join('')}</div>`
        : '<p class="small muted">Nothing yet this month.</p>'}
    </section>
  </div></div>`);
}

function targetLabel(c) {
  const t = c.target;
  switch (targetType(t)) {
    case 'monthly': return `${money(t.amount)} a month`;
    case 'yearly': return `${money(t.amount)} a year${t.start && t.start > thisMonth() ? `, from ${shortMonth(t.start)} ${t.start.slice(0, 4)}` : ''}`;
    case 'byDate': return `${money(t.amount)} by ${shortMonth(t.date)} ${t.date.slice(0, 4)}`;
    default: return 'None';
  }
}

/* ---------- Actions ---------- */

const current = () => A.budgets[A.route.id];
export const writeAssigned = (b, month, next, message) => {
  const before = b.assigned?.[month] || {};
  const changed = Object.fromEntries(Object.keys({ ...before, ...next }).filter(k => (before[k] || 0) !== (next[k] || 0)).map(k => [k, next[k] || 0]));
  if (!Object.keys(changed).length) return false;
  const undo = Object.fromEntries(Object.keys(changed).map(k => [k, before[k] || 0]));
  send(A.repo.setAssigned(b.id, month, changed));
  if (message) toast(message, () => send(A.repo.setAssigned(b.id, month, undo)));
  return true;
};
const refreshSheet = () => { if (A.sheet?.kind === 'cat') catSheet(); };
const toggle = key => { A.sheet.open = { ...(A.sheet.open || {}), [key]: !A.sheet.open?.[key] }; catSheet(); };

/** Every month at a glance, back to the oldest transaction: tap one to go straight there. */
function monthPicker() {
  const b = A.budgets[A.route.id], now = thisMonth();
  const counts = new Map();
  for (const t of liveTransactions(A.transactions[b?.id])) counts.set(monthOf(t.date), (counts.get(monthOf(t.date)) || 0) + 1);
  const oldest = [...counts.keys(), A.month, now].sort()[0];
  const years = [];
  for (let y = Number(now.slice(0, 4)) + (now.slice(5) === '12' ? 1 : 0); y >= Number(oldest.slice(0, 4)); y--) years.push(y);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  openSheet(`<div class="sheet">${sheetHead('Go to a month')}<div class="sheet-body">${years.map(y => `<section class="stack tight"><h3 class="date-head">${y}</h3><div class="month-grid">${MON.map((m, i) => {
    const key = `${y}-${String(i + 1).padStart(2, '0')}`, n = counts.get(key) || 0;
    if (key < oldest.slice(0, 7) || key > addMonths(now, 1)) return '<span></span>';
    return `<button type="button" class="month-cell ${key === A.month ? 'on' : ''} ${key === now ? 'now' : ''}" data-action="month-go" data-id="${key}" aria-pressed="${key === A.month}" aria-label="${esc(fmtMonth(key))}${n ? `, ${n} transactions` : ''}"><strong>${m}</strong><span class="tiny muted">${n || '–'}</span></button>`;
  }).join('')}</div></section>`).join('')}<p class="tiny muted">The number is how many transactions each month has.</p></div></div>`);
}
actions['month-pick'] = () => openChild({ kind: 'month-pick' }, monthPicker);
actions['month-go'] = el => { A.month = el.dataset.id; closeSheet(); render(); };
registerSheet('month-pick', monthPicker);

actions.month = el => {
  A.month = el.dataset.id === 'now' ? thisMonth() : addMonths(A.month, Number(el.dataset.id));
  render();
};
actions['open-cat'] = el => { A.sheet = { kind: 'cat', budgetId: A.route.id, id: el.dataset.id, open: {} }; catSheet(); };
actions['cat-spend'] = () => { const { budgetId, id } = A.sheet; openTxForm(budgetId, null, { categoryId: id }); };
registerSheet('cat', () => catSheet());
actions['cat-plan'] = () => { toggle('plan'); if (A.sheet.open.plan) document.getElementById('assignAmt')?.focus(); };
actions['cat-open'] = el => toggle(el.dataset.id);
actions['target-kind'] = el => { A.sheet.targetKind = el.dataset.id; catSheet(); };

actions['fund-targets'] = () => {
  const b = current();
  const s = summaryFor(b);
  const { assigned, funded } = fundTargets(b, s, b.assigned?.[A.month]);
  const total = Object.values(funded).reduce((a, v) => a + v, 0);
  if (!total) return toast(s.readyToAssign > 0 ? 'Bills and targets are already covered.' : 'Nothing left to assign.');
  const n = Object.keys(funded).length;
  writeAssigned(b, A.month, assigned, `Planned ${money(total)} for ${n} ${n === 1 ? 'category' : 'categories'}`);
  A.fundPreview = false;
};

actions['assign-save'] = () => {
  const b = current(), id = A.sheet.id;
  const cents = toCents(val('assignAmt'));
  writeAssigned(b, A.month, { ...(b.assigned?.[A.month] || {}), [id]: cents }, `${b.categories[id].name}: ${money(cents)} planned`);
  A.sheet.open = { ...A.sheet.open, plan: false };
  refreshSheet();
};
actions['assign-needed'] = () => {
  const b = current(), id = A.sheet.id;
  const x = summaryFor(b).categories[id];
  writeAssigned(b, A.month, moveMoney(b.assigned?.[A.month], 'ready', id, x.needed), `Added ${money(x.needed)} to ${b.categories[id].name}`);
  A.sheet.open = { ...A.sheet.open, plan: false };
  refreshSheet();
};
actions['move-save'] = () => {
  const b = current(), id = A.sheet.id;
  const cents = toCents(val('moveAmt')), to = val('moveTo');
  if (cents <= 0) return toast('Type an amount to move.');
  const name = to === 'ready' ? 'Ready to assign' : b.categories[to]?.name;
  writeAssigned(b, A.month, moveMoney(b.assigned?.[A.month], id, to, cents), `Moved ${money(cents)} to ${name}`);
  A.sheet.open = { ...A.sheet.open, move: false };
  refreshSheet();
};
actions['cover-auto'] = () => {
  const b = current(), id = A.sheet.id;
  const s = summaryFor(b);
  const donors = Object.keys(b.categories).filter(o => !b.categories[o].hidden);
  let { assigned, covered } = coverOverspending(s, b.assigned?.[A.month], id, donors);
  const short = -s.categories[id].available - covered;
  if (short > 0 && s.readyToAssign > 0) {
    const fromReady = Math.min(short, s.readyToAssign);
    assigned = moveMoney(assigned, 'ready', id, fromReady);
    covered += fromReady;
  }
  if (!covered) return toast('No money left to move.');
  writeAssigned(b, A.month, assigned, `Covered ${money(covered)} for ${b.categories[id].name}`);
  refreshSheet();
};
actions['cover-from'] = el => {
  const b = current(), id = A.sheet.id, from = el.dataset.id;
  const s = summaryFor(b);
  const short = -s.categories[id].available;
  const has = from === 'ready' ? s.readyToAssign : s.categories[from].available;
  const take = Math.min(short, Math.max(0, has));
  if (take <= 0) return;
  writeAssigned(b, A.month, moveMoney(b.assigned?.[A.month], from, id, take), `Moved ${money(take)} from ${from === 'ready' ? 'Ready to assign' : b.categories[from].name}`);
  refreshSheet();
};
actions['target-save'] = () => {
  const b = current(), id = A.sheet.id;
  const kind = A.sheet.targetKind ?? targetType(b.categories[id].target) ?? 'none';
  const before = b.categories[id].target ?? null;
  let target = null;
  if (kind !== 'none') {
    const amount = toCents(val('targetAmt'));
    if (amount <= 0) return toast('Type an amount, or pick None.');
    target = { type: kind, amount };
    if (kind === 'monthly' && Number(val('targetDue'))) target.dueDay = Number(val('targetDue'));
    if (kind === 'byDate') target.date = val('targetDate');
    if (kind === 'yearly' && val('targetStart') === 'jan') target.start = `${Number(thisMonth().slice(0, 4)) + 1}-01`;
  }
  send(A.repo.updateCategory(b.id, id, { target }));
  toast(target ? 'Target saved' : 'Target removed', () => send(A.repo.updateCategory(b.id, id, { target: before })));
  A.sheet.targetKind = undefined;
  A.sheet.open = { ...A.sheet.open, target: false };
  refreshSheet();
};
export { changes };
