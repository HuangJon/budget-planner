/**
 * Close out a month: one checklist for the start of each month. Statements in, accounts match,
 * nothing overspent, repeats looked at, every dollar assigned. Each line says what's left and
 * goes straight to where to fix it.
 */
import { A, actions, render } from './state.js';
import { esc, openSheet, closeSheet, sheetHead, openChild, registerSheet, today, fmtMonth, svg, ICON } from './dom.js';
import { closeOut } from '../core/closeout.js';
import { importGrid } from '../core/imports.js';
import { accountCheck } from '../core/accounts.js';
import { suggestRepeats } from '../core/recurring.js';
import { thisMonth, addMonths } from '../core/budget.js';
import { money } from '../core/money.js';
import { importsOf } from './imports.js';
import { summaryFor } from './budget.js';

function dismissedRepeats(id) { try { return JSON.parse(localStorage.getItem(`wmm:noRepeat:${id}`) || '[]'); } catch { return A.noRepeat?.[id] || []; } }

/** The checklist for a month, worked out from what's in the budget now. */
export function checklist(b, month) {
  const txs = A.transactions[b.id] || [];
  const recs = importsOf(b.id) || [];
  return closeOut({
    budget: b, txs, month,
    summary: summaryFor(b, month),
    check: accountCheck(b, txs, today()),
    grid: importGrid(recs, txs, b.accounts, month > thisMonth() ? month : thisMonth()),
    suggested: suggestRepeats(txs, b.recurring, today(), dismissedRepeats(b.id)).length,
  });
}

export function openCloseOut(budgetId, month = addMonths(thisMonth(), -1)) {
  openChild({ kind: 'closeout', budgetId, month }, drawCloseOut);
}

function drawCloseOut() {
  const S = A.sheet, b = A.budgets[S.budgetId];
  if (!b) { closeSheet(); return; }
  const { items, left } = checklist(b, S.month);
  openSheet(`<div class="sheet">${sheetHead(`Close out ${fmtMonth(S.month)}`)}<div class="sheet-body">
    <p class="${left ? 'small muted' : 'notice ok-note'}">${left ? `${left} ${left === 1 ? 'thing' : 'things'} to look at. Each one takes you where to sort it out.` : `<strong>All done.</strong> ${esc(fmtMonth(S.month))} is closed out.`}</p>
    <ol class="panel co-list">${items.map(i => `<li class="co-item ${i.done ? 'done' : ''}">
      <span class="tick" aria-hidden="true">${i.done ? svg(ICON.check) : ''}</span>
      <span class="grow stack tight"><strong>${esc(i.title)}${i.amount ? ` · ${money(Math.abs(i.amount))}` : ''}</strong><span class="tiny muted">${esc(i.detail)}</span></span>
      ${i.done ? '<span class="sr">Done</span>' : `<button type="button" class="btn small" data-action="${i.action}" data-month="${S.month}">${i.key === 'statements' ? 'Import' : 'Go'}</button>`}
    </li>`).join('')}</ol>
    <div class="row between"><button type="button" class="link small" data-action="closeout-month" data-id="${addMonths(S.month, -1)}">‹ ${esc(fmtMonth(addMonths(S.month, -1)))}</button>${S.month < thisMonth() ? `<button type="button" class="link small" data-action="closeout-month" data-id="${addMonths(S.month, 1)}">${esc(fmtMonth(addMonths(S.month, 1)))} ›</button>` : ''}</div>
  </div></div>`);
}

actions['open-closeout'] = el => openCloseOut(A.route.id, el.dataset.month || addMonths(thisMonth(), -1));
actions['closeout-month'] = el => { A.sheet.month = el.dataset.id; drawCloseOut(); };
/** Leaves the checklist for a screen of that month. */
const goTo = (el, tab) => {
  const b = A.sheet?.budgetId || A.route.id;
  A.month = el.dataset.month || A.month;
  closeSheet();
  location.hash = `#b-${b}${tab}`;
  render();
};
actions['closeout-budget'] = el => { try { localStorage.setItem('wmm:budgetFilter', 'over'); } catch { /* fine */ } goTo(el, ''); };
actions['closeout-plan'] = el => goTo(el, '-plan');
actions['closeout-repeats'] = el => { try { localStorage.setItem('wmm:repeatsOpen', '1'); } catch { A.repeatsOpen = true; } goTo(el, '-activity'); };
actions['closeout-search'] = el => goTo(el, '-activity');

registerSheet('closeout', drawCloseOut);
