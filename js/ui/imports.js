/**
 * Imports, organised. "Import from your bank" opens a page with a grid of months by accounts: each
 * statement sits in the months it covers, in its account's column, so a year of files is one small
 * table, and a missing one shows as a gap. Tapping one opens it: rename it, change its account
 * (which re-marks its rows), see and edit its transactions, take it out, or delete it.
 */
import { A, actions, changes, render } from './state.js';
import { esc, openSheet, closeSheet, sheetHead, toast, send, fmtDate, fmtMonth, openChild, registerSheet, refreshOpenSheet } from './dom.js';
import { money } from '../core/money.js';
import { txRow } from './search.js';
import { importGrid, importSpan, unfiled } from '../core/imports.js';
import { thisMonth } from '../core/budget.js';

/* ---------- The budget's imports, loaded once and kept up to date here ---------- */

let loading = null;
/** The budget's import records, newest first; null until loaded (loading starts on first ask). */
export function importsOf(budgetId) {
  const list = A.imports?.[budgetId];
  if (!list) loadImports(budgetId);
  return list || null;
}
export async function loadImports(budgetId, force = false) {
  if (!budgetId || (!force && A.imports?.[budgetId]) || loading === budgetId) return;
  loading = budgetId;
  try {
    const list = await A.repo.listImports(budgetId);
    A.imports = { ...A.imports, [budgetId]: list.sort((x, y) => y.at - x.at) };
    render();
    if (A.sheet) refreshOpenSheet();
  } catch { /* badges and the grid just wait */ } finally { loading = null; }
}
/** Changes one record here right away (the database catches up), then redraws. */
function keep(budgetId, rec, gone = false) {
  const list = (A.imports?.[budgetId] || []).filter(r => r.id !== rec.id);
  A.imports = { ...A.imports, [budgetId]: gone ? list : [rec, ...list].sort((x, y) => y.at - x.at) };
  render();
  if (A.sheet) refreshOpenSheet();
}
export const findImport = (budgetId, id) => (A.imports?.[budgetId] || []).find(r => r.id === id);
export const importLabel = (budgetId, id) => findImport(budgetId, id)?.file || 'Bank file';
/** After a new import is saved: load the list again so it shows. */
export const importsChanged = budgetId => loadImports(budgetId, true);


// Drawn icons (not text characters), so they sit dead centre in every font and size.
const ICON = {
  in: '<svg class="ig-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  out: '<svg class="ig-ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  gap: '<svg class="ig-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};
const accName = (b, id) => (id && b.accounts?.[id]?.name) || 'No account';
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortMonth = m => `${SHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const span = (b, rec) => {
  const { from, to } = importSpan(rec, new Map((A.transactions[b.id] || []).map(t => [t.id, t])));
  return from ? (from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`) : '';
};

/* ---------- The Imports page ---------- */

export function openImports(budgetId, preset = {}) {
  openChild({ kind: 'imports', budgetId, years: {}, error: '', ...preset }, drawImports);
  loadImports(budgetId);
}

