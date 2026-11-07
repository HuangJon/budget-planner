/**
 * Special values a write can carry, understood by both backends.
 * - `increment(n)` adds n to a number on the server, so two phones counting at once both count.
 * - In an update, a field set to `undefined` is removed.
 */
export const increment = by => ({ __op: 'increment', by });
export const isIncrement = v => Boolean(v) && typeof v === 'object' && v.__op === 'increment' && Number.isFinite(v.by);
