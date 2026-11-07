/**
 * Editing categories. Groups fold open and closed; each category is one line, and Edit opens it
 * in place to rename, regroup or hide. Hiding keeps history; nothing is deleted.
 * Also reachable from the budget page: "+ Add category" under each group, and from a category's sheet.
 */
import { A, actions, changes, render } from './state.js';
import { esc, svg, openSheet, sheetHead, toast, send, val, openChild, registerSheet } from './dom.js';
import { groupedCategories } from '../core/budget.js';
import { LIMITS } from '../config/app.js';

const UP = '<path d="M6 15l6-6 6 6"/>', DOWN = '<path d="M6 9l6 6 6-6"/>', CHEV = '<path d="M9 6l6 6-6 6"/>';

/** Opens the editor; `focus` can open one group, start adding to it, or open one category. */
export function openCatEditor({ group = null, adding = null, editing = null } = {}) {
  const b = A.budgets[A.route.id];
  const open = {};
  if (group) open[group] = true;
  if (editing && b.categories[editing]) open[b.categories[editing].group || 'Other'] = true;
  if (adding) open[adding] = true;
  openChild({ kind: 'cat-edit', budgetId: A.route.id, open, editing, adding, renaming: null }, drawEditor);
  if (adding) setTimeout(() => document.getElementById('newCatName')?.focus(), 50);
}

function addRow(groupName) {
  return `<div class="ed-add stack">
    <input id="newCatName" maxlength="${LIMITS.categoryName}" placeholder="New category in ${esc(groupName)}" autocomplete="off">
    <div class="row gap8"><button type="button" class="btn small primary" data-action="cat-add" data-id="${esc(groupName)}">Add</button><button type="button" class="btn small" data-action="cat-add-cancel">Cancel</button></div>
  </div>`;
}

