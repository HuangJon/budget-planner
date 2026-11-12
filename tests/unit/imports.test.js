import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSpan, importMonths, importGrid, unfiled } from '../../js/core/imports.js';

const tx = (id, date, extra = {}) => ({ id, date, kind: 'spend', amount: 100, ...extra });
const txs = [tx('a', '2026-10-03'), tx('b', '2026-10-28'), tx('c', '2026-11-02'), tx('d', '2026-09-15'), tx('i-old', '2026-08-01')];
const byId = new Map(txs.map(t => [t.id, t]));

test('an import covers the dates of its file, or of its rows for older ones', () => {
  assert.deepEqual(importSpan({ ids: ['a', 'b'] }, byId), { from: '2026-10-03', to: '2026-10-28' });
  assert.deepEqual(importSpan({ ids: ['a'], from: '2026-09-29', to: '2026-10-30' }, byId), { from: '2026-09-29', to: '2026-10-30' });
  assert.deepEqual(importMonths({ ids: ['a', 'c'] }, byId), ['2026-10', '2026-11']);
  assert.deepEqual(importMonths({ ids: [], from: '2026-01-01', to: '2026-10-30' }, byId), ['2026-07', '2026-08', '2026-09', '2026-10'], 'a long file keeps its last months');
});

test('imports sit in a grid of months by account, with gaps where one is missing', () => {
  const accounts = { chase: { name: 'Chase' }, ally: { name: 'Ally' } };
  const recs = [
    { id: 'r1', accountId: 'chase', ids: ['d'] },
    { id: 'r2', accountId: 'chase', ids: ['c'] },
    { id: 'r3', accountId: 'ally', ids: ['a', 'b'] },
    { id: 'r4', accountId: null, ids: ['i-old'] },
  ];
  const g = importGrid(recs, txs, accounts, '2026-11');
  assert.deepEqual(g.months, ['2026-11', '2026-10', '2026-09', '2026-08']);
  assert.deepEqual(g.columns, ['ally', 'chase', '']);
  assert.deepEqual(g.at('2026-11', 'chase').map(r => r.id), ['r2']);
  assert.equal(g.gap('2026-10', 'chase'), true, 'Chase had imports before and after October');
  assert.equal(g.gap('2026-08', 'chase'), false, 'before Chase’s first import is not a gap');
  assert.equal(g.gap('2026-11', 'ally'), true);
  assert.equal(g.gap('2026-10', ''), false, 'no account never counts as missing');
});

test('rows from files brought in before imports were recorded are unfiled', () => {
  assert.deepEqual(unfiled([...txs, tx('i-x', '2026-10-01', { importId: 'r9' }), tx('i-y', '2026-10-01', { deleted: true })]).map(t => t.id), ['i-old']);
});
