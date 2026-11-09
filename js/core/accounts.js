/**
 * Checking the budget against real accounts. The budget tracks what money is for; the accounts
 * say where it actually sits. Added up, they should be the same: everything in bank accounts,
 * cash and Venmo, minus what's owed on credit cards, equals all the money the budget holds.
 */
import { budgetTransactions } from './budget.js';

export const ACCOUNT_KINDS = { cash: 'Bank, cash or Venmo', card: 'Credit card' };
export const MAX_ACCOUNTS = 20;

/** All the money the budget holds today: everything that came in, less everything that went out. Future-dated repeats don't count yet. */
export function budgetMoney(transactionList, today, budget = {}) {
  let total = 0;
  for (const t of budgetTransactions(budget, transactionList)) {
    if (!t.date || t.date > today) continue;
    total += t.kind === 'spend' ? -t.amount : t.amount;
  }
  return total;
}

/** What the accounts add up to: balances, less what's owed on cards. */
export function accountsMoney(accounts) {
  return Object.values(accounts || {}).reduce((a, x) => a + (x.kind === 'card' ? -Math.abs(x.balance || 0) : (x.balance || 0)), 0);
}

/** The two totals side by side, and how far apart they are (positive: the budget shows more than the accounts hold). */
export function accountCheck(budget, transactionList, today) {
  const accounts = Object.entries(budget.accounts || {}).map(([id, a]) => ({ id, ...a }));
  const inAccounts = accountsMoney(budget.accounts);
  const inBudget = budgetMoney(transactionList, today, budget);
  const updated = accounts.map(a => a.updatedAt || 0);
  return { accounts, inAccounts, inBudget, gap: inBudget - inAccounts, oldest: updated.length ? Math.min(...updated) : null };
}
