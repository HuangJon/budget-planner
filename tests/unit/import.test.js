import test from 'node:test'; import assert from 'node:assert/strict';
import { parseCsv, readStatement, markExisting, guessCategory, readDate, cleanDescription, importName } from '../../js/core/import.js';

// Made-up rows in the layouts Chase uses. No real statements live in this repo.
const CARD = `Transaction Date,Post Date,Description,Category,Type,Amount,Memo
11/04/2026,11/06/2026,SAMPLE OPTICAL  0001,Health & Wellness,Sale,-125.00,
11/03/2026,11/05/2026,SQ *SAMPLE COFFEE &amp; DES,Food & Drink,Sale,-11.81,
11/02/2026,11/04/2026,CORNER MART,Groceries,Sale,-0.89,
11/02/2026,11/03/2026,CORNER MART,Groceries,Sale,-0.89,
11/01/2026,11/03/2026,UBER RIDES,Travel,Sale,-12.98,
10/30/2026,10/30/2026,SAMPLE CLOTHING INC,Shopping,Return,609.70,
10/29/2026,10/29/2026,Payment Thank You-Mobile,,Payment,2144.86,
`;
const CHECKING = `Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #
CREDIT,11/01/2026,"SAMPLE EMPLOYER PAYROLL PPD ID: 000",2500.00,ACH_CREDIT,4000.00,,
DEBIT,11/02/2026,"Payment to Chase card ending in 0000 11/02",-800.00,LOAN_PMT,1500.00,,
DEBIT,11/03/2026,"SAMPLE ELECTRIC CO BILL PAY",-92.10,ACH_DEBIT,3200.00,,
`;

