/**
 * Spreadsheet files of a budget: every transaction, and the plan for each month. Plain CSV that
 * opens in Numbers, Excel or Google Sheets. Amounts are dollars with two decimals.
 */
import { liveTransactions } from './budget.js';

/**
 * One spreadsheet cell. Text that starts like a formula gets a leading apostrophe so a spreadsheet
 * shows it instead of running it; plain numbers (including negative amounts) pass through as numbers.
 */
const cell = v => {
  const s = String(v ?? '');
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const row = values => values.map(cell).join(',');
const dollars = cents => (cents / 100).toFixed(2);

/** Every transaction, oldest first. Spending is negative, income and refunds positive. */
export function transactionsCsv(budget, transactionList) {
  const lines = [row(['Date', 'Type', 'Description', 'Category', 'Group', 'Amount', 'Note', 'Added by', 'Repeats'])];
  const list = liveTransactions(transactionList).sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
  for (const t of list) {
    const c = budget.categories?.[t.categoryId];
    lines.push(row([
      t.date, t.kind === 'income' ? 'Income' : t.kind === 'refund' ? 'Refund' : 'Spending', t.description || '',
      t.kind === 'income' ? 'Ready to assign' : c?.name || 'Removed category', t.kind === 'income' ? '' : c?.group || '',
      dollars(t.kind === 'spend' ? -t.amount : t.amount), t.note || '', budget.members?.[t.createdBy]?.name || '', t.recurringId ? 'Yes' : '',
    ]));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** What was planned for each category in each month, months as columns. */
export function planCsv(budget) {
  const months = Object.keys(budget.assigned || {}).filter(m => /^\d{4}-\d{2}$/.test(m)).sort();
  const lines = [row(['Group', 'Category', ...months])];
  const cats = Object.entries(budget.categories || {}).sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0));
  for (const [id, c] of cats) lines.push(row([c.group || '', c.name, ...months.map(m => dollars(budget.assigned[m]?.[id] || 0))]));
  return `${lines.join('\r\n')}\r\n`;
}

/** A file name from the budget's name and a date, safe on every system. */
export const exportName = (name, kind, date) => `${String(name || 'budget').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'budget'}-${kind}-${date}.csv`;
