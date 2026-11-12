/**
 * Search: every transaction in the budget, history included. Type words (like "coffee" or "gym"),
 * pick a category or a time, and see the matches with what they add up to. "Change category"
 * moves all of the matches at once, past ones included, and can be undone.
 */
import { A, actions, changes, inputs } from './state.js';
import { esc, openSheet, sheetHead, openChild, registerSheet, toast, send, fmtDate, today, refreshOpenSheet } from './dom.js';
import { searchTransactions, searchTotals } from '../core/search.js';
import { money } from '../core/money.js';
import { catOptions } from './tx-form.js';
import { isHistory, categoryLabel, parts } from '../core/budget.js';
import { importsOf, importLabel, openImportView } from './imports.js';

const SHOWN = 150;
const WHEN = [['', 'Any time'], ['year', 'This year'], ['12', 'Last 12 months'], ['3', 'Last 3 months'], ['month', 'This month']];
const budget = () => A.budgets[A.sheet?.budgetId];

function datesFor(when) {
  const t = today();
  if (when === 'year') return { from: `${t.slice(0, 4)}-01-01`, to: '' };
  if (when === 'month') return { from: `${t.slice(0, 7)}-01`, to: '' };
  if (when === '12' || when === '3') {
    const d = new Date(`${t}T12:00:00`);
    d.setMonth(d.getMonth() - Number(when));
    return { from: d.toISOString().slice(0, 10), to: '' };
  }
  return { from: '', to: '' };
}

/** The dates searched: a month picked from Trends (from/to), or one of the choices in the list. */
const range = S => (S.from ? { from: S.from, to: S.to || '' } : datesFor(S.when));

/**
 * A small badge with the account a transaction came from. Tapping it shows everything from that
 * account in Search (or narrows the Search already open).
 */
export function accountBadge(b, t) {
  if (t.accountId && b.accounts?.[t.accountId]) {
    return `<button type="button" class="acc-badge" data-action="open-acc-tag" data-id="${esc(t.accountId)}" aria-label="Everything from ${esc(b.accounts[t.accountId].name)}">${esc(b.accounts[t.accountId].name)}</button>`;
  }
  // No account picked: it still shows which import it came in with.
  if (t.importId) {
    const recs = importsOf(b.id);
    if (!recs) return '';
    const name = importLabel(b.id, t.importId);
    return `<button type="button" class="acc-badge imp-badge" data-action="open-import-view" data-id="${esc(t.importId)}" data-budget="${esc(b.id)}" aria-label="Open the import ${esc(name)}">${esc(name)}</button>`;
  }
  return '';
}
actions['open-acc-tag'] = el => {
  if (A.sheet?.kind === 'search') { openChild({ ...A.sheet, accountId: el.dataset.id, moving: false }, drawSearch); return; }
  openSearch(A.route.id || A.sheet?.budgetId, { accountId: el.dataset.id });
};

// An import badge (or "Came in with") opens that import.
actions['open-import-view'] = el => openImportView(el.dataset.budget || A.form?.budgetId || A.route.id, el.dataset.id);

/**
 * One transaction in a list. The whole row opens it; the badge on it is its own button on top
 * (a button can't hold another button), so both work by tap and by keyboard.
 */
export const txRow = (b, t, meta, amount) => `<div class="tap tx-row tx-line"><span class="grow stack tight"><button type="button" class="tx-main" data-action="edit-tx" data-id="${esc(t.id)}"><strong class="wrap-any two-lines">${esc(t.description || (t.kind === 'income' ? 'Income' : t.kind === 'refund' ? 'Refund' : 'Spending'))}</strong></button><span class="tiny muted">${meta}</span>${accountBadge(b, t)}</span>${amount}</div>`;

export function openSearch(budgetId, preset = {}) {
  openChild({ kind: 'search', budgetId, text: '', categoryId: '', when: '', flow: '', moving: false, ...preset }, drawSearch);
}