test('reads quoted cells, commas and line breaks inside quotes', () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""e"""\r\n1,"two\nlines",3\n'), [['a', 'b, c', 'd "e"'], ['1', 'two\nlines', '3']]);
});

test('dates and descriptions come out tidy', () => {
  assert.equal(readDate('11/4/26'), '2026-11-04');
  assert.equal(readDate('2026-11-04'), '2026-11-04');
  assert.equal(readDate('02/30/2026'), null);
  assert.equal(cleanDescription('SQ *A  &amp;  B'), 'SQ *A & B');
});

test('a Chase card file: purchases are spending, returns are refunds, the card payment is skipped', () => {
  const { format, rows } = readStatement(CARD);
  assert.equal(format, 'chase-card');
  assert.equal(rows.length, 7);
  assert.deepEqual(rows[0], { key: rows[0].key, date: '2026-11-04', description: 'SAMPLE OPTICAL 0001', amount: 12500, kind: 'spend', bankCategory: 'Health & Wellness', skip: null });
  assert.equal(rows[1].description, 'SQ *SAMPLE COFFEE & DES');
  assert.equal(rows[5].kind, 'refund');
  assert.equal(rows[5].amount, 60970);
  assert.equal(rows[6].skip, 'payment');
  assert.notEqual(rows[2].key, rows[3].key, 'two identical small purchases are two transactions');
});

test('a Chase checking file: pay is income, paying the card is skipped, bills are spending', () => {
  const { format, rows } = readStatement(CHECKING);
  assert.equal(format, 'chase-checking');
  assert.deepEqual(rows.map(r => [r.kind, r.amount, r.skip]), [['income', 250000, null], ['spend', 80000, 'card'], ['spend', 9210, null]]);
});

test('other banks work with Debit and Credit columns', () => {
  const { rows } = readStatement('Date,Payee,Debit,Credit\n2026-11-01,Shop,12.50,\n2026-11-02,Refund,,3.00\n');
  assert.deepEqual(rows.map(r => [r.kind, r.amount]), [['spend', 1250], ['income', 300]]);
});

test('a file without dates and amounts is refused clearly', () => {
  assert.throws(() => readStatement('Name,Email\nSam,sam@example.com\n'), { code: 'unknown-format' });
});

test('the same file twice gives the same ids, so importing again adds nothing new', () => {
  const first = readStatement(CARD).rows, again = readStatement(CARD).rows;
  assert.deepEqual(first.map(r => r.key), again.map(r => r.key));
  const saved = first.filter(r => !r.skip).map(r => ({ id: r.key, amount: r.amount, kind: r.kind, date: r.date }));
  assert.ok(markExisting(again, saved).every(r => r.skip));
});

test('one typed in by hand is spotted: same amount within 3 days, matched once', () => {
  const rows = readStatement(CARD).rows;
  const typed = [{ id: 'abc', kind: 'spend', amount: 89, date: '2026-11-03' }, { id: 'old', kind: 'spend', amount: 12500, date: '2026-10-01' }];
  const marked = markExisting(rows, typed);
  assert.equal(marked[2].skip, 'already');
  assert.equal(marked[3].skip, null, 'the second identical purchase is still new');
  assert.equal(marked[0].skip, null, 'a month apart is a different purchase');
});

test('categories: your past choice first, then common words, then the bank’s category', () => {
  const cats = { g: { name: 'Groceries' }, e: { name: 'Eating out' }, t: { name: 'Transport' }, h: { name: 'Health' } };
  const rows = readStatement(CARD).rows;
  assert.equal(guessCategory(rows[4], cats, []), 't', 'Uber is transport, though Chase calls it Travel');
  assert.equal(guessCategory(rows[0], cats, []), 'h', 'from Chase’s Health & Wellness');
  assert.equal(guessCategory(rows[2], cats, []), 'g');
  assert.equal(guessCategory(rows[2], cats, [{ description: 'corner mart', categoryId: 'e', kind: 'spend' }]), 'e', 'how you filed it last time wins');
});

test('one imported then deleted can be imported again', () => {
  const rows = readStatement(CARD).rows;
  const marked = markExisting(rows, [{ id: rows[0].key, amount: rows[0].amount, kind: 'spend', date: rows[0].date, deleted: true }]);
  assert.equal(marked[0].skip, null);
});

test('an Ally file: bills tidy, card payments and transfers left out, interest is income', () => {
  const ally = `Date, Time, Amount, Type, Description
2026-11-09,00:57:50,-10.00,Withdrawal,SAMPLE WIRELESS PAYMENTS~ Future Amount: 10.00 ~ Tran: ACHDW
2026-10-25,23:26:49,0.20,Deposit,Interest Paid
2026-10-20,01:09:01,-27.85,Withdrawal,NGRID38 NGRID38WEB~ Future Amount: 27.85 ~ Tran: ACHDW
2026-10-13,04:38:01,-107.16,Withdrawal,CHASE CREDIT CRD EPAY
2026-10-10,18:41:17,3000.00,Deposit,Internet transfer from Savings account XXXXXX0000
`;
  const { rows } = readStatement(ally);
  assert.deepEqual(rows.map(r => [r.description, r.kind, r.amount, r.skip]), [
    ['SAMPLE WIRELESS PAYMENTS', 'spend', 1000, null],
    ['Interest Paid', 'income', 20, null],
    ['NGRID38 NGRID38WEB', 'spend', 2785, null],
    ['CHASE CREDIT CRD EPAY', 'spend', 10716, 'card'],
    ['Internet transfer from Savings account XXXXXX0000', 'income', 300000, 'transfer'],
  ]);
  assert.equal(guessCategory(rows[2], { u: { name: 'Utilities' } }, []), 'u');
});

test('an Ally savings file: Zelle shows who it went to, a brokerage transfer is Investing', () => {
  const { rows } = readStatement(`Date, Time, Amount, Type, Description
2026-11-04,16:19:15,5000.00,Deposit,SAMPLE EMPLOYER PAYROLL
2026-10-25,21:38:58,-1000.00,Withdrawal,Zelle payment from Sam Person (Ally Savings Account XXXXXX0000) to PAT  LANDLORD
2026-10-10,18:41:17,-3000.00,Withdrawal,Internet transfer to Spending account XXXXXX0000
2026-09-18,12:42:54,-500.00,Withdrawal,FID BKG SVC LLC MONEYLINE
`);
  assert.deepEqual(rows.map(r => [r.description, r.kind, r.skip]), [
    ['SAMPLE EMPLOYER PAYROLL', 'income', null],
    ['Zelle to PAT LANDLORD', 'spend', null],
    ['Internet transfer to Spending account XXXXXX0000', 'spend', 'transfer'],
    ['FID BKG SVC LLC MONEYLINE', 'spend', null],
  ]);
  assert.equal(guessCategory(rows[3], { i: { name: 'Investing' }, s: { name: 'Shopping' } }, []), 'i');
});

test('moving money between the bank and your own Venmo is left out', () => {
  const { rows } = readStatement(`Date, Time, Amount, Type, Description
2026-11-02,10:00:00,120.00,Deposit,VENMO CASHOUT
2026-11-03,10:00:00,-50.00,Withdrawal,VENMO ADD FUNDS
2026-11-04,10:00:00,-30.00,Withdrawal,VENMO PAYMENT 1234
`);
  assert.deepEqual(rows.map(r => r.skip), ['transfer', 'transfer', null], 'paying someone through Venmo from the bank is still spending');
});

test('an import is named after its account and months until one is typed', () => {
  assert.equal(importName('Chase card', 'Chase1234.CSV', ['2026-10-03', '2026-05-01', '2026-07-09']), 'Chase card May – Oct 2026');
  assert.equal(importName('', 'Chase1234.CSV', ['2026-11-02']), 'Chase1234 Nov 2026');
  assert.equal(importName('Ally', 'x.csv', ['2025-12-30', '2026-01-02']), 'Ally Dec 2025 – Jan 2026');
  assert.equal(importName('', '', []), 'Bank file');
});
