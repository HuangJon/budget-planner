/**
 * The database on this device only, used by the preview and local tests. It behaves like Firestore
 * where the app relies on it: paths, update() with dotted field names, failure when updating a
 * missing document, and live listeners. Sign-in is simulated; real sign-in only happens through Firebase.
 */
import { isIncrement } from './fields.js';

const KEY = 'wmm:localdb:v6';
const parentOf = p => p.split('/').slice(0, -1).join('/');
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function setDotted(doc, field, value) {
  const parts = field.split('.');
  let at = doc;
  for (const p of parts.slice(0, -1)) {
    if (!at[p] || typeof at[p] !== 'object') at[p] = {};
    at = at[p];
  }
  const last = parts.at(-1);
  if (value === undefined) delete at[last];
  else if (isIncrement(value)) at[last] = (Number(at[last]) || 0) + value.by;
  else at[last] = value;
}
/** Merges nested values into a document, like Firestore's set with merge. */
function mergeInto(doc, value) {
  for (const [k, v] of Object.entries(value)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && !isIncrement(v)) {
      if (!doc[k] || typeof doc[k] !== 'object') doc[k] = {};
      mergeInto(doc[k], v);
    } else setDotted(doc, k, v);
  }
}

export function createLocalBackend({ delay = 25, area = safeStorage(), user = { uid: 'preview-you', displayName: 'You', email: 'you@example.com', emailVerified: true } } = {}) {
  let docs = load();
  const docWatchers = new Map(), colWatchers = new Map();

  function load() { try { return JSON.parse(area?.getItem(KEY) || '{}'); } catch { return {}; } }
  function persist() { try { area?.setItem(KEY, JSON.stringify(docs)); } catch { /* memory only */ } }
  const docsIn = col => Object.keys(docs).filter(p => parentOf(p) === col).map(p => clone(docs[p]));
  const add = (map, key, fn) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(fn); return () => map.get(key).delete(fn); };
  /**
   * Tells watchers a little later, like the real database does, so screens that assume a change
   * shows up instantly fail in tests here instead of only on a phone.
   */
  function emit(path) {
    setTimeout(() => {
      for (const fn of docWatchers.get(path) || []) fn(clone(docs[path]) ?? null);
      for (const fn of colWatchers.get(parentOf(path)) || []) fn();
    }, delay);
  }

  return {
    kind: 'local',
    uid: () => user?.uid || null,
    user: () => user,
    get: async path => clone(docs[path]) ?? null,
    async set(path, value) { docs[path] = clone(value); persist(); emit(path); },
    async update(path, fields) {
      if (!docs[path]) throw Object.assign(new Error(`No document at ${path}`), { code: 'not-found' });
      for (const [k, v] of Object.entries(fields)) setDotted(docs[path], k, isIncrement(v) ? v : clone(v));
      persist(); emit(path);
    },
    async remove(path) { delete docs[path]; persist(); emit(path); },
    /** Several writes that all happen or none do: [{ op: 'set' | 'merge' | 'update' | 'remove', path, value }]. */
    async batch(writes) {
      for (const w of writes) if (w.op === 'update' && !docs[w.path]) throw Object.assign(new Error(`No document at ${w.path}`), { code: 'not-found' });
      const next = clone(docs);
      for (const w of writes) {
        if (w.op === 'set') next[w.path] = clone(w.value);
        else if (w.op === 'merge') { next[w.path] ??= {}; mergeInto(next[w.path], w.value); }
        else if (w.op === 'update') for (const [k, v] of Object.entries(w.value)) setDotted(next[w.path], k, isIncrement(v) ? v : clone(v));
        else if (w.op === 'remove') delete next[w.path];
      }
      docs = next; persist();
      for (const path of new Set(writes.map(w => w.path))) emit(path);
    },
    async list(col, { orderBy, limit } = {}) {
      let out = docsIn(col);
      if (orderBy) out.sort((a, b) => (a[orderBy] > b[orderBy] ? 1 : a[orderBy] < b[orderBy] ? -1 : 0));
      return limit ? out.slice(0, limit) : out;
    },
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
