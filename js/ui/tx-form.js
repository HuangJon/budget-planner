/**
 * Adding or editing spending or income. Amount and description first, then matching rows
 * (category, date, repeat), a note behind one link, and one save button pinned at the bottom.
 * Spending offers your frequent ones as one-tap buttons; income offers your recent paychecks.
 */
import { A, actions, inputs, changes } from './state.js';
import { esc, openSheet, closeSheet, sheetHead, toast, send, today, fmtDate, ordinal, openChild, finishSheet, registerSheet } from './dom.js';
import { groupedCategories, isValidTransaction, liveTransactions, defaultDateFor } from '../core/budget.js';
import { suggestCategory } from '../core/categorize.js';
import { recurringId, DAY_MAX, EVERY, howOften } from '../core/recurring.js';
import { toCents, fromCents, money } from '../core/money.js';
import { LIMITS } from '../config/app.js';

/** Today, or the same day in the month being looked at, so a purchase lands where you're looking. */
export const defaultDate = (viewing = A.month) => defaultDateFor(today(), viewing);

export function openTxForm(budgetId, editing = null, preset = {}) {
  A.form = editing
    ? { budgetId, editing, kind: editing.kind, amount: fromCents(editing.amount), description: editing.description || '', categoryId: editing.categoryId || '', date: editing.date, note: editing.note || '', showNote: Boolean(editing.note), touchedCat: true, repeat: false, every: 'month' }
    : { budgetId, editing: null, kind: preset.kind || 'spend', amount: '', description: '', categoryId: preset.categoryId || '', date: defaultDate(), note: '', showNote: false, touchedCat: Boolean(preset.categoryId), repeat: false, every: 'month' };
  openChild({ kind: 'tx' }, drawForm);
  if (!editing) document.getElementById('fAmount')?.focus();
}