function drawImports() {
  const S = A.sheet, b = A.budgets[S.budgetId];
  if (!b) { closeSheet(); return; }
  const recs = importsOf(b.id);
  const grid = recs ? importGrid(recs, A.transactions[b.id], b.accounts, thisMonth()) : null;
  const year = thisMonth().slice(0, 4);
  const loose = unfiled(A.transactions[b.id]).length;
  const takenOut = (recs || []).filter(r => r.undone).length;
  const cell = (m, c) => {
    const here = grid.at(m, c), live = here.filter(r => !r.undone);
    if (here.length) {
      const one = here.length === 1;
      return `<button type="button" class="ig-cell ${live.length ? 'in' : 'out'}" data-action="${one ? 'import-view' : 'import-month'}" data-id="${esc(one ? here[0].id : m)}" data-col="${esc(c)}" aria-label="${esc(accName(b, c))}, ${esc(fmtMonth(m))}: ${one ? esc(here[0].file || 'Bank file') : `${here.length} imports`}${live.length ? '' : ', taken out'}">${live.length ? ICON.in : ICON.out}${here.length > 1 ? `<span class="ig-n">${here.length}</span>` : ''}</button>`;
    }
    if (grid.gap(m, c)) return `<button type="button" class="ig-cell gap" data-action="import-for" data-col="${esc(c)}" aria-label="${esc(accName(b, c))}, ${esc(fmtMonth(m))}: not imported yet. Import it">${ICON.gap}</button>`;
    return '<span class="ig-cell none" aria-hidden="true"></span>';
  };
  const byYear = new Map();
  for (const m of grid?.months || []) (byYear.get(m.slice(0, 4)) || byYear.set(m.slice(0, 4), []).get(m.slice(0, 4))).push(m);
  const head = grid ? `<div class="ig-row ig-head"><span></span>${grid.columns.map(c => `<span class="ig-col" title="${esc(accName(b, c))}">${esc(accName(b, c))}</span>`).join('')}</div>` : '';
  const rows = grid ? [...byYear].map(([y, months]) => {
    const open = y === year || S.years[y];
    const count = new Set(months.flatMap(m => grid.columns.flatMap(c => grid.at(m, c).map(r => r.id)))).size;
    return y === year ? months.map(m => `<div class="ig-row"><button type="button" class="ig-month" data-action="import-month" data-id="${m}">${shortMonth(m).slice(0, 3)}</button>${grid.columns.map(c => cell(m, c)).join('')}</div>`).join('')
      : `<button type="button" class="ig-year" data-action="import-year" data-id="${y}" aria-expanded="${Boolean(open)}">${open ? '▾' : '▸'} ${y} · ${count} ${count === 1 ? 'import' : 'imports'}</button>
        ${open ? months.map(m => `<div class="ig-row"><button type="button" class="ig-month" data-action="import-month" data-id="${m}">${shortMonth(m).slice(0, 3)}</button>${grid.columns.map(c => cell(m, c)).join('')}</div>`).join('') : ''}`;
  }).join('') : '';
  openSheet(`<div class="sheet">${sheetHead('Imports')}<div class="sheet-body">
    ${doneNote(b, S)}
    <label class="btn primary file-btn">${S.forName ? `Import a file from ${esc(S.forName)}` : 'Import files'}<input type="file" id="importFile" accept=".csv,text/csv,text/plain" data-change="import-file" ${S.forName ? '' : 'multiple'}></label>
    ${S.forName ? '' : '<p class="tiny muted center">Pick one file or several at once, like this month’s statements from each account.</p>'}
    ${S.error ? `<p class="small owe" role="alert">${esc(S.error)}</p>` : ''}
    <details class="how small"><summary>How to download a file from your bank</summary>
      <ol class="how-steps"><li>In your bank, open the card or account.</li><li>Choose <strong>Download account activity</strong> (or statements).</li><li>Pick <strong>CSV</strong> or <strong>Spreadsheet</strong> and the dates, then download.</li></ol>
      <p class="tiny muted">The file is read on this device and isn’t uploaded. Any bank’s CSV works if it has a date, a description and an amount. PDF statements can’t be read yet.</p></details>
    ${recs === null ? '<p class="small muted">Loading your imports…</p>' : !recs.length ? '<p class="small muted">Nothing imported yet. Your imports will show here by month and account.</p>' : `
    <section class="stack tight"><div class="row between"><h3 class="date-head">By month</h3>${takenOut ? `<button type="button" class="link small" data-action="import-clear-out">Clear ${takenOut} taken out</button>` : ''}</div>
      <div class="panel ig" role="table" aria-label="Imports by month and account" style="--cols:${grid.columns.length}">${head}${rows}</div>
      <p class="ig-key tiny muted"><span><span class="ig-cell in mini">${ICON.in}</span> In, tap to open</span><span><span class="ig-cell gap mini">${ICON.gap}</span> Missing, tap to import</span><span><span class="ig-cell out mini">${ICON.out}</span> Taken out</span></p></section>`}
    ${loose ? `<p class="notice">${loose} ${loose === 1 ? 'transaction came' : 'transactions came'} from files before imports were kept here. Import those files again and they’ll be filed in this grid. Nothing gets added twice.</p>` : ''}
  </div></div>`);
}

