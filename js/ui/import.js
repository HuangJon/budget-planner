/**
 * Bringing in a bank's CSV download. Pick the file, check each row's category (one choice fills
 * in the rest from the same place), untick anything to leave out, then add them all at once.
 * The file is read on this device; only the transactions are saved, like typing them in.
 */
import { A, actions, changes, inputs } from './state.js';
import { openImports, importsChanged, findImport } from './imports.js';
import { LIMITS } from '../config/app.js';
import { groupedCategories, budgetStart } from '../core/budget.js';
import { esc, openSheet, closeSheet, sheetHead, toast, send, fmtDate, openChild, registerSheet, val, refreshOpenSheet } from './dom.js';
import { readStatement, markExisting, guessCategory, SKIP, importName } from '../core/import.js';
import { money } from '../core/money.js';
import { catOptions } from './tx-form.js';
import { randomId } from '../core/ids.js';

const MAX_ROWS = 1000;
/** The budget, plus any categories made here that the database hasn't sent back yet. */
const budget = () => {
  const b = A.budgets[A.sheet?.budgetId];
  return b && A.sheet?.newCats ? { ...b, categories: { ...A.sheet.newCats, ...b.categories } } : b;
};
const NEW = '__new';
const norm = s => String(s || '').trim().toLowerCase();

/** "Import from your bank" opens the Imports page; choosing a file there leads here to check it. */
export function openImport(budgetId) { openImports(budgetId); }
const remembered = key => { try { return localStorage.getItem(`wmm:importAccount:${key}`) || ''; } catch { return ''; } };
const remember = (key, id) => { try { localStorage.setItem(`wmm:importAccount:${key}`, id); } catch { /* fine */ } };

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

/** The transactions already in the budget that this file's rows match. */
function alreadyIn(rows, existing) {
  const byId = new Map((existing || []).filter(t => !t.deleted).map(t => [t.id, t]));
  return rows.map(r => byId.get(r.skip === 'imported' ? r.key : r.skip === 'already' ? r.twin : null)).filter(Boolean);
}

const nameFor = (S, b) => (S.nameTyped ? S.name : importName(b.accounts?.[S.accountId]?.name, S.fileName, S.rows.map(r => r.date)));
inputs['import-name'] = el => { A.sheet.name = el.value; A.sheet.nameTyped = true; };

