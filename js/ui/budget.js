/** The budget screen: Ready to assign, anything overspent, and every category with what's left. */
import { A, actions, render } from './state.js';
import { esc, svg, ICON, fmtMonth, ordinal, openSheet, closeSheet, sheetHead, toast, send, val, fmtDate } from './dom.js';
import { monthSummary, groupedCategories, fundTargets, coverOverspending, moveMoney, addMonths, thisMonth, monthOf, liveTransactions } from '../core/budget.js';
import { money, toCents, fromCents } from '../core/money.js';

export const summaryFor = (b, month = A.month) => monthSummary(b, A.transactions[b.id] || [], month);

export function monthBar() {
  const now = thisMonth();
  return `<div class="monthbar">
    <button type="button" class="icon-btn" data-action="month" data-id="-1" aria-label="Previous month">${svg(ICON.back)}</button>
    <div class="monthbar-mid"><h2>${esc(fmtMonth(A.month))}</h2>${A.month !== now ? '<button type="button" class="link small" data-action="month" data-id="now">Back to this month</button>' : ''}</div>
    <button type="button" class="icon-btn" data-action="month" data-id="1" aria-label="Next month">${svg(ICON.next)}</button>
  </div>`;
}

function hero(b, s) {
  const needed = Object.entries(s.categories).filter(([id]) => !b.categories[id]?.hidden).reduce((a, [, c]) => a + c.needed, 0);
  const negative = s.readyToAssign < 0;
  const say = negative
    ? `You've assigned ${money(-s.readyToAssign)} more than you have. Take some back from a category.`
    : s.readyToAssign === 0 ? 'Every dollar has a job.' : 'Give these dollars a job.';
  return `<section class="hero ${negative ? 'is-owing' : ''}" aria-label="Ready to assign">
    <span class="label">Ready to assign</span>
    <span class="big ${negative ? 'down' : ''}" data-testid="ready">${money(s.readyToAssign)}</span>
    <p>${esc(say)}</p>
    ${needed > 0 ? `<div class="hero-line"><span>Bills and targets still need <strong class="amt">${money(needed)}</strong></span><button type="button" class="hero-btn" data-action="fund-targets"${s.readyToAssign <= 0 ? ' disabled' : ''}>Fund them</button></div>` : ''}
  </section>`;
}

function overspentNotice(b, s) {
  const over = s.overspent.filter(id => !b.categories[id]?.hidden);
  if (!over.length) return '';
  return `<section class="panel over" aria-label="Overspent">
    <div class="over-head"><span class="owe-dot" aria-hidden="true"></span><h3>${over.length === 1 ? 'One category is' : `${over.length} categories are`} overspent</h3></div>
    ${over.map(id => `<div class="over-row"><span class="grow wrap-any">${esc(b.categories[id].name)} is <strong class="owe amt">${money(-s.categories[id].available)}</strong> over</span><button type="button" class="btn small" data-action="cover" data-id="${id}">Cover it</button></div>`).join('')}
  </section>`;
}

function catLine(c, s) {
  const x = s.categories[c.id];
  const funds = Math.max(0, x.carried + x.assigned);
  const spent = Math.max(0, -x.activity);
  const pct = x.available < 0 ? 100 : funds ? Math.min(100, Math.round((spent / funds) * 100)) : 0;
  let sub;
  if (x.available < 0) sub = '<span class="owe">Overspent</span>';
  else if (x.needed > 0) sub = `<span class="nudge">Needs ${money(x.needed)} more${c.target?.dueDay ? ` by the ${ordinal(c.target.dueDay)}` : ''}</span>`;
  else if (c.target?.amount) sub = `<span class="muted">${spent ? `${money(spent)} spent · ` : ''}Target met</span>`;
  else sub = `<span class="muted">${spent ? `${money(spent)} spent` : funds ? 'Nothing spent yet' : 'Nothing assigned'}</span>`;
  return `<button type="button" class="tap cat-row" data-action="open-cat" data-id="${c.id}">
    <span class="grow stack tight">
      <strong class="cat-name">${esc(c.name)}</strong>
      <span class="small">${sub}</span>
      ${funds || spent ? `<span class="bar ${x.available < 0 ? 'is-over' : ''}" aria-hidden="true"><i style="width:${pct}%"></i></span>` : ''}
    </span>
    <span class="cat-avail"><span class="amt ${x.available < 0 ? 'owe' : ''}">${money(x.available)}</span><span class="tiny muted">left</span></span>
  </button>`;
}

