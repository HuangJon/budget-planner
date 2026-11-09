/**
 * Check against your accounts: list the accounts money really sits in (bank, Venmo, cards), type
 * their balances now and then, and see whether they add up to what the budget holds. A gap usually
 * means a transaction is missing or entered twice. Names and balances only, never account numbers.
 */
import { A, actions, changes } from './state.js';
import { esc, openSheet, sheetHead, openChild, registerSheet, toast, send, val, today } from './dom.js';
import { money, toCents } from '../core/money.js';
import { accountCheck, ACCOUNT_KINDS, MAX_ACCOUNTS } from '../core/accounts.js';
import { randomId } from '../core/ids.js';

const budget = () => A.budgets[A.sheet?.budgetId];
const ago = at => {
  if (!at) return 'not updated yet';
  const days = Math.floor((Date.now() - at) / 864e5);
  return days <= 0 ? 'updated today' : days === 1 ? 'updated yesterday' : `updated ${days} days ago`;
};

/** `afterImport`: how many rows were just imported, to show this as the last step of an import. */
export function openAccounts(budgetId, { afterImport = 0 } = {}) {
  openChild({ kind: 'accounts', budgetId, adding: false, afterImport }, drawAccounts);
}

/**
 * The bar under Ready to assign (and at the top of Activity): bring in transactions, then see at a
 * glance whether the budget still matches your accounts and how fresh the balances are.
 */
export function syncBar(b) {
  const r = accountCheck(b, A.transactions[b.id] || [], today());
  const age = r.oldest ? Math.floor((Date.now() - r.oldest) / 864e5) : null;
  const when = age === null ? '' : age <= 0 ? ' · today' : age === 1 ? ' · yesterday' : ` · ${age} days ago`;
  const status = !r.accounts.length
    ? { cls: '', text: 'Check your accounts' }
    : Math.abs(r.gap) < 100
      ? { cls: 'ok', text: `✓ Accounts match${when}` }
      : { cls: 'off', text: `Accounts off by ${money(Math.abs(r.gap))}${when}` };
  return `<div class="sync-bar">
    <button type="button" class="btn small" data-action="open-import">Import from your bank</button>
    <button type="button" class="btn small acc-status ${status.cls}" data-action="open-accounts">${esc(status.text)}</button>
  </div>`;
}

function verdict(r) {
  if (!r.accounts.length) return '<p class="small muted">Add the accounts your money is in. Then you can see whether the budget matches them.</p>';
  const off = Math.abs(r.gap);
  const head = off < 100
    ? '<p class="acc-verdict ok"><strong>They match.</strong> Every dollar in your accounts is in the budget.</p>'
    : `<p class="acc-verdict off"><strong>Off by ${money(off)}.</strong> The budget has ${r.gap > 0 ? 'more' : 'less'} than your accounts.</p>`;
  const why = off < 100 ? '' : r.gap > 0
    ? '<ul class="small muted acc-why"><li>Spending that isn’t in the budget yet, from an account you haven’t imported lately.</li><li>Income added twice.</li><li>A card balance that’s out of date.</li></ul>'
    : '<ul class="small muted acc-why"><li>Income, interest or a refund that isn’t in the budget yet.</li><li>Spending added twice, typed and imported.</li><li>A balance that’s out of date.</li></ul>';
  return `${head}${why}`;
}