/**
 * After files are checked: what came in, and (only if account balances are kept) a nudge to
 * check they still match. No extra screen to get through.
 */
function doneNote(b, S) {
  const d = S.summary;
  if (!d || S.queue?.length || (!d.files && !d.skipped)) return '';
  const said = [d.added && `added ${d.added}`, d.filed && `filed ${d.filed}`].filter(Boolean).join(', ');
  const bits = said && said[0].toUpperCase() + said.slice(1);
  const from = `${d.files} ${d.files === 1 ? 'file' : 'files'}${d.skipped ? `, skipped ${d.skipped}` : ''}`;
  const balances = Object.values(b.accounts || {}).some(a => a.balance != null);
  return `<div class="notice done-note stack tight" role="status"><span><strong>${bits || 'Nothing new'}</strong> from ${from}.</span>
    ${balances && d.added ? '<span class="row between gap8"><span class="small">Update your balances to see if your accounts still match.</span><button type="button" class="btn small" data-action="open-accounts">Check accounts</button></span>' : ''}</div>`;
}

actions['import-year'] = el => { A.sheet.years = { ...A.sheet.years, [el.dataset.id]: !A.sheet.years[el.dataset.id] }; drawImports(); };
// A gap: import a file for that account (it's picked for you on the next screen).
actions['import-for'] = el => {
  const b = A.budgets[A.sheet.budgetId], c = el.dataset.col;
  Object.assign(A.sheet, { forAccount: c, forName: b.accounts?.[c]?.name || '' });
  drawImports();
  document.getElementById('importFile')?.click();
};
actions['import-month'] = el => openChild({ kind: 'import-month', budgetId: A.sheet.budgetId, month: el.dataset.id }, drawImportMonth);
actions['import-view'] = el => openImportView(A.sheet?.budgetId || A.route.id, el.dataset.id);
// Taken-out imports have no rows in the budget, so clearing them just tidies the grid.
actions['import-clear-out'] = () => {
  const b = A.budgets[A.sheet.budgetId], gone = (A.imports?.[b.id] || []).filter(r => r.undone);
  if (!gone.length) return;
  for (const rec of gone) { send(A.repo.deleteImport(b.id, rec)); keep(b.id, rec, true); }
  toast(`Cleared ${gone.length} taken out`, () => { for (const rec of gone) { send(A.repo.restoreImport(b.id, rec)); keep(b.id, rec); } });
};

/* ---------- One month: every import that covers it ---------- */

function drawImportMonth() {
  const S = A.sheet, b = A.budgets[S.budgetId];
  if (!b) { closeSheet(); return; }
  const recs = importsOf(b.id) || [];
  const grid = importGrid(recs, A.transactions[b.id], b.accounts, thisMonth());
  const cols = grid.columns.length ? grid.columns : [];
  const items = cols.map(c => {
    const here = grid.at(S.month, c);
    if (!here.length) return grid.gap(S.month, c) ? `<div class="tx-row im-row"><span class="grow stack tight"><strong>${esc(accName(b, c))}</strong><span class="tiny muted">Not imported for ${esc(fmtMonth(S.month))}</span></span><button type="button" class="btn small" data-action="import-month-for" data-col="${esc(c)}">Import</button></div>` : '';
    return here.map(r => importRow(b, r)).join('');
  }).join('');
  openSheet(`<div class="sheet">${sheetHead(fmtMonth(S.month))}<div class="sheet-body">
    ${items ? `<div class="panel tx-list">${items}</div>` : `<p class="small muted">No imports cover ${esc(fmtMonth(S.month))}.</p>`}
  </div></div>`);
}
actions['import-month-for'] = el => {
  const b = A.budgets[A.sheet.budgetId], c = el.dataset.col;
  openChild({ kind: 'imports', budgetId: b.id, years: {}, error: '', forAccount: c, forName: b.accounts?.[c]?.name || '' }, drawImports);
  document.getElementById('importFile')?.click();
};