function drawSearch() {
  const S = A.sheet, b = budget();
  if (!b) return;
  const matches = searchTransactions(A.transactions[b.id] || [], { text: S.text, categoryId: S.categoryId, kind: S.flow, accountId: S.accountId || '', importId: S.importId || '', ...range(S) });
  const t = searchTotals(matches);
  // With nothing typed or picked, it lists everything: every transaction, newest first.
  const any = true;
  const filtered = Boolean(S.text.trim() || S.categoryId || S.when || S.flow || S.from || S.accountId || S.importId);
  const cats = b.categories;
  openSheet(`<div class="sheet">${sheetHead('Search')}<div class="sheet-body">
    <input id="searchText" type="search" placeholder="Search, like coffee, gym or rent" value="${esc(S.text)}" data-input="search-text" autocomplete="off" enterkeyhint="search">
    <div class="seg flow-seg" role="group" aria-label="Money in or out">${[['', 'All'], ['income', 'Money in'], ['spend', 'Money out']].map(([k, l]) => `<button type="button" data-action="search-flow" data-id="${k}" aria-pressed="${(S.flow || '') === k}">${l}</button>`).join('')}</div>
    <div class="search-filters">
      <select aria-label="Category" data-change="search-cat"><option value="">Any category</option>${catOptions(b, S.categoryId).replace(/^<option value="" [^>]*>Pick one<\/option>/, '')}</select>
      ${S.from ? `<button type="button" class="btn small" data-action="search-when-clear" aria-label="Any time instead">${esc(S.fromLabel || S.from)} ×</button>` : `<select aria-label="When" data-change="search-when">${WHEN.map(([k, l]) => `<option value="${k}" ${S.when === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`}
    </div>
    ${S.importId ? `<button type="button" class="btn small search-import" data-action="search-import-clear" aria-label="Everything instead">Import: ${esc(S.importName || 'bank file')} ×</button>` : ''}
    ${Object.keys(b.accounts || {}).length ? `<select class="search-account" aria-label="Account" data-change="search-account"><option value="">Any account</option>${Object.entries(b.accounts).map(([id, x]) => `<option value="${id}" ${S.accountId === id ? 'selected' : ''}>From ${esc(x.name)}</option>`).join('')}</select>` : ''}
    ${any ? `<section class="panel pad search-sum">
      <div class="row between"><span class="label">${filtered ? `${t.count} ${t.count === 1 ? 'match' : 'matches'}` : `All ${t.count} transactions`}</span>${t.income ? `<span class="small owed">+${money(t.income)} came in</span>` : ''}</div>
      <div class="row between"><span class="amt big-amt owe">${money(t.spent)}</span><span class="small muted">${t.months > 1 ? `${money(t.perMonth)} a month over ${t.months} months` : t.months === 1 ? 'in one month' : ''}</span></div>
      ${!S.categoryId && t.byCategory.length > 1 ? `<div class="chips by-cat" aria-label="Narrow to a category">${t.byCategory.slice(0, 6).filter(c => cats[c.id]).map(c => `<button type="button" class="chip" data-action="search-pick-cat" data-id="${c.id}">${esc(cats[c.id].name)} · ${money(c.amount)}</button>`).join('')}</div>` : ''}
      ${filtered && matches.some(m => m.kind !== 'income') ? (S.moving
        ? `<div class="move-all stack tight"><label class="small">Move all ${matches.filter(m => m.kind !== 'income').length} to</label><div class="row gap8"><select id="moveAllTo">${catOptions(b, '')}</select><button type="button" class="btn small primary" data-action="search-move">Move</button><button type="button" class="btn small" data-action="search-move-cancel">Cancel</button></div><p class="tiny muted">Past ones too. Each keeps its old version, and you can undo.</p></div>`
        : '<button type="button" class="link small" data-action="search-move-open">Change category for all of these</button>') : ''}
      ${filtered && matches.length && Object.keys(b.accounts || {}).length ? (S.tagging
        ? `<div class="move-all stack tight"><label class="small" for="tagAllTo">Set the account for all ${matches.length}</label><div class="row gap8"><select id="tagAllTo"><option value="">No account</option>${Object.entries(b.accounts).map(([id, a]) => `<option value="${id}">${esc(a.name)}</option>`).join('')}</select><button type="button" class="btn small primary" data-action="search-tag">Set</button><button type="button" class="btn small" data-action="search-tag-cancel">Cancel</button></div><p class="tiny muted">Past ones too, and you can undo.</p></div>`
        : '<button type="button" class="link small" data-action="search-tag-open">Set the account for all of these</button>') : ''}
    </section>` : ''}
    ${filtered ? '' : '<p class="tiny muted">Everything in this budget, every month, history included. Type or pick above to narrow it down.</p>'}
    ${any && matches.length ? `<div class="panel tx-list">${matches.slice(0, SHOWN).map(m => txRow(b, m, `${fmtDate(m.date)} · ${esc(categoryLabel(b, m))}${m.kind === 'refund' ? ' · Refund' : ''}${isHistory(b, m) ? ' · History' : ''}`, `<span class="amt ${m.kind === 'spend' ? 'owe' : 'owed'}">${m.kind === 'spend' ? '−' : '+'}${money(m.amount)}</span>`)).join('')}</div>
    ${matches.length > SHOWN ? `<p class="tiny muted">Showing the newest ${SHOWN} of ${matches.length}. The totals count them all.</p>` : ''}` : any ? '<p class="small muted">Nothing matches.</p>' : ''}
  </div></div>`);
}

// Redrawn while typing, keeping the cursor in the box.
inputs['search-text'] = el => { A.sheet.text = el.value; refreshOpenSheet(); };
changes['search-cat'] = el => { A.sheet.categoryId = el.value; drawSearch(); };
changes['search-account'] = el => { A.sheet.accountId = el.value; drawSearch(); };
changes['search-when'] = el => { A.sheet.when = el.value; drawSearch(); };
actions['search-import-clear'] = () => { A.sheet.importId = ''; drawSearch(); };
actions['search-when-clear'] = () => { A.sheet.from = ''; A.sheet.to = ''; drawSearch(); };
// Tapping one of the biggest categories drills in: it opens as a step on top, so Back returns to
// the list before it (and from there, Back closes the popup).
actions['search-pick-cat'] = el => openChild({ ...A.sheet, categoryId: el.dataset.id, moving: false }, drawSearch);
actions['search-flow'] = el => { A.sheet.flow = el.dataset.id; if (el.dataset.id === 'income') A.sheet.categoryId = ''; drawSearch(); };
actions['search-move-open'] = () => { A.sheet.moving = true; A.sheet.tagging = false; drawSearch(); };
actions['search-move-cancel'] = () => { A.sheet.moving = false; drawSearch(); };
actions['search-move'] = () => {
  const S = A.sheet, b = budget(), to = document.getElementById('moveAllTo')?.value;
  if (!to || !b.categories[to]) { toast('Pick a category.'); return; }
  const matches = searchTransactions(A.transactions[b.id] || [], { text: S.text, categoryId: S.categoryId, kind: S.flow, accountId: S.accountId || '', importId: S.importId || '', ...range(S) })
    .filter(m => m.kind !== 'income' && m.categoryId !== to);
  // Split purchases stay as they are: moving one whole would undo how it was divided.
  const splitOnes = matches.filter(m => parts(m).length > 1);
  matches.splice(0, matches.length, ...matches.filter(m => parts(m).length === 1));
  S.moving = false;
  if (!matches.length) { toast(`They’re all in ${b.categories[to].name} already.`); drawSearch(); return; }
  send(A.repo.recategorize(b.id, matches, to));
  // Undo puts each one back where it was.
  const back = {};
  for (const m of matches) (back[m.categoryId] ||= []).push({ ...m, categoryId: to });
  toast(`Moved ${matches.length} to ${b.categories[to].name}${splitOnes.length ? `; ${splitOnes.length} split ${splitOnes.length === 1 ? 'one' : 'ones'} left as they are` : ''}`, () => { for (const [cat, list] of Object.entries(back)) send(A.repo.recategorize(b.id, list, cat)); });
  drawSearch();
};
actions['search-tag-open'] = () => { A.sheet.tagging = true; A.sheet.moving = false; drawSearch(); };
actions['search-tag-cancel'] = () => { A.sheet.tagging = false; drawSearch(); };
actions['search-tag'] = () => {
  const S = A.sheet, b = budget(), to = document.getElementById('tagAllTo')?.value || null;
  const matches = searchTransactions(A.transactions[b.id] || [], { text: S.text, categoryId: S.categoryId, kind: S.flow, accountId: S.accountId || '', importId: S.importId || '', ...range(S) })
    .filter(m => (m.accountId || null) !== to);
  S.tagging = false;
  const name = to ? b.accounts[to]?.name : 'no account';
  if (!matches.length) { toast(`They’re all ${to ? `from ${name}` : 'without an account'} already.`); drawSearch(); return; }
  send(A.repo.tagAccount(b.id, matches.map(m => m.id), to));
  // Undo puts each one back to the account it had.
  const back = {};
  for (const m of matches) (back[m.accountId || ''] ||= []).push(m.id);
  toast(`Set ${matches.length} to ${name}`, () => { for (const [acc, ids] of Object.entries(back)) send(A.repo.tagAccount(b.id, ids, acc || null)); });
  drawSearch();
};
actions['open-search'] = () => openSearch(A.route.id);

registerSheet('search', drawSearch);
