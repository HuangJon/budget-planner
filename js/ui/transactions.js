/** Every transaction in the month, newest first, grouped by day. */
import { A, actions, render } from './state.js';
import { esc, fmtDate, ordinal, openSheet, closeSheet, sheetHead, toast, send, val, today as todayDate } from './dom.js';
import { isValidRule, nextDate } from '../core/recurring.js';
import { toCents } from '../core/money.js';
import { amountBox, monthBar, summaryFor } from './budget.js';
import { liveTransactions, monthOf } from '../core/budget.js';
import { money } from '../core/money.js';

export const signed = t => `<span class="amt ${t.kind === 'spend' ? 'owe' : 'owed'}">${t.kind === 'spend' ? '−' : '+'}${money(t.amount)}</span>`;

export function transactionsScreen(b) {
  const list = liveTransactions(A.transactions[b.id]).filter(t => monthOf(t.date) === A.month)
    .sort((p, q) => q.date.localeCompare(p.date) || (q.createdAt || 0) - (p.createdAt || 0));
  const s = summaryFor(b);
  const spent = list.filter(t => t.kind !== 'income').reduce((a, t) => a + (t.kind === 'spend' ? t.amount : -t.amount), 0);
  const days = new Map();
  for (const t of list) { if (!days.has(t.date)) days.set(t.date, []); days.get(t.date).push(t); }
  const shared = Object.keys(b.members || {}).length > 1;
  return `${monthBar()}
    ${repeatsPanel(b)}
    <section class="panel pad totals">
      <div><span class="label">Came in</span><span class="amt owed">${money(s.incomeThisMonth)}</span></div>
      <div><span class="label">Spent</span><span class="amt owe">${money(spent)}</span></div>
    </section>
    ${list.length ? [...days].map(([day, items]) => `<section class="stack tight"><h3 class="date-head">${fmtDate(day)}</h3><div class="panel tx-list">${items.map(t => {
      const cat = t.kind === 'income' ? 'Ready to assign' : b.categories[t.categoryId]?.name || 'Removed category';
      const who = shared ? ` · ${esc(t.createdBy === A.user?.uid ? 'You' : b.members[t.createdBy]?.name || 'Former member')}` : '';
      return `<button type="button" class="tap tx-row" data-action="edit-tx" data-id="${t.id}"><span class="grow stack tight"><strong class="wrap-any two-lines">${esc(t.description || (t.kind === 'income' ? 'Income' : t.kind === 'refund' ? 'Refund' : 'Spending'))}</strong><span class="tiny muted">${esc(cat)}${who}${t.kind === 'refund' ? ' · Refund' : ''}</span></span>${signed(t)}</button>`;
    }).join('')}</div></section>`).join('')
    : `<section class="panel empty"><h2>Nothing this month yet</h2><p class="muted">Tap Spend to record a purchase. Income goes in from the Budget tab.</p><button type="button" class="btn primary" data-action="add-tx">Add spending</button></section>`}`;
}

/* ---------- Every month ---------- */

const rules = b => Object.values(b.recurring || {}).filter(isValidRule).sort((x, y) => Number(Boolean(x.stopped)) - Number(Boolean(y.stopped)) || x.day - y.day);
const allIds = id => (A.transactions[id] || []).map(t => t.id);

function repeatsPanel(b) {
  const list = rules(b);
  if (!list.length) return '';
  const today = todayDate();
  const active = list.filter(r => !r.stopped);
  return `<section class="stack tight"><h3 class="date-head">Every month</h3><div class="panel tx-list">${(A.showStopped ? list : active).map(r => {
    const next = nextDate(r, today, allIds(b.id));
    const where = r.kind === 'income' ? 'Ready to assign' : b.categories[r.categoryId]?.name || 'Removed category';
    return `<button type="button" class="tap tx-row" data-action="open-rule" data-id="${r.id}"><span class="grow stack tight"><strong class="wrap-any two-lines">${esc(r.description || (r.kind === 'income' ? 'Income' : 'Spending'))}</strong><span class="tiny muted">${esc(where)} · ${r.stopped ? 'Stopped' : `the ${ordinal(r.day)}${next ? ` · next ${fmtDate(next)}` : ''}`}</span></span>${signed({ kind: r.kind, amount: r.amount })}</button>`;
  }).join('')}</div>${list.length > active.length ? `<button type="button" class="link small" data-action="toggle-stopped">${A.showStopped ? 'Hide stopped' : `Show stopped (${list.length - active.length})`}</button>` : ''}</section>`;
}
actions['toggle-stopped'] = () => { A.showStopped = !A.showStopped; render(); };

function ruleSheet() {
  const b = A.budgets[A.route.id], r = b?.recurring?.[A.sheet.id];
  if (!r) { closeSheet(); return; }
  openSheet(`<div class="sheet">${sheetHead(r.description || 'Every month')}<div class="sheet-body">
    <p class="small muted">${r.kind === 'income' ? 'Added to Ready to assign' : `Added to ${esc(b.categories[r.categoryId]?.name || 'a removed category')}`} every month. Changes apply from the next one.</p>
    <div class="form-rows">
      <div class="form-row"><span class="form-row-label">Amount</span>${amountBox('ruleAmt', r.amount, 'Amount')}</div>
      <label class="form-row"><span class="form-row-label">Day</span><select id="ruleDay">${Array.from({ length: 28 }, (_, i) => i + 1).map(n => `<option value="${n}" ${r.day === n ? 'selected' : ''}>The ${ordinal(n)}</option>`).join('')}</select></label>
    </div>
    ${r.stopped ? '<button type="button" class="btn" data-action="rule-resume">Start repeating again</button>' : '<button type="button" class="btn danger" data-action="rule-stop">Stop repeating</button>'}
    <p class="small muted">Stopping keeps everything already added.</p>
  </div><div class="sheet-foot"><button type="button" class="btn primary" data-action="rule-save">Save</button></div></div>`);
}
actions['open-rule'] = el => { A.sheet = { kind: 'rule', id: el.dataset.id }; ruleSheet(); };
actions['rule-save'] = () => {
  const b = A.budgets[A.route.id], r = b.recurring[A.sheet.id];
  const amount = toCents(val('ruleAmt')), day = Number(val('ruleDay'));
  if (amount <= 0) return toast('Type an amount.');
  send(A.repo.saveRule(b.id, { ...r, amount, day }));
  closeSheet();
  toast('Saved', () => send(A.repo.saveRule(b.id, r)));
};
actions['rule-stop'] = () => {
  const b = A.budgets[A.route.id], id = A.sheet.id;
  send(A.repo.stopRule(b.id, id));
  closeSheet();
  toast('Stopped repeating', () => send(A.repo.resumeRule(b.id, id)));
};
actions['rule-resume'] = () => {
  const b = A.budgets[A.route.id], id = A.sheet.id;
  send(A.repo.resumeRule(b.id, id, A.month > todayDate().slice(0, 7) ? A.month : todayDate().slice(0, 7)));
  closeSheet();
  toast('Repeating again');
};
