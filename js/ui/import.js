/**
 * Bringing in a bank's CSV download. Pick the file, check each row's category (one choice fills
 * in the rest from the same place), untick anything to leave out, then add them all at once.
 * The file is read on this device; only the transactions are saved, like typing them in.
 */
import { A, actions, changes, inputs, render } from './state.js';
import { openSearch } from './search.js';
import { LIMITS } from '../config/app.js';
import { groupedCategories, budgetStart } from '../core/budget.js';
import { esc, openSheet, closeSheet, sheetHead, toast, send, fmtDate, openChild, registerSheet, val } from './dom.js';
import { readStatement, markExisting, guessCategory, SKIP, importName } from '../core/import.js';
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
  openChild({ kind: 'import', budgetId, step: 'pick', rows: [], error: '', open: {}, past: null }, drawImport);
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

/** The dates an import covers, from its rows (taken-out ones too). */
function covers(b, rec) {
  const ids = new Set(rec.ids), dates = (A.transactions[b.id] || []).filter(t => ids.has(t.id)).map(t => t.date).sort();
  return dates.length ? (dates[0] === dates.at(-1) ? fmtDate(dates[0]) : `${fmtDate(dates[0])} – ${fmtDate(dates.at(-1))}`) : '';
}

const SHOWN_PER_ACCOUNT = 3;

/**
 * Past imports, one group per account, newest first. Each group shows its newest few, with the
 * rest folded away. Manage on a row offers Rename, Undo (or Bring back) and Delete.
 */
function pastList(b) {
  const S = A.sheet, past = S.past;
  if (!past?.length) return '';
  const groups = new Map();
  for (const p of past) {
    const key = b.accounts?.[p.accountId] ? p.accountId : '';
    (groups.get(key) || groups.set(key, []).get(key)).push(p);
  }
  const order = [...groups.keys()].sort((x, y) => (x === '') - (y === '') || (b.accounts[x]?.name || '').localeCompare(b.accounts[y]?.name || ''));
  const item = p => {
    const span = covers(b, p);
    const meta = `<span class="tiny muted">${span ? `${span} · ` : ''}${p.count} ${p.count === 1 ? 'row' : 'rows'} · added ${fmtDate(new Date(p.at).toISOString().slice(0, 10))}${p.undone ? ' · <strong>Taken out</strong>' : ''}</span>`;
    if (S.renaming === p.id) {
      return `<div class="tx-row past-row"><span class="grow stack tight">
        <input id="impRename" maxlength="80" value="${esc(p.file || '')}" aria-label="Name of this import" autocomplete="off">${meta}
        <span class="row gap8"><button type="button" class="btn small primary" data-action="import-rename-save" data-id="${esc(p.id)}">Save</button><button type="button" class="btn small" data-action="import-rename-cancel">Cancel</button></span>
      </span></div>`;
    }
    const managing = S.managing === p.id, deleting = S.deleting === p.id;
    return `<div class="tx-row past-row stack tight ${p.undone ? 'off' : ''}">
      <span class="row between gap8"><span class="grow stack tight"><button type="button" class="link wrap-any imp-name" data-action="import-open" data-id="${esc(p.id)}">${esc(p.file || 'Bank file')} ›</button>${meta}</span>
      <button type="button" class="btn small" data-action="import-manage" data-id="${esc(p.id)}" aria-expanded="${managing}">${managing ? 'Done' : 'Manage'}</button></span>
      ${managing && !deleting ? `<span class="row gap8 wrap past-acts">
        <button type="button" class="btn small" data-action="import-rename" data-id="${esc(p.id)}">Rename</button>
        <button type="button" class="btn small" data-action="${p.undone ? 'import-redo' : 'import-undo'}" data-id="${esc(p.id)}">${p.undone ? 'Bring back' : 'Take out'}</button>
        <button type="button" class="btn small danger" data-action="import-delete" data-id="${esc(p.id)}">Delete</button></span>` : ''}
      ${deleting ? `<span class="stack tight past-delete"><span class="small">Delete “${esc(p.file || 'Bank file')}”?</span>
        ${p.undone ? '' : `<button type="button" class="btn small danger" data-action="import-delete-yes" data-id="${esc(p.id)}">Delete it and take out its ${p.count} ${p.count === 1 ? 'row' : 'rows'}</button>`}
        <button type="button" class="btn small" data-action="import-delete-keep" data-id="${esc(p.id)}">${p.undone ? 'Remove it from this list' : 'Keep the rows, just remove it from this list'}</button>
        <button type="button" class="btn small" data-action="import-delete-no">Cancel</button></span>` : ''}
    </div>`;
  };
  const takenOut = past.filter(p => p.undone).length;
  return `<section class="stack tight past-imports"><div class="row between"><h3 class="date-head">Past imports · ${past.length}</h3>${takenOut ? `<button type="button" class="link small" data-action="import-clear-out">Clear ${takenOut} taken out</button>` : ''}</div>
    ${order.map(key => {
      const list = groups.get(key), open = S.olderOpen?.[key], shown = open ? list : list.slice(0, SHOWN_PER_ACCOUNT);
      return `<div class="stack tight past-group"><span class="small label">${esc(key ? b.accounts[key].name : 'No account')} · ${list.length}</span>
        <div class="panel tx-list">${shown.map(item).join('')}</div>
        ${list.length > SHOWN_PER_ACCOUNT ? `<button type="button" class="link small" data-action="import-older" data-id="${esc(key)}">${open ? 'Show fewer' : `Show ${list.length - SHOWN_PER_ACCOUNT} older`}</button>` : ''}</div>`;
    }).join('')}
    <p class="tiny muted">Tap a name to see what came in with it. Take out removes its rows (Bring back returns them); Delete also removes it from this list.</p></section>`;
}

