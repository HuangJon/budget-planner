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

// Cover the overspent category from the notice.
await tap('.over [data-action=open-cat]');
await page.locator('dialog[open] .over-panel').waitFor();
await shot('cover-sheet');
await tap('[data-action=cover-auto]');
await page.locator('dialog .over-panel').waitFor({ state: 'detached' });
await tap('[data-action=close-sheet]');
if (await page.locator('.over').count()) fail('Still overspent after covering');

// Plan money: typing counts Ready to assign down live, leaving the box saves it.
await tap('a.hero-btn');
await page.locator('#planReady').waitFor();
const planBefore = await page.locator('#planReady').innerText();
const firstBox = page.locator('[data-plan]').nth(3);
await firstBox.fill('');
await firstBox.pressSequentially('25');
const planTyped = await page.locator('#planReady').innerText();
if (planTyped === planBefore) fail('Ready to assign did not update while typing');
await page.locator('[data-plan]').nth(4).focus();
await page.waitForTimeout(50);
if ((await page.locator('#planReady').innerText()) !== planTyped) fail('Leaving the box changed the total');
if (!(await page.locator('[data-plan]').nth(4).evaluate(el => el === document.activeElement))) fail('Focus was lost after saving a box');
await shot('plan');
await tap('[data-action=fund-targets]');
await tap('.topbar a.btn');
await page.locator('[data-testid=ready]').waitFor();
if ((await ready()) === before) fail('Planning did not change Ready to assign');

// A category: add spending with it already picked, change the plan, set a yearly target.
await page.locator('.cat-row', { hasText: 'Groceries' }).click();
await tap('[data-action=cat-spend]');
if ((await page.locator('#fCat option:checked').innerText()) !== 'Groceries') fail('Add spending did not pick the category');
await page.fill('#fAmount', '12');
await page.locator('.sheet-head h2').tap();
await tap('[data-action=tx-save]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });
await page.locator('.cat-row', { hasText: 'Entertainment' }).click();
await tap('[data-action=cat-plan]');
await page.fill('#assignAmt', '123.45');
await tap('[data-action=assign-save]');
await tap('[data-action=cat-open][data-id=target]');
await tap('[data-action=target-kind][data-id=yearly]');
await page.fill('#targetAmt', '2000');
await tap('[data-action=target-save]');
await page.locator('dialog .form-row-value', { hasText: '$2,000.00 a year' }).waitFor();
await shot('category-sheet');
await tap('[data-action=close-sheet]');
await page.locator('.cat-row', { hasText: 'Vacation' }).locator('.bar.save').waitFor();

// Spend from the bottom bar, with a suggested category.
await tap('.spend-tab');
await page.fill('#fAmount', '18.50');
await page.locator('#fDesc').pressSequentially('Trader Joe');
if (!(await page.locator('#fCat').inputValue())) fail('No category suggested for groceries');
await shot('add-form');
await page.locator('.sheet-head h2').tap(); // tap away to close the keyboard
await tap('[data-action=tx-save]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });

// Income has no category.
await tap('.spend-tab');
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

// Categories editor: add one.
await tap('a.tab[href^="#b-"]:not([href$="-activity"])');
await tap('[data-action=account]');
await tap('[data-action=edit-cats]');
await page.fill('#newCatName', 'Pets');
await tap('[data-action=cat-add]');
await page.locator('.edit-row input[value="Pets"]').waitFor();
await shot('categories');
await tap('[data-action=close-sheet]');
if (!(await page.getByText('Pets', { exact: true }).count())) fail('New category not on the budget');

// Starting a budget: name, money you have, categories, then straight to Plan money.
await page.goto(pathToFileURL(resolve('preview-test.html')).href + '#home');
await tap('[data-action=new-budget]');
await page.fill('#nbName', 'Test budget');
await page.locator('.sheet-head h2').tap();
await tap('[data-action=nb-next]');
await page.fill('#nbMoney', '1,500');
await page.locator('.sheet-head h2').tap();
await tap('[data-action=nb-next]');
await tap('[data-action=nb-pick][data-id=Pets]');
await shot('setup-categories');
await tap('[data-action=nb-next]');
await page.locator('#planReady').waitFor();
if ((await page.locator('#planReady').innerText()) !== '$1,500.00') fail('Starting money should be ready to assign');
if (!(await page.locator('label.cat-name', { hasText: 'Pets' }).count())) fail('Picked category missing');
await shot('setup-plan');

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