function catRow(c, i, count, groupNames) {
  const S = A.sheet;
  if (S.editing === c.id) {
    return `<div class="ed-row editing stack">
      <label class="f"><span>Name</span><input id="editName" maxlength="${LIMITS.categoryName}" value="${esc(c.name)}" autocomplete="off"></label>
      <div class="form-rows"><label class="form-row"><span class="form-row-label">Group</span><select id="editGroup">${groupNames.map(g => `<option ${g === (c.group || 'Other') ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></label></div>
      <div class="row gap8 wrap"><button type="button" class="btn small primary" data-action="cat-edit-save" data-id="${c.id}">Save</button><button type="button" class="btn small" data-action="cat-edit-cancel">Cancel</button><span class="grow"></span><button type="button" class="btn small" data-action="cat-hide" data-id="${c.id}">Hide</button><button type="button" class="btn small danger" data-action="cat-delete-ask" data-id="${c.id}">Delete</button></div>
      ${S.deleting === c.id ? deletePanel(c) : ''}
    </div>`;
  }
  return `<div class="ed-row row">
    <span class="grow wrap-any">${esc(c.name)}</span>
    <button type="button" class="icon-btn small-icon" data-action="cat-up" data-id="${c.id}" aria-label="Move ${esc(c.name)} up" ${i === 0 ? 'disabled' : ''}>${svg(UP)}</button>
    <button type="button" class="icon-btn small-icon" data-action="cat-down" data-id="${c.id}" aria-label="Move ${esc(c.name)} down" ${i === count - 1 ? 'disabled' : ''}>${svg(DOWN)}</button>
    <button type="button" class="btn small" data-action="cat-edit" data-id="${c.id}">Edit</button>
  </div>`;
}

/** How much a category is in use, to decide whether deleting needs somewhere to move things. */
function usage(b, id) {
  const txs = (A.transactions[b.id] || []).filter(t => t.categoryId === id);
  const planned = Object.values(b.assigned || {}).some(m => m?.[id]);
  const repeats = Object.values(b.recurring || {}).filter(r => r.categoryId === id && !r.stopped).length;
  return { count: txs.filter(t => !t.deleted).length, any: txs.length > 0 || planned || repeats > 0, repeats };
}
function deletePanel(c) {
  const b = A.budgets[A.sheet.budgetId], u = usage(b, c.id);
  const others = Object.entries(b.categories).filter(([id, x]) => id !== c.id && !x.hidden).sort(([, p], [, q]) => (p.order ?? 0) - (q.order ?? 0));
  if (!u.any) return `<div class="delete-panel stack"><p class="small">Delete ${esc(c.name)}? It has never been used.</p><div class="row gap8"><button type="button" class="btn small danger" data-action="cat-delete" data-id="${c.id}">Delete</button><button type="button" class="btn small" data-action="cat-delete-cancel">Keep it</button></div></div>`;
  return `<div class="delete-panel stack">
    <p class="small">${esc(c.name)} has ${u.count ? `${u.count} ${u.count === 1 ? 'transaction' : 'transactions'}` : 'planned money'}${u.repeats ? ` and ${u.repeats} monthly ${u.repeats === 1 ? 'repeat' : 'repeats'}` : ''}. Pick where they move, so your totals stay right. Hiding keeps it as it is instead.</p>
    <div class="form-rows"><label class="form-row"><span class="form-row-label">Move to</span><select id="deleteMoveTo">${others.map(([id, x]) => `<option value="${id}">${esc(x.name)}</option>`).join('')}</select></label></div>
    <div class="row gap8"><button type="button" class="btn small danger" data-action="cat-delete" data-id="${c.id}">Move and delete</button><button type="button" class="btn small" data-action="cat-delete-cancel">Keep it</button></div>
  </div>`;
}

function drawEditor() {
  const S = A.sheet, b = A.budgets[S.budgetId];
  const groups = groupedCategories(b);
  const groupNames = groups.map(g => g.name);
  const hidden = Object.entries(b.categories).filter(([, c]) => c.hidden).map(([id, c]) => ({ id, ...c }));
  openSheet(`<div class="sheet">${sheetHead('Categories')}<div class="sheet-body">
    <p class="small muted">Tap a group to open it. Hidden categories keep their history.</p>
    ${groups.map(g => {
      const isOpen = Boolean(S.open[g.name]);
      return `<section class="ed-group panel">
        ${S.renaming === g.name
          ? `<div class="ed-head-edit row gap8"><input id="groupName" maxlength="${LIMITS.groupName}" value="${esc(g.name)}" aria-label="Group name" autocomplete="off"><button type="button" class="btn small primary" data-action="group-rename-save" data-id="${esc(g.name)}">Save</button><button type="button" class="btn small" data-action="group-rename-cancel">Cancel</button></div>`
          : `<button type="button" class="ed-head" data-action="group-toggle" data-id="${esc(g.name)}" aria-expanded="${isOpen}"><span class="chev" aria-hidden="true">${svg(CHEV)}</span><strong class="grow wrap-any">${esc(g.name)}</strong><span class="small muted">${g.categories.length}</span></button>`}
        ${isOpen ? `<div class="ed-body">
          ${g.categories.map((c, i) => catRow(c, i, g.categories.length, groupNames)).join('')}
          ${S.adding === g.name ? addRow(g.name) : `<div class="ed-foot row gap8 wrap"><button type="button" class="link small" data-action="cat-add-open" data-id="${esc(g.name)}">+ Add category</button><button type="button" class="link small" data-action="group-rename" data-id="${esc(g.name)}">Rename group</button></div>`}
        </div>` : ''}
      </section>`;
    }).join('')}
    ${S.adding === '__newgroup'
      ? `<section class="panel pad stack"><h3>New group</h3><input id="newGroupName" maxlength="${LIMITS.groupName}" placeholder="Group name, like Kids" autocomplete="off"><input id="newCatName" maxlength="${LIMITS.categoryName}" placeholder="First category in it" autocomplete="off"><div class="row gap8"><button type="button" class="btn small primary" data-action="cat-add" data-id="__newgroup">Add</button><button type="button" class="btn small" data-action="cat-add-cancel">Cancel</button></div></section>`
      : '<button type="button" class="btn" data-action="cat-add-open" data-id="__newgroup">Add a group</button>'}
    ${hidden.length ? `<section class="ed-group panel">
      <button type="button" class="ed-head" data-action="group-toggle" data-id="__hidden" aria-expanded="${Boolean(S.open.__hidden)}"><span class="chev" aria-hidden="true">${svg(CHEV)}</span><strong class="grow">Hidden</strong><span class="small muted">${hidden.length}</span></button>
      ${S.open.__hidden ? `<div class="ed-body">${hidden.map(c => `<div class="ed-row row"><span class="grow wrap-any">${esc(c.name)} <span class="tiny muted">${esc(c.group || '')}</span></span><button type="button" class="btn small" data-action="cat-show" data-id="${c.id}">Show</button></div>`).join('')}</div>` : ''}
    </section>` : ''}
  </div></div>`);
}

const budget = () => A.budgets[A.sheet.budgetId];
const redraw = () => setTimeout(() => { if (A.sheet?.kind === 'cat-edit') drawEditor(); render(); });

actions['group-toggle'] = el => { const k = el.dataset.id; A.sheet.open = { ...A.sheet.open, [k]: !A.sheet.open[k] }; A.sheet.editing = null; A.sheet.adding = null; drawEditor(); };
actions['cat-edit'] = el => { A.sheet.editing = el.dataset.id; A.sheet.adding = null; drawEditor(); document.getElementById('editName')?.focus(); };
actions['cat-edit-cancel'] = () => { A.sheet.editing = null; A.sheet.deleting = null; drawEditor(); };
actions['cat-edit-save'] = el => {
  const b = budget(), id = el.dataset.id, c = b.categories[id];
  const name = val('editName').trim().slice(0, LIMITS.categoryName), group = val('editGroup');
  if (!name) return toast('A category needs a name.');
  const fields = {}, undo = {};
  if (name !== c.name) { fields.name = name; undo.name = c.name; }
  if (group !== (c.group || 'Other')) {
    fields.group = group; undo.group = c.group;
    fields.order = Math.max(0, ...Object.values(b.categories).map(x => x.order ?? 0)) + 1; undo.order = c.order;
    A.sheet.open = { ...A.sheet.open, [group]: true };
  }
  A.sheet.editing = null;
  if (Object.keys(fields).length) {
    send(A.repo.updateCategory(b.id, id, fields));
    toast(fields.group ? `Moved to ${group}` : 'Renamed', () => { send(A.repo.updateCategory(b.id, id, undo)); redraw(); });
  }
  redraw();
};
const swap = (id, dir) => {
  const b = budget();
  const g = groupedCategories(b).find(x => x.categories.some(c => c.id === id));
  const i = g.categories.findIndex(c => c.id === id), j = i + dir;
  if (j < 0 || j >= g.categories.length) return;
  const a = g.categories[i], other = g.categories[j];
  const ao = a.order ?? 0, oo = other.order ?? 0;
  send(A.repo.updateCategory(b.id, a.id, { order: oo === ao ? ao + dir : oo }));
  send(A.repo.updateCategory(b.id, other.id, { order: ao }));
  redraw();
};
actions['cat-up'] = el => swap(el.dataset.id, -1);
actions['cat-down'] = el => swap(el.dataset.id, 1);
actions['cat-hide'] = el => {
  const b = budget(), id = el.dataset.id;
  A.sheet.editing = null;
  send(A.repo.updateCategory(b.id, id, { hidden: true }));
  toast(`${b.categories[id].name} hidden`, () => { send(A.repo.updateCategory(b.id, id, { hidden: false })); redraw(); });
  redraw();
};
actions['cat-show'] = el => {
  const b = budget(), id = el.dataset.id;
  send(A.repo.updateCategory(b.id, id, { hidden: false }));
  toast(`${b.categories[id].name} is back`);
  redraw();
};
actions['cat-add-open'] = el => { A.sheet.adding = el.dataset.id; A.sheet.editing = null; drawEditor(); document.getElementById(el.dataset.id === '__newgroup' ? 'newGroupName' : 'newCatName')?.focus(); };
actions['cat-add-cancel'] = () => { A.sheet.adding = null; drawEditor(); };
actions['cat-add'] = el => {
  const b = budget();
  const name = val('newCatName').trim().slice(0, LIMITS.categoryName);
  const group = el.dataset.id === '__newgroup' ? val('newGroupName').trim().slice(0, LIMITS.groupName) : el.dataset.id;
  if (!group) return toast('Name the new group.');
  if (!name) return toast('Type a name first.');
  if (Object.keys(b.categories).length >= LIMITS.categories) return toast(`A budget can have up to ${LIMITS.categories} categories.`);
  const order = Math.max(0, ...Object.values(b.categories).map(c => c.order ?? 0)) + 1;
  const { written } = A.repo.addCategory(b.id, { name, group, order });
  send(written);
  toast(`Added ${name}`);
  A.sheet.adding = group === el.dataset.id ? group : null;
  A.sheet.open = { ...A.sheet.open, [group]: true };
  redraw();
  setTimeout(() => document.getElementById('newCatName')?.focus(), 60);
};
actions['group-rename'] = el => { A.sheet.renaming = el.dataset.id; drawEditor(); document.getElementById('groupName')?.select(); };
actions['group-rename-cancel'] = () => { A.sheet.renaming = null; drawEditor(); };
actions['group-rename-save'] = el => {
  const b = budget(), from = el.dataset.id, to = val('groupName').trim().slice(0, LIMITS.groupName);
  A.sheet.renaming = null;
  if (!to || to === from) { drawEditor(); return; }
  send(A.repo.renameGroup(b.id, from, to));
  toast(`Renamed to ${to}`, () => { send(A.repo.renameGroup(b.id, to, from)); redraw(); });
  A.sheet.open = { ...A.sheet.open, [to]: true };
  redraw();
};

actions['cat-delete-ask'] = el => { A.sheet.deleting = el.dataset.id; drawEditor(); };
actions['cat-delete-cancel'] = () => { A.sheet.deleting = null; drawEditor(); };
actions['cat-delete'] = async el => {
  const b = budget(), id = el.dataset.id, c = { ...b.categories[id] };
  const u = usage(b, id);
  const moveTo = u.any ? val('deleteMoveTo') : null;
  if (u.any && !moveTo) return toast('Pick a category to move things to.');
  el.disabled = true;
  try {
    await A.repo.deleteCategory(b.id, id, moveTo, A.transactions[b.id] || []);
    A.sheet.deleting = null; A.sheet.editing = null;
    if (moveTo) toast(`Deleted ${c.name}. Everything moved to ${b.categories[moveTo].name}.`);
    else toast(`Deleted ${c.name}`, () => { send(A.repo.updateCategory(b.id, id, c)); redraw(); });
    redraw();
  } catch { el.disabled = false; toast("Couldn't delete it. Check your connection and try again."); }
};

/* From the budget page and a category's sheet */
actions['add-cat-here'] = el => openCatEditor({ adding: el.dataset.id });
actions['edit-this-cat'] = () => openCatEditor({ editing: A.sheet.id });
export { changes };
registerSheet('cat-edit', () => drawEditor());