function drawImport() {
  const S = A.sheet, b = budget();
  if (!b) { closeSheet(); return; }
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
  // Rows already in that belong to no import (from before imports were kept) join this one.
  const inTx = alreadyIn(S.rows, txs);
  const adopt = [...new Set(inTx.filter(t => !t.importId).map(t => t.id))];
  const owners = [...new Set(inTx.map(t => t.importId).filter(Boolean))].map(id => findImport(b.id, id)).filter(Boolean);
  const making = adding.length || adopt.length;
  const label = adding.length ? `Add ${adding.length}` : adopt.length ? `File ${adopt.length} under this import` : retag.length ? `Mark ${retag.length} as ${accName}` : fresh.length ? 'Nothing ticked' : 'Nothing new. Close';
  const alreadyNote = !already.length ? '' : [
    owners.length ? `From ${owners.map(r => `“${esc(r.file || 'Bank file')}”`).join(', ')}.` : '',
    adopt.length ? `${adopt.length === already.length ? 'They' : `${adopt.length} of them`} will be filed under this import.` : '',
    retag.length ? `${retag.length === already.length ? 'They' : `${retag.length} of them`} will be marked as ${esc(accName)}.`
      : couldTag ? `Pick the account above to mark ${couldTag === 1 ? 'it' : 'these'}.` : '',
  ].filter(Boolean).join(' ');
  const section = (key, title, note, list) => `<section class="imp-section stack tight">
      <button type="button" class="imp-head row between" data-action="import-section" data-id="${key}" aria-expanded="${Boolean(S.open?.[key])}"><span class="stack tight"><strong>${title}</strong>${note ? `<span class="tiny muted">${note}</span>` : ''}</span><span class="muted" aria-hidden="true">${S.open?.[key] ? '▾' : '▸'}</span></button>
      ${S.open?.[key] ? `<div class="panel import-list">${list.map(([r, i]) => row(b, r, i)).join('')}</div>` : ''}
    </section>`;
  openSheet(`<div class="sheet">${sheetHead('Check and add')}<div class="sheet-body">
    <p class="small muted">${S.total > 1 ? `<strong>File ${S.pos} of ${S.total}</strong> · ` : ''}${esc(S.fileName)} · ${fmtDate(dates[0])} to ${fmtDate(dates.at(-1))}</p>
    <label class="form-row bordered"><span class="form-row-label">From</span><select data-change="import-account" aria-label="Which account this file is from">
      <option value="" ${S.accountId ? '' : 'selected'}>Not one of my accounts</option>
      ${Object.entries(b.accounts || {}).map(([id, a]) => `<option value="${id}" ${S.accountId === id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
      <option value="${NEW}">+ Add an account…</option></select></label>
    ${S.why && S.accountId ? `<p class="tiny muted why">Picked ${esc(accName)} because ${esc(S.why)}.</p>` : ''}
    ${fresh.length || adopt.length ? `<label class="form-row bordered"><span class="form-row-label">Name</span><input id="impName" maxlength="80" value="${esc(nameFor(S, b))}" data-input="import-name" aria-label="Name for this import" autocomplete="off"></label>` : ''}
    ${!fresh.length && !adopt.length && owners.length ? `<div class="notice stack tight"><span>Everything in this file is already in, from ${owners.length === 1 ? 'this import' : 'these imports'}:</span>${owners.map(r => `<button type="button" class="btn small" data-action="import-view" data-id="${esc(r.id)}">Open “${esc(r.file || 'Bank file')}”</button>`).join('')}</div>` : ''}
    ${S.addingAccount ? `<div class="panel pad stack tight"><input id="impAccName" maxlength="40" placeholder="Name, like Chase card" autocomplete="off"><div class="seg" role="group" aria-label="Kind of account"><button type="button" data-action="imp-acc-kind" data-id="cash" aria-pressed="${S.accKind !== 'card'}">Bank or cash</button><button type="button" data-action="imp-acc-kind" data-id="card" aria-pressed="${S.accKind === 'card'}">Credit card</button></div><div class="row gap8"><button type="button" class="btn small primary" data-action="imp-acc-add">Add</button><button type="button" class="btn small" data-action="imp-acc-cancel">Cancel</button></div><p class="tiny muted">Its balance can go in later, in Check your accounts.</p></div>` : ''}
    <section class="stack tight">
      <div class="row between"><h3 class="date-head">${fresh.length ? `New · ${fresh.length}` : 'Nothing new in this file'}</h3>${fresh.length > 1 ? `<label class="row gap8 small tick-all"><input type="checkbox" data-change="import-tick-all" ${allTicked ? 'checked' : ''}>${allTicked ? 'Untick all' : 'Tick all'}</label>` : ''}</div>
      ${fresh.length ? `${needCat ? `<p class="small owe">${needCat} still need${needCat === 1 ? 's' : ''} a category.</p>` : '<p class="tiny muted">Categories are guessed from what you picked before. Changing one changes the rest from the same place.</p>'}
      ${history ? `<p class="notice">${history} ${history === 1 ? 'is' : 'are'} from before your budget started (${fmtDate(start)}). ${history === 1 ? 'It’s' : 'They’re'} kept as history for Trends and search, and won’t change your money.</p>` : ''}
      <div class="panel import-list">${fresh.map(([r, i]) => row(b, r, i)).join('')}</div>` : ''}
    </section>
    ${already.length ? section('in', `Already in your budget · ${already.length}`, alreadyNote, already) : ''}
    ${out.length ? section('out', `Left out · ${out.length}`, 'Card payments and moving money between your accounts. Tick one only if it’s really spending.', out) : ''}
  </div><div class="sheet-foot row gap8">${S.total > 1 ? '<button type="button" class="btn" data-action="import-skip">Skip</button>' : ''}<button type="button" class="btn primary grow" data-action="import-save" ${!making && !retag.length && fresh.length ? 'disabled' : ''}>${esc(label)}</button></div></div>`);
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

/** Reads one bank file into rows, or says why it can't be read. */
async function readFile(file) {
  try {
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') throw Object.assign(new Error('it’s a PDF. Download the CSV (spreadsheet) version instead.'), { code: 'pdf' });
    if (file.size > 2e6) throw new Error('it’s too big. Pick a shorter date range.');
    const { format, rows } = readStatement(await file.text());
    if (!rows.length) throw new Error('no transactions were found in it.');
    if (rows.length > MAX_ROWS) throw new Error(`it has ${rows.length} rows. Pick a shorter date range (up to ${MAX_ROWS}).`);
    return { fileName: file.name, format, rows };
  } catch (e) {
    return { fileName: file.name, error: e.code === 'unknown-format' || e.code === 'pdf' || !e.code ? e.message : 'it couldn’t be read.' };
  }
}

/** The last group of 4 digits in a file name, like 1234 in "Chase1234_Activity.CSV": often the card. */
const digitsIn = name => (String(name).match(/(\d{4})(?!.*\d{4})/) || [])[1] || '';

/**
 * Which account a file is from, and why: the account of earlier imports its rows overlap, else the
 * one used before for files named with the same digits, else for files from the same bank layout.
 */
export function guessAccount(b, file, rows, txs, pick = '') {
  const ok = id => id && b.accounts?.[id];
  if (ok(pick)) return { accountId: pick, why: '' };
  const counts = new Map();
  for (const t of alreadyIn(rows, txs)) if (ok(t.accountId)) counts.set(t.accountId, (counts.get(t.accountId) || 0) + 1);
  const top = [...counts].sort((x, y) => y[1] - x[1])[0];
  if (top) return { accountId: top[0], why: 'its rows overlap earlier imports from it' };
  const d = digitsIn(file.fileName);
  if (d && ok(remembered(`${file.format}:${d}`))) return { accountId: remembered(`${file.format}:${d}`), why: `files named with ${d} came from it before` };
  if (!d && ok(remembered(file.format))) return { accountId: remembered(file.format), why: 'files like this came from it before' };
  return { accountId: '', why: '' };
}

/** Opens the next file waiting to be checked, on top of the Imports page. */
function nextFile(hub) {
  const b = A.budgets[hub.budgetId], file = hub.queue?.shift();
  if (!file || !b) { refreshOpenSheet(); return; }
  const existing = A.transactions[b.id] || [];
  const past = existing.filter(t => !t.deleted);
  const S = { kind: 'import', budgetId: b.id, step: 'review', open: {}, error: '', fileName: file.fileName, format: file.format, pos: hub.total - hub.queue.length, total: hub.total };
  S.deleted = new Set(existing.filter(t => t.deleted).map(t => t.id));
  S.rows = markExisting(file.rows, existing).map(r => ({ ...r, include: !r.skip, categoryId: guessCategory(r, b.categories, past) || '' }));
  const g = guessAccount(b, file, S.rows, existing, hub.total === 1 ? hub.forAccount : '');
  S.accountId = g.accountId;
  S.why = g.why;
  openChild(S, drawImport);
}

// Picking one or more files on the Imports page: each is checked in turn.
changes['import-file'] = async el => {
  const hub = A.sheet, b = A.budgets[hub?.budgetId];
  const files = [...(el.files || [])];
  if (!files.length || !b) return;
  const read = await Promise.all(files.map(readFile));
  el.value = '';
  const bad = read.filter(f => f.error);
  hub.error = bad.map(f => (files.length === 1 ? `That file couldn’t be used: ${f.error}` : `${f.fileName} couldn’t be used: ${f.error}`)).join(' ');
  hub.queue = read.filter(f => !f.error).sort((x, y) => (x.rows[0]?.date || '').localeCompare(y.rows[0]?.date || ''));
  hub.total = hub.queue.length;
  hub.summary = { added: 0, filed: 0, files: 0, skipped: 0 };
  if (!hub.queue.length) { refreshOpenSheet(); return; }
  nextFile(hub);
};
/** After a file is saved or skipped: back to the Imports page, then on to the next file. */
function fileDone(kind, n = 0) {
  actions['sheet-back']();
  const hub = A.sheet;
  if (hub?.kind !== 'imports') return;
  if (hub.summary) {
    if (kind === 'skip') hub.summary.skipped += 1;
    else { hub.summary.files += 1; hub.summary[kind] += n; }
  }
  if (hub.queue?.length) nextFile(hub);
  else refreshOpenSheet();
}
actions['import-skip'] = () => fileDone('skip');

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
  const txs = A.transactions[b.id];
  const retag = untagged(b, S.rows, S.accountId, txs);
  const adopt = [...new Set(alreadyIn(S.rows, txs).filter(t => !t.importId).map(t => t.id))];
  const accName = b.accounts?.[S.accountId]?.name;
  if (S.accountId) {
    // Remembered for next time: by the digits in the file name when it has some, else by layout.
    const d = digitsIn(S.fileName);
    remember(d ? `${S.format}:${d}` : S.format, S.accountId);
  }
  // Imports this file's rows already belong to, with no account yet, take the one picked here.
  if (S.accountId) {
    for (const id of new Set(alreadyIn(S.rows, txs).map(t => t.importId).filter(Boolean))) {
      const rec = findImport(b.id, id);
      if (rec && !rec.accountId) send(A.repo.markImportAccount(b.id, id, S.accountId).then(() => importsChanged(b.id)));
    }
  }
  if (!adding.length && !adopt.length) {
    if (retag.length) {
      send(A.repo.tagAccount(b.id, retag, S.accountId));
      toast(`Marked ${retag.length} as ${accName}`, () => send(A.repo.tagAccount(b.id, retag, null)));
    }
    fileDone('skip');
    return;
  }
  const list = adding.map(r => ({ id: r.key, kind: r.kind, amount: r.amount, date: r.date, description: r.description, categoryId: r.kind === 'income' ? null : r.categoryId }));
  const ids = list.map(t => t.id), dates = S.rows.map(r => r.date).sort();
  // Rows already in get the file's account too (adopted ones get it as they join).
  const mark = retag.filter(id => !adopt.includes(id));
  if (mark.length) send(A.repo.tagAccount(b.id, mark, S.accountId));
  const importId = randomId(16);
  const seen = S.rows.filter(r => r.skip === 'imported' || r.skip === 'already').length - adopt.length;
  send(A.repo.importTransactions(b.id, list, S.deleted, { file: nameFor(S, b).trim() || S.fileName, accountId: S.accountId || null, importId, adopt, from: dates[0], to: dates.at(-1), seen: Math.max(0, seen) }).then(() => importsChanged(b.id)));
  const undo = () => {
    send(A.repo.unimport(b.id, ids));
    if (adopt.length) send(A.repo.relinkImport(b.id, adopt, null));
    if (mark.length) send(A.repo.tagAccount(b.id, mark, null));
    send(A.repo.deleteImport(b.id, { id: importId, ids: [], undone: true }).then(() => importsChanged(b.id)));
  };
  toast(list.length ? `Added ${list.length}${adopt.length ? `, filed ${adopt.length} more` : ''}` : `Filed ${adopt.length} under “${nameFor(S, b)}”`, undo);
  fileDone(list.length ? 'added' : 'filed', list.length || adopt.length);
};

changes['import-account'] = el => {
  if (el.value === NEW) { A.sheet.addingAccount = true; A.sheet.accKind = A.sheet.format === 'chase-card' ? 'card' : 'cash'; drawImport(); document.getElementById('impAccName')?.focus(); return; }
  A.sheet.accountId = el.value;
  A.sheet.why = '';
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
  Object.assign(A.sheet, { addingAccount: false, accountId: accId, why: '' });
  toast(`Added ${name}`);
  drawImport();
};
actions['open-import'] = () => openImports(A.route.id);
registerSheet('import', drawImport);
