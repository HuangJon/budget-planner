/**
 * Searching every transaction in a budget, history included: by words (in the description or
 * note), category, kind and dates. Gives the matches, newest first, and what they add up to.
 */
import { liveTransactions, monthOf, parts } from './budget.js';

const norm = s => String(s || '').toLowerCase();

/** { text, categoryId, kind: 'spend' | 'income' | '', from: 'YYYY-MM-DD', to } → matching transactions. */
export function searchTransactions(list, { text = '', categoryId = '', kind = '', from = '', to = '', accountId = '', importId = '' } = {}) {
  const words = norm(text).split(/\s+/).filter(Boolean);
  return liveTransactions(list).filter(t => {
    if (categoryId && t.categoryId !== categoryId && !(t.splits || []).some(p => p.categoryId === categoryId)) return false;
    if (accountId && t.accountId !== accountId) return false;
    if (importId && t.importId !== importId) return false;
    if (kind === 'spend' && t.kind === 'income') return false;
    if (kind === 'income' && t.kind !== 'income') return false;
    if (from && t.date < from) return false;
    if (to && t.date > to) return false;
    if (!words.length) return true;
    const hay = `${norm(t.description)} ${norm(t.note)}`;
    return words.every(w => hay.includes(w));
  }).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
}

/** What a set of matches adds up to: spending (less refunds), income, months covered, and the biggest categories. */
export function searchTotals(matches) {
  let spent = 0, income = 0;
  const byCat = {}, months = new Set();
  for (const t of matches) {
    months.add(monthOf(t.date));
    if (t.kind === 'income') { income += t.amount; continue; }
    const sign = t.kind === 'spend' ? 1 : -1;
    spent += sign * t.amount;
    for (const p of parts(t)) byCat[p.categoryId] = (byCat[p.categoryId] || 0) + sign * p.amount;
  }
  const sorted = [...months].sort();
  let span = 0;
  if (sorted.length) {
    const [y1, m1] = sorted[0].split('-').map(Number), [y2, m2] = sorted.at(-1).split('-').map(Number);
    span = (y2 - y1) * 12 + (m2 - m1) + 1;
  }
  return {
    count: matches.length, spent, income, months: span,
    perMonth: span ? Math.round(spent / span) : 0,
    byCategory: Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([id, amount]) => ({ id, amount })),
  };
}
