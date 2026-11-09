/**
 * Arranging categories right on the budget screen: tap Arrange, then drag a category by its handle
 * (or use its arrows) to a new place, in its group or another one. Done saves the new order in
 * one go. While dragging, new data doesn't redraw the screen; it catches up afterwards.
 */
import { A, actions, render } from './state.js';
import { esc, send, toast } from './dom.js';
import { groupedCategories } from '../core/budget.js';

export const arranging = () => Boolean(A.arrange && A.arrange.budgetId === A.route?.id);

/** The arrange version of the budget's categories: every group open, a handle and arrows on each row. */
export function arrangeList(b) {
  const groups = groupedCategories(b);
  return `<div class="arrange-bar"><span class="small"><strong>Arranging.</strong> Drag ≡ to move a category, even to another group.</span><button type="button" class="btn small primary" data-action="arrange-done">Done</button></div>
    <div class="arrange" id="arrangeList">${groups.map(g => `<section class="arr-group" data-group="${esc(g.name)}">
      <h3 class="arr-group-name">${esc(g.name)}</h3>
      <div class="panel arr-list">${g.categories.map(c => `<div class="arr-row" data-id="${c.id}">
        <span class="drag-handle" aria-hidden="true">≡</span>
        <span class="grow wrap-any">${esc(c.name)}</span>
        <button type="button" class="icon-btn small-icon" data-action="arr-move" data-id="${c.id}" data-dir="-1" aria-label="Move ${esc(c.name)} up">▲</button>
        <button type="button" class="icon-btn small-icon" data-action="arr-move" data-id="${c.id}" data-dir="1" aria-label="Move ${esc(c.name)} down">▼</button>
      </div>`).join('')}<div class="arr-drop" aria-hidden="true"></div></div>
    </section>`).join('')}</div>`;
}

/** Reads the order on screen and saves what changed. */
function save() {
  const b = A.budgets[A.arrange.budgetId], list = document.getElementById('arrangeList');
  if (!b || !list) return;
  const changes = {};
  let n = 0;
  for (const sec of list.querySelectorAll('.arr-group')) {
    const group = sec.dataset.group;
    for (const row of sec.querySelectorAll('.arr-row')) {
      const id = row.dataset.id, c = b.categories[id];
      n += 1;
      if (!c) continue;
      const f = {};
      if ((c.order ?? 0) !== n) f.order = n;
      if ((c.group || 'Other') !== group) f.group = group;
      if (Object.keys(f).length) changes[id] = f;
    }
  }
  if (Object.keys(changes).length) send(A.repo.arrangeCategories(b.id, changes));
  return Object.keys(changes).length;
}

actions['arrange-start'] = () => { A.arrange = { budgetId: A.route.id }; render(); };
actions['arrange-done'] = () => {
  const moved = save();
  A.arrange = null;
  if (moved) toast('New order saved');
  render();
};
/** The arrows: one step up or down, crossing into the next group at either end. */
actions['arr-move'] = el => {
  const row = el.closest('.arr-row'), dir = Number(el.dataset.dir);
  if (dir < 0) {
    const prev = row.previousElementSibling;
    if (prev?.classList.contains('arr-row')) prev.before(row);
    else { const up = row.closest('.arr-group').previousElementSibling; if (up) up.querySelector('.arr-drop').before(row); }
  } else {
    const next = row.nextElementSibling;
    if (next?.classList.contains('arr-row')) next.after(row);
    else { const down = row.closest('.arr-group').nextElementSibling; if (down) down.querySelector('.arr-list').prepend(row); }
  }
  el.focus();
};

/* ---------- Dragging by the handle ---------- */
let drag = null;
function rowAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return { row: el?.closest('.arr-row'), list: el?.closest('.arr-list') };
}
addEventListener('pointerdown', ev => {
  const handle = ev.target.closest?.('.drag-handle');
  if (!handle || !arranging()) return;
  ev.preventDefault();
  const row = handle.closest('.arr-row');
  drag = { row, id: ev.pointerId };
  row.classList.add('dragging');
  handle.setPointerCapture?.(ev.pointerId);
});
addEventListener('pointermove', ev => {
  if (!drag || ev.pointerId !== drag.id) return;
  ev.preventDefault();
  const { row, list } = rowAt(ev.clientX, ev.clientY);
  if (row && row !== drag.row) {
    const r = row.getBoundingClientRect();
    if (ev.clientY < r.top + r.height / 2) row.before(drag.row); else row.after(drag.row);
  } else if (!row && list && !list.contains(drag.row)) {
    list.querySelector('.arr-drop').before(drag.row);
  }
  // Scroll when dragging near the top or bottom of the screen.
  if (ev.clientY < 90) scrollBy(0, -12); else if (ev.clientY > innerHeight - 110) scrollBy(0, 12);
}, { passive: false });
const end = ev => {
  if (!drag || ev.pointerId !== drag.id) return;
  drag.row.classList.remove('dragging');
  drag = null;
};
addEventListener('pointerup', end);
addEventListener('pointercancel', end);
