/** The budget screen: Ready to assign, anything overspent, and every category with what's left. */
import { A, actions, changes, render } from './state.js';
import { esc, svg, ICON, fmtMonth, ordinal, openSheet, closeSheet, sheetHead, toast, send, val, fmtDate } from './dom.js';
import { monthSummary, groupedCategories, fundTargets, coverOverspending, moveMoney, addMonths, thisMonth, monthOf, liveTransactions, targetType } from '../core/budget.js';
import { money, toCents, fromCents } from '../core/money.js';
import { openTxForm } from './tx-form.js';

export const summaryFor = (b, month = A.month) => monthSummary(b, A.transactions[b.id] || [], month);
const shortMonth = m => fmtMonth(m).split(' ')[0];

export function monthBar() {
  const now = thisMonth();
  return `<div class="monthbar">
    <button type="button" class="icon-btn" data-action="month" data-id="-1" aria-label="Previous month">${svg(ICON.back)}</button>
    <div class="monthbar-mid"><h2>${esc(fmtMonth(A.month))}</h2>${A.month !== now ? '<button type="button" class="link small" data-action="month" data-id="now">Back to this month</button>' : ''}</div>
    <button type="button" class="icon-btn" data-action="month" data-id="1" aria-label="Next month">${svg(ICON.next)}</button>
  </div>`;
}

export const hasTargets = b => Object.values(b.categories || {}).some(c => !c.hidden && targetType(c.target));
export const totalNeeded = (b, s) => Object.entries(s.categories).filter(([id]) => !b.categories[id]?.hidden).reduce((a, [, c]) => a + c.needed, 0);

function hero(b, s) {
  const needed = totalNeeded(b, s);
  const negative = s.readyToAssign < 0;
  const say = negative
    ? `You've assigned ${money(-s.readyToAssign)} more than you have. Take some back from a category.`
    : s.readyToAssign === 0 ? 'Every dollar has a job.' : 'Give these dollars a job.';
  return `<section class="hero ${negative ? 'is-owing' : ''}" aria-label="Ready to assign">
    <span class="label">Ready to assign</span>
    <span class="big ${negative ? 'down' : ''}" data-testid="ready">${money(s.readyToAssign)}</span>
    <p>${esc(say)}</p>
    <div class="hero-line"><span>${needed > 0 ? `Bills and targets need <strong class="amt">${money(needed)}</strong>` : hasTargets(b) ? 'Bills and targets are covered' : 'Decide where it all goes'}</span></div>
    <div class="hero-actions"><button type="button" class="hero-btn ghost" data-action="add-income">Add income</button><a class="hero-btn" href="#b-${b.id}-plan">Plan money</a></div>
  </section>`;
}

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
    <span class="cat-avail"><span class="amt ${x.available < 0 ? 'owe' : ''}">${money(x.available)}</span><span class="tiny muted">left</span></span>
  </button>`;
}

/** A group's name on a tab above its card, so groups are easy to tell apart. */
export const groupTab = (name, right = '') => `<div class="group-tab"><h3>${esc(name)}</h3>${right ? `<span class="small">${right}</span>` : ''}</div>`;

export function budgetScreen(b) {
  const s = summaryFor(b);
  const groups = groupedCategories(b);
  return `${monthBar()}
    ${hero(b, s)}
    ${overspentNotice(b, s)}
    ${s.unknownActivity ? `<p class="notice">${money(-s.unknownActivity)} was spent in a category that has since been removed.</p>` : ''}
    ${groups.map(g => {
      const left = g.categories.reduce((a, c) => a + s.categories[c.id].available, 0);
      return `<section class="group" aria-label="${esc(g.name)}">${groupTab(g.name, `${money(left)} left`)}<div class="panel group-card">${g.categories.map(c => catLine(c, s)).join('')}</div></section>`;
    }).join('')}
    ${groups.length ? '' : '<section class="panel empty"><h2>No categories yet</h2><p class="muted">Add one from the menu behind your icon.</p></section>'}`;
}

/* ---------- One category ---------- */

export const amountBox = (id, cents, label, extra = '') => `<label class="money-in"><span class="sr">${esc(label)}</span><span aria-hidden="true">$</span><input id="${id}" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${cents ? esc(fromCents(cents)) : ''}"${extra}></label>`;

const KINDS = [['none', 'None'], ['monthly', 'Monthly'], ['yearly', 'Yearly'], ['byDate', 'By a date']];
const KIND_HELP = {
  none: 'No target. Add money whenever you have extra.',
  monthly: 'The same amount every month, like rent or groceries.',
  yearly: 'A yearly limit, like $2,000 for clothes. It asks for a share each month, and the money builds up until you spend it.',
  byDate: 'Save up an amount by a month, like a trip. It works out how much to add each month.',
};
const futureMonths = (from, n = 48) => Array.from({ length: n }, (_, i) => addMonths(from, i));

function targetEditor(c) {
  const kind = A.sheet.targetKind ?? targetType(c.target) ?? 'none';
  const t = c.target || {};
  const rows = kind === 'none' ? '' : `<div class="form-rows">
    <div class="form-row"><span class="form-row-label">${kind === 'yearly' ? 'Per year' : kind === 'byDate' ? 'Goal' : 'Per month'}</span>${amountBox('targetAmt', t.amount || 0, 'Target amount')}</div>
    ${kind === 'monthly' ? `<label class="form-row"><span class="form-row-label">Due day</span><select id="targetDue"><option value="">No due day</option>${Array.from({ length: 28 }, (_, i) => i + 1).map(n => `<option value="${n}" ${String(t.dueDay || '') === String(n) ? 'selected' : ''}>The ${ordinal(n)}</option>`).join('')}</select></label>` : ''}
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
  openSheet(`<div class="sheet">${sheetHead(c.name, '', 'Done')}<div class="sheet-body">
    <section class="panel pad stack">
      <div class="row between"><span class="label">Left in ${esc(shortMonth(A.month))}</span><span class="big-amt amt ${x.available < 0 ? 'owe' : ''}">${money(x.available)}</span></div>
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
      ${donors.slice(0, 6).map(([o, oc]) => `<button type="button" class="btn row between" data-action="cover-from" data-id="${o}"><span>From ${esc(oc.name)}</span><span class="amt muted">${money(s.categories[o].available)} left</span></button>`).join('')}
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
    case 'yearly': return `${money(t.amount)} a year`;
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

actions.month = el => {
  A.month = el.dataset.id === 'now' ? thisMonth() : addMonths(A.month, Number(el.dataset.id));
  render();
};
actions['open-cat'] = el => { A.sheet = { kind: 'cat', budgetId: A.route.id, id: el.dataset.id, open: {} }; catSheet(); };
actions['cat-spend'] = () => { const { budgetId, id } = A.sheet; openTxForm(budgetId, null, { categoryId: id }); };
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
  }
  send(A.repo.updateCategory(b.id, id, { target }));
  toast(target ? 'Target saved' : 'Target removed', () => send(A.repo.updateCategory(b.id, id, { target: before })));
  A.sheet.targetKind = undefined;
  A.sheet.open = { ...A.sheet.open, target: false };
  refreshSheet();
};
export { changes };