/** One import in a list: its name, account, dates and size. */
function importRow(b, r) {
  const s = span(b, r);
  return `<button type="button" class="tap tx-row im-row ${r.undone ? 'off' : ''}" data-action="import-view" data-id="${esc(r.id)}"><span class="grow stack tight"><strong class="wrap-any">${esc(r.file || 'Bank file')}</strong><span class="tiny muted">${esc(accName(b, r.accountId))}${s ? ` · ${s}` : ''} · ${r.count} ${r.count === 1 ? 'row' : 'rows'}${r.undone ? ' · Taken out' : ''}</span></span><span class="muted" aria-hidden="true">›</span></button>`;
}

/* ---------- One import ---------- */

export function openImportView(budgetId, id) {
  openChild({ kind: 'import-view', budgetId, id, deleting: false }, drawImportView);
  loadImports(budgetId);
}

function drawImportView() {
  const S = A.sheet, b = A.budgets[S.budgetId];
  if (!b) { closeSheet(); return; }
  const rec = findImport(b.id, S.id);
  if (!rec) {
    openSheet(`<div class="sheet">${sheetHead('Import')}<div class="sheet-body"><p class="small muted">${A.imports?.[b.id] ? 'This import was deleted.' : 'Loading…'}</p></div></div>`);
    return;
  }
  const ids = new Set(rec.ids);
  const rows = (A.transactions[b.id] || []).filter(t => ids.has(t.id)).sort((x, y) => y.date.localeCompare(x.date));
  const live = rows.filter(t => !t.deleted);
  const s = span(b, rec);
  const spent = live.filter(t => t.kind === 'spend').reduce((a, t) => a + t.amount, 0);
  const others = (rec.seen || 0);
  openSheet(`<div class="sheet">${sheetHead(rec.file || 'Import')}<div class="sheet-body">
    <div class="panel form-rows">
      <label class="form-row"><span class="form-row-label">Name</span><input id="impViewName" maxlength="80" value="${esc(rec.file || '')}" data-change="impv-name" aria-label="Name of this import" autocomplete="off" enterkeyhint="done"></label>
      <label class="form-row"><span class="form-row-label">From</span><select data-change="impv-account" aria-label="Which account this import is from"><option value="" ${rec.accountId && b.accounts?.[rec.accountId] ? '' : 'selected'}>No account</option>${Object.entries(b.accounts || {}).map(([id, a]) => `<option value="${id}" ${rec.accountId === id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    </div>
    <p class="small muted">${s ? `Covers ${s} · ` : ''}${rec.count} ${rec.count === 1 ? 'row' : 'rows'}${others ? ` · ${others} more in the file were already in` : ''} · added ${fmtDate(new Date(rec.at).toISOString().slice(0, 10))}</p>
    ${rec.undone ? '<p class="notice">Taken out: these rows aren’t in your budget right now. Bring back returns them with any edits.</p>' : ''}
    <section class="stack tight"><div class="row between"><h3 class="date-head">${rec.undone ? 'Rows' : 'Transactions'} · ${rows.length}</h3>${spent ? `<span class="small muted">${money(spent)} spent</span>` : ''}</div>
      ${rows.length ? `<div class="panel tx-list">${rows.slice(0, 300).map(t => rec.undone || t.deleted
        ? `<div class="tx-row off"><span class="grow stack tight"><strong class="wrap-any">${esc(t.description || 'Spending')}</strong><span class="tiny muted">${fmtDate(t.date)}${t.deleted && !rec.undone ? ' · Deleted' : ''}</span></span></div>`
        : txRow(b, t, `${fmtDate(t.date)} · ${esc(b.categories[t.categoryId]?.name || (t.kind === 'income' ? 'Ready to assign' : 'Removed category'))}`, `<span class="amt ${t.kind === 'spend' ? 'owe' : 'owed'}">${t.kind === 'spend' ? '−' : '+'}${money(t.amount)}</span>`)).join('')}</div>` : '<p class="small muted">Its rows aren’t here any more.</p>'}
    </section>
    ${S.deleting ? `<div class="stack tight past-delete"><span class="small">Delete “${esc(rec.file || 'this import')}”?</span>
      ${rec.undone ? '' : `<button type="button" class="btn small danger" data-action="impv-delete-yes">Delete it and take out its ${rec.count} ${rec.count === 1 ? 'row' : 'rows'}</button>`}
      <button type="button" class="btn small" data-action="impv-delete-keep">${rec.undone ? 'Remove it from the list' : 'Keep the rows, just remove the import'}</button>
      <button type="button" class="btn small" data-action="impv-delete-no">Cancel</button></div>` : ''}
  </div><div class="sheet-foot row gap8">
    <button type="button" class="btn" data-action="${rec.undone ? 'impv-redo' : 'impv-undo'}">${rec.undone ? 'Bring back' : 'Take out'}</button>
    <button type="button" class="btn danger" data-action="impv-delete">Delete</button>
  </div></div>`);
}

const viewRec = () => { const S = A.sheet; return [A.budgets[S.budgetId], findImport(S.budgetId, S.id)]; };
changes['impv-name'] = el => {
  const [b, rec] = viewRec(), name = el.value.trim().slice(0, 80);
  if (!rec || !name || name === rec.file) return;
  send(A.repo.renameImport(b.id, rec.id, name));
  keep(b.id, { ...rec, file: name });
  toast('Renamed');
};
changes['impv-account'] = el => {
  const [b, rec] = viewRec(), to = el.value || null, before = rec.accountId || null;
  if (!rec || to === before) return;
  const txs = A.transactions[b.id];
  const p = A.repo.setImportAccount(b.id, rec, to, txs);
  send(p);
  keep(b.id, { ...rec, accountId: to });
  toast(`Marked as ${to ? b.accounts[to].name : 'no account'}`, () => {
    send(p.then(rows => A.repo.tagAccount(b.id, rows, before)).then(() => A.repo.markImportAccount(b.id, rec.id, before)));
    keep(b.id, { ...rec, accountId: before });
  });
};
actions['impv-undo'] = () => {
  const [b, rec] = viewRec();
  if (!rec) return;
  send(A.repo.undoImport(b.id, rec));
  keep(b.id, { ...rec, undone: true });
  toast(`Took out ${rec.count}`, () => { send(A.repo.redoImport(b.id, rec)); keep(b.id, { ...rec, undone: false }); });
};
actions['impv-redo'] = () => {
  const [b, rec] = viewRec();
  if (!rec) return;
  send(A.repo.redoImport(b.id, rec));
  keep(b.id, { ...rec, undone: false });
  toast(`Brought back ${rec.count}`);
};
actions['impv-delete'] = () => { A.sheet.deleting = true; drawImportView(); document.querySelector('.past-delete')?.scrollIntoView({ block: 'center' }); };
actions['impv-delete-no'] = () => { A.sheet.deleting = false; drawImportView(); };
function deleteIt(keepRows) {
  const [b, rec] = viewRec();
  if (!rec) return;
  keepRows = keepRows && !rec.undone;
  send(A.repo.deleteImport(b.id, rec, { keepRows }));
  keep(b.id, rec, true);
  // Back to where it was opened from.
  actions['sheet-back']?.();
  toast(keepRows || rec.undone ? `Removed ${rec.file || 'the import'}` : `Deleted ${rec.file || 'the import'} and took out ${rec.count}`, () => {
    send(A.repo.restoreImport(b.id, rec, { keepRows }));
    keep(b.id, rec);
  });
}
actions['impv-delete-yes'] = () => deleteIt(false);
actions['impv-delete-keep'] = () => deleteIt(true);

registerSheet('imports', drawImports);
registerSheet('import-view', drawImportView);
registerSheet('import-month', drawImportMonth);

actions['open-imports'] = () => openImports(A.route.id);

// Enter in the name box saves it (by leaving the box, which saves on change).
addEventListener('keydown', ev => {
  if (ev.target?.id === 'impViewName' && ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); }
});
