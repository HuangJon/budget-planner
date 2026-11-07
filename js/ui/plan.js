/**
 * Plan money: every category with an amount box, and Ready to assign pinned at the top counting
 * down as you type. Each box saves when you leave it.
 */
import { A, inputs, changes } from './state.js';
import { esc, svg, ICON, fmtMonth } from './dom.js';
import { groupedCategories } from '../core/budget.js';
import { money, toCents, fromCents } from '../core/money.js';
import { summaryFor, catStatus, groupTab, totalNeeded, hasTargets, writeAssigned } from './budget.js';

const typedDelta = () => [...document.querySelectorAll('[data-plan]')].reduce((a, el) => a + (toCents(el.value) - Number(el.dataset.saved)), 0);

export function planScreen(b) {
  const s = summaryFor(b);
  const needed = totalNeeded(b, s);
  const month = fmtMonth(A.month).split(' ')[0];
  return `<header class="topbar">
      <a class="icon-btn" href="#b-${b.id}" aria-label="Back to the budget">${svg(ICON.back)}</a>
      <h1 class="grow">Plan ${esc(month)}</h1>
      <a class="btn small primary" href="#b-${b.id}">Done</a>
    </header>
    <section class="plan-bar" aria-live="polite">
      <div class="row between"><span class="label">Ready to assign</span><span class="amt plan-ready ${s.readyToAssign < 0 ? 'owe' : ''}" id="planReady" data-saved="${s.readyToAssign}">${money(s.readyToAssign)}</span></div>
      ${needed > 0 ? `<button type="button" class="btn" data-action="fund-targets">Fund bills and targets · ${money(needed)}</button>` : `<p class="small muted">${hasTargets(b) ? 'Bills and targets are covered. Put the rest wherever you like.' : 'Type an amount next to each category. Set targets later and this button will fill them in for you.'}</p>`}
    </section>
    ${groupedCategories(b).map(g => `<section class="group">${groupTab(g.name)}<div class="panel group-card">${g.categories.map(c => {
      const x = s.categories[c.id];
      return `<div class="plan-row">
        <div class="grow stack tight"><label class="cat-name" for="plan-${c.id}">${esc(c.name)}</label><span class="small">${catStatus(c, x)}</span><span class="tiny muted" id="left-${c.id}" data-saved="${x.available}">${x.available < 0 ? `${money(-x.available)} over` : `${money(x.available)} to spend`}</span></div>
        <label class="money-in plan-in"><span class="sr">Planned for ${esc(c.name)}</span><span aria-hidden="true">$</span><input id="plan-${c.id}" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${x.assigned ? esc(fromCents(x.assigned)) : ''}" data-plan="${c.id}" data-saved="${x.assigned}" data-input="plan" data-change="plan"></label>
      </div>`;
    }).join('')}</div></section>`).join('')}
    <a class="btn primary" href="#b-${b.id}">Done</a>`;
}

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