/**
 * Rows from this file that are already in the budget without an account (imported before imports
 * knew their account, or typed in by hand): saving tags them with the account picked above.
 */
export function untagged(b, rows, accountId, existing) {
  if (!accountId || !b.accounts?.[accountId]) return [];
  const byId = new Map((existing || []).filter(t => !t.deleted).map(t => [t.id, t]));
  const ids = new Set();
  for (const r of rows) {
    const t = byId.get(r.skip === 'imported' ? r.key : r.skip === 'already' ? r.twin : null);
    if (t && !t.accountId) ids.add(t.id);
  }
  return [...ids];
}

const nameFor = (S, b) => (S.nameTyped ? S.name : importName(b.accounts?.[S.accountId]?.name, S.fileName, S.rows.map(r => r.date)));
inputs['import-name'] = el => { A.sheet.name = el.value; A.sheet.nameTyped = true; };

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
  const rows = S.rows.map((r, i) => [r, i]);
  // Three plain sections: new rows to add, rows already in the budget, and rows left out on purpose.
  const fresh = rows.filter(([r]) => !r.skip);
  const already = rows.filter(([r]) => r.skip === 'imported' || r.skip === 'already');
  const out = rows.filter(([r]) => r.skip && r.skip !== 'imported' && r.skip !== 'already');
  const adding = S.rows.filter(r => r.include);
  const needCat = adding.filter(r => r.kind !== 'income' && !b.categories[r.categoryId]).length;
  const dates = S.rows.map(r => r.date).sort();
  const start = budgetStart(b);
  const history = start ? adding.filter(r => r.date < start).length : 0;
  const txs = A.transactions[b.id];
  const accName = b.accounts?.[S.accountId]?.name || '';
  const retag = untagged(b, S.rows, S.accountId, txs);
  const anyAccount = Object.keys(b.accounts || {})[0];
  const couldTag = !S.accountId && anyAccount ? untagged(b, S.rows, anyAccount, txs).length : 0;
  const allTicked = fresh.length && fresh.every(([r]) => r.include);
  const label = adding.length && retag.length ? `Add ${adding.length} and mark ${retag.length} as ${accName}`
    : adding.length ? `Add ${adding.length}` : retag.length ? `Mark ${retag.length} as ${accName}` : fresh.length ? 'Nothing ticked' : 'Nothing new. Close';
  const alreadyNote = !already.length ? ''
    : retag.length ? `${retag.length === already.length ? 'They' : `${retag.length} of them`} will be marked as ${esc(accName)}.`
    : couldTag ? `Pick the account above to mark ${couldTag === 1 ? 'it' : 'these'}.`
    : S.accountId ? `Already marked.` : '';
  const section = (key, title, note, list) => `<section class="imp-section stack tight">
      <button type="button" class="imp-head row between" data-action="import-section" data-id="${key}" aria-expanded="${Boolean(S.open?.[key])}"><span class="stack tight"><strong>${title}</strong>${note ? `<span class="tiny muted">${note}</span>` : ''}</span><span class="muted" aria-hidden="true">${S.open?.[key] ? '▾' : '▸'}</span></button>
      ${S.open?.[key] ? `<div class="panel import-list">${list.map(([r, i]) => row(b, r, i)).join('')}</div>` : ''}
    </section>`;
  openSheet(`<div class="sheet">${sheetHead('Check and add')}<div class="sheet-body">
    <p class="small muted">${esc(S.fileName)} · ${fmtDate(dates[0])} to ${fmtDate(dates.at(-1))}</p>
    <label class="form-row bordered"><span class="form-row-label">From</span><select data-change="import-account" aria-label="Which account this file is from">
      <option value="" ${S.accountId ? '' : 'selected'}>Not one of my accounts</option>
      ${Object.entries(b.accounts || {}).map(([id, a]) => `<option value="${id}" ${S.accountId === id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
      <option value="${NEW}">+ Add an account…</option></select></label>
    ${fresh.length ? '' : '<!--'}<label class="form-row bordered"><span class="form-row-label">Name</span><input id="impName" maxlength="80" value="${esc(nameFor(S, b))}" data-input="import-name" aria-label="Name for this import" autocomplete="off"></label>${fresh.length ? '' : '-->'}
    ${S.addingAccount ? `<div class="panel pad stack tight"><input id="impAccName" maxlength="40" placeholder="Name, like Chase card" autocomplete="off"><div class="seg" role="group" aria-label="Kind of account"><button type="button" data-action="imp-acc-kind" data-id="cash" aria-pressed="${S.accKind !== 'card'}">Bank or cash</button><button type="button" data-action="imp-acc-kind" data-id="card" aria-pressed="${S.accKind === 'card'}">Credit card</button></div><div class="row gap8"><button type="button" class="btn small primary" data-action="imp-acc-add">Add</button><button type="button" class="btn small" data-action="imp-acc-cancel">Cancel</button></div><p class="tiny muted">Its balance can go in later, in Check your accounts.</p></div>` : ''}
    <section class="stack tight">
      <div class="row between"><h3 class="date-head">${fresh.length ? `New · ${fresh.length}` : 'Nothing new in this file'}</h3>${fresh.length > 1 ? `<label class="row gap8 small tick-all"><input type="checkbox" data-change="import-tick-all" ${allTicked ? 'checked' : ''}>${allTicked ? 'Untick all' : 'Tick all'}</label>` : ''}</div>
      ${fresh.length ? `${needCat ? `<p class="small owe">${needCat} still need${needCat === 1 ? 's' : ''} a category.</p>` : '<p class="tiny muted">Categories are guessed from what you picked before. Changing one changes the rest from the same place.</p>'}
      ${history ? `<p class="notice">${history} ${history === 1 ? 'is' : 'are'} from before your budget started (${fmtDate(start)}). ${history === 1 ? 'It’s' : 'They’re'} kept as history for Trends and search, and won’t change your money.</p>` : ''}
      <div class="panel import-list">${fresh.map(([r, i]) => row(b, r, i)).join('')}</div>` : ''}
    </section>
    ${already.length ? section('in', `Already in your budget · ${already.length}`, alreadyNote, already) : ''}
    ${out.length ? section('out', `Left out · ${out.length}`, 'Card payments and moving money between your accounts. Tick one only if it’s really spending.', out) : ''}
  </div><div class="sheet-foot"><button type="button" class="btn primary" data-action="import-save" ${!adding.length && !retag.length && fresh.length ? 'disabled' : ''}>${esc(label)}</button></div></div>`);
}

function row(b, r, i) {
  const sign = r.kind === 'spend' ? '−' : '+';
  const where = r.kind === 'income'
    ? '<span class="tiny muted">Income · Ready to assign</span>'
    : A.sheet.making === i ? newCatForm(b, r, i)
    : `<select aria-label="Category for ${esc(r.description)}" data-change="import-cat" data-id="${i}" class="${r.include && !b.categories[r.categoryId] ? 'needs' : ''}">${catOptions(b, b.categories[r.categoryId] ? r.categoryId : '')}<option value="${NEW}">+ New category…</option></select>`;
  return `<div class="import-row ${r.include ? '' : 'off'}">
    ${r.skip === 'imported' ? '<span class="imp-gap" aria-hidden="true"></span>' : `<input type="checkbox" aria-label="Add ${esc(r.description)}" ${r.include ? 'checked' : ''} data-change="import-tick" data-id="${i}">`}
    <div class="grow stack tight">
      <div class="row between gap8"><strong class="wrap-any two-lines">${esc(r.description)}</strong><span class="amt ${r.kind === 'spend' ? 'owe' : 'owed'}">${sign}${money(r.amount)}</span></div>
      <span class="tiny muted">${fmtDate(r.date)}${r.kind === 'refund' ? ' · Refund' : ''}</span>
      ${r.skip && r.skip !== 'imported' ? `<span class="tiny muted">${esc(SKIP[r.skip])}</span>` : ''}
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

// Ticks (or unticks) every new row. Rows already in, or left out on purpose, are never touched.
changes['import-tick-all'] = el => {
  for (const r of A.sheet.rows) if (!r.skip) r.include = el.checked;
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

actions['import-section'] = el => { const S = A.sheet; S.open = { ...S.open, [el.dataset.id]: !S.open?.[el.dataset.id] }; drawImport(); };

actions['import-save'] = () => {
  const S = A.sheet, b = budget();
  const adding = S.rows.filter(r => r.include);
  const missing = adding.findIndex(r => r.kind !== 'income' && !b.categories[r.categoryId]);
  if (missing >= 0) {
    toast('Pick a category for each one, or untick it.');
    document.querySelector('.import-list select.needs')?.scrollIntoView({ block: 'center' });
    return;
  }
  const retag = untagged(b, S.rows, S.accountId, A.transactions[b.id]);
  if (!adding.length) {
    if (!retag.length) { closeSheet(); return; }
    remember(S.format, S.accountId);
    send(A.repo.tagAccount(b.id, retag, S.accountId));
    closeSheet();
    toast(`Marked ${retag.length} as ${b.accounts[S.accountId].name}`, () => send(A.repo.tagAccount(b.id, retag, null)));
    return;
  }
  if (retag.length) send(A.repo.tagAccount(b.id, retag, S.accountId));
  const list = adding.map(r => ({ id: r.key, kind: r.kind, amount: r.amount, date: r.date, description: r.description, categoryId: r.kind === 'income' ? null : r.categoryId }));
  const ids = list.map(t => t.id);
  if (S.accountId) remember(S.format, S.accountId);
  if (A.importNames) delete A.importNames[b.id];
  send(A.repo.importTransactions(b.id, list, S.deleted, { file: nameFor(S, b).trim() || S.fileName, accountId: S.accountId || null }));
  closeSheet();
  // The last step of an import: check the budget still matches the accounts.
  openAccounts(b.id, { afterImport: list.length });
  toast(`Added ${list.length}${retag.length ? `, marked ${retag.length} as ${b.accounts[S.accountId].name}` : ''}`, () => { send(A.repo.unimport(b.id, ids)); if (retag.length) send(A.repo.tagAccount(b.id, retag, null)); });
};

changes['import-account'] = el => {
  if (el.value === NEW) { A.sheet.addingAccount = true; A.sheet.accKind = A.sheet.format === 'chase-card' ? 'card' : 'cash'; drawImport(); document.getElementById('impAccName')?.focus(); return; }
  A.sheet.accountId = el.value;
  drawImport();
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
  toast(`Took out ${rec.count} from ${rec.file || 'that file'}`, () => { rec.undone = false; send(A.repo.redoImport(b.id, rec)); if (A.sheet?.kind === 'import') drawImport(); });
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
actions['import-manage'] = el => { const S = A.sheet; S.managing = S.managing === el.dataset.id ? null : el.dataset.id; S.deleting = null; drawImport(); };
actions['import-older'] = el => { const S = A.sheet; S.olderOpen = { ...S.olderOpen, [el.dataset.id]: !S.olderOpen?.[el.dataset.id] }; drawImport(); };
actions['import-delete'] = el => { A.sheet.deleting = el.dataset.id; drawImport(); };
actions['import-delete-no'] = () => { A.sheet.deleting = null; drawImport(); };
function deleteImport(id, keepRows) {
  const S = A.sheet, b = budget(), rec = S.past?.find(p => p.id === id);
  if (!rec) return;
  S.past = S.past.filter(p => p !== rec);
  S.deleting = S.managing = null;
  if (A.importNames) delete A.importNames[b.id];
  send(A.repo.deleteImport(b.id, rec, { keepRows }));
  toast(keepRows || rec.undone ? `Removed ${rec.file || 'it'} from the list` : `Deleted ${rec.file || 'it'} and took out ${rec.count}`, () => {
    send(A.repo.restoreImport(b.id, rec, { keepRows }));
    if (A.sheet?.kind === 'import' && A.sheet.past) { A.sheet.past = [...A.sheet.past, rec].sort((x, y) => y.at - x.at); drawImport(); }
    if (A.importNames) delete A.importNames[b.id];
  });
  drawImport();
}
actions['import-delete-yes'] = el => deleteImport(el.dataset.id, false);
actions['import-delete-keep'] = el => deleteImport(el.dataset.id, A.sheet.past?.find(p => p.id === el.dataset.id)?.undone ? false : true);
// Taken-out imports have no rows in the budget, so clearing them just tidies the list.
actions['import-clear-out'] = () => {
  const S = A.sheet, b = budget(), gone = (S.past || []).filter(p => p.undone);
  if (!gone.length) return;
  S.past = S.past.filter(p => !p.undone);
  for (const rec of gone) send(A.repo.deleteImport(b.id, rec));
  toast(`Cleared ${gone.length} from the list`, () => {
    for (const rec of gone) send(A.repo.restoreImport(b.id, rec));
    if (A.sheet?.kind === 'import' && A.sheet.past) { A.sheet.past = [...A.sheet.past, ...gone].sort((x, y) => y.at - x.at); drawImport(); }
  });
  drawImport();
};
actions['import-rename'] = el => { A.sheet.renaming = el.dataset.id; A.sheet.managing = null; drawImport(); const i = document.getElementById('impRename'); i?.focus(); i?.select(); };
actions['import-rename-cancel'] = () => { A.sheet.renaming = null; drawImport(); };
actions['import-rename-save'] = el => {
  const b = budget(), rec = A.sheet.past?.find(p => p.id === el.dataset.id), name = val('impRename').trim().slice(0, 80);
  A.sheet.renaming = null;
  if (rec && name && name !== rec.file) { rec.file = name; if (A.importNames?.[b.id]) A.importNames[b.id][rec.id] = name; render(); send(A.repo.renameImport(b.id, rec.id, name)); toast('Renamed'); }
  drawImport();
};
// Enter saves the new name, Escape leaves it as it was.
addEventListener('keydown', ev => {
  if (ev.target?.id !== 'impRename') return;
  if (ev.key === 'Enter') { ev.preventDefault(); document.querySelector('[data-action=import-rename-save]')?.click(); }
  else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); actions['import-rename-cancel'](); }
}, true);
// Everything that came in with one import, in Search (Back returns here).
actions['import-open'] = el => {
  const b = budget(), rec = A.sheet.past?.find(p => p.id === el.dataset.id);
  if (rec) openSearch(b.id, { importId: rec.id, importName: rec.file || 'Bank file' });
};
actions['open-import'] = () => openImport(A.route.id);
registerSheet('import', drawImport);
