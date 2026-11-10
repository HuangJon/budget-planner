/**
 * Bringing in a bank's CSV download. Pick the file, check each row's category (one choice fills
 * in the rest from the same place), untick anything to leave out, then add them all at once.
 * The file is read on this device; only the transactions are saved, like typing them in.
 */
import { A, actions, changes } from './state.js';
import { LIMITS } from '../config/app.js';
import { groupedCategories, budgetStart } from '../core/budget.js';
import { esc, openSheet, closeSheet, sheetHead, toast, send, fmtDate, openChild, registerSheet, val } from './dom.js';
import { readStatement, markExisting, guessCategory, SKIP } from '../core/import.js';
import { money } from '../core/money.js';
import { catOptions } from './tx-form.js';
import { openAccounts } from './accounts.js';
import { randomId } from '../core/ids.js';

const MAX_ROWS = 1000;
/** The budget, plus any categories made here that the database hasn't sent back yet. */
const budget = () => {
  const b = A.budgets[A.sheet?.budgetId];
  return b && A.sheet?.newCats ? { ...b, categories: { ...A.sheet.newCats, ...b.categories } } : b;
};
const NEW = '__new';
const norm = s => String(s || '').trim().toLowerCase();

export function openImport(budgetId) {
  openChild({ kind: 'import', budgetId, step: 'pick', rows: [], error: '', showSkipped: false, past: null }, drawImport);
  loadPast();
}
/** Past imports, newest first, for undoing or bringing one back. */
async function loadPast() {
  const S = A.sheet, b = budget();
  if (!b || S?.kind !== 'import') return;
  try { S.past = (await A.repo.listImports(b.id)).sort((x, y) => y.at - x.at); } catch { S.past = []; }
  if (A.sheet === S && S.step === 'pick') drawImport();
}
const remembered = key => { try { return localStorage.getItem(`wmm:importAccount:${key}`) || ''; } catch { return ''; } };
const remember = (key, id) => { try { localStorage.setItem(`wmm:importAccount:${key}`, id); } catch { /* fine */ } };

function pastList(b) {
  const past = A.sheet.past;
  if (!past?.length) return '';
  const acc = id => b.accounts?.[id]?.name;
  return `<section class="stack tight past-imports"><h3 class="date-head">Past imports</h3><div class="panel tx-list">${past.slice(0, 12).map(p => `<div class="tx-row past-row ${p.undone ? 'off' : ''}">
      <span class="grow stack tight"><strong class="wrap-any">${esc(p.file || 'Bank file')}</strong><span class="tiny muted">${fmtDate(new Date(p.at).toISOString().slice(0, 10))} · ${p.count} ${p.count === 1 ? 'row' : 'rows'}${acc(p.accountId) ? ` · ${esc(acc(p.accountId))}` : ''}${p.undone ? ' · Taken out' : ''}</span></span>
      <button type="button" class="btn small" data-action="${p.undone ? 'import-redo' : 'import-undo'}" data-id="${esc(p.id)}">${p.undone ? 'Bring back' : 'Undo'}</button>
    </div>`).join('')}</div><p class="tiny muted">Undo takes every row from that file back out. Edits you made to them come back with Bring back.</p></section>`;
}

