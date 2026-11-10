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
/**
 * Waits up to 3 seconds for something to become true, like a person glancing back. The database
 * answers a moment after each change, on phones and in this preview alike.
 */
async function eventually(check, message) {
  for (let i = 0; i < 60; i += 1) { if (await check()) return; await new Promise(r => setTimeout(r, 50)); }
  fail(message);
}
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
// The tour runs on the first budget opened: step through every part, then it stays away.
await page.locator('.tour-card').waitFor();
await shot('tour');
for (let i = 0; i < 10 && await page.locator('.tour-card').count(); i += 1) await page.locator('[data-action=tour-next]').click();
await eventually(async () => !(await page.locator('.tour').count()), 'The tour did not finish');
await page.reload();
await page.locator('[data-testid=ready]').waitFor();
await page.waitForTimeout(200);
await eventually(async () => !(await page.locator('.tour').count()), 'The tour should only run once');
const before = await ready();
await shot('budget-blue');

// Cover the overspent category from the notice.
await tap('.over [data-action=open-cat]');
await page.locator('dialog[open] .over-panel').waitFor();
await shot('cover-sheet');
await tap('[data-action=cover-auto]');
await page.locator('dialog .over-panel').waitFor({ state: 'detached' });
await tap('[data-action=sheet-back]');
await eventually(async () => !(await page.locator('.over').count()), 'Still overspent after covering');

// Plan money: typing counts Ready to assign down live, leaving the box saves it.
await tap('a.hero-btn');
await page.locator('#planReady').waitFor();
const planBefore = await page.locator('#planReady').innerText();
const firstBox = page.locator('[data-plan]').nth(3);
await firstBox.fill('');
await firstBox.pressSequentially('25');
const planTyped = await page.locator('#planReady').innerText();
await eventually(async () => !(planTyped === planBefore), 'Ready to assign did not update while typing');
await page.locator('[data-plan]').nth(4).focus();
await page.waitForTimeout(50);
await eventually(async () => !((await page.locator('#planReady').innerText()) !== planTyped), 'Leaving the box changed the total');
await eventually(async () => !(!(await page.locator('[data-plan]').nth(4).evaluate(el => el === document.activeElement))), 'Focus was lost after saving a box');
await shot('plan');
// Copy last month's plan, then undo everything done on this screen.
await tap('[data-action=plan-copy]');
await page.locator('#toast').filter({ hasText: 'Copied' }).waitFor();
await tap('[data-action=plan-undo]');
await page.locator('#toast').filter({ hasText: 'Back to how the plan was' }).waitFor();
await eventually(async () => !((await page.locator('#planReady').innerText()) !== planBefore), 'Undo did not put Ready to assign back');
// Fund bills and targets shows what it will do first.
await tap('[data-action=fund-show]');
await page.locator('.fund-preview li').first().waitFor();
await shot('fund-preview');
await tap('.fund-preview [data-action=fund-targets]');
await tap('.topbar a.btn');
await page.locator('[data-testid=ready]').waitFor();
await eventually(async () => !((await ready()) === before), 'Planning did not change Ready to assign');

// A category: add spending with it already picked, change the plan, set a yearly target.
await page.locator('.cat-row', { hasText: 'Groceries' }).click();
await tap('[data-action=cat-spend]');
await eventually(async () => !((await page.locator('#fCat option:checked').innerText()) !== 'Groceries'), 'Add spending did not pick the category');
await page.fill('#fAmount', '12');
await page.locator('.sheet-head h2').tap();
await tap('[data-action=tx-save]');
// Saving returns to the category it was added from; Back from there closes it.
await page.locator('.sheet-head h2', { hasText: 'Groceries' }).waitFor();
await tap('[data-action=sheet-back]');
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
await tap('[data-action=sheet-back]');
await page.locator('.cat-row', { hasText: 'Vacation' }).locator('.bar.save').waitFor();

