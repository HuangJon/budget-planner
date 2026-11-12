/**
 * Closing out a month: the few things worth checking once a month is over, in one list.
 * Each item is done or not, with a short note and where to go to sort it out.
 */
import { liveTransactions, monthOf } from './budget.js';

export function closeOut({ budget, txs, month, summary, check, grid, suggested = 0 }) {
  const items = [];
  const cats = budget.categories || {};

  // 1. A statement from every account that has them.
  const cols = (grid?.columns || []).filter(c => c !== '');
  if (cols.length) {
    const missing = cols.filter(c => !grid.at(month, c).some(r => !r.undone));
    items.push({
      key: 'statements', done: !missing.length,
      title: missing.length ? `Import ${missing.length === 1 ? 'a statement' : `${missing.length} statements`}` : 'Statements imported',
      detail: missing.length ? `Still to come: ${missing.map(c => budget.accounts?.[c]?.name || 'an account').join(', ')}` : `From ${cols.length === 1 ? 'your account' : `all ${cols.length} accounts`}`,
      action: 'open-imports',
    });
  }

  // 2. The accounts match the budget.
  if (check?.accounts?.length) {
    const off = Math.abs(check.gap || 0);
    const done = !check.missing?.length && off < 100;
    items.push({
      key: 'accounts', done,
      title: done ? 'Accounts match' : check.missing?.length ? 'Add your account balances' : 'Accounts don’t match',
      detail: done ? 'Every dollar is in the budget' : check.missing?.length ? `Missing for ${check.missing.map(m => m.name).join(', ')}` : `Off by ${(off / 100).toFixed(2)}`,
      action: 'open-accounts', amount: done || check.missing?.length ? null : off,
    });
  }

  // 3. Nothing overspent.
  const over = Object.entries(summary?.categories || {}).filter(([id, c]) => cats[id] && !cats[id].hidden && c.available < 0);
  items.push({
    key: 'overspent', done: !over.length,
    title: over.length ? `Cover ${over.length === 1 ? '1 overspent category' : `${over.length} overspent categories`}` : 'Nothing overspent',
    detail: over.length ? over.slice(0, 3).map(([id]) => cats[id].name).join(', ') + (over.length > 3 ? ` and ${over.length - 3} more` : '') : 'Every category stayed within what it had',
    action: 'closeout-budget',
  });

  // 4. Everything has a category.
  const loose = liveTransactions(txs).filter(t => monthOf(t.date) === month && t.kind !== 'income' && !cats[t.categoryId]).length;
  if (loose) items.push({ key: 'uncategorized', done: false, title: `Pick a category for ${loose}`, detail: 'Their category was removed', action: 'closeout-search' });

  // 5. Things that look like repeats.
  if (suggested) items.push({ key: 'repeats', done: false, title: `Look at ${suggested} possible ${suggested === 1 ? 'repeat' : 'repeats'}`, detail: 'Things that come every month, not set up yet', action: 'closeout-repeats' });

  // 6. Every dollar has a job.
  const ready = summary?.readyToAssign || 0;
  items.push({
    key: 'assign', done: ready === 0,
    title: ready > 0 ? 'Assign what’s left' : ready < 0 ? 'More assigned than you have' : 'Every dollar assigned',
    detail: ready > 0 ? 'Ready to assign isn’t zero yet' : ready < 0 ? 'Take some back from a category' : 'Ready to assign is $0',
    action: 'closeout-plan', amount: ready || null,
  });

  return { items, left: items.filter(i => !i.done).length };
}