function drawAccounts() {
  const S = A.sheet, b = budget();
  if (!b) return;
  const r = accountCheck(b, A.transactions[b.id] || [], today());
  openSheet(`<div class="sheet">${sheetHead('Check against your accounts')}<div class="sheet-body">
    ${S.afterImport ? `<p class="notice">Added ${S.afterImport}. Last step: update your balances below to make sure nothing’s missing or doubled.</p>` : ''}
    <p class="small muted">The budget tracks what your money is for. Your accounts say where it sits. Added up, the two should match.</p>
    ${r.accounts.length ? `<section class="panel pad acc-totals">
      <div><span class="label">Your accounts</span><span class="amt">${money(r.inAccounts)}</span></div>
      <div><span class="label">The budget</span><span class="amt">${money(r.inBudget)}</span></div>
    </section>` : ''}
    ${verdict(r)}
    ${r.accounts.length ? `<section class="panel acc-list">${r.accounts.sort((x, y) => (x.kind === y.kind ? String(x.name).localeCompare(y.name) : x.kind === 'card' ? 1 : -1)).map(a => `
      <div class="acc-row">
        <div class="grow stack tight"><strong class="wrap-any">${esc(a.name)}</strong><span class="tiny muted">${esc(ACCOUNT_KINDS[a.kind] || '')} · ${ago(a.updatedAt)}</span></div>
        <label class="money-in small-money"><span class="sr">${a.kind === 'card' ? 'Owed on' : 'Balance of'} ${esc(a.name)}</span><span aria-hidden="true">${a.kind === 'card' ? '−$' : '$'}</span><input class="amount-input" inputmode="decimal" autocomplete="off" value="${(Math.abs(a.balance || 0) / 100).toFixed(2)}" data-change="acc-balance" data-id="${a.id}"></label>
        <button type="button" class="icon-btn small" data-action="acc-remove" data-id="${a.id}" aria-label="Remove ${esc(a.name)}">×</button>
      </div>`).join('')}</section>
      <p class="tiny muted">Type each balance as your bank shows it today. For a card, type what you owe. Pending charges can make a small gap for a few days.</p>` : ''}
    ${S.adding ? `<section class="panel pad stack">
      <input id="accName" maxlength="40" placeholder="Name, like Ally checking or Venmo" autocomplete="off">
      <div class="seg" role="group" aria-label="Kind of account"><button type="button" data-action="acc-kind" data-id="cash" aria-pressed="${S.accKind !== 'card'}">${ACCOUNT_KINDS.cash}</button><button type="button" data-action="acc-kind" data-id="card" aria-pressed="${S.accKind === 'card'}">${ACCOUNT_KINDS.card}</button></div>
      <label class="money-in"><span class="sr">${S.accKind === 'card' ? 'What you owe' : 'Balance'}</span><span aria-hidden="true">$</span><input id="accBalance" class="amount-input" inputmode="decimal" autocomplete="off" placeholder="${S.accKind === 'card' ? 'What you owe' : 'Balance today'}"></label>
      <div class="row gap8"><button type="button" class="btn small primary" data-action="acc-add">Add</button><button type="button" class="btn small" data-action="acc-add-cancel">Cancel</button></div>
    </section>` : r.accounts.length < MAX_ACCOUNTS ? '<button type="button" class="btn" data-action="acc-add-open">Add an account</button>' : ''}
  </div></div>`);
}

const keepTyped = () => {
  if (!document.getElementById('accName')) return;
  A.sheet.draftName = val('accName');
  A.sheet.draftBalance = val('accBalance');
};
const restoreTyped = () => {
  const n = document.getElementById('accName'), m = document.getElementById('accBalance');
  if (n && A.sheet.draftName) n.value = A.sheet.draftName;
  if (m && A.sheet.draftBalance) m.value = A.sheet.draftBalance;
};

actions['open-accounts'] = () => openAccounts(A.route.id);
actions['acc-add-open'] = () => { Object.assign(A.sheet, { adding: true, accKind: 'cash', draftName: '', draftBalance: '' }); drawAccounts(); document.getElementById('accName')?.focus(); };
actions['acc-add-cancel'] = () => { A.sheet.adding = false; drawAccounts(); };
actions['acc-kind'] = el => { keepTyped(); A.sheet.accKind = el.dataset.id; drawAccounts(); restoreTyped(); };
actions['acc-add'] = () => {
  const b = budget(), name = val('accName').trim().slice(0, 40), balance = Math.abs(toCents(val('accBalance')) || 0);
  if (!name) { toast('Name the account first.'); document.getElementById('accName')?.focus(); return; }
  if (Object.keys(b.accounts || {}).length >= MAX_ACCOUNTS) { toast(`Up to ${MAX_ACCOUNTS} accounts.`); return; }
  send(A.repo.saveAccount(b.id, randomId(10), { name, kind: A.sheet.accKind === 'card' ? 'card' : 'cash', balance }));
  A.sheet.adding = false;
  toast(`Added ${name}`);
  drawAccounts();
};
changes['acc-balance'] = el => {
  const b = budget(), a = b?.accounts?.[el.dataset.id];
  if (!a) return;
  const balance = Math.abs(toCents(el.value) || 0);
  send(A.repo.saveAccount(b.id, el.dataset.id, { name: a.name, kind: a.kind, balance }));
};
actions['acc-remove'] = el => {
  const b = budget(), id = el.dataset.id, a = b?.accounts?.[id];
  if (!a) return;
  send(A.repo.removeAccount(b.id, id));
  toast(`Removed ${a.name}`, () => send(A.repo.saveAccount(b.id, id, a)));
};

registerSheet('accounts', drawAccounts);
