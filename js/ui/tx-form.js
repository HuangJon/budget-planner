/**
 * Adding or editing a transaction. Amount and description first, then matching rows
 * (category, date), with a note behind one link and one save button pinned at the bottom.
 */
import { A, actions, inputs, changes } from './state.js';
import { esc, openSheet, closeSheet, sheetHead, toast, send, today, fmtDate } from './dom.js';
import { groupedCategories, isValidTransaction } from '../core/budget.js';
import { suggestCategory } from '../core/categorize.js';
import { toCents, fromCents, money } from '../core/money.js';
import { LIMITS } from '../config/app.js';

const KINDS = [['spend', 'Spending'], ['income', 'Income'], ['refund', 'Refund']];

export function openTxForm(budgetId, editing = null) {
  A.form = editing
    ? { budgetId, editing, kind: editing.kind, amount: fromCents(editing.amount), description: editing.description || '', categoryId: editing.categoryId || '', date: editing.date, note: editing.note || '', showNote: Boolean(editing.note), touchedCat: true }
    : { budgetId, editing: null, kind: 'spend', amount: '', description: '', categoryId: '', date: today(), note: '', showNote: false, touchedCat: false };
  drawForm();
  if (!editing) setTimeout(() => document.getElementById('fAmount')?.focus(), 50);
}

const catOptions = (b, selected) => `<option value="" ${selected ? '' : 'selected'} disabled>Pick one</option>${groupedCategories(b).map(g => `<optgroup label="${esc(g.name)}">${g.categories.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}${selected && b.categories[selected]?.hidden ? `<option value="${selected}" selected>${esc(b.categories[selected].name)} (hidden)</option>` : ''}`;

function drawForm() {
  const F = A.form, b = A.budgets[F.budgetId];
  const income = F.kind === 'income';
  openSheet(`<form class="sheet tx-form" id="txForm" novalidate>${sheetHead(F.editing ? 'Edit' : 'Add')}
    <div class="sheet-body">
      <div class="seg" role="group" aria-label="Kind">${KINDS.map(([k, label]) => `<button type="button" data-action="tx-kind" data-id="${k}" aria-pressed="${F.kind === k}">${label}</button>`).join('')}</div>
      <label class="money-in big"><span class="sr">Amount</span><span aria-hidden="true">$</span><input id="fAmount" class="amount-input" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(F.amount)}" data-input="tx-amount"></label>
      <label class="f"><span class="sr">Description</span><input id="fDesc" maxlength="${LIMITS.description}" autocomplete="off" placeholder="${income ? 'Paycheck, gift, side job…' : F.kind === 'refund' ? 'What was returned?' : 'What was it for?'}" value="${esc(F.description)}" data-input="tx-desc"></label>
      <div class="form-rows">
        ${income
          ? '<div class="form-row"><span class="form-row-label">Goes to</span><span class="form-row-value">Ready to assign</span></div>'
          : `<label class="form-row"><span class="form-row-label">Category <span class="tiny muted" id="catHint">${F.suggested ? 'Suggested' : ''}</span></span><select id="fCat" data-change="tx-cat">${catOptions(b, F.categoryId)}</select></label>`}
        <label class="form-row form-row-date"><span class="form-row-label">Date</span><span class="form-row-value" id="fDateShown">${esc(fmtDate(F.date))}</span><input id="fDate" type="date" required value="${esc(F.date)}" data-change="tx-date"></label>
      </div>
      ${F.showNote
        ? `<label class="f"><span>Note</span><textarea id="fNote" maxlength="${LIMITS.note}" data-input="tx-note">${esc(F.note)}</textarea></label>`
        : '<button type="button" class="link" data-action="tx-note">Add a note</button>'}
      ${F.editing ? '<button type="button" class="btn danger" data-action="tx-delete">Delete</button>' : ''}
    </div>
    <div class="sheet-foot"><button type="submit" class="btn primary" data-action="tx-save">${F.editing ? 'Save changes' : 'Save'}</button></div>
  </form>`);
}

inputs['tx-amount'] = el => { A.form.amount = el.value; };
inputs['tx-note'] = el => { A.form.note = el.value; };
inputs['tx-desc'] = el => {
  const F = A.form;
  F.description = el.value;
  if (F.touchedCat || F.kind === 'income') return;
  const b = A.budgets[F.budgetId];
  const pick = suggestCategory(el.value, b.categories, A.transactions[F.budgetId]);
  const sel = document.getElementById('fCat'), hint = document.getElementById('catHint');
  if (pick) { F.categoryId = pick; F.suggested = true; if (sel) sel.value = pick; if (hint) hint.textContent = 'Suggested'; }
  else if (F.suggested) { F.categoryId = ''; F.suggested = false; if (sel) sel.value = ''; if (hint) hint.textContent = ''; }
};
changes['tx-cat'] = el => {
  A.form.categoryId = el.value; A.form.touchedCat = true; A.form.suggested = false;
  const hint = document.getElementById('catHint'); if (hint) hint.textContent = '';
};
changes['tx-date'] = el => {
  A.form.date = el.value || today();
  const shown = document.getElementById('fDateShown'); if (shown) shown.textContent = fmtDate(A.form.date);
};
actions['tx-kind'] = el => { A.form.kind = el.dataset.id; drawForm(); };
actions['tx-note'] = () => { A.form.showNote = true; drawForm(); document.getElementById('fNote')?.focus(); };

actions['tx-save'] = () => {
  const F = A.form;
  const amount = toCents(F.amount);
  if (amount <= 0) { toast('Type an amount.'); document.getElementById('fAmount')?.focus(); return; }
  if (F.kind !== 'income' && !F.categoryId) { toast('Pick a category.'); document.getElementById('fCat')?.focus(); return; }
  const fields = {
    kind: F.kind, amount, date: F.date, description: F.description.trim(), note: F.note.trim(),
    categoryId: F.kind === 'income' ? null : F.categoryId,
  };
  if (!isValidTransaction({ id: 'check', ...fields, categoryId: fields.categoryId ?? undefined })) { toast('Something is missing. Check the amount and date.'); return; }
  const budgetId = F.budgetId;
  if (F.editing) {
    const before = F.editing;
    send(A.repo.updateTransaction(budgetId, before, fields));
    closeSheet();
    const { id, budgetId: _b, createdBy, createdAt, updatedAt, updatedBy, ...old } = before;
    toast('Saved', () => send(A.repo.updateTransaction(budgetId, { ...before, ...fields }, { note: '', ...old, categoryId: old.categoryId ?? null })));
  } else {
    const { transaction, written } = A.repo.addTransaction(budgetId, fields);
    send(written);
    closeSheet();
    toast(`${F.kind === 'income' ? 'Added' : 'Saved'} ${money(amount)}`, () => send(A.repo.deleteTransaction(budgetId, transaction.id)));
  }
};
actions['tx-delete'] = () => {
  const F = A.form, budgetId = F.budgetId, id = F.editing.id;
  send(A.repo.deleteTransaction(budgetId, id));
  closeSheet();
  toast('Deleted', () => send(A.repo.restoreTransaction(budgetId, id)));
};
actions['add-tx'] = () => openTxForm(A.route.id);
actions['edit-tx'] = el => {
  const t = (A.transactions[A.route.id] || []).find(x => x.id === el.dataset.id);
  if (t) openTxForm(A.route.id, t);
};
