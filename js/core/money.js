/** All money is stored as whole cents, so totals never drift. */

/** Reads what someone typed. Returns 0 for anything that is not a number. */
export function toCents(value) {
  const n = parseFloat(String(value ?? '').replace(/[,$\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
export const fromCents = cents => (cents / 100).toFixed(2);

const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
/** "$1,234.56", or "−$12.00" with a real minus sign for negatives. */
export function money(cents) {
  const text = formatter.format(Math.abs(cents) / 100);
  return cents < 0 ? `−${text}` : text;
}

/**
 * Splits a whole-number total by weights using the largest remainder, so the parts always add up
 * exactly. Leftover cents go to the largest fractions, then to whoever comes first.
 * Example: 100 split by {a:1,b:1,c:1} gives {a:34,b:33,c:33}.
 */
export function allocate(total, weights) {
  const ids = Object.keys(weights);
  const out = Object.fromEntries(ids.map(i => [i, 0]));
  const positive = ids.filter(i => weights[i] > 0);
  const sum = positive.reduce((a, i) => a + weights[i], 0);
  if (sum <= 0 || total <= 0) return out;
  let left = total;
  const parts = positive.map((id, order) => {
    const exact = (total * weights[id]) / sum;
    const whole = Math.floor(exact);
    out[id] = whole;
    left -= whole;
    return { id, frac: exact - whole, order };
  });
  parts.sort((a, b) => b.frac - a.frac || a.order - b.order);
  for (let k = 0; left > 0; k = (k + 1) % parts.length) { out[parts[k].id] += 1; left -= 1; }
  return out;
}
