/**
 * Plan money: every category with an amount box, and Ready to assign pinned at the top counting
 * down as you type. Each box saves when you leave it.
 */
import { A, actions, inputs, changes, render } from './state.js';
import { esc, svg, ICON, fmtMonth, toast } from './dom.js';
import { groupedCategories, copyLastMonth, fundTargets, addMonths, thisMonth } from '../core/budget.js';
import { money, toCents, fromCents } from '../core/money.js';
import { helpButton, describe } from './help.js';
import { summaryFor, catStatus, groupTab, totalNeeded, hasTargets, writeAssigned, isFolded } from './budget.js';

const typedDelta = () => [...document.querySelectorAll('[data-plan]')].reduce((a, el) => a + (toCents(el.value) - Number(el.dataset.saved)), 0);

const monthName = m => fmtMonth(m).split(' ')[0];
const sameMap = (x = {}, y = {}) => Object.keys({ ...x, ...y }).every(k => (x[k] || 0) === (y[k] || 0));

/** What the plan looked like when this screen opened, so every change since can be undone at once. */
function snapshot(b) {
  const key = `${b.id}|${A.month}`;
  if (A.planSnapshot?.key !== key) A.planSnapshot = { key, assigned: { ...(b.assigned?.[A.month] || {}) } };
  return A.planSnapshot.assigned;
}

function fundPreview(b, s) {
  const { funded } = fundTargets(b, s, b.assigned?.[A.month]);
  const rows = Object.entries(funded);
  if (!rows.length) return '<p class="small muted">Nothing left to assign to them.</p>';
  const total = rows.reduce((a, [, v]) => a + v, 0);
  return `<div class="fund-preview stack tight">
    <span class="small">This plans ${money(total)}:</span>
    <ul>${rows.map(([id, v]) => `<li class="row between"><span class="wrap-any">${esc(b.categories[id].name)}</span><span class="amt">${money(v)}</span></li>`).join('')}</ul>
    <div class="row gap8"><button type="button" class="btn small primary" data-action="fund-targets">Plan these</button><button type="button" class="btn small" data-action="fund-cancel">Cancel</button></div>
  </div>`;
}

