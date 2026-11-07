/**
 * Tries the published staging site for real: real sign-in, real rules, real database. Signs in as
 * a test person, starts a budget, adds spending, then checks the owner page shows counts only.
 * Deletes everything it made. Refuses to run against any project but the staging one.
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/staging-key.json node tests/staging/staging.e2e.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'wheres-my-money-staging';
const SITE = `https://${PROJECT}.web.app`;
const key = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
if (key.project_id !== PROJECT) throw new Error(`Refusing to run against ${key.project_id}: this test only runs on ${PROJECT}.`);
initializeApp({ credential: cert(key), projectId: PROJECT });
const auth = getAuth(), db = getFirestore();

const OWNER = { uid: 'stagingOwnerTestAccount01', email: 'staging-owner@example.com' };
const PERSON = { uid: 'stagingPersonTestAccount01', email: 'staging-person@example.com' };
const password = randomBytes(12).toString('hex');
const check = what => console.log(`ok - ${what}`);

async function freshAccount({ uid, email }, displayName) {
  await auth.deleteUser(uid).catch(() => {});
  await auth.createUser({ uid, email, password, emailVerified: true, displayName });
}
async function cleanUp() {
  for (const { uid } of [PERSON, OWNER]) {
    const list = await db.collection(`users/${uid}/budgets`).get().catch(() => ({ docs: [] }));
    for (const d of list.docs) await db.recursiveDelete(db.doc(`budgets/${d.id}`));
    await db.recursiveDelete(db.doc(`users/${uid}`)).catch(() => {});
    await auth.deleteUser(uid).catch(() => {});
  }
}

const browser = await chromium.launch();
let page;
try {
  await cleanUp();
  await freshAccount(PERSON, 'Staging Person');
  await freshAccount(OWNER, 'Staging Owner');

  const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
  await context.addInitScript(() => localStorage.setItem('wmm:tourDone', '1'));
  page = await context.newPage();
  await page.goto(SITE);
  await page.locator('#authEmail').fill(PERSON.email);
  await page.locator('#authPassword').fill(password);
  await page.locator('[data-action=auth-in]').click();
  await page.getByText('No budgets yet').waitFor({ timeout: 30000 });
  check('a verified person signs in with real Firebase sign-in');

  await page.locator('[data-action=new-budget]').click();
  await page.locator('#nbName').fill('Staging budget');
  await page.locator('[data-action=nb-next]').click();
  await page.locator('#nbMoney').fill('1200');
  await page.locator('[data-action=nb-next]').click();
  await page.locator('[data-action=nb-next]').click();
  await page.locator('#planReady').waitFor({ timeout: 30000 });
  // The budget can arrive a moment before its transactions, so wait for the starting money to count.
  await page.waitForFunction(() => document.getElementById('planReady')?.textContent === '$1,200.00', null, { timeout: 20000 })
    .catch(async () => assert.fail(`Ready to assign showed ${await page.locator('#planReady').innerText()}, not $1,200.00`));
  check('starting a budget with starting money, through the real rules');

  await page.locator('.topbar a.btn').click();
  await page.locator('.spend-tab').click();
  await page.locator('#fAmount').fill('12.34');
  await page.locator('#fDesc').fill('Staging groceries');
  await page.locator('#fCat').selectOption({ label: 'Groceries' });
  await page.locator('[data-action=tx-save]').click();
  await page.locator('dialog[open]').waitFor({ state: 'detached' });
  const ids = (await db.collection(`users/${PERSON.uid}/budgets`).get()).docs.map(d => d.id);
  assert.equal(ids.length, 1);
  let saved = [];
  for (let i = 0; i < 20 && !saved.length; i += 1) {
    saved = (await db.collection(`budgets/${ids[0]}/transactions`).where('description', '==', 'Staging groceries').get()).docs;
    if (!saved.length) await new Promise(r => setTimeout(r, 500));
  }
  assert.equal(saved.length, 1, 'the spending reached the database');
  assert.equal(saved[0].data().amount, 1234);
  check('spending saves to the real database in whole cents');

  // The owner sees counts, and the page works with the owner's real account.
  const ownerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ownerContext.addInitScript(() => localStorage.setItem('wmm:tourDone', '1'));
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${SITE}/#owner`);
  await ownerPage.locator('#authEmail').fill(OWNER.email);
  await ownerPage.locator('#authPassword').fill(password);
  await ownerPage.locator('[data-action=auth-in]').click();
  await ownerPage.locator('.owner-counts').waitFor({ timeout: 30000 });
  const budgets = Number(await ownerPage.locator('.owner-counts > div').nth(1).locator('.big-amt').innerText());
  assert.ok(budgets >= 1, 'the owner sees the budget count');
  check('the owner page shows counts');
  await ownerPage.goto(`${SITE}/#b-${ids[0]}`);
  await ownerPage.getByText("This budget can't be opened").waitFor({ timeout: 30000 });
  check("the owner can't open someone else's budget");

  console.log('Staging test passed');
} catch (e) {
  if (page) await page.screenshot({ path: 'staging-failure.png', fullPage: true }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  await cleanUp().catch(e => console.log('Clean-up:', e.message));
}
process.exit(0);