export const catOptions = (b, selected) => `<option value="" ${selected ? '' : 'selected'} disabled>Pick one</option>${groupedCategories(b).map(g => `<optgroup label="${esc(g.name)}">${g.categories.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}${selected && b.categories[selected]?.hidden ? `<option value="${selected}" selected>${esc(b.categories[selected].name)} (hidden)</option>` : ''}`;

/** Your most used description and category pairs from the last 90 days, most frequent first. */
export function frequentSpending(b, list, limit = 6) {
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const seen = new Map();
  for (const t of liveTransactions(list)) {
    if (t.kind !== 'spend' || !t.description || t.date < since || !b.categories[t.categoryId] || b.categories[t.categoryId].hidden) continue;
    const key = `${t.description.trim().toLowerCase()}|${t.categoryId}`;
    const row = seen.get(key) || { description: t.description.trim(), categoryId: t.categoryId, count: 0, last: '' };
    row.count += 1;
    if (t.date > row.last) row.last = t.date;
    seen.set(key, row);
  }
  return [...seen.values()].sort((a, b2) => b2.count - a.count || b2.last.localeCompare(a.last)).slice(0, limit);
}
/** Your recent income, newest first, without repeats, for one-tap paychecks. */
export function recentIncome(list, limit = 3) {
  const out = new Map();
  for (const t of liveTransactions(list).filter(x => x.kind === 'income' && x.description !== 'Starting money').sort((a, b) => b.date.localeCompare(a.date))) {
    const key = `${t.description.trim().toLowerCase()}|${t.amount}`;
    if (!out.has(key)) out.set(key, { description: t.description.trim() || 'Income', amount: t.amount });
  }
  return [...out.values()].slice(0, limit);
}

function drawForm() {
  const F = A.form, b = A.budgets[F.budgetId];
  const income = F.kind === 'income', refund = F.kind === 'refund';
  const list = A.transactions[F.budgetId];
  const day = Number(F.date.slice(8, 10));
  const isRepeatCopy = Boolean(F.editing?.recurringId);
  const rule = isRepeatCopy ? b.recurring?.[F.editing.recurringId] : null;
  const quick = F.editing ? [] : income ? recentIncome(list) : frequentSpending(b, list);
  const title = F.editing ? (income ? 'Edit income' : 'Edit spending') : income ? 'Add income' : 'Add spending';
  openSheet(`<form class="sheet tx-form" id="txForm" novalidate>${sheetHead(title)}
    <div class="sheet-body">
      ${quick.length ? `<div class="quick" aria-label="${income ? 'Recent income' : 'Your usual spending'}"><span class="label">${income ? 'Same as before' : 'Your usual'}</span><div class="quick-row">${quick.map((q, i) => `<button type="button" class="chip" data-action="tx-quick" data-id="${i}">${esc(q.description)}${income ? ` · ${money(q.amount)}` : ` · <span class="muted">${esc(b.categories[q.categoryId].name)}</span>`}</button>`).join('')}</div></div>` : ''}
      <label class="money-in big"><span class="sr">Amount</span><span aria-hidden="true">$</span><input id="fAmount" class="amount-input" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(F.amount)}" data-input="tx-amount"></label>
      <label class="f"><span class="sr">Description</span><input id="fDesc" maxlength="${LIMITS.description}" autocomplete="off" placeholder="${income ? 'Paycheck, gift, side job…' : refund ? 'What was returned?' : 'What was it for?'}" value="${esc(F.description)}" data-input="tx-desc"></label>
      <div class="form-rows">
        ${income
          ? '<div class="form-row"><span class="form-row-label">Goes to</span><span class="form-row-value">Ready to assign</span></div>'
          : `<label class="form-row"><span class="form-row-label">Category <span class="tiny muted" id="catHint">${F.suggested ? 'Suggested' : ''}</span></span><select id="fCat" data-change="tx-cat">${catOptions(b, F.categoryId)}</select></label>`}
        <label class="form-row form-row-date"><span class="form-row-label">Date</span><span class="form-row-value" id="fDateShown">${esc(fmtDate(F.date))}</span><input id="fDate" type="date" required value="${esc(F.date)}" data-change="tx-date"></label>
        ${income ? '' : `<label class="form-row switch-row"><span class="form-row-label">This was a refund</span><input type="checkbox" id="fRefund" role="switch" ${refund ? 'checked' : ''} data-change="tx-refund"></label>`}
        ${F.editing
          ? (isRepeatCopy ? `<div class="form-row"><span class="form-row-label">Repeats ${rule ? esc(howOften(rule, ordinal)) : ''}</span>${rule && !rule.stopped ? '<button type="button" class="link small" data-action="tx-stop-repeat">Stop repeating</button>' : '<span class="small muted">Stopped</span>'}</div>` : '')
          : refund ? '' : `<label class="form-row switch-row"><span class="form-row-label">Repeat <span class="tiny muted" id="repeatHint">${F.repeat ? esc(howOften(draftRule(F), ordinal)) : ''}</span></span><input type="checkbox" id="fRepeat" role="switch" ${F.repeat ? 'checked' : ''} data-change="tx-repeat"></label>
            ${F.repeat ? `<label class="form-row"><span class="form-row-label">How often</span><select id="fEvery" data-change="tx-every">${Object.entries(EVERY).map(([k, label]) => `<option value="${k}" ${F.every === k ? 'selected' : ''}>${label}</option>`).join('')}</select></label>` : ''}`}
      </div>
      ${F.repeat && F.every === 'month' && day > DAY_MAX ? `<p class="small muted">Repeats on the ${ordinal(DAY_MAX)}, so it lands in every month.</p>` : ''}
      ${F.repeat && F.every !== 'month' ? '<p class="small muted">Counted from this date. Paychecks every 2 weeks land in some months three times, and the extra goes to Ready to assign.</p>' : ''}
      ${F.showNote
        ? `<label class="f"><span>Note</span><textarea id="fNote" maxlength="${LIMITS.note}" data-input="tx-note">${esc(F.note)}</textarea></label>`
        : '<button type="button" class="link" data-action="tx-note">Add a note</button>'}
      ${F.editing ? '<button type="button" class="btn danger" data-action="tx-delete">Delete</button>' : ''}
    </div>
    <div class="sheet-foot"><button type="submit" class="btn primary" data-action="tx-save">${F.editing ? 'Save changes' : 'Save'}</button></div>
  </form>`);
}

/** Keeps what's typed before redrawing the form. */
const keepTyped = () => {
  const F = A.form;
  for (const [id, key] of [['fAmount', 'amount'], ['fDesc', 'description'], ['fNote', 'note']]) {
    const el = document.getElementById(id);
    if (el) F[key] = el.value;
  }
};

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
  if (A.form.repeat) { keepTyped(); drawForm(); }
};
changes['tx-refund'] = el => { keepTyped(); A.form.kind = el.checked ? 'refund' : 'spend'; if (el.checked) A.form.repeat = false; drawForm(); };
changes['tx-repeat'] = el => { keepTyped(); A.form.repeat = el.checked; drawForm(); };
changes['tx-every'] = el => { keepTyped(); A.form.every = el.value; drawForm(); };

/** The rule this form would save, for describing it before saving. */
function draftRule(F) {
  return F.every === 'month'
    ? { id: 'draft', kind: F.kind, amount: 1, categoryId: F.categoryId || 'x', day: Math.min(Number(F.date.slice(8, 10)), DAY_MAX), start: F.date.slice(0, 7) }
    : { id: 'draft', kind: F.kind, amount: 1, categoryId: F.categoryId || 'x', every: F.every, anchor: F.date };
}
actions['tx-note'] = () => { keepTyped(); A.form.showNote = true; drawForm(); document.getElementById('fNote')?.focus(); };
actions['tx-quick'] = el => {
  keepTyped();
  const F = A.form, b = A.budgets[F.budgetId];
  if (F.kind === 'income') {
    const q = recentIncome(A.transactions[F.budgetId])[Number(el.dataset.id)];
    Object.assign(F, { description: q.description, amount: fromCents(q.amount) });
  } else {
    const q = frequentSpending(b, A.transactions[F.budgetId])[Number(el.dataset.id)];
    Object.assign(F, { description: q.description, categoryId: q.categoryId, touchedCat: true, suggested: false });
  }
  drawForm();
  const amount = document.getElementById('fAmount');
  if (amount) { amount.focus(); amount.select?.(); }
};

actions['tx-save'] = () => {
  keepTyped();
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
    finishSheet();
    const { id, budgetId: _b, createdBy, createdAt, updatedAt, updatedBy, ...old } = before;
    toast('Saved', () => send(A.repo.updateTransaction(budgetId, { ...before, ...fields }, { note: '', ...old, categoryId: old.categoryId ?? null })));
    return;
  }
  let tid;
  if (F.repeat) {
    // This copy is the rule's first, so it isn't added a second time automatically.
    const base = { id: A.repo.newRuleId(), kind: F.kind, amount, description: fields.description, ...(F.kind === 'income' ? {} : { categoryId: F.categoryId }) };
    const rule = F.every === 'month'
      ? { ...base, every: 'month', day: Math.min(Number(F.date.slice(8, 10)), DAY_MAX), start: F.date.slice(0, 7) }
      : { ...base, every: F.every, anchor: F.date };
    send(A.repo.saveRule(budgetId, rule));
    tid = recurringId(rule.id, F.every === 'month' ? rule.start : rule.anchor);
    fields.recurringId = rule.id;
  }
  const { transaction, written } = A.repo.addTransaction(budgetId, fields, tid);
  send(written);
  finishSheet();
  const message = F.kind === 'income' ? `Added ${money(amount)} to Ready to assign` : F.kind === 'refund' ? `Refund saved: ${money(amount)}` : `Saved ${money(amount)}`;
  toast(`${message}${F.repeat ? `, repeats ${F.every === 'month' ? 'monthly' : F.every === 'week' ? 'weekly' : 'every 2 weeks'}` : ''}`, () => {
    send(A.repo.deleteTransaction(budgetId, transaction.id));
    if (fields.recurringId) send(A.repo.stopRule(budgetId, fields.recurringId));
  });
};
actions['tx-delete'] = () => {
  const F = A.form, budgetId = F.budgetId, id = F.editing.id;
  send(A.repo.deleteTransaction(budgetId, id));
  finishSheet();
  toast('Deleted', () => send(A.repo.restoreTransaction(budgetId, id)));
};
actions['tx-stop-repeat'] = () => {
  keepTyped();
  const F = A.form, ruleId = F.editing.recurringId;
  send(A.repo.stopRule(F.budgetId, ruleId));
  toast('Stopped repeating. This one stays.', () => send(A.repo.resumeRule(F.budgetId, ruleId, today().slice(0, 7))));
  drawForm();
};
actions['add-tx'] = () => openTxForm(A.route.id);
actions['add-income'] = () => openTxForm(A.route.id, null, { kind: 'income' });
actions['edit-tx'] = el => {
  const t = (A.transactions[A.route.id] || []).find(x => x.id === el.dataset.id);
  if (t) openTxForm(A.route.id, t);
};

registerSheet('tx', () => drawForm());
