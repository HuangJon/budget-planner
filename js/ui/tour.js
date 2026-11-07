/**
 * A short tour of the real budget screen: it highlights each part and says what it's for. Runs
 * once after signing in (on the first budget opened) and again from "Show me around" in any help.
 * It only runs on a budget screen, so it never covers signing in or joining. No timers.
 */
import { A, actions, render } from './state.js';
import { esc, closeSheet } from './dom.js';

const KEY = 'wmm:tourDone';
const STEPS = [
  { sel: '.hero', title: 'Ready to assign', text: 'Money that has come in but has no job yet. Add income here when you’re paid.' },
  { sel: '.hero-actions a.hero-btn', title: 'Plan money', text: 'Give every dollar a job: put money into each category until Ready to assign reaches $0.' },
  { sel: '.groups .cat-row', title: 'Each category is a pot', text: 'What you plan goes in, what you spend comes out. Tap one to add spending, change its plan or set a target.' },
  { sel: '.spend-tab', title: 'Spend', text: 'Log a purchase here. Your usual ones are one tap, and the category is suggested for you.' },
  { sel: 'a.tab[href$="-trends"]', title: 'Trends', text: 'How this month is going, and how your spending compares with usual.' },
  { sel: '.help-btn', title: 'Help any time', text: 'Tap ? on any screen for a short explanation of it.' },
];

const done = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return Boolean(A.tourDoneMemory); } };
const markDone = () => { try { localStorage.setItem(KEY, '1'); } catch { A.tourDoneMemory = true; } };

/** Starts the tour when someone first lands on a budget, unless they've seen it on this device. */
export function maybeStartTour() {
  if (A.tour || done() || A.route?.name !== 'budget' || !A.budgets[A.route.id] || document.getElementById('dlg').open) return;
  startTour();
}
export function startTour() {
  if (A.route?.name !== 'budget') return;
  A.tour = { step: 0 };
  drawTour();
}

/** Draws the highlight and the card for the current step, skipping steps whose part isn't on screen. */
export function drawTour() {
  document.getElementById('tour')?.remove();
  if (!A.tour) return;
  let target = null;
  while (A.tour.step < STEPS.length && !(target = document.querySelector(STEPS[A.tour.step].sel))) A.tour.step += 1;
  if (!target) { endTour(); return; }
  const s = STEPS[A.tour.step];
  target.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = target.getBoundingClientRect();
  const pad = 6;
  const el = document.createElement('div');
  el.id = 'tour';
  el.className = 'tour';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Tour');
  const below = r.top < innerHeight / 2;
  el.innerHTML = `<div class="tour-ring" style="top:${r.top - pad}px;left:${r.left - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px"></div>
    <div class="tour-card ${below ? 'low' : 'high'}">
      <span class="tiny muted">${A.tour.step + 1} of ${STEPS.length}</span>
      <h2>${esc(s.title)}</h2>
      <p>${esc(s.text)}</p>
      <div class="row between"><button type="button" class="link small" data-action="tour-end">Skip</button><div class="row gap8">${A.tour.step > 0 ? '<button type="button" class="btn small" data-action="tour-back">Back</button>' : ''}<button type="button" class="btn small primary" data-action="tour-next">${A.tour.step === STEPS.length - 1 ? 'Done' : 'Next'}</button></div></div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('[data-action=tour-next]').focus({ preventScroll: true });
}
function endTour() {
  A.tour = null;
  markDone();
  document.getElementById('tour')?.remove();
}

actions['tour-next'] = () => { if (A.tour.step >= STEPS.length - 1) endTour(); else { A.tour.step += 1; drawTour(); } };
actions['tour-back'] = () => { A.tour.step = Math.max(0, A.tour.step - 1); drawTour(); };
actions['tour-end'] = () => endTour();
actions['tour-start'] = () => {
  closeSheet();
  if (A.route?.name !== 'budget') { if (A.route?.id) location.hash = `#b-${A.route.id}`; setTimeout(() => { render(); startTour(); }, 50); return; }
  startTour();
};
addEventListener('resize', () => { if (A.tour) drawTour(); });
addEventListener('keydown', ev => { if (A.tour && ev.key === 'Escape') endTour(); });
