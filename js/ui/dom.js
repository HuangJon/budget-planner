/** Small shared helpers for building and updating the page. */
import { A } from './state.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const val = id => document.getElementById(id)?.value ?? '';

export const ICON = {
  home: '<path d="M4 11l8-7 8 7M6.500 9.500V20h11V9.500M10 20v-5.500h4V20"/>',
  back: '<path d="M15 5l-7 7 7 7"/>', next: '<path d="M9 5l7 7-7 7"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  wallet: '<path d="M4 7.500A2.500 2.500 0 0 1 6.500 5H18v3"/><rect x="4" y="8" width="16" height="11" rx="2.500"/><circle cx="16" cy="13.500" r="1.200"/>',
  people: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.800 3.500-5.500 7-5.500s6.200 1.700 7 5.500"/>',
  swap: '<path d="M4 8h14l-4-4M20 16H6l4 4"/>', chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>', bolt: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
  target: '<circle cx="12" cy="12" r="8.500"/><circle cx="12" cy="12" r="4.500"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
};

export const fmtDate = d => {
  const x = new Date(`${d}T12:00:00`);
  return Number.isNaN(+x) ? esc(d) : x.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
};
export const fmtMonth = m => new Date(`${m}-15T12:00:00`).toLocaleDateString('en', { month: 'long', year: 'numeric' });
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const ordinal = n => `${n}${[, 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1) && n % 10] || 'th'}`;

/* ---------- Sheets and messages ---------- */
const sheet = () => document.getElementById('dlg');
const toastEl = () => document.getElementById('toast');
const parkToast = () => { const t = toastEl(); if (t.parentElement !== document.body) document.body.appendChild(t); };

export function openSheet(html) {
  const d = sheet();
  parkToast();
  d.innerHTML = html;
  if (!d.open) d.showModal();
}
export function closeSheet() {
  const d = sheet();
  A.form = null;
  A.sheet = null;
  A.sheetStack = [];
  parkToast();
  if (d.open) d.close();
  d.innerHTML = '';
}

/*
 * Popups opened from another popup remember where they came from, so the back arrow returns
 * there (a category, then Add spending, then back to the category). Each kind of popup
 * registers how to draw itself.
 */
const drawers = {};
export const registerSheet = (kind, draw) => { drawers[kind] = draw; };
/** Opens a popup on top of the one showing now, if any, so Back returns to it. */
export function openChild(next, draw) {
  if (A.sheet && sheet().open) A.sheetStack = [...(A.sheetStack || []), { sheet: A.sheet, form: A.form }];
  A.sheet = next;
  draw();
}
/** Back to the popup underneath, or closed when there isn't one. */
export function sheetBack() {
  const prev = (A.sheetStack || []).at(-1);
  if (!prev || !drawers[prev.sheet.kind]) { closeSheet(); return; }
  A.sheetStack = A.sheetStack.slice(0, -1);
  A.sheet = prev.sheet;
  A.form = prev.form;
  drawers[prev.sheet.kind]();
}
/** After saving: back to where this popup was opened from, or closed. */
export const finishSheet = () => ((A.sheetStack || []).length ? sheetBack() : closeSheet());

const BACK = '<path d="M15 5l-7 7 7 7"/>';
/** Every popup has a back arrow on the left: to the popup underneath, or out to the screen. */
export const sheetHead = (title, right = '') => `<div class="sheet-head"><button type="button" class="btn small back-btn" data-action="sheet-back" aria-label="Back">${svg(BACK)}<span>Back</span></button><h2>${esc(title)}</h2><div class="sheet-right">${right}</div></div>`;

let toastTimer;
export function toast(message, undo) {
  const el = toastEl(), d = sheet();
  el.innerHTML = `<span>${esc(message)}</span>${undo ? '<button type="button" data-action="undo">Undo</button>' : ''}`;
  el.hidden = false;
  A.undo = undo || null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; A.undo = null; }, undo ? 7000 : 3500);
  if (d.open) d.appendChild(el); else parkToast();
}

/** Runs a write without waiting. Offline writes stay open until reconnecting, so only failure is reported. */
export function send(promise) {
  promise.catch(e => {
    A.logProblem?.(e?.code === 'permission-denied' ? 'refused-save' : 'failed-save', e?.code || e?.message || 'Save failed');
    const why = e?.code === 'permission-denied' ? "That change was refused. Check that you're on the latest version." : "That change didn't save. Check your connection and try again.";
    toast(why);
  });
}

/** Saves a text file to the phone or computer. The preview can't save files, so it says so. */
export function downloadFile(name, text, type = 'text/csv') {
  if (A.preview) { toast('Saving files works in the real app.'); return; }
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
