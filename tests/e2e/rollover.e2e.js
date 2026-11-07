// The app left open across the end of a month moves to the new month, with leftovers carried in.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

execFileSync('node', ['tools/build-preview.mjs', '.', 'preview.html']);
writeFileSync('preview-test.html', `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${readFileSync('preview.html', 'utf8')}`);
const fail = m => { throw new Error(m); };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
await page.clock.install({ time: new Date('2026-11-30T23:58:00') });
await page.addInitScript(() => localStorage.setItem('wmm:tourDone', '1'));
await page.goto(pathToFileURL(resolve('preview-test.html')).href);
await page.locator('a.budget-row').click();
await page.locator('.monthbar h2', { hasText: 'November 2026' }).waitFor();
const groceriesNov = await page.locator('.cat-row', { hasText: 'Groceries' }).locator('.cat-avail .amt').innerText();
await page.clock.fastForward('03:00');
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.locator('.monthbar h2', { hasText: 'December 2026' }).waitFor();
if (await page.locator('.away-pill').count()) fail('December should be the current month, not a "future month"');
const groceriesDec = await page.locator('.cat-row', { hasText: 'Groceries' }).locator('.cat-avail .amt').innerText();
if (groceriesDec !== groceriesNov) fail(`Groceries should carry ${groceriesNov} into December, got ${groceriesDec}`);
// December's paychecks repeat on the 1st, so income is already ticked; planning is next.
await page.locator('.new-month', { hasText: 'New month: December 2026' }).waitFor();
// The repeating paychecks are added on arrival and show up a moment later, as on a phone.
await page.locator('.nm-steps li.done', { hasText: 'income' }).waitFor({ timeout: 5000 }).catch(() => fail('Repeating paychecks should tick off the income step'));
if (await page.locator('.nm-steps li.done', { hasText: 'Plan money' }).count()) fail('Planning is not done yet');
if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/new-month.png` });
await page.locator('.nm-steps a', { hasText: 'Plan money' }).click();
await page.locator('[data-action=plan-copy]').click();
await page.locator('.topbar a.btn').click();
await page.locator('.new-month').waitFor({ state: 'detached', timeout: 5000 }).catch(() => fail('Checklist should go once income is in and money is planned'));
await browser.close();
console.log('Rollover test passed');
