/** Every transaction in the month, newest first, grouped by day. */
import { A } from './state.js';
import { esc, fmtDate } from './dom.js';
import { monthBar, summaryFor } from './budget.js';
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
    <section class="panel pad totals">
      <div><span class="label">Came in</span><span class="amt owed">${money(s.incomeThisMonth)}</span></div>
      <div><span class="label">Spent</span><span class="amt owe">${money(spent)}</span></div>
    </section>
    ${list.length ? [...days].map(([day, items]) => `<section class="stack tight"><h3 class="date-head">${fmtDate(day)}</h3><div class="panel tx-list">${items.map(t => {
      const cat = t.kind === 'income' ? 'Ready to assign' : b.categories[t.categoryId]?.name || 'Removed category';
      const who = shared ? ` · ${esc(t.createdBy === A.user?.uid ? 'You' : b.members[t.createdBy]?.name || 'Former member')}` : '';
      return `<button type="button" class="tap tx-row" data-action="edit-tx" data-id="${t.id}"><span class="grow stack tight"><strong class="wrap-any two-lines">${esc(t.description || (t.kind === 'income' ? 'Income' : t.kind === 'refund' ? 'Refund' : 'Spending'))}</strong><span class="tiny muted">${esc(cat)}${who}${t.kind === 'refund' ? ' · Refund' : ''}</span></span>${signed(t)}</button>`;
    }).join('')}</div></section>`).join('')
    : `<section class="panel empty"><h2>Nothing this month yet</h2><p class="muted">Tap Add to record spending or income.</p><button type="button" class="btn primary" data-action="add-tx">Add a transaction</button></section>`}`;
}
