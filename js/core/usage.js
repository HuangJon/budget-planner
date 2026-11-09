/**
 * What the app's owner may see: counts of people, budgets and weekly use, and error reports with
 * nothing personal in them. Pure functions, so the rules about what's allowed are easy to test.
 */

/** The ISO week a date falls in, like "2026-W45". Weeks start on Monday. */
export function isoWeek(d = new Date()) {
  const day = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day - yearStart) / 864e5 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The weeks before `week`, newest first, for the owner page's history. */
export function recentWeeks(now = new Date(), count = 8) {
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(isoWeek(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7 * i)));
  return [...new Set(out)];
}

export const ERROR_KINDS = ['failed-save', 'refused-save', 'app-error'];
export const SCREENS = ['home', 'budget', 'plan', 'transactions', 'trends', 'people', 'join', 'owner', 'sign-in', 'other'];

/**
 * Strips anything personal from an error message before it leaves the phone: email addresses,
 * every digit (amounts, dates, ids), quoted text (often what someone typed), and long tokens.
 * The database rules refuse a report that still has a digit or an "@" in it.
 */
export function scrubMessage(text) {
  return String(text ?? '')
    .replace(/\S+@\S+/g, '[email]')
    .replace(/(["'`“‘])[^"'`”’]*(["'`”’])/g, '[text]')
    .replace(/[0-9]+/g, '#')
    .replace(/@/g, '')
    .replace(/[A-Za-z_-]{25,}/g, '[id]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) || 'Unknown problem';
}

/** The whole error report: no account, no budget, no amounts. */
export function errorRecord({ id, kind, message, screen, version, platform, at }) {
  return {
    id,
    kind: ERROR_KINDS.includes(kind) ? kind : 'app-error',
    message: scrubMessage(message),
    screen: SCREENS.includes(screen) ? screen : 'other',
    // The app's version (like wmm-v12) is the one place digits are allowed: it says nothing about anyone.
    version: String(version || '').replace(/[^a-z0-9.-]/gi, '').slice(0, 20) || 'unknown',
    platform: ['iphone', 'android', 'computer'].includes(platform) ? platform : 'computer',
    at,
  };
}

/** Which kind of device, in one word, without the details a user-agent string gives away. */
export const platformOf = (ua = '') => (/iPhone|iPad|iPod/.test(ua) ? 'iphone' : /Android/.test(ua) ? 'android' : 'computer');

/** Feedback someone sends: a problem or an idea, their words (up to 1,000 characters), their email only if they chose. */
export function reportRecord({ id, kind, text, email, screen, version, platform, at }) {
  const r = errorRecord({ id, kind: 'app-error', message: '', screen, version, platform, at });
  const out = { id, kind: kind === 'idea' ? 'idea' : 'problem', text: String(text || '').trim().slice(0, 1000), screen: r.screen, version: r.version, platform: r.platform, at, done: false };
  if (email) out.email = email;
  return out;
}
