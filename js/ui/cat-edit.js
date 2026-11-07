/** Adding, renaming, regrouping, reordering and hiding categories. Hiding keeps history; nothing is deleted. */
import { A, actions, changes } from './state.js';
import { esc, svg, openSheet, sheetHead, toast, send, val } from './dom.js';
import { groupedCategories } from '../core/budget.js';
import { LIMITS } from '../config/app.js';

const UP = '<path d="M6 15l6-6 6 6"/>', DOWN = '<path d="M6 9l6 6 6-6"/>';

export function openCatEditor() {
  A.sheet = { kind: 'cat-edit', budgetId: A.route.id };
  drawEditor();
}

function drawEditor() {
  const b = A.budgets[A.sheet.budgetId];
  const groups = groupedCategories(b);
  const groupNames = groups.map(g => g.name);
  const hidden = Object.entries(b.categories).filter(([, c]) => c.hidden).map(([id, c]) => ({ id, ...c }));
  const groupSelect = (id, current) => `<select data-change="cat-group" data-id="${id}" aria-label="Group">${groupNames.map(g => `<option ${g === current ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>`;
  openSheet(`<div class="sheet">${sheetHead('Categories', '', 'Done')}<div class="sheet-body">
    ${groups.map(g => `<section class="stack tight"><h3 class="date-head">${esc(g.name)}</h3><div class="panel edit-list">${g.categories.map((c, i) => `
      <div class="edit-row">
        <input value="${esc(c.name)}" maxlength="${LIMITS.categoryName}" aria-label="Name" data-change="cat-rename" data-id="${c.id}">
        <div class="row gap6 edit-tools">
          ${groupSelect(c.id, g.name)}
          <button type="button" class="icon-btn" data-action="cat-up" data-id="${c.id}" aria-label="Move ${esc(c.name)} up" ${i === 0 ? 'disabled' : ''}>${svg(UP)}</button>
          <button type="button" class="icon-btn" data-action="cat-down" data-id="${c.id}" aria-label="Move ${esc(c.name)} down" ${i === g.categories.length - 1 ? 'disabled' : ''}>${svg(DOWN)}</button>
          <button type="button" class="btn small" data-action="cat-hide" data-id="${c.id}">Hide</button>
        </div>
      </div>`).join('')}</div></section>`).join('')}

    <section class="panel pad stack">
      <h3>Add a category</h3>
      <input id="newCatName" maxlength="${LIMITS.categoryName}" placeholder="Name, like Pets or Car" autocomplete="off">
      <div class="form-rows"><label class="form-row"><span class="form-row-label">Group</span><select id="newCatGroup" data-change="new-cat-group">${groupNames.map(g => `<option>${esc(g)}</option>`).join('')}<option value="__new">New group…</option></select></label></div>
      <input id="newGroupName" maxlength="${LIMITS.groupName}" placeholder="New group name" autocomplete="off" hidden>
      <button type="button" class="btn primary" data-action="cat-add">Add</button>
    </section>

    ${hidden.length ? `<section class="stack tight"><h3 class="date-head">Hidden</h3><p class="small muted">Hidden categories keep their history. Show one to use it again.</p><div class="panel edit-list">${hidden.map(c => `<div class="edit-row row between"><span class="wrap-any">${esc(c.name)}</span><button type="button" class="btn small" data-action="cat-show" data-id="${c.id}">Show</button></div>`).join('')}</div></section>` : ''}
  </div></div>`);
}

const budget = () => A.budgets[A.sheet.budgetId];
const update = (id, fields, msg, undoFields) => {
  const b = budget();
  send(A.repo.updateCategory(b.id, id, fields));
  if (msg) toast(msg, undoFields ? () => { send(A.repo.updateCategory(b.id, id, undoFields)); setTimeout(drawEditor); } : undefined);
  setTimeout(drawEditor);
};

changes['cat-rename'] = el => {
  const b = budget(), id = el.dataset.id, name = el.value.trim().slice(0, LIMITS.categoryName);
  const before = b.categories[id].name;
  if (!name) { el.value = before; return toast('A category needs a name.'); }
  if (name !== before) update(id, { name }, 'Renamed', { name: before });
};
changes['cat-group'] = el => {
  const b = budget(), id = el.dataset.id;
  const before = b.categories[id].group, group = el.value;
  update(id, { group }, `Moved to ${group}`, { group: before });
};
const swap = (id, dir) => {
  const b = budget();
  const g = groupedCategories(b).find(x => x.categories.some(c => c.id === id));
  const i = g.categories.findIndex(c => c.id === id), j = i + dir;
  if (j < 0 || j >= g.categories.length) return;
  const a = g.categories[i], other = g.categories[j];
  // Orders can tie in older budgets, so make sure they end up different.
  const ao = a.order ?? 0, oo = other.order ?? 0;
  send(A.repo.updateCategory(b.id, a.id, { order: oo === ao ? ao + dir : oo }));
  send(A.repo.updateCategory(b.id, other.id, { order: ao }));
  setTimeout(drawEditor);
};
actions['cat-up'] = el => swap(el.dataset.id, -1);
actions['cat-down'] = el => swap(el.dataset.id, 1);
actions['cat-hide'] = el => update(el.dataset.id, { hidden: true }, `${budget().categories[el.dataset.id].name} hidden`, { hidden: false });
actions['cat-show'] = el => update(el.dataset.id, { hidden: false }, `${budget().categories[el.dataset.id].name} is back`);
actions['cat-add'] = () => {
  const b = budget();
  const name = val('newCatName').trim().slice(0, LIMITS.categoryName);
  if (!name) return toast('Type a name first.');
  if (Object.keys(b.categories).length >= LIMITS.categories) return toast(`A budget can have up to ${LIMITS.categories} categories.`);
  const group = val('newCatGroup') === '__new' ? val('newGroupName').trim().slice(0, LIMITS.groupName) : val('newCatGroup');
  if (!group) return toast('Name the new group.');
  const order = Math.max(0, ...Object.values(b.categories).map(c => c.order ?? 0)) + 1;
  const { written } = A.repo.addCategory(b.id, { name, group, order });
  send(written);
  toast(`Added ${name}`);
  setTimeout(drawEditor);
};
changes['new-cat-group'] = el => {
  const box = document.getElementById('newGroupName');
  box.hidden = el.value !== '__new';
  if (!box.hidden) box.focus();
};
