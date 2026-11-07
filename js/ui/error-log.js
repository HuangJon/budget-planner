/**
 * Sends the owner a short note when something breaks: a refused or failed save, or a crash. Each
 * problem goes once per visit, with a cap, so it can't use up the free database limits. The note
 * is scrubbed of anything personal first (see core/usage.js), and a note that can't be sent is dropped.
 */
import { A } from './state.js';
import { randomId } from '../core/ids.js';
import { errorRecord, platformOf } from '../core/usage.js';
import { APP_VERSION } from '../config/app.js';

const MAX_PER_VISIT = 20;
const sent = new Set();

function report(kind, message) {
  try {
    const key = `${kind}:${message}`;
    if (A.preview || !A.user?.uid || !A.repo?.logError || sent.has(key) || sent.size >= MAX_PER_VISIT) return;
    sent.add(key);
    A.repo.logError(errorRecord({ id: randomId(), kind, message, screen: A.route?.name || 'other', version: APP_VERSION, platform: platformOf(navigator.userAgent), at: Date.now() })).catch(() => {});
  } catch { /* reporting must never cause a problem of its own */ }
}

export function setUpErrorLog() {
  A.logProblem = report;
  addEventListener('error', ev => report('app-error', ev.message || 'Unknown error'));
  addEventListener('unhandledrejection', ev => report('app-error', ev.reason?.code || ev.reason?.message || 'Unhandled failure'));
}