export function planScreen(b) {
  const s = summaryFor(b);
  const needed = totalNeeded(b, s);
  const before = snapshot(b);
  const changed = !sameMap(before, b.assigned?.[A.month]);
  const copy = copyLastMonth(b, A.month);
  const copyTotal = Object.values(copy.copied).reduce((a, v) => a + v, 0);
  const copyCount = Object.keys(copy.copied).length;
  const past = A.month < thisMonth();
  return `<header class="topbar">
      <a class="icon-btn" href="#b-${b.id}" aria-label="Back to the budget">${svg(ICON.back)}</a>
      <h1 class="grow">Plan ${esc(monthName(A.month))}</h1>
      ${helpButton('plan')}
      <a class="btn small primary" href="#b-${b.id}">Done</a>
    </header>
    ${describe('plan')}
    ${past ? `<p class="notice">${esc(monthName(A.month))} is over. Changes here also change what carried into the months after it.</p>` : ''}
    <section class="plan-bar" aria-live="polite">
      <div class="row between"><span class="label">Ready to assign</span><span class="amt plan-ready ${s.readyToAssign < 0 ? 'owe' : ''}" id="planReady" data-saved="${s.readyToAssign}">${money(s.readyToAssign)}</span></div>
      ${copyCount ? `<button type="button" class="btn" data-action="plan-copy">Copy ${esc(monthName(addMonths(A.month, -1)))}'s plan · ${money(copyTotal)} for ${copyCount} ${copyCount === 1 ? 'category' : 'categories'}</button>` : ''}
      ${needed > 0
        ? (A.fundPreview ? fundPreview(b, s) : `<button type="button" class="btn" data-action="fund-show">Fund bills and targets · ${money(needed)}</button>`)
        : `<p class="small muted">${hasTargets(b) ? 'Bills and targets are covered. Put the rest wherever you like.' : 'Type an amount next to each category. Set targets later and the app will fill them in for you.'}</p>`}
      ${changed ? '<button type="button" class="link small" data-action="plan-undo">Undo my changes on this screen</button>' : ''}
    </section>
    ${groupedCategories(b).map(g => {
      const folded = isFolded(b.id, g.name);
      const planned = g.categories.reduce((a, c) => a + (s.categories[c.id].assigned || 0), 0);
      if (folded) return `<section class="group folded">${groupTab(g.name, `${money(planned)} planned`, { toggle: true, folded, level: 2 })}<div class="panel group-card"><button type="button" class="tap fold-line" data-action="group-fold" data-id="${esc(g.name)}"><span class="grow small muted">${g.categories.length} ${g.categories.length === 1 ? 'category' : 'categories'}</span><span class="small link">Show</span></button></div></section>`;
      return `<section class="group">${groupTab(g.name, `${money(planned)} planned`, { toggle: true, folded, level: 2 })}<div class="panel group-card">${g.categories.map(c => {
      const x = s.categories[c.id];
      return `<div class="plan-row">
        <div class="grow stack tight"><label class="cat-name" for="plan-${c.id}">${esc(c.name)}</label><span class="small">${catStatus(c, x)}</span><span class="tiny muted" id="left-${c.id}" data-saved="${x.available}">${x.available < 0 ? `${money(-x.available)} over` : `${money(x.available)} to spend`}</span></div>
        <label class="money-in plan-in"><span class="sr">Planned for ${esc(c.name)}</span><span aria-hidden="true">$</span><input id="plan-${c.id}" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${x.assigned ? esc(fromCents(x.assigned)) : ''}" data-plan="${c.id}" data-saved="${x.assigned}" data-input="plan" data-change="plan"></label>
      </div>`;
    }).join('')}<button type="button" class="add-cat" data-action="add-cat-here" data-id="${esc(g.name)}">+ Add category</button></div></section>`;
    }).join('')}
    <button type="button" class="link edit-cats-link" data-action="edit-cats">Edit categories</button>
    <a class="btn primary" href="#b-${b.id}">Done</a>`;
}

actions['plan-copy'] = () => {
  const b = A.budgets[A.route.id];
  const { assigned, copied } = copyLastMonth(b, A.month);
  const n = Object.keys(copied).length;
  if (!n) return toast('Every category already has a plan this month.');
  writeAssigned(b, A.month, assigned, `Copied ${money(Object.values(copied).reduce((a, v) => a + v, 0))} into ${n} ${n === 1 ? 'category' : 'categories'}`);
};
actions['plan-undo'] = () => {
  const b = A.budgets[A.route.id];
  writeAssigned(b, A.month, A.planSnapshot.assigned, 'Back to how the plan was when you opened it');
};
actions['fund-show'] = () => { A.fundPreview = true; render(); };
actions['fund-cancel'] = () => { A.fundPreview = false; render(); };

/** As you type, Ready to assign and the category's "left" update before anything is saved. */
inputs.plan = el => {
  const ready = document.getElementById('planReady');
  const r = Number(ready.dataset.saved) - typedDelta();
  ready.textContent = money(r);
  ready.classList.toggle('owe', r < 0);
  const left = document.getElementById(`left-${el.dataset.plan}`);
  const l = Number(left.dataset.saved) + toCents(el.value) - Number(el.dataset.saved);
  left.textContent = l < 0 ? `${money(-l)} over` : `${money(l)} to spend`;
  left.classList.toggle('owe', l < 0);
  left.classList.toggle('muted', l >= 0);
};
changes.plan = el => {
  const b = A.budgets[A.route.id], id = el.dataset.plan;
  const cents = toCents(el.value);
  if (cents === Number(el.dataset.saved)) return;
  // Save after focus has moved to the next box, so redrawing keeps the person in that box.
  setTimeout(() => writeAssigned(b, A.month, { ...(b.assigned?.[A.month] || {}), [id]: cents }));
};
