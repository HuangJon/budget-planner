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
import { isHistory } from '../core/budget.js';

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

export function openSearch(budgetId, preset = {}) {
  openChild({ kind: 'search', budgetId, text: '', categoryId: '', when: '', flow: '', moving: false, ...preset }, drawSearch);
}

function drawSearch() {
  const S = A.sheet, b = budget();
  if (!b) return;
  const matches = searchTransactions(A.transactions[b.id] || [], { text: S.text, categoryId: S.categoryId, kind: S.flow, ...range(S) });
  const t = searchTotals(matches);
  // With nothing typed or picked, it lists everything: every transaction, newest first.
  const any = true;
  const filtered = Boolean(S.text.trim() || S.categoryId || S.when || S.flow || S.from);
  const cats = b.categories;
  openSheet(`<div class="sheet">${sheetHead('Search')}<div class="sheet-body">
    <input id="searchText" type="search" placeholder="Search, like coffee, gym or rent" value="${esc(S.text)}" data-input="search-text" autocomplete="off" enterkeyhint="search">
    <div class="seg flow-seg" role="group" aria-label="Money in or out">${[['', 'All'], ['income', 'Money in'], ['spend', 'Money out']].map(([k, l]) => `<button type="button" data-action="search-flow" data-id="${k}" aria-pressed="${(S.flow || '') === k}">${l}</button>`).join('')}</div>
    <div class="search-filters">
      <select aria-label="Category" data-change="search-cat"><option value="">Any category</option>${catOptions(b, S.categoryId).replace(/^<option value="" [^>]*>Pick one<\/option>/, '')}</select>
      ${S.from ? `<button type="button" class="btn small" data-action="search-when-clear" aria-label="Any time instead">${esc(S.fromLabel || S.from)} ×</button>` : `<select aria-label="When" data-change="search-when">${WHEN.map(([k, l]) => `<option value="${k}" ${S.when === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`}
    </div>
    ${any ? `<section class="panel pad search-sum">
      <div class="row between"><span class="label">${filtered ? `${t.count} ${t.count === 1 ? 'match' : 'matches'}` : `All ${t.count} transactions`}</span>${t.income ? `<span class="small owed">+${money(t.income)} came in</span>` : ''}</div>
      <div class="row between"><span class="amt big-amt owe">${money(t.spent)}</span><span class="small muted">${t.months > 1 ? `${money(t.perMonth)} a month over ${t.months} months` : t.months === 1 ? 'in one month' : ''}</span></div>
      ${!S.categoryId && t.byCategory.length > 1 ? `<div class="chips by-cat" aria-label="Narrow to a category">${t.byCategory.slice(0, 6).filter(c => cats[c.id]).map(c => `<button type="button" class="chip" data-action="search-pick-cat" data-id="${c.id}">${esc(cats[c.id].name)} · ${money(c.amount)}</button>`).join('')}</div>` : ''}
      ${filtered && matches.some(m => m.kind !== 'income') ? (S.moving
        ? `<div class="move-all stack tight"><label class="small">Move all ${matches.filter(m => m.kind !== 'income').length} to</label><div class="row gap8"><select id="moveAllTo">${catOptions(b, '')}</select><button type="button" class="btn small primary" data-action="search-move">Move</button><button type="button" class="btn small" data-action="search-move-cancel">Cancel</button></div><p class="tiny muted">Past ones too. Each keeps its old version, and you can undo.</p></div>`
        : '<button type="button" class="link small" data-action="search-move-open">Change category for all of these</button>') : ''}
    </section>` : ''}
    ${filtered ? '' : '<p class="tiny muted">Everything in this budget, every month, history included. Type or pick above to narrow it down.</p>'}
    ${any && matches.length ? `<div class="panel tx-list">${matches.slice(0, SHOWN).map(m => `<button type="button" class="tap tx-row" data-action="edit-tx" data-id="${m.id}"><span class="grow stack tight"><strong class="wrap-any two-lines">${esc(m.description || 'Spending')}</strong><span class="tiny muted">${fmtDate(m.date)} · ${esc(m.kind === 'income' ? 'Ready to assign' : cats[m.categoryId]?.name || 'Removed category')}${m.kind === 'refund' ? ' · Refund' : ''}${isHistory(b, m) ? ' · History' : ''}</span></span><span class="amt ${m.kind === 'spend' ? 'owe' : 'owed'}">${m.kind === 'spend' ? '−' : '+'}${money(m.amount)}</span></button>`).join('')}</div>
    ${matches.length > SHOWN ? `<p class="tiny muted">Showing the newest ${SHOWN} of ${matches.length}. The totals count them all.</p>` : ''}` : any ? '<p class="small muted">Nothing matches.</p>' : ''}
  </div></div>`);
}

// Redrawn while typing, keeping the cursor in the box.
inputs['search-text'] = el => { A.sheet.text = el.value; refreshOpenSheet(); };
changes['search-cat'] = el => { A.sheet.categoryId = el.value; drawSearch(); };
changes['search-when'] = el => { A.sheet.when = el.value; drawSearch(); };
actions['search-when-clear'] = () => { A.sheet.from = ''; A.sheet.to = ''; drawSearch(); };
// Tapping one of the biggest categories drills in: it opens as a step on top, so Back returns to
// the list before it (and from there, Back closes the popup).
actions['search-pick-cat'] = el => openChild({ ...A.sheet, categoryId: el.dataset.id, moving: false }, drawSearch);
actions['search-flow'] = el => { A.sheet.flow = el.dataset.id; if (el.dataset.id === 'income') A.sheet.categoryId = ''; drawSearch(); };
actions['search-move-open'] = () => { A.sheet.moving = true; drawSearch(); };
actions['search-move-cancel'] = () => { A.sheet.moving = false; drawSearch(); };
actions['search-move'] = () => {
  const S = A.sheet, b = budget(), to = document.getElementById('moveAllTo')?.value;
  if (!to || !b.categories[to]) { toast('Pick a category.'); return; }
  const matches = searchTransactions(A.transactions[b.id] || [], { text: S.text, categoryId: S.categoryId, kind: S.flow, ...range(S) })
    .filter(m => m.kind !== 'income' && m.categoryId !== to);
  S.moving = false;
  if (!matches.length) { toast(`They’re all in ${b.categories[to].name} already.`); drawSearch(); return; }
  send(A.repo.recategorize(b.id, matches, to));
  // Undo puts each one back where it was.
  const back = {};
  for (const m of matches) (back[m.categoryId] ||= []).push({ ...m, categoryId: to });
  toast(`Moved ${matches.length} to ${b.categories[to].name}`, () => { for (const [cat, list] of Object.entries(back)) send(A.repo.recategorize(b.id, list, cat)); });
  drawSearch();
};
actions['open-search'] = () => openSearch(A.route.id);

registerSheet('search', drawSearch);
