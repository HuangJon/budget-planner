/**
 * The database on this device only, used by the preview and local tests. It behaves like Firestore
 * where the app relies on it: paths, update() with dotted field names, failure when updating a
 * missing document, and live listeners. Sign-in is simulated; real sign-in only happens through Firebase.
 */
const KEY = 'wmm:localdb:v4';
const parentOf = p => p.split('/').slice(0, -1).join('/');
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function setDotted(doc, field, value) {
  const parts = field.split('.');
  let at = doc;
  for (const p of parts.slice(0, -1)) {
    if (!at[p] || typeof at[p] !== 'object') at[p] = {};
    at = at[p];
  }
  if (value === undefined) delete at[parts.at(-1)];
  else at[parts.at(-1)] = value;
}

export function createLocalBackend({ area = safeStorage(), user = { uid: 'preview-you', displayName: 'You', email: 'you@example.com', emailVerified: true } } = {}) {
  let docs = load();
  const docWatchers = new Map(), colWatchers = new Map();

  function load() { try { return JSON.parse(area?.getItem(KEY) || '{}'); } catch { return {}; } }
  function persist() { try { area?.setItem(KEY, JSON.stringify(docs)); } catch { /* memory only */ } }
  const docsIn = col => Object.keys(docs).filter(p => parentOf(p) === col).map(p => clone(docs[p]));
  const add = (map, key, fn) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(fn); return () => map.get(key).delete(fn); };
  function emit(path) {
    for (const fn of docWatchers.get(path) || []) fn(clone(docs[path]) ?? null);
    for (const fn of colWatchers.get(parentOf(path)) || []) fn();
  }

  return {
    kind: 'local',
    uid: () => user?.uid || null,
    user: () => user,
    get: async path => clone(docs[path]) ?? null,
    async set(path, value) { docs[path] = clone(value); persist(); emit(path); },
    async update(path, fields) {
      if (!docs[path]) throw Object.assign(new Error(`No document at ${path}`), { code: 'not-found' });
      for (const [k, v] of Object.entries(fields)) setDotted(docs[path], k, clone(v));
      persist(); emit(path);
    },
    async remove(path) { delete docs[path]; persist(); emit(path); },
    watchDoc(path, cb) {
      queueMicrotask(() => cb(clone(docs[path]) ?? null));
      return add(docWatchers, path, cb);
    },
    watchCollection(col, cb) {
      const fire = () => cb(docsIn(col));
      queueMicrotask(fire);
      return add(colWatchers, col, fire);
    },
    /** For the preview's "start over" and tests. */
    reset(seed = {}) { docs = clone(seed); persist(); },
    isEmpty: () => Object.keys(docs).length === 0,
  };
}

function safeStorage() {
  try { const s = globalThis.localStorage; s?.getItem('x'); return s; } catch { return null; }
}