// Spend from the bottom bar, with a suggested category.
await tap('.spend-tab');
await page.fill('#fAmount', '18.50');
await page.locator('#fDesc').pressSequentially('Trader Joe');
await eventually(async () => !(!(await page.locator('#fCat').inputValue())), 'No category suggested for groceries');
await shot('add-form');
await page.locator('.sheet-head h2').tap(); // tap away to close the keyboard
await tap('[data-action=tx-save]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });

// Income comes in from the Ready to assign card, with last paycheck one tap away.
const beforeIncome = await ready();
await tap('[data-action=add-income]');
await page.locator('.sheet-head h2', { hasText: 'Add income' }).waitFor();
await eventually(async () => !(await page.locator('#fCat').count()), 'Income should not ask for a category');
await tap('[data-action=tx-quick]');
await eventually(async () => !(!(await page.locator('#fAmount').inputValue())), 'Tapping a recent paycheck did not fill the amount');
await shot('income-form');
await page.locator('.sheet-head h2').tap();
await tap('[data-action=tx-save]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });
await eventually(async () => !((await ready()) === beforeIncome), 'Income did not add to Ready to assign');

// The Spend form only spends: usual ones are one tap, refunds are a switch, and it can repeat monthly.
await tap('.spend-tab');
await eventually(async () => !(await page.locator('[data-action=tx-kind]').count()), 'Spend form should not offer income');
await tap('[data-action=tx-quick]');
await eventually(async () => !(!(await page.locator('#fDesc').inputValue()) || !(await page.locator('#fCat').inputValue())), 'Quick add did not fill description and category');
await page.fill('#fAmount', '9.99');
await page.fill('#fDesc', 'Music app');
await page.locator('#fCat').selectOption({ label: 'Subscriptions' });
await page.locator('#fRepeat').check();
await page.locator('#repeatHint').filter({ hasText: 'on the' }).waitFor();
await page.locator('.sheet-head h2').tap();
await tap('[data-action=tx-save]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });

// Activity, edit and delete with undo.
await tap('a.tab[href$="-activity"]');
await page.locator('.tx-row').first().waitFor();
// Repeats start folded to one line; open them (the phone remembers).
if (await page.locator('[data-action=open-rule]').count()) fail('Repeats should start folded');
await page.locator('.repeats-head', { hasText: 'Next:' }).waitFor();
await tap('[data-action=toggle-repeats]');
await eventually(async () => !(!(await page.locator('[data-action=open-rule]', { hasText: 'Music app' }).count())), 'New repeat missing from Every month');
await shot('activity');
const count = await page.locator('.tx-list:not(:first-of-type) .tx-row, [data-action=edit-tx].tx-row').count();
await tap('[data-action=edit-tx].tx-row');
await tap('[data-action=tx-delete]');
await eventually(async () => !(await page.locator('[data-action=edit-tx].tx-row').count() !== count - 1), 'Delete did not remove the row');
await tap('#toast [data-action=undo]');
await eventually(async () => !(await page.locator('[data-action=edit-tx].tx-row').count() !== count), 'Undo did not restore the row');

// Stop a repeat from the Every month list.
await page.locator('[data-action=open-rule]', { hasText: 'Music app' }).click();
await tap('[data-action=rule-stop]');
await eventually(async () => !(await page.locator('[data-action=open-rule]', { hasText: 'Music app' }).count()), 'Stopped repeat still listed');

// Trends: summary first, then sections that fold, a range, tappable months, and one category's trend.
await tap('a.tab[href$="-trends"]');
await page.locator('.summary li').first().waitFor();
for (const h of ['Pace this month', 'Coming up', 'Where it went', 'Worth a look', 'Over time', 'Categories over time', 'Biggest purchases', 'Plan vs real', 'Saving', 'Limits and goals', 'By person']) {
  await page.getByRole('heading', { name: h, exact: true }).waitFor();
}
await eventually(async () => !(!(await page.locator('.trend.folded[data-section=where]').count())), 'Lower Trends sections should start folded');
await shot('trends');
for (const k of ['where', 'months', 'people']) await page.locator(`[data-action=trend-fold][data-id=${k}]`).click();
await page.locator('.cmp-btn').first().click();
await page.getByText('Average month').waitFor();
await shot('category-trend');
await tap('[data-action=sheet-back]');
await page.locator('[data-section=months] .overview').getByText('Came in', { exact: true }).waitFor();
await page.locator('[data-section=months] .col-bars .left').first().waitFor();
// Long, all-time and custom ranges.
await page.locator('[data-section=months] [data-change=trend-range]').selectOption('24');
await page.locator('[data-section=months] .more-range.on > span', { hasText: '2 years' }).waitFor();
await page.locator('[data-section=months] [data-change=trend-range]').selectOption('all');
await page.locator('[data-section=months] .overview').getByText('All time', { exact: false }).waitFor();
await page.locator('[data-section=months] [data-change=trend-range]').selectOption('custom');
await page.locator('[data-section=months] [data-change=trend-from]').fill('2026-08');
await page.locator('[data-section=months] [data-change=trend-from]').dispatchEvent('change');
await page.locator('[data-section=months] .overview').getByText('Aug 2026 to', { exact: false }).waitFor();
await page.locator('[data-section=months] .more-range.on > span', { hasText: 'Pick months' }).waitFor();
await page.locator('[data-section=months] [data-action=trend-range][data-id="12"]').click();
await page.locator('[data-section=months] .more-range:not(.on) > span', { hasText: 'More' }).waitFor();
await page.locator('[data-action=trend-fold][data-id=categories]').click();
await page.locator('[data-section=categories]').getByText('last 12 months', { exact: true }).waitFor();
// From the chart, jump to a month's Activity, then back.
const cols0 = page.locator('.cols:not(.one) .col');
await cols0.nth(1).click();
const target = await page.locator('.col-detail strong').innerText();
await page.locator('[data-action=trend-go][data-to=activity]').click();
await page.locator('.monthbar h2', { hasText: target }).waitFor();
await page.locator('.repeats-head, .tx-row').first().waitFor();
await page.goBack();
await page.locator('[data-section=months] .col-detail').waitFor();
await tap('[data-action=month][data-id=now]');
// Tapping the picked column again opens everything from that month.
await page.locator('.cols:not(.one) .col[aria-pressed=true]').click();
await page.locator('dialog[open] .search-sum').waitFor();
await tap('[data-action=sheet-back]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });
// A month's "Came in" opens exactly what came in that month.
await page.locator('[data-section=months] [data-action=trend-see][data-flow=income]').click();
await page.locator('dialog[open] .search-sum').waitFor();
if (await page.locator('dialog[open] .tx-row .amt.owe').count()) fail('Came in should list only money coming in');
await tap('[data-action=sheet-back]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });
const cols = page.locator('.cols:not(.one) .col');
await cols.nth(0).click();
const picked = await page.locator('.col-detail strong').innerText();
await cols.last().click();
await eventually(async () => !((await page.locator('.col-detail strong').innerText()) === picked), 'Tapping a month did not change the numbers shown');
await page.locator('[data-action=trend-fold][data-id=biggest]').click();
await page.locator('.trend:not(.folded)[data-section=biggest]').waitFor();
await page.locator('[data-section=people] [data-change=trend-byperson]').check();
await page.locator('[data-section=people] .cmp-list li').first().waitFor();
await shot('trends-bottom');
await page.locator('[data-action=trend-fold][data-id=plan]').click();
if (await page.locator('[data-action=plan-usual]').count()) {
  await tap('[data-action=plan-usual]');
  await page.locator('#toast').filter({ hasText: 'planned' }).waitFor();
}

// People: invite link, a new link replaces it, removing someone asks first.
await tap('a.tab[href$="-people"]');
const link1 = await page.locator('#inviteLink').innerText();
await tap('[data-action=invite-reset]');
await page.waitForFunction(old => document.getElementById('inviteLink')?.textContent !== old, link1);
const link2 = await page.locator('#inviteLink').innerText();
await tap('[data-action=person-ask]');
await page.getByText('They lose access').waitFor();
await shot('people');
await tap('[data-action=person-cancel]');

// Old invite links stop working; the current one sends members straight to the budget.
await page.goto(pathToFileURL(resolve('preview-test.html')).href + '#join-' + link1.split('#join-')[1]);
await page.getByText('doesn\u2019t work any more').waitFor();
await page.goto(pathToFileURL(resolve('preview-test.html')).href + '#join-' + link2.split('#join-')[1]);
await page.locator('[data-testid=ready]').waitFor();

// Months.
await tap('[data-action=month][data-id="-1"]');
await page.locator('.away-pill').waitFor();
await tap('[data-action=month][data-id=now]');

// Categories: add one straight from the budget page, then rename it in the editor.
await tap('a.tab[href^="#b-"]:not([href$="-activity"])');
await page.locator('.group', { hasText: 'Everyday' }).locator('[data-action=add-cat-here]').click();
await page.fill('#newCatName', 'Pets');
await tap('[data-action=cat-add]');
await page.locator('.ed-row', { hasText: 'Pets' }).waitFor();
await page.locator('.ed-row', { hasText: 'Pets' }).locator('[data-action=cat-edit]').click();
await page.fill('#editName', 'Pet stuff');
await tap('[data-action=cat-edit-save]');
await page.locator('.ed-row', { hasText: 'Pet stuff' }).waitFor();
// Delete it: unused, so it goes straight away.
await page.locator('.ed-row', { hasText: 'Pet stuff' }).locator('[data-action=cat-edit]').click();
await tap('[data-action=cat-delete-ask]');
await page.getByText('It has never been used').waitFor();
await shot('categories');
await tap('.delete-panel [data-action=cat-delete]');
await page.locator('.ed-row', { hasText: 'Pet stuff' }).waitFor({ state: 'detached' });
// Delete one that's in use: it asks where things move.
await page.locator('.ed-row', { hasText: 'Household' }).locator('[data-action=cat-edit]').click();
await tap('[data-action=cat-delete-ask]');
await page.getByText('Pick where they move').waitFor();
await page.selectOption('#deleteMoveTo', { label: 'Groceries' });
await tap('.delete-panel [data-action=cat-delete]');
await page.locator('.ed-row', { hasText: 'Household' }).waitFor({ state: 'detached' });
await tap('[data-action=sheet-back]');
await eventually(async () => !(await page.locator('.cat-row', { hasText: 'Household' }).count()), 'Deleted category still on the budget');

// Fold a group to one line, and back.
await page.locator('button.group-tab', { hasText: 'Bills' }).click();
await page.locator('.group.folded', { hasText: 'Bills' }).locator('.fold-line').waitFor();
await shot('folded');
await page.locator('button.group-tab', { hasText: 'Bills' }).click();
await page.locator('.cat-row', { hasText: 'Rent' }).waitFor();

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
await eventually(async () => !((await page.locator('#planReady').innerText()) !== '$1,500.00'), 'Starting money should be ready to assign');
await eventually(async () => !(!(await page.locator('label.cat-name', { hasText: 'Pets' }).count())), 'Picked category missing');
await shot('setup-plan');

// Round 6: requests to join, filters, compact view, viewed-month dates, yearly start, See trend.
await page.goto(pathToFileURL(resolve('preview-test.html')).href + '#home');
await tap('a.budget-row');
await tap('a.request-note');
await page.getByRole('heading', { name: 'Waiting to join' }).waitFor();
await shot('requests');
await tap('[data-action=request-approve]');
await page.locator('.person', { hasText: 'Alex' }).waitFor();
await tap('a.tab[href^="#b-"]:not([href$="-activity"])');
await eventually(async () => !(await page.locator('a.request-note').count()), 'Request notice should go once handled');
await tap('[data-action=budget-filter][data-id=needs]');
const needRows = await page.locator('.cat-row').count();
if (!needRows || await page.locator('.cat-row .owe').count()) {
  // Needs-money rows can still be overspent too; just make sure the list shrank.
}
await tap('[data-action=budget-filter][data-id=all]');
if ((await page.locator('.cat-row').count()) <= needRows) fail('Needs money filter did not narrow the list');
await tap('[data-action=budget-compact]');
await page.locator('.groups.compact').waitFor();
await shot('compact');
await tap('[data-action=budget-compact]');
await tap('[data-action=month][data-id="-1"]');
await page.locator('.away-pill').waitFor();
await tap('.spend-tab');
const viewed = await page.locator('.monthbar h2').innerText();
const date = await page.locator('#fDate').inputValue();
await eventually(async () => !(new Date(date + 'T12:00').toLocaleDateString('en', { month: 'long', year: 'numeric' }) !== viewed), `Spend date ${date} is not in ${viewed}`);
await tap('[data-action=sheet-back]');
await tap('.away-pill');
await page.locator('.cat-row', { hasText: 'Gifts' }).click();
await tap('[data-action=cat-trend]');
await page.getByText('Average month').waitFor();
await tap('[data-action=sheet-back]');
await page.locator('.sheet-head h2', { hasText: 'Gifts' }).waitFor();
await tap('[data-action=cat-open][data-id=target]');
if (await page.locator('#targetStart').count()) {
  await page.selectOption('#targetStart', 'jan');
  await tap('[data-action=target-save]');
  await page.locator('dialog .form-row-value', { hasText: 'from Jan' }).waitFor();
}
await tap('[data-action=sheet-back]');

// Help and descriptors on each screen.
await page.locator('.screen-tip').waitFor();
await tap('[data-action=help]');
await page.locator('.help-list li').first().waitFor();
await shot('help');
await tap('[data-action=tour-start]');
await page.locator('.tour-card').waitFor();
await tap('[data-action=tour-end]');

// Plan money: groups fold, categories can be added there.
await tap('a.hero-btn');
await page.locator('button.group-tab:has(h2:text-is("Fun"))').click();
await page.locator('.group.folded:has(h2:text-is("Fun"))').waitFor();
await page.locator('button.group-tab:has(h2:text-is("Fun"))').click();
await page.locator('.group:has(.group-tab h2:text-is("Fun")) [data-action=add-cat-here]').click();
await page.fill('#newCatName', 'Hobbies');
await tap('[data-action=cat-add]');
await page.locator('.ed-row', { hasText: 'Hobbies' }).waitFor();
await tap('[data-action=sheet-back]');
await page.locator('label.cat-name', { hasText: 'Hobbies' }).waitFor();
await tap('.topbar a.btn');

// A paycheck every 2 weeks.
await tap('[data-action=add-income]');
await page.fill('#fAmount', '1500');
await page.fill('#fDesc', 'Side job');
await page.locator('#fRepeat').check();
await page.selectOption('#fEvery', '2weeks');
await page.locator('#repeatHint').filter({ hasText: 'every other' }).waitFor();
await page.locator('.sheet-head h2').tap();
await tap('[data-action=tx-save]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });
await tap('a.tab[href$="-activity"]');
await page.locator('[data-action=open-rule]', { hasText: 'Side job' }).locator('text=every other').waitFor();
await tap('a.tab[href^="#b-"]:not([href$="-activity"])');

// Importing a bank file: made-up rows in Chase's card layout.
const CSV = ['Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
  '11/04/2026,11/05/2026,SAMPLE NOODLE BAR,Food & Drink,Sale,-23.45,',
  '11/04/2026,11/05/2026,"<img src=x onerror=window.__xss=1>",Shopping,Sale,-1.11,',
  '11/03/2026,11/04/2026,MYSTERY SHOP 99,,Sale,-10.00,',
  '11/03/2026,11/04/2026,MYSTERY SHOP 99,,Sale,-5.00,',
  '11/02/2026,11/02/2026,SAMPLE CLOTHES,Shopping,Return,40.00,',
  '11/01/2026,11/01/2026,Payment Thank You-Mobile,,Payment,500.00,'].join('\n');
await page.goto(pathToFileURL(resolve('preview-test.html')).href + '#home');
await tap('a.budget-row');
await tap('a.tab[href$="-activity"]');
await tap('[data-action=open-import]');
await page.locator('#importFile').setInputFiles({ name: 'Chase_Activity.CSV', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
await page.locator('.import-row').first().waitFor();
if ((await page.locator('.import-row').count()) !== 5) fail('The card payment should be left out of the list');
await page.getByText('2 still need a category').waitFor();
await page.locator('[data-action=import-save]').click();
await page.getByText('Pick a category for each one').waitFor();
await page.locator('.import-row', { hasText: 'MYSTERY SHOP' }).first().locator('select').selectOption({ label: 'Clothes' });
await page.getByText('Also set 1 more').waitFor();
await page.locator('.import-row', { hasText: 'MYSTERY SHOP' }).nth(1).locator('select').evaluate(el => { if (el.selectedOptions[0].text !== 'Clothes') throw new Error('One choice should fill the rest from the same place'); });
// A new category, made without leaving the import.
await page.locator('.import-row', { hasText: 'SAMPLE NOODLE BAR' }).locator('select').selectOption({ label: '+ New category…' });
await page.locator('#impNewName').fill('Noodles');
await tap('[data-action=import-newcat]');
await page.getByText('Added Noodles').waitFor();
await eventually(async () => (await page.locator('.import-row', { hasText: 'SAMPLE NOODLE BAR' }).locator('select').evaluate(el => el.selectedOptions[0]?.text)) === 'Noodles', 'The new category should be picked on that row');
await tap('[data-action=import-skipped]');
await page.getByText('Paying the card off').waitFor();
await shot('import');
// Text from a bank file is shown as text, never run as code.
await page.locator('.import-row', { hasText: '<img src=x' }).locator('select').selectOption({ label: 'Clothes' });
await page.locator('[data-action=import-save]', { hasText: 'Add 5' }).click();
// The last step of an import is checking the accounts.
await page.getByText('Added 5. Last step').waitFor();
// Adding an account right there works (the popup that came before had just closed).
await page.waitForTimeout(100);
await tap('dialog[open] [data-action=acc-add-open]');
await page.locator('#accName').fill('Imported check');
await page.locator('#accBalance').fill('10');
await tap('dialog[open] [data-action=acc-add]');
await page.locator('.acc-row', { hasText: 'Imported check' }).waitFor();
await page.locator('.acc-row', { hasText: 'Imported check' }).locator('[data-action=acc-remove]').click();
await tap('[data-action=sheet-back]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });
await page.locator('.tx-row', { hasText: 'SAMPLE NOODLE BAR' }).waitFor();
await page.locator('.tx-row', { hasText: 'SAMPLE NOODLE BAR' }).getByText('Noodles').waitFor();
await page.locator('.tx-row', { hasText: '<img src=x onerror=window.__xss=1>' }).waitFor();
if (await page.evaluate(() => window.__xss || document.querySelectorAll('img[src=x]').length)) fail('HTML in a description must never run');
// The same file again: everything is already in.
await tap('[data-action=open-import]');
await page.locator('#importFile').setInputFiles({ name: 'again.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
await page.locator('[data-action=import-save]', { hasText: 'Nothing ticked' }).waitFor();
await tap('[data-action=sheet-back]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });
// A PDF gets a clear message.
await tap('[data-action=open-import]');
await page.locator('#importFile').setInputFiles({ name: 'statement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
await page.getByText('That’s a PDF').waitFor();
await tap('[data-action=sheet-back]');

// Checking the budget against accounts.
await tap('[data-action=account]');
await tap('dialog[open] [data-action=open-accounts]');
await page.getByText('Add the accounts your money is in').waitFor();
await tap('[data-action=acc-add-open]');
await page.locator('#accName').fill('Checking');
await page.locator('#accBalance').fill('100');
await tap('[data-action=acc-add]');
await page.locator('.acc-row', { hasText: 'Checking' }).waitFor();
await page.locator('dialog[open] .acc-verdict', { hasText: 'Off by' }).waitFor();
const inBudget = await page.locator('.acc-totals > div').nth(1).locator('.amt').innerText();
const row = page.locator('.acc-row', { hasText: 'Checking' }).locator('input');
await row.fill(inBudget.replace(/[$,]/g, ''));
await row.dispatchEvent('change');
await page.locator('dialog[open] .acc-verdict', { hasText: 'They match' }).waitFor();
await shot('accounts');
await tap('[data-action=acc-add-open]');
await page.locator('#accName').fill('Card');
await tap('[data-action=acc-kind][data-id=card]');
await eventually(async () => (await page.locator('#accName').inputValue()) === 'Card', 'Switching to Credit card should keep the typed name');
await page.locator('#accBalance').fill('25');
await tap('[data-action=acc-add]');
await page.locator('dialog[open] .acc-verdict', { hasText: 'Off by $25.00' }).waitFor();
// More in the accounts than the budget (money it doesn't know about yet): starting money can fill the gap.
await page.locator('.acc-row', { hasText: 'Card' }).locator('[data-action=acc-remove]').click();
await page.locator('dialog[open] .acc-verdict', { hasText: 'They match' }).waitFor();
const chk = page.locator('.acc-row', { hasText: 'Checking' }).locator('input');
const was = await chk.inputValue();
await chk.fill(String((Number(was) + 40).toFixed(2)));
await chk.dispatchEvent('change');
await page.locator('dialog[open] .acc-verdict', { hasText: 'Off by $40.00' }).waitFor();
await tap('dialog[open] [data-action=acc-fix-start]');
await page.getByText('starting money of $40.00').waitFor();
await page.locator('dialog[open] .acc-verdict', { hasText: 'They match' }).waitFor();
// It can be put back while checking things, then set again.
await tap('dialog[open] [data-action=acc-unfix-start]');
await page.locator('dialog[open] .acc-verdict', { hasText: 'Off by $40.00' }).waitFor();
await tap('dialog[open] [data-action=acc-fix-start]');
await page.locator('dialog[open] .acc-verdict', { hasText: 'They match' }).waitFor();
// Renaming an account.
await page.locator('.acc-row', { hasText: 'Checking' }).locator('[data-action=acc-rename]').click();
await page.locator('#accRename').fill('Everyday checking');
await tap('dialog[open] [data-action=acc-rename-save]');
await page.locator('.acc-row', { hasText: 'Everyday checking' }).waitFor();
await tap('[data-action=sheet-back]');
await tap('[data-action=sheet-back]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });
await page.locator('#app .acc-status.ok', { hasText: 'Accounts match' }).waitFor();

// Feedback from a screen's "?" help.
await tap('[data-action=help]');
await tap('[data-action=feedback-open]');
await page.locator('dialog[open] h2', { hasText: 'Send feedback' }).waitFor();
await tap('[data-action=sheet-back]');
await page.locator('dialog[open] h2', { hasText: 'Send feedback' }).waitFor({ state: 'detached' });
await tap('[data-action=sheet-back]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });

// Reporting a problem from settings.
await tap('[data-action=account]');
await tap('[data-action=feedback-open]');
await tap('[data-action=report-send]');
await page.getByText('Write a few words').waitFor();
await tap('[data-action=feedback-type][data-id=idea]');
await page.getByText('What would make it better?').waitFor();
await page.locator('#reportText').fill('The import button is hard to find');
await page.locator('#reportEmail').check();
await shot('report');
await tap('[data-action=report-send]');
await page.getByText('Sending feedback works in the real app').waitFor();
await tap('[data-action=sheet-back]');
await tap('[data-action=sheet-back]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });

// History: with a start date set, an older import shows in Activity but never moves money.
await page.goto(pathToFileURL(resolve('preview-test.html')).href + '#home');
await tap('a.budget-row');
await tap('[data-action=account]');
await page.locator('dialog[open] [data-change=budget-start]').fill('2026-11-01');
await page.locator('dialog[open] [data-change=budget-start]').dispatchEvent('change');
await page.getByText('Budget start saved').waitFor();
await tap('[data-action=sheet-back]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });
const readyBefore = await page.locator('[data-testid=ready]').innerText();
await tap('#app [data-action=open-import]');
await page.locator('#importFile').setInputFiles({ name: 'old.csv', mimeType: 'text/csv', buffer: Buffer.from('Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n01/15/2026,01/16/2026,OLD SAMPLE SHOP,Groceries,Sale,-77.00,\n') });
await page.getByText('from before your budget started').waitFor();
await page.locator('.import-row').first().locator('select').selectOption({ label: 'Groceries' });
await tap('[data-action=import-save]');
await page.getByText('Last step').waitFor();
await tap('[data-action=sheet-back]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });
await page.waitForTimeout(200);
if ((await page.locator('[data-testid=ready]').innerText()) !== readyBefore) fail('History should not change Ready to assign');

// Search: words, totals, then moving every match (past ones too) to another category, and undo.
await tap('#app [data-action=open-search]');
// Nothing typed lists everything, without the option to move it all.
await page.locator('.search-sum', { hasText: 'All ' }).waitFor();
if (await page.locator('[data-action=search-move-open]').count()) fail('Moving everything at once should not be offered');
await tap('[data-action=search-flow][data-id=income]');
await page.locator('dialog[open] .tx-row', { hasText: 'Paycheck' }).first().waitFor();
if (await page.locator('dialog[open] .tx-row .amt.owe').count()) fail('Money in should show only money coming in');
await tap('[data-action=search-flow][data-id=""]');
await page.locator('#searchText').fill('mystery shop');
await page.locator('.search-sum', { hasText: '2 matches' }).waitFor();
await eventually(async () => (await page.locator('#searchText').evaluate(el => el === document.activeElement)), 'Typing should keep the cursor in the search box');
await shot('search');
await tap('[data-action=search-move-open]');
await page.locator('#moveAllTo').selectOption({ label: 'Gifts' });
await tap('[data-action=search-move]');
await page.getByText('Moved 2 to Gifts').waitFor();
await eventually(async () => (await page.locator('dialog[open] .tx-row', { hasText: 'MYSTERY SHOP' }).filter({ hasText: 'Gifts' }).count()) === 2, 'Both should now be in Gifts');
await page.locator('#toast [data-action=undo]').click();
await eventually(async () => (await page.locator('dialog[open] .tx-row', { hasText: 'MYSTERY SHOP' }).filter({ hasText: 'Clothes' }).count()) === 2, 'Undo should put both back');
// Changing one: the other from the same place can follow.
await page.locator('dialog[open] .tx-row', { hasText: 'MYSTERY SHOP' }).first().click();
await page.locator('dialog[open] .sheet-head h2', { hasText: 'Edit' }).waitFor({ timeout: 3000 }).catch(async () => { await page.screenshot({ path: '/tmp/claude-0/-home-claude/2ddb4c4e-a39a-562e-8ff6-380136a568ad/scratchpad/fail.png' }); fail(`Tapping a search result should open it: ${await page.locator('dialog[open] .sheet-head h2').innerText()}`); });
await page.locator('#fCat').selectOption({ label: 'Hobbies' });
await tap('[data-action=tx-save]');
await page.getByText('1 more from MYSTERY SHOP 99').waitFor();
await page.locator('#toast [data-action=undo]', { hasText: 'Move them too' }).click();
await eventually(async () => (await page.locator('dialog[open] .tx-row', { hasText: 'MYSTERY SHOP' }).filter({ hasText: 'Hobbies' }).count()) === 2, 'Move them too should move the other one');
await tap('[data-action=sheet-back]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });

// Arranging categories on the budget screen: arrows, then dragging by the handle.
await page.goto(pathToFileURL(resolve('preview-test.html')).href + '#home');
await tap('a.budget-row');
await page.locator('[data-action=budget-filter][data-id=all]').click();
await tap('[data-action=arrange-start]');
const names = () => page.locator('#arrangeList .arr-row .grow').allInnerTexts();
const arrBefore = await names();
await page.locator('#arrangeList .arr-row').first().locator('[data-action=arr-move][data-dir="1"]').click();
const afterArrow = await names();
if (afterArrow[0] !== arrBefore[1] || afterArrow[1] !== arrBefore[0]) fail('The down arrow should swap the first two');
await page.locator('#arrangeList .arr-row').nth(0).evaluate(el => el.scrollIntoView({ block: 'center' }));
const h = await page.locator('#arrangeList .arr-row').nth(0).locator('.drag-handle').boundingBox();
const t = await page.locator('#arrangeList .arr-row').nth(2).boundingBox();
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
await page.mouse.down();
await page.mouse.move(h.x + h.width / 2, t.y + t.height * 0.75, { steps: 8 });
await page.mouse.up();
const afterDrag = await names();
if (afterDrag[2] !== afterArrow[0]) fail(`Dragging should move the row down two places: ${afterDrag.slice(0, 3)}`);
await shot('arrange');
await tap('[data-action=arrange-done]');
await page.getByText('New order saved').waitFor();
await eventually(async () => (await page.locator('.groups .cat-row .cat-name').first().innerText()) === afterDrag[0], 'The budget should show the new order');
// The category popup has an Edit button that opens the editor on that category.
await page.locator('.groups .cat-row').first().click();
await page.locator('dialog[open] .sheet-head [data-action=edit-this-cat]').click();
await page.locator('dialog[open] #editName').waitFor();
await tap('[data-action=sheet-back]');
await tap('[data-action=sheet-back]');
await page.locator('dialog[open]').waitFor({ state: 'detached' });

// Every theme, on the example budget.
await page.goto(pathToFileURL(resolve('preview-test.html')).href + '#home');
await tap('a.budget-row');
for (const look of ['light', 'dark']) {
  await tap('[data-action=account]');
  await tap(`[data-action=set-look][data-id=${look}]`);
  await tap('[data-action=sheet-back]');
  await shot(`budget-${look}`);
}
await page.emulateMedia({ colorScheme: 'dark' });
await tap('[data-action=account]');
await tap('[data-action=set-look][data-id=blue]');
await tap('[data-action=sheet-back]');
await shot('budget-blue-darkmode');

// After every screen above, the HTML-looking description still never ran.
await page.goto(pathToFileURL(resolve('preview-test.html')).href + '#home');
await tap('a.budget-row');
for (const tab of ['-activity', '-trends']) {
  await tap(`a.tab[href$="${tab}"]`);
  await page.waitForTimeout(300);
  if (await page.evaluate(() => window.__xss || document.querySelectorAll('img[src=x]').length)) fail(`HTML in a description ran on ${tab}`);
}

// No sideways scrolling on a small phone.
await page.setViewportSize({ width: 320, height: 640 });
const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
await eventually(async () => !(wide), 'The page scrolls sideways at 320px');

await browser.close();
await eventually(async () => !(errors.length), `Page errors:\n${errors.join('\n')}`);
console.log('Smoke test passed');
