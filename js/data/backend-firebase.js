/**
 * The shared database and real sign-in, ported from Trip Tab. The Firebase SDK is passed in, so
 * the app loads it from Google's CDN while tests use the npm package against the emulators.
 *
 * Offline: the SDK keeps a copy on the device and queues writes. A write's promise does not finish
 * until the server has it, so the app never waits on one before moving on.
 */
import { isIncrement } from './fields.js';

/**
 * Tries a refused write again shortly. When writes overlap, the rules can read a document another
 * write is changing and refuse by mistake. A true refusal is refused every time, so it's only delayed.
 */
export async function retryRefusal(write, waits = [300, 1000]) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await write(); } catch (e) {
      if (e?.code !== 'permission-denied' || attempt >= waits.length) throw e;
      await new Promise(r => setTimeout(r, waits[attempt]));
    }
  }
}

export async function createFirebaseBackend(config, sdk, { appCheckSiteKey = null, appCheckProvider = 'v3', retryWaits } = {}) {
  const app = sdk.initializeApp(config);
  // App Check has to start before anything talks to the database, or those first requests have no proof.
  if (appCheckSiteKey) {
    // A key made in the Google Cloud console is a reCAPTCHA Enterprise key; one from google.com/recaptcha/admin is v3.
    const Provider = appCheckProvider === 'enterprise' ? sdk.ReCaptchaEnterpriseProvider : sdk.ReCaptchaV3Provider;
    sdk.initializeAppCheck(app, { provider: new Provider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  }
  let db;
  try {
    db = sdk.initializeFirestore(app, { localCache: sdk.persistentLocalCache({ tabManager: sdk.persistentMultipleTabManager() }) });
  } catch {
    db = sdk.getFirestore(app); // private browsing and some older phones can't keep the offline copy
  }

  /** Turns the app's special values into Firestore's: removal and server-side counting. */
  const fieldValue = v => (v === undefined ? sdk.deleteField() : isIncrement(v) ? sdk.increment(v.by) : v);
  const fieldsOut = fields => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fieldValue(v)]));
  const nestedOut = value => (value && typeof value === 'object' && !Array.isArray(value) && !isIncrement(value)
    ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, nestedOut(v)]))
    : fieldValue(value));

  const firebaseAuth = sdk.getAuth(app);
  const shape = u => (u ? { uid: u.uid, email: u.email || '', displayName: u.displayName || '', verified: Boolean(u.emailVerified) } : null);
  const auth = {
    simulated: false,
    current: () => shape(firebaseAuth.currentUser),
    onChange: fn => sdk.onAuthStateChanged(firebaseAuth, u => fn(shape(u))),
    async google() {
      await sdk.signInWithPopup(firebaseAuth, new sdk.GoogleAuthProvider());
      return auth.current();
    },
    async signUp(name, email, password) {
      const { user } = await sdk.createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
      await sdk.updateProfile(user, { displayName: name });
      await sdk.sendEmailVerification(user);
      return auth.current();
    },
    async signIn(email, password) {
      await sdk.signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      return auth.current();
    },
    sendVerification: () => sdk.sendEmailVerification(firebaseAuth.currentUser),
    /** Checks whether the email link was tapped, and gets a new pass so the database sees it too. */
    async refresh() {
      if (!firebaseAuth.currentUser) return null;
      await sdk.reload(firebaseAuth.currentUser);
      if (firebaseAuth.currentUser.emailVerified) await firebaseAuth.currentUser.getIdToken(true);
      return auth.current();
    },
    resetPassword: email => sdk.sendPasswordResetEmail(firebaseAuth, email.trim()),
    /** Signs out and clears this device's copy of the budgets, so the next person can't see them. */
    async signOut() {
      await sdk.signOut(firebaseAuth);
      try { await sdk.terminate(db); await sdk.clearIndexedDbPersistence(db); } catch { /* the reload still resets the app */ }
    },
  };
  await firebaseAuth.authStateReady?.();

  const data = snap => snap.data();
  const ref = path => sdk.doc(db, path);
  return {
    kind: 'firebase',
    db,
    firebaseAuth,
    auth,
    uid: () => firebaseAuth.currentUser?.uid || '',
    user: () => auth.current(),
    set: (path, value) => retryRefusal(() => sdk.setDoc(ref(path), value), retryWaits),
    update: (path, fields) => retryRefusal(() => sdk.updateDoc(ref(path), fieldsOut(fields)), retryWaits),
    remove: path => sdk.deleteDoc(ref(path)),
    /** Several writes that all happen or none do: [{ op: 'set' | 'merge' | 'update' | 'remove', path, value }]. */
    batch: writes => retryRefusal(() => {
      const b = sdk.writeBatch(db);
      for (const w of writes) {
        if (w.op === 'set') b.set(ref(w.path), w.value);
        else if (w.op === 'merge') b.set(ref(w.path), nestedOut(w.value), { merge: true });
        else if (w.op === 'update') b.update(ref(w.path), fieldsOut(w.value));
        else if (w.op === 'remove') b.delete(ref(w.path));
      }
      return b.commit();
    }, retryWaits),
    get: async path => {
      const snap = await sdk.getDoc(ref(path));
      return snap.exists() ? data(snap) : null;
    },
    list: async (col, { orderBy, limit } = {}) => {
      const parts = [];
      if (orderBy) parts.push(sdk.orderBy(orderBy, 'desc'));
      if (limit) parts.push(sdk.limit(limit));
      return (await sdk.getDocs(sdk.query(sdk.collection(db, col), ...parts))).docs.map(data);
    },
    watchDoc: (path, cb, err) => sdk.onSnapshot(ref(path), snap => {
      // A cached "missing" is not proof, because the budget may be brand new on this phone.
      if (!snap.exists() && snap.metadata.fromCache) return;
      cb(snap.exists() ? data(snap) : null);
    }, err),
    watchCollection: (col, cb, err) => sdk.onSnapshot(sdk.query(sdk.collection(db, col)), { includeMetadataChanges: true }, snap => {
      cb(snap.docs.map(data), { pending: snap.docs.filter(d => d.metadata.hasPendingWrites).map(d => d.id) });
    }, err),
  };
}

/** Loads the SDK from Google's CDN. The address is built at run time so preview builds never bundle it. */
export async function loadFirebaseSdk(version, { appCheck = false } = {}) {
  const url = name => `https://www.gstatic.com/firebasejs/${version}/firebase-${name}.js`;
  const names = ['app', 'firestore', 'auth', ...(appCheck ? ['app-check'] : [])];
  const parts = await Promise.all(names.map(n => import(/* @vite-ignore */ url(n))));
  return Object.assign({}, ...parts);
}
