/**
 * Reads a bank's CSV download into transactions to review. Knows Chase credit card and Chase
 * checking files by their headings, and any CSV with a date, a description and an amount.
 * Nothing here saves anything: the review screen decides what goes in.
 */
import { toCents } from './money.js';
import { suggestCategory } from './categorize.js';

/** Splits CSV text into rows of cells, handling quotes, commas and line breaks inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
/** Banks send "COFFEE &amp; DES" and runs of spaces; tidy that up. */
export const cleanDescription = s => String(s || '')
  .replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e) => ENTITIES[e])
  // Ally adds "~ Future Amount: 27.85 ~ Tran: ACHDW" after the name; it says nothing new.
  .replace(/\s*~.*$/, '')
  // "Zelle payment from PAT SMITH (Savings Account XXXX) to SAM LEE": who it went to is what matters.
  .replace(/^zelle payment from .*?\bto\s+(.+)$/i, 'Zelle to $1')
  .replace(/^zelle payment to\s+(.+?)\s+from\s+.*$/i, 'Zelle to $1')
  .replace(/\s+/g, ' ').trim().slice(0, 80);

/** "11/04/2026", "11/4/26" or "2026-11-04" to "2026-11-04". */
export function readDate(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  return null;
}
function iso(y, mo, d) {
  const x = new Date(Date.UTC(y, mo - 1, d));
  if (x.getUTCFullYear() !== y || x.getUTCMonth() !== mo - 1 || x.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const head = h => String(h || '').trim().toLowerCase();
const find = (heads, names) => heads.findIndex(h => names.includes(h));

/** Card payments and moves between your own accounts: real, but not spending or income. */
const CARD_PAYMENT = /payment thank you|autopay|payment to chase card|credit crd|crd epay|card payment|cardmember serv|amex epayment|discover e-?payment|capital one.*pmt|citi.*autopay/i;
const MOVING = /online transfer|internet transfer|transfer (to|from)|zelle payment to .* (savings|checking)/i;

export const SKIP = {
  payment: 'Paying the card off. Your spending is already counted from the purchases.',
  transfer: 'Looks like moving money between your own accounts.',
  card: 'Paying off a credit card. The purchases count when you import that card.',
  already: 'Looks like one that’s already in.',
  imported: 'Already imported.',
};

/**
 * Turns CSV text into rows to review: { key, date, description, amount (cents, positive),
 * kind: 'spend' | 'refund' | 'income', bankCategory, skip: one of SKIP's keys or null }.
 * Throws { code: 'unknown-format' } when it can't find dates and amounts.
 */
export function readStatement(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw Object.assign(new Error('That file is empty.'), { code: 'empty' });
  const heads = rows[0].map(head);
  const at = {
    date: find(heads, ['transaction date', 'date', 'posting date', 'posted date', 'trans. date']),
    desc: find(heads, ['description', 'payee', 'name', 'merchant', 'memo']),
    amount: find(heads, ['amount', 'amount (usd)']),
    debit: find(heads, ['debit', 'withdrawal', 'withdrawals']),
    credit: find(heads, ['credit', 'deposit', 'deposits']),
    type: find(heads, ['type']),
    details: find(heads, ['details']),
    category: find(heads, ['category']),
  };
  if (at.date < 0 || at.desc < 0 || (at.amount < 0 && at.debit < 0 && at.credit < 0)) {
    throw Object.assign(new Error('Couldn’t find dates, descriptions and amounts in that file.'), { code: 'unknown-format' });
  }
  const format = heads.includes('post date') && at.category >= 0 ? 'chase-card' : at.details >= 0 && heads.includes('posting date') ? 'chase-checking' : 'other';
  const out = [];
  const seen = new Map();
  for (const r of rows.slice(1)) {
    const date = readDate(r[at.date]);
    if (!date) continue;
    // Money out is negative in one Amount column, or split across Debit and Credit columns.
    const signedCents = at.amount >= 0 ? toCents(r[at.amount]) : toCents(r[at.credit]) - Math.abs(toCents(r[at.debit]));
    if (!signedCents) continue;
    const description = cleanDescription(r[at.desc]);
    const type = head(r[at.type]);
    let kind, skip = null;
    if (format === 'chase-card') {
      kind = signedCents < 0 ? 'spend' : 'refund';
      if (type === 'payment' || CARD_PAYMENT.test(description) || MOVING.test(description)) skip = 'payment';
    } else {
      kind = signedCents < 0 ? 'spend' : 'income';
      if (CARD_PAYMENT.test(description)) skip = 'card';
      else if (/acct_xfer|loan_pmt/.test(type) || MOVING.test(description)) skip = 'transfer';
    }
    // The same purchase always gets the same id, so importing an overlapping file skips it.
    const base = [date, r[heads.indexOf('post date')] || r[heads.indexOf('posting date')] || '', description.toLowerCase(), signedCents].join('|');
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    out.push({ key: `i-${hash(`${base}|${n}`)}`, date, description, amount: Math.abs(signedCents), kind, bankCategory: at.category >= 0 ? String(r[at.category] || '').trim() : '', skip });
  }
  return { format, rows: out };
}

/** A short, stable fingerprint (two 32-bit FNV-1a hashes). */
function hash(s) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(36) + b.toString(36);
}

/**
 * Marks rows that are already in the budget: imported before (same key), or typed in by hand
 * with the same amount within 3 days. Each existing transaction matches at most one row.
 * One imported and then deleted counts as not there, so it can be brought back.
 */
export function markExisting(rows, existing) {
  const live = (existing || []).filter(t => !t.deleted);
  const ids = new Set(live.map(t => t.id));
  const free = live.filter(t => !t.id.startsWith('i-'));
  const used = new Set();
  const days = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
  return rows.map(r => {
    if (ids.has(r.key)) return { ...r, skip: 'imported' };
    if (r.skip) return r;
    const twin = free.find(t => !used.has(t.id) && t.amount === r.amount && t.kind === r.kind && Math.abs(days(t.date) - days(r.date)) <= 3);
    if (!twin) return r;
    used.add(twin.id);
    return { ...r, skip: 'already', twin: twin.id };
  });
}

/** Chase's own categories, as a fallback when the description alone doesn't say. */
const BANK = {
  'food & drink': ['eating out', 'dining', 'restaurants'],
  groceries: ['groceries'],
  gas: ['transport', 'transportation', 'gas'],
  automotive: ['transport', 'transportation', 'car'],
  travel: ['travel', 'transport', 'transportation'],
  'bills & utilities': ['utilities', 'bills', 'phone', 'internet'],
  'health & wellness': ['medical', 'health', 'health & wellness', 'fitness'],
  entertainment: ['entertainment', 'fun'],
  shopping: ['shopping', 'clothes'],
  personal: ['personal care', 'personal', 'shopping'],
  home: ['household', 'home'],
  'gifts & donations': ['gifts', 'giving', 'donations'],
  education: ['education', 'school'],
};
const norm = s => String(s || '').trim().toLowerCase();

/** Your own history first (how you filed this place last time), then common words, then Chase's category. */
export function guessCategory(row, categories, past) {
  if (row.kind === 'income') return null;
  const live = Object.entries(categories || {}).filter(([, c]) => !c.hidden);
  const text = norm(row.description);
  const mine = [...(past || [])].reverse().find(t => !t.deleted && t.kind !== 'income' && norm(t.description) === text && categories[t.categoryId] && !categories[t.categoryId].hidden);
  if (mine) return mine.categoryId;
  const guess = suggestCategory(row.description, categories, []);
  if (guess) return guess;
  const byName = new Map(live.map(([id, c]) => [norm(c.name), id]));
  for (const n of BANK[norm(row.bankCategory)] || []) if (byName.has(n)) return byName.get(n);
  return null;
}
