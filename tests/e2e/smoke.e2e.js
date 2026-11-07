// Opens the built preview on a phone-size screen, walks every screen and main action, and fails on any page error.
// Screenshots go to $SHOTS (if set) in every theme.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

execFileSync('node', ['tools/build-preview.mjs', '.', 'preview.html']);
// The preview viewer wraps the page with a charset and phone viewport; do the same here.
writeFileSync('preview-test.html', `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${readFileSync('preview.html', 'utf8')}`);
const shots = process.env.SHOTS;
const browser = await chromium.launch();
const errors = [];
const fail = m => { throw new Error(m); };
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
page.on('pageerror', e => errors.push(e.message));
// Web fonts come from Google and may be unreachable where tests run; the app falls back to system fonts.
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
await page.goto(pathToFileURL(resolve('preview-test.html')).href);
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };
const tap = sel => page.locator(sel).first().click();

await page.getByText('Home', { exact: true }).waitFor();
await shot('home');
await tap('a.budget-row');
await page.locator('[data-testid=ready]').waitFor();
const ready = async () => page.locator('[data-testid=ready]').innerText();
const before = await ready();
await shot('budget-blue');

// Fund bills and targets, then undo.
await tap('[data-action=fund-targets]');
if ((await ready()) === before) fail('Funding targets did not change Ready to assign');
await tap('#toast [data-action=undo]');
if ((await ready()) !== before) fail('Undo did not restore Ready to assign');

// Cover the overspent category.
await tap('.over [data-action=cover]');
await page.locator('dialog[open]').waitFor();
await shot('cover-sheet');
await tap('[data-action=cover-auto]');
await page.locator('dialog .over-panel').waitFor({ state: 'detached' });
await tap('[data-action=close-sheet]');
if (await page.locator('.over').count()) fail('Still overspent after covering');

// Open a category, assign, set a target.
await tap('.cat-row');
await page.fill('#assignAmt', '123.45');
await tap('[data-action=assign-save]');
await page.fill('#targetAmt', '50');
await page.selectOption('#targetDue', '15');
await tap('[data-action=target-save]');
await shot('category-sheet');
await tap('[data-action=close-sheet]');

// Add spending with a suggested category.
await tap('.add-tab');
await page.fill('#fAmount', '18.50');
await page.locator('#fDesc').pressSequentially('Trader Joe');
const cat = await page.locator('#fCat').inputValue();
if (!cat) fail('No category suggested for groceries');
await shot('add-form');
await page.locator('.sheet-head h2').tap(); // tap away to close the keyboard
await tap('[data-action=tx-save]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });

// Income has no category.
await tap('.add-tab');
await tap('[data-action=tx-kind][data-id=income]');
if (await page.locator('#fCat').count()) fail('Income should not ask for a category');
await page.fill('#fAmount', '100');
await page.fill('#fDesc', 'Gift');
await page.locator('.sheet-head h2').tap();
await tap('[data-action=tx-save]');

// Activity, edit and delete with undo.
await tap('a.tab[href$="-activity"]');
await page.locator('.tx-row').first().waitFor();
await shot('activity');
const count = await page.locator('.tx-row').count();
await tap('.tx-row');
await tap('[data-action=tx-delete]');
if (await page.locator('.tx-row').count() !== count - 1) fail('Delete did not remove the row');
await tap('#toast [data-action=undo]');
if (await page.locator('.tx-row').count() !== count) fail('Undo did not restore the row');

// Months.
await tap('[data-action=month][data-id="-1"]');
await page.getByText('Back to this month').waitFor();
await tap('[data-action=month][data-id=now]');

// Categories editor: add, hide, show.
await tap('a.tab[href^="#b-"]:not([href$="-activity"])');
await tap('[data-action=account]');
await tap('[data-action=edit-cats]');
await page.fill('#newCatName', 'Pets');
await tap('[data-action=cat-add]');
await page.locator('.edit-row input[value="Pets"]').waitFor();
await shot('categories');
await tap('[data-action=close-sheet]');
if (!(await page.getByText('Pets', { exact: true }).count())) fail('New category not on the budget');

// New budget.
await page.goto(pathToFileURL(resolve('preview-test.html')).href + '#home');
await tap('[data-action=new-budget]');
await page.fill('#nbName', 'Test budget');
await page.locator('.sheet-head h2').tap();
await tap('[data-action=nb-save]');
await page.locator('[data-testid=ready]').waitFor();
if ((await ready()) !== '$0.00') fail('New budget should start at $0.00');

// Every theme, on the example budget.
await page.goto(pathToFileURL(resolve('preview-test.html')).href + '#home');
await tap('a.budget-row');
for (const look of ['light', 'dark', 'pride']) {
  await tap('[data-action=account]');
  await tap(`[data-action=set-look][data-id=${look}]`);
  await tap('[data-action=close-sheet]');
  await shot(`budget-${look}`);
}
await page.emulateMedia({ colorScheme: 'dark' });
await tap('[data-action=account]');
await tap('[data-action=set-look][data-id=blue]');
await tap('[data-action=close-sheet]');
await shot('budget-blue-darkmode');

// No sideways scrolling on a small phone.
await page.setViewportSize({ width: 320, height: 640 });
const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
if (wide) fail('The page scrolls sideways at 320px');

await browser.close();
if (errors.length) fail(`Page errors:\n${errors.join('\n')}`);
console.log('Smoke test passed');