function drawImport() {
  const S = A.sheet, b = budget();
  if (!b) { closeSheet(); return; }
  if (S.step === 'pick') {
    openSheet(`<div class="sheet">${sheetHead('Import from your bank')}<div class="sheet-body">
      <p class="muted">Bring in purchases from a CSV file instead of typing them. You check everything before it’s added.</p>
      <ol class="how-steps small">
        <li>In Chase, open the card or account.</li>
        <li>Choose <strong>Download account activity</strong>.</li>
        <li>Pick <strong>Spreadsheet (Excel, CSV)</strong> and the dates, then download.</li>
      </ol>
      <label class="btn primary file-btn">Choose the CSV file<input type="file" id="importFile" accept=".csv,text/csv,text/plain" data-change="import-file"></label>
      ${S.error ? `<p class="small owe" role="alert">${esc(S.error)}</p>` : ''}
      <p class="tiny muted">The file is read on this device and isn’t uploaded. Other banks’ CSV files work too if they have a date, a description and an amount. PDF statements can’t be read yet.</p>
      ${pastList(b)}
    </div></div>`);
    return;
  }
  const rows = S.rows;
  const adding = rows.filter(r => r.include);
  const needCat = adding.filter(r => r.kind !== 'income' && !b.categories[r.categoryId]).length;
  const skipped = rows.filter(r => r.skip);
  const shown = rows.map((r, i) => [r, i]).filter(([r]) => !r.skip || S.showSkipped);
  const dates = rows.map(r => r.date).sort();
  const start = budgetStart(b);
  const history = start ? adding.filter(r => r.date < start).length : 0;
  openSheet(`<div class="sheet">${sheetHead('Check and add')}<div class="sheet-body">
    <p class="small muted">${esc(S.fileName)} · ${fmtDate(dates[0])} to ${fmtDate(dates.at(-1))}</p>
    <label class="form-row bordered"><span class="form-row-label">From</span><select data-change="import-account" aria-label="Which account this file is from">
      <option value="" ${S.accountId ? '' : 'selected'}>Not one of my accounts</option>
      ${Object.entries(b.accounts || {}).map(([id, a]) => `<option value="${id}" ${S.accountId === id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
      <option value="${NEW}">+ Add an account…</option></select></label>
    ${S.addingAccount ? `<div class="panel pad stack tight"><input id="impAccName" maxlength="40" placeholder="Name, like Chase card" autocomplete="off"><div class="seg" role="group" aria-label="Kind of account"><button type="button" data-action="imp-acc-kind" data-id="cash" aria-pressed="${S.accKind !== 'card'}">Bank or cash</button><button type="button" data-action="imp-acc-kind" data-id="card" aria-pressed="${S.accKind === 'card'}">Credit card</button></div><div class="row gap8"><button type="button" class="btn small primary" data-action="imp-acc-add">Add</button><button type="button" class="btn small" data-action="imp-acc-cancel">Cancel</button></div><p class="tiny muted">Its balance can go in later, in Check your accounts.</p></div>` : ''}
    ${history ? `<p class="notice">${history} ${history === 1 ? 'is' : 'are'} from before your budget started (${fmtDate(start)}). ${history === 1 ? 'It’s' : 'They’re'} kept as history for Trends and search, and won’t change your money.</p>` : ''}
    ${needCat ? `<p class="small owe">${needCat} still need${needCat === 1 ? 's' : ''} a category.</p>` : '<p class="small muted">Categories are guessed from what you picked before. Changing one changes the rest from the same place.</p>'}
    <div class="panel import-list">${shown.map(([r, i]) => row(b, r, i)).join('')}</div>
    ${skipped.length ? `<button type="button" class="link small" data-action="import-skipped">${S.showSkipped ? 'Hide the ones left out' : `Show ${skipped.length} left out`}</button>` : ''}
  </div><div class="sheet-foot"><button type="button" class="btn primary" data-action="import-save" ${adding.length ? '' : 'disabled'}>${adding.length ? `Add ${adding.length}` : 'Nothing ticked'}</button></div></div>`);
}

function row(b, r, i) {
  const sign = r.kind === 'spend' ? '−' : '+';
  const where = r.kind === 'income'
    ? '<span class="tiny muted">Income · Ready to assign</span>'
    : A.sheet.making === i ? newCatForm(b, r, i)
    : `<select aria-label="Category for ${esc(r.description)}" data-change="import-cat" data-id="${i}" class="${r.include && !b.categories[r.categoryId] ? 'needs' : ''}">${catOptions(b, b.categories[r.categoryId] ? r.categoryId : '')}<option value="${NEW}">+ New category…</option></select>`;
  return `<div class="import-row ${r.include ? '' : 'off'}">
    <input type="checkbox" aria-label="Add ${esc(r.description)}" ${r.include ? 'checked' : ''} data-change="import-tick" data-id="${i}">
    <div class="grow stack tight">
      <div class="row between gap8"><strong class="wrap-any two-lines">${esc(r.description)}</strong><span class="amt ${r.kind === 'spend' ? 'owe' : 'owed'}">${sign}${money(r.amount)}</span></div>
      <span class="tiny muted">${fmtDate(r.date)}${r.kind === 'refund' ? ' · Refund' : ''}</span>
      ${r.skip ? `<span class="tiny muted">${esc(SKIP[r.skip])}</span>` : ''}
      ${r.include || !r.skip ? where : ''}
    </div>
  </div>`;
}

changes['import-file'] = async el => {
  const file = el.files?.[0], S = A.sheet, b = budget();
  if (!file || !b) return;
  try {
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') throw Object.assign(new Error('That’s a PDF. Download the CSV (spreadsheet) version instead.'), { code: 'pdf' });
    if (file.size > 2e6) throw new Error('That file is too big. Pick a shorter date range.');
    const { format, rows } = readStatement(await file.text());
    if (!rows.length) throw new Error('No transactions found in that file.');
    if (rows.length > MAX_ROWS) throw new Error(`That’s ${rows.length} rows. Pick a shorter date range (up to ${MAX_ROWS}).`);
    const existing = A.transactions[b.id] || [];
    const past = existing.filter(t => !t.deleted);
    S.deleted = new Set(existing.filter(t => t.deleted).map(t => t.id));
    S.rows = markExisting(rows, existing).map(r => ({ ...r, include: !r.skip, categoryId: guessCategory(r, b.categories, past) || '' }));
    S.fileName = file.name;
    S.format = format;
    const last = remembered(format);
    S.accountId = last && b.accounts?.[last] ? last : '';
    S.step = 'review';
    S.error = '';
  } catch (e) {
    S.error = e.code === 'unknown-format' || e.code === 'pdf' || !e.code ? e.message : 'That file couldn’t be read.';
  }
  drawImport();
};

changes['import-tick'] = el => {
  const r = A.sheet.rows[+el.dataset.id];
  r.include = el.checked;
  drawImport();
};

/** Making a category without leaving the import: a name and which group it goes in. */
function newCatForm(b, r, i) {
  const groups = groupedCategories(b).map(g => g.name);
  // Start in the group of the category it had (the guess), which is usually close.
  const guess = b.categories[r.categoryId]?.group;
  return `<div class="new-cat stack tight">
    <input id="impNewName" maxlength="${LIMITS.categoryName}" placeholder="New category, like Travel" autocomplete="off">
    <select id="impNewGroup" aria-label="Group for the new category">${groups.map(g => `<option ${g === (groups.includes(guess) ? guess : groups[0]) ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
    <div class="row gap8"><button type="button" class="btn small primary" data-action="import-newcat" data-id="${i}">Add</button><button type="button" class="btn small" data-action="import-newcat-cancel">Cancel</button></div>
  </div>`;
}

/** Puts a category on a row, and on the others from the same place that weren't picked by hand. */
function setCategory(r, categoryId) {
  const rows = A.sheet.rows;
  r.categoryId = categoryId;
  r.picked = true;
  let more = 0;
  for (const o of rows) {
    if (o !== r && !o.picked && o.kind === r.kind && norm(o.description) === norm(r.description) && o.categoryId !== categoryId) { o.categoryId = categoryId; more += 1; }
  }
  return more;
}

actions['import-newcat'] = el => {
  const S = A.sheet, b = budget(), r = S.rows[+el.dataset.id];
  const name = val('impNewName').trim().slice(0, LIMITS.categoryName), group = val('impNewGroup');
  if (!name) { toast('Type a name first.'); document.getElementById('impNewName')?.focus(); return; }
  const same = Object.entries(b.categories).find(([, c]) => !c.hidden && norm(c.name) === norm(name));
  if (same) { S.making = null; setCategory(r, same[0]); toast(`${same[1].name} already exists, so it’s using that`); drawImport(); return; }
  if (Object.keys(b.categories).length >= LIMITS.categories) { toast(`A budget can have up to ${LIMITS.categories} categories.`); return; }
  const order = Math.max(0, ...Object.values(b.categories).map(c => c.order ?? 0)) + 1;
  const { catId, written } = A.repo.addCategory(b.id, { name, group, order });
  send(written);
  S.newCats = { ...S.newCats, [catId]: { name, group, order } };
  S.making = null;
  const more = setCategory(r, catId);
  toast(`Added ${name}${more ? ` and used it for ${more} more from ${r.description}` : ''}`);
  drawImport();
};
actions['import-newcat-cancel'] = () => { A.sheet.making = null; drawImport(); };

changes['import-cat'] = el => {
  const rows = A.sheet.rows, r = rows[+el.dataset.id];
  if (el.value === NEW) {
    A.sheet.making = +el.dataset.id;
    drawImport();
    document.getElementById('impNewName')?.focus();
    return;
  }
  r.categoryId = el.value;
  r.picked = true;
  // The same place usually goes in the same category: fill in the others not picked by hand.
  let more = 0;
  for (const o of rows) {
    if (o !== r && !o.picked && o.kind === r.kind && norm(o.description) === norm(r.description) && o.categoryId !== r.categoryId) { o.categoryId = r.categoryId; more += 1; }
  }
  if (more) toast(`Also set ${more} more from ${r.description}`);
  drawImport();
};

actions['import-skipped'] = () => { A.sheet.showSkipped = !A.sheet.showSkipped; drawImport(); };

actions['import-save'] = () => {
  const S = A.sheet, b = budget();
  const adding = S.rows.filter(r => r.include);
  const missing = adding.findIndex(r => r.kind !== 'income' && !b.categories[r.categoryId]);
  if (missing >= 0) {
    toast('Pick a category for each one, or untick it.');
    document.querySelector('.import-list select.needs')?.scrollIntoView({ block: 'center' });
    return;
  }
  const list = adding.map(r => ({ id: r.key, kind: r.kind, amount: r.amount, date: r.date, description: r.description, categoryId: r.kind === 'income' ? null : r.categoryId }));
  const ids = list.map(t => t.id);
  if (S.accountId) remember(S.format, S.accountId);
  send(A.repo.importTransactions(b.id, list, S.deleted, { file: S.fileName, accountId: S.accountId || null }));
  closeSheet();
  // The last step of an import: check the budget still matches the accounts.
  openAccounts(b.id, { afterImport: list.length });
  toast(`Added ${list.length}`, () => send(A.repo.unimport(b.id, ids)));
};

changes['import-account'] = el => {
  if (el.value === NEW) { A.sheet.addingAccount = true; A.sheet.accKind = A.sheet.format === 'chase-card' ? 'card' : 'cash'; drawImport(); document.getElementById('impAccName')?.focus(); return; }
  A.sheet.accountId = el.value;
};
actions['imp-acc-kind'] = el => { const n = val('impAccName'); A.sheet.accKind = el.dataset.id; drawImport(); const i = document.getElementById('impAccName'); if (i) i.value = n; };
actions['imp-acc-cancel'] = () => { A.sheet.addingAccount = false; drawImport(); };
actions['imp-acc-add'] = () => {
  const b = budget(), name = val('impAccName').trim().slice(0, 40);
  if (!name) { toast('Name the account first.'); return; }
  const accId = randomId(10);
  // No balance yet: the accounts check asks for it rather than counting it as $0.
  send(A.repo.saveAccount(b.id, accId, { name, kind: A.sheet.accKind === 'card' ? 'card' : 'cash', balance: null }));
  Object.assign(A.sheet, { addingAccount: false, accountId: accId });
  toast(`Added ${name}`);
  drawImport();
};
actions['import-undo'] = el => {
  const b = budget(), rec = A.sheet.past?.find(p => p.id === el.dataset.id);
  if (!rec) return;
  rec.undone = true;
  send(A.repo.undoImport(b.id, rec));
  toast(`Took out ${rec.count} from ${rec.file || 'that file'}`);
  drawImport();
};
actions['import-redo'] = el => {
  const b = budget(), rec = A.sheet.past?.find(p => p.id === el.dataset.id);
  if (!rec) return;
  rec.undone = false;
  send(A.repo.redoImport(b.id, rec));
  toast(`Brought back ${rec.count}`);
  drawImport();
};
actions['open-import'] = () => openImport(A.route.id);
registerSheet('import', drawImport);