export function budgetScreen(b) {
  const s = summaryFor(b);
  const groups = groupedCategories(b);
  return `${monthBar()}
    ${hero(b, s)}
    ${overspentNotice(b, s)}
    ${s.unknownActivity ? `<p class="notice">${money(-s.unknownActivity)} was spent in a category that has since been removed.</p>` : ''}
    ${groups.map(g => {
      const left = g.categories.reduce((a, c) => a + s.categories[c.id].available, 0);
      return `<section class="panel group" aria-label="${esc(g.name)}">
        <div class="group-head"><h3>${esc(g.name)}</h3><span class="small muted">${money(left)} left</span></div>
        ${g.categories.map(c => catLine(c, s)).join('')}
      </section>`;
    }).join('')}
    ${groups.length ? '' : '<section class="panel empty"><h2>No categories yet</h2><p class="muted">Add one to start giving your money jobs.</p></section>'}`;
}

/* ---------- One category ---------- */

const amountBox = (id, cents, label) => `<label class="money-in"><span class="sr">${esc(label)}</span><span aria-hidden="true">$</span><input id="${id}" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${cents ? esc(fromCents(cents)) : ''}"></label>`;

export function catSheet() {
  const { budgetId, id } = A.sheet;
  const b = A.budgets[budgetId];
  const c = b?.categories[id];
  if (!c) { closeSheet(); return; }
  const s = summaryFor(b);
  const x = s.categories[id];
  const others = Object.entries(b.categories).filter(([o, oc]) => o !== id && !oc.hidden).sort(([, p], [, q]) => (p.order ?? 0) - (q.order ?? 0));
  const donors = others.filter(([o]) => s.categories[o].available > 0);
  const recent = liveTransactions(A.transactions[budgetId]).filter(t => t.categoryId === id && monthOf(t.date) === A.month).sort((p, q) => q.date.localeCompare(p.date)).slice(0, 6);
  const due = c.target?.dueDay || '';
  openSheet(`<div class="sheet">${sheetHead(c.name, '', 'Done')}<div class="sheet-body">
    <section class="panel pad stack">
      <div class="row between"><span class="label">Left in ${esc(fmtMonth(A.month).split(' ')[0])}</span><span class="big-amt amt ${x.available < 0 ? 'owe' : ''}">${money(x.available)}</span></div>
      <dl class="mini-stats">
        <div><dt>Carried from last month</dt><dd class="amt ${x.carried < 0 ? 'owe' : ''}">${money(x.carried)}</dd></div>
        <div><dt>Assigned this month</dt><dd class="amt">${money(x.assigned)}</dd></div>
        <div><dt>Spent this month</dt><dd class="amt ${x.activity < 0 ? 'owe' : x.activity > 0 ? 'owed' : ''}">${money(x.activity)}</dd></div>
      </dl>
    </section>

    ${x.available < 0 ? `<section class="panel pad stack over-panel">
      <h3>Cover the ${money(-x.available)}</h3>
      <p class="small muted">Take it from a category with money left. Ready to assign has ${money(Math.max(0, s.readyToAssign))}.</p>
      ${donors.length || s.readyToAssign > 0 ? `<button type="button" class="btn primary" data-action="cover-auto">Cover it for me</button>` : '<p class="small">No category has money left to move.</p>'}
      ${s.readyToAssign > 0 ? `<button type="button" class="btn" data-action="cover-from" data-id="ready">From Ready to assign</button>` : ''}
      ${donors.slice(0, 6).map(([o, oc]) => `<button type="button" class="btn row between" data-action="cover-from" data-id="${o}"><span>From ${esc(oc.name)}</span><span class="amt muted">${money(s.categories[o].available)} left</span></button>`).join('')}
    </section>` : ''}

    <section class="panel pad stack">
      <h3>Assign</h3>
      <div class="row gap8">${amountBox('assignAmt', x.assigned, 'Assigned this month')}<button type="button" class="btn primary" data-action="assign-save">Save</button></div>
      ${x.needed > 0 ? `<button type="button" class="btn" data-action="assign-needed">Add the ${money(x.needed)} it needs</button>` : ''}
      <p class="small muted">${money(Math.max(0, s.readyToAssign))} ready to assign.</p>
    </section>

    <section class="panel pad stack">
      <h3>Move money</h3>
      <div class="row gap8">${amountBox('moveAmt', 0, 'Amount to move')}</div>
      <div class="form-rows">
        <label class="form-row"><span class="form-row-label">To</span><select id="moveTo">${others.map(([o, oc]) => `<option value="${o}">${esc(oc.name)}</option>`).join('')}<option value="ready">Ready to assign</option></select></label>
      </div>
      <button type="button" class="btn" data-action="move-save">Move</button>
    </section>

    <section class="panel pad stack">
      <h3>Monthly target</h3>
      <p class="small muted">How much this needs each month. Bills with a due day get funded first.</p>
      <div class="form-rows">
        <div class="form-row"><span class="form-row-label">Amount</span>${amountBox('targetAmt', c.target?.amount || 0, 'Monthly target')}</div>
        <label class="form-row"><span class="form-row-label">Due day</span><select id="targetDue"><option value="">No due day</option>${Array.from({ length: 28 }, (_, i) => i + 1).map(n => `<option value="${n}" ${String(due) === String(n) ? 'selected' : ''}>The ${ordinal(n)}</option>`).join('')}</select></label>
      </div>
      <div class="row gap8"><button type="button" class="btn" data-action="target-save">Save target</button>${c.target ? '<button type="button" class="link small" data-action="target-clear">Remove target</button>' : ''}</div>
    </section>

    ${recent.length ? `<section class="panel"><div class="group-head pad-x"><h3>Spending this month</h3></div>${recent.map(t => `<button type="button" class="tap tx-row" data-action="edit-tx" data-id="${t.id}"><span class="grow stack tight"><strong class="wrap-any">${esc(t.description || (t.kind === 'refund' ? 'Refund' : 'Spending'))}</strong><span class="tiny muted">${fmtDate(t.date)}</span></span><span class="amt ${t.kind === 'refund' ? 'owed' : 'owe'}">${t.kind === 'refund' ? '+' : '−'}${money(t.amount)}</span></button>`).join('')}</section>` : ''}
  </div></div>`);
}

