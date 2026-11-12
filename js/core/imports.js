/**
 * Organising imports by account and month. Each bank file covers some dates; it's filed under the
 * months it covers, in the column of the account it came from. A grid of months by accounts then
 * shows at a glance what's in and what's missing, instead of a long list of files.
 */
import { addMonths } from './budget.js';

const monthOf = d => String(d || '').slice(0, 7);

/** The dates a file covered: saved with it, or worked out from its rows for older imports. */
export function importSpan(rec, txById) {
  if (rec.from && rec.to) return { from: rec.from, to: rec.to };
  const dates = (rec.ids || []).map(id => txById.get(id)?.date).filter(Boolean).sort();
  return dates.length ? { from: dates[0], to: dates.at(-1) } : { from: '', to: '' };
}

/** The months a file covers (at most 4, so a long file doesn't take over the grid). */
export function importMonths(rec, txById) {
  const { from, to } = importSpan(rec, txById);
  if (!from) return [monthOf(new Date(rec.at || 0).toISOString())];
  const out = [];
  for (let m = monthOf(from); m <= monthOf(to) && out.length < 4; m = addMonths(m, 1)) out.push(m);
  // A long file keeps its last months: those are usually what it was downloaded for.
  return out.length === 4 && addMonths(monthOf(from), 3) < monthOf(to) ? [addMonths(monthOf(to), -3), addMonths(monthOf(to), -2), addMonths(monthOf(to), -1), monthOf(to)] : out;
}

/**
 * The grid: one row per month (newest first, from this month back to the oldest import), one column
 * per account that has imports ('' for files with no account), and in each cell the imports filed
 * there. A cell is a gap when that account had imports before and after but none that month.
 */
export function importGrid(recs, txs, accounts, month) {
  const txById = new Map((txs || []).map(t => [t.id, t]));
  const cells = new Map(), cols = new Set();
  let oldest = month;
  for (const rec of recs || []) {
    const col = accounts?.[rec.accountId] ? rec.accountId : '';
    cols.add(col);
    for (const m of importMonths(rec, txById)) {
      const key = `${m}|${col}`;
      (cells.get(key) || cells.set(key, []).get(key)).push(rec);
      if (m < oldest) oldest = m;
    }
  }
  const months = [];
  for (let m = month; m >= oldest; m = addMonths(m, -1)) months.push(m);
  // Accounts in name order, with no account last.
  const columns = [...cols].sort((a, b) => (a === '') - (b === '') || (accounts?.[a]?.name || '').localeCompare(accounts?.[b]?.name || ''));
  const firstFor = new Map(columns.map(c => [c, months.filter(m => cells.has(`${m}|${c}`)).at(-1)]));
  const at = (m, c) => cells.get(`${m}|${c}`) || [];
  // A gap: nothing that month, from an account whose imports had started by then.
  const gap = (m, c) => c !== '' && !at(m, c).length && firstFor.get(c) && m >= firstFor.get(c);
  return { months, columns, at, gap };
}

/** Transactions that came from a bank file before imports were recorded, so belong to none. */
export const unfiled = txs => (txs || []).filter(t => !t.deleted && String(t.id).startsWith('i-') && !t.importId);
