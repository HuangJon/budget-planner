/**
 * Suggests a category from what someone typed. Past transactions with the same description win,
 * since that's how this household actually files things; then common words; then category names.
 */
const WORDS = [
  [/rent|landlord|mortgage/, ['rent', 'housing', 'mortgage']],
  [/electric|con ?ed|gas bill|water|power|utilit/, ['utilities', 'power']],
  [/phone|verizon|t-?mobile|at&t|mint mobile/, ['phone']],
  [/internet|wifi|comcast|spectrum|fios/, ['internet']],
  [/insur/, ['insurance']],
  [/netflix|spotify|hulu|disney|youtube|apple tv|icloud|stream|subscription|patreon/, ['subscriptions']],
  [/grocer|trader|whole foods|safeway|kroger|costco|aldi|wegmans|market|fairway|h ?mart/, ['groceries']],
  [/restaurant|dinner|lunch|brunch|breakfast|coffee|cafe|pizza|taco|sushi|ramen|burger|bar\b|drinks|doordash|uber eats|seamless|grubhub/, ['eating out', 'dining', 'restaurants']],
  [/uber|lyft|taxi|metro|subway|train|bus\b|gas station|parking|toll|citi ?bike|omny/, ['transport', 'transportation']],
  [/target|cleaning|paper towel|toilet|soap|ikea|hardware|home depot/, ['household', 'home']],
  [/movie|concert|ticket|game|museum|show/, ['entertainment', 'fun']],
  [/gift|birthday present|wedding/, ['gifts']],
  [/flight|hotel|airbnb|trip|vacation/, ['travel']],
  [/amazon|clothes|shoes|zara|uniqlo/, ['shopping']],
];

const norm = s => String(s || '').trim().toLowerCase();

export function suggestCategory(description, categories, pastTransactions = []) {
  const text = norm(description);
  if (text.length < 2) return null;
  const live = Object.entries(categories || {}).filter(([, c]) => !c.hidden);
  const byName = new Map(live.map(([id, c]) => [norm(c.name), id]));

  const past = [...pastTransactions].reverse().find(t => !t.deleted && t.kind !== 'income' && norm(t.description) === text && categories[t.categoryId] && !categories[t.categoryId].hidden);
  if (past) return past.categoryId;

  for (const [pattern, names] of WORDS) {
    if (!pattern.test(text)) continue;
    for (const n of names) if (byName.has(n)) return byName.get(n);
  }
  for (const [id, c] of live) if (text.includes(norm(c.name)) || norm(c.name).includes(text)) return id;
  return null;
}