/* ---------- Actions ---------- */

const current = () => A.budgets[A.route.id];
const writeAssigned = (b, month, next, message) => {
  const before = b.assigned?.[month] || {};
  const changed = Object.fromEntries(Object.keys({ ...before, ...next }).filter(k => (before[k] || 0) !== (next[k] || 0)).map(k => [k, next[k] || 0]));
  if (!Object.keys(changed).length) return;
  const undo = Object.fromEntries(Object.keys(changed).map(k => [k, before[k] || 0]));
  send(A.repo.setAssigned(b.id, month, changed));
  toast(message, () => send(A.repo.setAssigned(b.id, month, undo)));
};
const refreshSheet = () => { if (A.sheet?.kind === 'cat') catSheet(); };

actions.month = el => {
  A.month = el.dataset.id === 'now' ? thisMonth() : addMonths(A.month, Number(el.dataset.id));
  render();
};
actions['open-cat'] = el => { A.sheet = { kind: 'cat', budgetId: A.route.id, id: el.dataset.id }; catSheet(); };
actions.cover = el => { A.sheet = { kind: 'cat', budgetId: A.route.id, id: el.dataset.id }; catSheet(); };

actions['fund-targets'] = () => {
  const b = current();
  const s = summaryFor(b);
  const { assigned, funded } = fundTargets(b, s, b.assigned?.[A.month]);
  const total = Object.values(funded).reduce((a, v) => a + v, 0);
  if (!total) return toast('Nothing left to assign.');
  writeAssigned(b, A.month, assigned, `Assigned ${money(total)} to ${Object.keys(funded).length} ${Object.keys(funded).length === 1 ? 'category' : 'categories'}`);
};

actions['assign-save'] = () => {
  const b = current(), id = A.sheet.id;
  const cents = toCents(val('assignAmt'));
  writeAssigned(b, A.month, { ...(b.assigned?.[A.month] || {}), [id]: cents }, `${b.categories[id].name}: ${money(cents)} assigned`);
  refreshSheet();
};
actions['assign-needed'] = () => {
  const b = current(), id = A.sheet.id;
  const x = summaryFor(b).categories[id];
  writeAssigned(b, A.month, moveMoney(b.assigned?.[A.month], 'ready', id, x.needed), `Added ${money(x.needed)} to ${b.categories[id].name}`);
  refreshSheet();
};
actions['move-save'] = () => {
  const b = current(), id = A.sheet.id;
  const cents = toCents(val('moveAmt')), to = val('moveTo');
  if (cents <= 0) return toast('Type an amount to move.');
  const name = to === 'ready' ? 'Ready to assign' : b.categories[to]?.name;
  writeAssigned(b, A.month, moveMoney(b.assigned?.[A.month], id, to, cents), `Moved ${money(cents)} to ${name}`);
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
  const amount = toCents(val('targetAmt'));
  const dueDay = Number(val('targetDue')) || null;
  if (amount <= 0) return toast('Type a monthly amount, or remove the target.');
  const before = b.categories[id].target ?? null;
  send(A.repo.updateCategory(b.id, id, { target: { amount, ...(dueDay ? { dueDay } : {}) } }));
  toast('Target saved', () => send(A.repo.updateCategory(b.id, id, { target: before })));
  refreshSheet();
};
actions['target-clear'] = () => {
  const b = current(), id = A.sheet.id;
  const before = b.categories[id].target ?? null;
  send(A.repo.updateCategory(b.id, id, { target: null }));
  toast('Target removed', () => send(A.repo.updateCategory(b.id, id, { target: before })));
  refreshSheet();
};
