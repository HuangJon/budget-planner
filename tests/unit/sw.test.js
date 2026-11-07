import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { APP_VERSION } from '../../js/config/app.js';

const sw = readFileSync('sw.js', 'utf8');
const listed = new Set([...sw.matchAll(/'(\.\/[^']+)'/g)].map(m => m[1]));

test('every app file is kept for offline use', () => {
  for (const dir of ['css', 'js/config', 'js/core', 'js/data', 'js/ui']) {
    for (const f of readdirSync(dir)) {
      if (/\.(css|js)$/.test(f)) assert.ok(listed.has(`./${dir}/${f}`), `${dir}/${f} is missing from sw.js`);
    }
  }
  assert.ok(listed.has('./js/main.js'));
  for (const f of listed) if (f !== './') assert.doesNotThrow(() => readFileSync(f.slice(2)), `${f} is listed but doesn't exist`);
});

test('the offline cache and the app version move together', () => {
  assert.equal(sw.match(/const CACHE = '([^']+)'/)[1], APP_VERSION, 'bump both for every release');
});
