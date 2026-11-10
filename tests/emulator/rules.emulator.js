/**
 * Runs the real Firebase backend and firestore.rules against the emulators, as several different
 * people: an admin, someone who joins, a stranger, an unverified account, and the app's owner.
 *   npx firebase-tools emulators:exec --only firestore,auth --project demo-wmm "node tests/emulator/rules.emulator.js"
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as app from 'firebase/app';
import * as store from 'firebase/firestore';
import * as authSdk from 'firebase/auth';
import { createFirebaseBackend } from '../../js/data/backend-firebase.js';
import { createRepository } from '../../js/data/repository.js';
import { reportRecord, errorRecord } from '../../js/core/usage.js';
import { randomId } from '../../js/core/ids.js';

const PROJECT = 'demo-wmm';
let phones = 0;
function phoneSdk() {
  const name = `phone${phones += 1}`;
  return {
    ...app, ...store, ...authSdk,
    initializeApp: config => app.initializeApp(config, name),
    getAuth: a => {
      const auth = authSdk.getAuth(a);
      if (!auth.emulatorConfig) authSdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      return auth;
    },
    persistentLocalCache: () => store.memoryLocalCache(),
    persistentMultipleTabManager: () => undefined,
    initializeFirestore: (a, options) => {
      const instance = store.initializeFirestore(a, options);
      store.connectFirestoreEmulator(instance, '127.0.0.1', 8181);
      return instance;
    },
  };
}
const config = { projectId: PROJECT, apiKey: 'x' };
const quick = { retryWaits: [] };
let people = 0;
/** A verified account. The emulator accepts a made-up Google identity, which counts as verified. */
async function newPhone(email = `person${people += 1}@example.com`) {
  const backend = await createFirebaseBackend(config, phoneSdk(), quick);
  await authSdk.signInWithCredential(backend.firebaseAuth, authSdk.GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true, name: email })));
  return { backend, repo: createRepository(backend), uid: backend.uid(), email };
}
/** The owner is listed in /developers, which only an admin can write (here, the emulator's admin door). */
async function ownerPhone() {
  const ownerUid = 'ownerTestAccount01';
  const res = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: ownerUid, email: 'owner@example.com', password: 'password1', emailVerified: true }),
  });
  assert.ok(res.ok, `could not make the owner account: ${res.status}`);
  const listed = await fetch(`http://127.0.0.1:8181/v1/projects/${PROJECT}/databases/(default)/documents/developers/${ownerUid}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ fields: {} }),
  });
  assert.ok(listed.ok, `could not list the owner: ${listed.status}`);
  const backend = await createFirebaseBackend(config, phoneSdk(), quick);
  await authSdk.signInWithEmailAndPassword(backend.firebaseAuth, 'owner@example.com', 'password1');
  assert.equal(backend.uid(), ownerUid);
  return { backend, repo: createRepository(backend), uid: ownerUid };
}
const refused = (p, why) => assert.rejects(p, /permission|PERMISSION/, why);
let checks = 0;
const ok = async (p, why) => { try { await p; checks += 1; } catch (e) { throw new Error(`${why}: ${e.message}`); } };
const no = async (p, why) => { await refused(p, why); checks += 1; };

const alice = await newPhone(), bob = await newPhone(), carol = await newPhone(), dave = await newPhone();
const owner = await ownerPhone();
const unverified = await createFirebaseBackend(config, phoneSdk(), quick);
await authSdk.createUserWithEmailAndPassword(unverified.firebaseAuth, 'unverified@example.com', 'password1');

/* Counting people and weeks, once each, and nothing else. */
await ok(alice.repo.noteVisit(new Date(2026, 10, 7)), 'a first visit counts one person');
await ok(bob.repo.noteVisit(new Date(2026, 10, 7)), 'so does a second person');
assert.equal(await alice.repo.noteVisit(new Date(2026, 10, 8)), null, 'a second visit the same week writes nothing');
await ok(alice.repo.noteVisit(new Date(2026, 10, 10)), 'a new week counts once');
await no(carol.backend.batch([{ op: 'merge', path: 'stats/usage', value: { people: 99 } }]), 'nobody sets the counts');
await no(carol.backend.batch([{ op: 'merge', path: 'stats/usage', value: { budgets: 1000, lastBudget: 'x'.repeat(24) } }]), 'no counting a budget that was never made');
await no(alice.backend.batch([{ op: 'update', path: `users/${alice.uid}`, value: { lastWeek: '2099-W01' } }, { op: 'merge', path: 'stats/usage', value: { people: 3 } }]), 'no counting yourself twice as a person');
await no(carol.backend.get(`users/${alice.uid}`), "nobody reads someone else's visit record");

/* Reading a budget that isn't saved yet gives nothing away, so it's allowed (and empty). */
const notYet = 'n'.repeat(24);
assert.equal(await carol.backend.get(`budgets/${notYet}`), null, 'a budget that does not exist reads as missing');
assert.deepEqual(await carol.backend.list(`budgets/${notYet}/transactions`), [], 'and has no transactions');
checks += 2;

/* A budget: only its members can see it. */
const { budget, written } = alice.repo.createBudget({ name: 'Home', kind: 'shared', myName: 'Alice', startingMoney: 250000, today: '2026-11-07' });
await ok(written, 'creating a budget with starting money');
const B = budget.id;
assert.ok(await alice.backend.get(`budgets/${B}`));
await no(carol.backend.get(`budgets/${B}`), 'a stranger cannot read a budget');
await no(carol.backend.list(`budgets/${B}/transactions`), "a stranger cannot read a budget's transactions");
await no(carol.backend.list('budgets'), 'nobody can list budgets');
await no(unverified.get(`budgets/${B}`), 'an unverified account gets nothing');
const spamId = randomId();
await no(unverified.set(`errorLog/${spamId}`, { id: spamId, kind: 'app-error', message: 'spam', screen: 'other', version: 'v', platform: 'computer', at: 1 }), 'an unverified account cannot fill the error log');
await no(owner.backend.get(`budgets/${B}`), "the owner can't read anyone's budget");
await no(owner.backend.list(`budgets/${B}/transactions`), "the owner can't read anyone's transactions");
await no(carol.backend.set(`budgets/${'c'.repeat(24)}`, { ...budget, id: 'c'.repeat(24), members: { [alice.uid]: { name: 'x', admin: true, joinedAt: 1 } }, changedBy: carol.uid }), "nobody makes a budget for someone else");

/* Who the owner is lives in the database, not the code, and nobody can make themselves owner. */
assert.equal(await owner.repo.amOwner(), true, 'the owner is told they are the owner');
assert.equal(await carol.repo.amOwner(), false, 'anyone else is told they are not');
await no(carol.backend.set(`developers/${carol.uid}`, {}), 'nobody adds themselves as owner');
await no(carol.backend.get(`developers/${owner.uid}`), "nobody checks whether someone else is the owner");
await no(carol.backend.list('developers'), 'nobody lists the owners');

/* The owner sees counts and error reports, nothing more. */
const stats = await owner.repo.readStats();
assert.equal(stats.people, 2);
assert.equal(stats.budgets, 1);
assert.equal(stats.weeks['2026-W45'], 2);
assert.equal(stats.weeks['2026-W46'], 1);
await no(carol.repo.readStats(), 'only the owner reads the counts');
const report = errorRecord({ id: randomId(), kind: 'failed-save', message: 'Could not save "Rent 1800" for a@b.com', screen: 'plan', version: 'wmm-v1', platform: 'iphone', at: 1 });
await ok(carol.repo.logError(report), 'anyone can send a scrubbed error report');
await no(carol.backend.set(`errorLog/${randomId()}`, { ...report, message: 'Rent was 1800' }), 'a report with a digit is refused');
await no(carol.backend.set(`errorLog/${randomId()}`, { ...report, message: 'from a@b.com' }), 'a report with an email is refused');
await no(carol.backend.set(`errorLog/${randomId()}`, { ...report, uid: carol.uid }), 'a report naming its account is refused');
await no(carol.repo.listErrors(), 'only the owner reads error reports');
assert.equal((await owner.repo.listErrors()).length, 1);

/* Problems people report: their words, their own email only if they choose, read only by the owner. */
const bug = reportRecord({ id: randomId(), text: 'Save on a repeat did nothing', screen: 'plan', version: 'wmm-v3', platform: 'iphone', at: 1 });
await ok(carol.repo.sendReport(bug), 'anyone signed in can report a problem');
await ok(carol.repo.sendReport({ ...bug, id: randomId(), email: carol.email }), 'with their own email if they choose');
await no(carol.repo.sendReport({ ...bug, id: randomId(), email: 'someone@else.com' }), "not with someone else's email");
await no(carol.repo.sendReport({ ...bug, id: randomId(), text: 'x'.repeat(1001) }), 'a report over 1,000 characters is refused');
await no(carol.repo.sendReport({ ...bug, id: randomId(), done: true }), 'a report starts open');
await no(carol.repo.sendReport({ ...bug, id: randomId(), uid: carol.uid }), 'nothing extra rides along');
await no(carol.repo.sendReport({ ...bug, id: randomId(), kind: 'rant' }), 'feedback is a problem or an idea');
await no(carol.repo.listReports(), 'only the owner reads reports');
assert.equal((await owner.repo.listReports()).length, 2);
await no(carol.repo.markReport(bug.id, true), 'only the owner marks a report fixed');
await ok(owner.repo.markReport(bug.id, true), 'the owner marks it fixed');
await no(owner.backend.update(`reports/${bug.id}`, { text: 'changed' }), "the owner can't change what someone wrote");

/* Invite links: one code can be looked up, the list never. */
const code1 = await alice.repo.resetInvite(B, null, 'Home');
const code = await alice.repo.resetInvite(B, code1, 'Home');
assert.equal((await carol.repo.lookUpInvite(code)).budgetName, 'Home');
assert.equal(await carol.repo.lookUpInvite(code1), null, 'a reset link stops working');
await no(carol.backend.list('invites'), 'nobody lists invite codes');
await no(carol.backend.set(`invites/${randomId(20)}`, { code: 'x', budgetId: B, budgetName: 'Home', by: carol.uid, at: 1 }), 'only admins make invite codes');

/* Asking to join, and being let in. */
await ok(bob.repo.requestToJoin(code, 'Bob'), 'asking to join with a live code');
await no(bob.backend.get(`budgets/${B}`), 'asking does not let you see the budget');
await no(carol.backend.update(`budgets/${B}`, { [`requests.${carol.uid}`]: { name: 'Carol', at: 1, invite: 'notarealinvitecode00' } }), 'asking needs a live code');
await no(carol.backend.update(`budgets/${B}`, { [`members.${carol.uid}`]: { name: 'Carol', admin: true, joinedAt: 1 }, changedBy: carol.uid }), 'nobody adds themselves');
await no(carol.backend.update(`budgets/${B}`, { [`requests.${bob.uid}`]: undefined }), "nobody touches someone else's request");
await no(bob.repo.approveRequest(B, bob.uid), 'only an admin lets people in');
await ok(alice.repo.approveRequest(B, bob.uid), 'the admin lets Bob in');
assert.ok(await bob.backend.get(`budgets/${B}`), 'now Bob can read it');
assert.ok(await bob.backend.get(`users/${bob.uid}/budgets/${B}`), "and it's on Bob's list");
await no(alice.backend.update(`budgets/${B}`, { [`members.${carol.uid}`]: { name: 'Carol', joinedAt: 1 }, changedBy: alice.uid }), 'even an admin only adds people who asked');

/* Members change everything about the money, but not who's in it. */
await ok(bob.repo.setAssigned(B, '2026-11', { [Object.keys(budget.categories)[0]]: 50000 }), 'a member plans money');
const { catId, written: catWritten } = bob.repo.addCategory(B, { name: 'Pets', group: 'Everyday', order: 99 });
await ok(catWritten, 'a member adds a category');
await ok(bob.repo.renameMe(B, 'Bobby'), 'a member renames themselves');
await no(bob.repo.setAdmin(B, bob.uid, true), 'a member cannot make themselves admin');
await no(bob.repo.resetInvite(B, code, 'Home'), 'only admins reset the invite link');
await no(bob.repo.deleteBudget(B), 'only admins delete a budget');
await no(bob.backend.update(`budgets/${B}`, { [`members.${alice.uid}.name`]: 'Hacked', changedBy: bob.uid }), "a member can't rename someone else");

/* Transactions: members only, checked, never deleted outright. */
const { transaction: t1, written: tw } = bob.repo.addTransaction(B, { kind: 'spend', amount: 1850, date: '2026-11-07', description: 'Groceries', categoryId: catId });
await ok(tw, 'a member adds spending');
await ok(alice.repo.updateTransaction(B, t1, { amount: 1900 }), "anyone in the budget can fix anyone's entry");
await ok(alice.repo.deleteTransaction(B, t1.id), 'deleting only marks it');
await no(alice.backend.remove(`budgets/${B}/transactions/${t1.id}`), 'nothing is deleted outright');
await no(bob.backend.set(`budgets/${B}/transactions/${randomId()}`, { id: 'x', budgetId: B, kind: 'spend', amount: 12.5, date: '2026-11-07', description: 'x', categoryId: catId, createdBy: bob.uid, createdAt: 1 }), 'amounts are whole cents');
const tid = randomId();
await no(bob.backend.set(`budgets/${B}/transactions/${tid}`, { id: tid, budgetId: B, kind: 'spend', amount: 100, date: '2026-11-07', description: 'x', categoryId: catId, createdBy: alice.uid, createdAt: 1 }), 'nobody adds in someone else\'s name');
await no(carol.repo.addTransaction(B, { kind: 'income', amount: 100, date: '2026-11-07', description: 'x', categoryId: null }).written, 'a stranger cannot add to a budget');
const due = [{ id: 'r-rule1-2026-11', kind: 'spend', amount: 180000, date: '2026-11-01', description: 'Rent', categoryId: catId, recurringId: 'rule1' }];
await ok(bob.repo.addRecurringCopies(B, due), 'repeats are added by members');
const bank = Array.from({ length: 130 }, (_, i) => ({ id: `i-test${i}`, kind: i % 10 ? 'spend' : 'refund', amount: 100 + i, date: '2026-11-02', description: `Bank line ${i}`, categoryId: catId }));
await ok(bob.repo.importTransactions(B, bank), 'a bank file goes in, 100 rows at a time');
await ok(bob.repo.unimport(B, bank.map(t => t.id)), 'and Undo takes the whole import back out');
const recs = await bob.repo.listImports(B);
assert.ok(recs.length >= 1, 'imports are recorded');
await ok(alice.repo.undoImport(B, recs[0]), 'any member can take a past import back out');
await ok(alice.repo.redoImport(B, recs[0]), 'or bring it back');
await no(carol.repo.listImports(B), "a stranger can't see a budget's imports");
await no(bob.backend.update(`budgets/${B}/imports/${recs[0].id}`, { count: 1 }), 'an import record only changes whether it was undone');
await ok(bob.repo.importTransactions(B, bank.slice(0, 3), new Set(bank.slice(0, 3).map(t => t.id))), 'deleted imports can be brought back');

/* A member's own entry: a short name and nothing extra. */
await ok(bob.repo.renameMe(B, 'Bobby'), 'a member renames themselves');
await no(bob.backend.update(`budgets/${B}`, { [`members.${bob.uid}.name`]: 'x'.repeat(41), changedBy: bob.uid }), 'not with a very long name');
await no(bob.backend.update(`budgets/${B}`, { [`members.${bob.uid}.secret`]: 'hidden', changedBy: bob.uid }), 'nothing extra can be tucked into a member entry');

/* Accounts to check against: any member can keep them, nobody outside can. */
await ok(bob.repo.saveAccount(B, 'acc1', { name: 'Checking', kind: 'cash', balance: 120000 }), 'a member adds an account');
await ok(alice.repo.removeAccount(B, 'acc1'), 'and anyone in the budget can remove it');
await no(carol.repo.saveAccount(B, 'acc2', { name: 'Mine', kind: 'cash', balance: 1 }), 'a stranger cannot add accounts');

/* Turned away, removed, leaving. */
await ok(dave.repo.requestToJoin(code, 'Dave'), 'Dave asks');
await ok(alice.repo.declineRequest(B, dave.uid), 'the admin turns Dave away');
assert.equal((await dave.backend.get(`users/${dave.uid}/pending/${B}`)).declined, true, 'Dave sees he was turned away');
await ok(alice.repo.removeMember(B, bob.uid), 'the admin removes Bob');
await no(bob.backend.get(`budgets/${B}`), 'Bob can no longer read it');
assert.equal(await bob.backend.get(`users/${bob.uid}/budgets/${B}`), null, "and it's off Bob's list");
await ok(carol.repo.requestToJoin(code, 'Carol'), 'Carol asks');
await ok(alice.repo.approveRequest(B, carol.uid), 'and is let in');
await ok(carol.repo.leaveBudget(B), 'any member can leave');
await no(carol.backend.get(`budgets/${B}`), 'and then sees nothing');

/* Deleting a budget, and bringing it back. */
await ok(dave.repo.requestToJoin(code, 'Dave'), 'Dave asks again');
await ok(alice.repo.approveRequest(B, dave.uid), 'and is let in');
await ok(alice.repo.deleteBudget(B), 'the admin deletes the budget');
await no(dave.repo.setAssigned(B, '2026-11', { [catId]: 1 }), 'a deleted budget cannot be changed by members');
await no(dave.repo.addTransaction(B, { kind: 'income', amount: 100, date: '2026-11-07', description: 'x', categoryId: null }).written, 'or added to');
await ok(alice.repo.restoreBudget(B), 'the admin brings it back');
await ok(dave.repo.setAssigned(B, '2026-11', { [catId]: 1 }), 'and members can use it again');

console.log(`Rules test passed: ${checks} checks`);
process.exit(0);
