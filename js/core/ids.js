/** Random ids. Trip ids double as the invite secret, so they are long and from a secure source. */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function randomId(length = 16) {
  let out = '';
  while (out.length < length) {
    // Bytes of 252 and above are skipped so that every character stays equally likely.
    for (const b of crypto.getRandomValues(new Uint8Array(length))) if (b < 252 && out.length < length) out += ALPHABET[b % 36];
  }
  return out;
}
export const tripId = () => randomId(24);
export const TRIP_ID_PATTERN = /^[a-z0-9]{20,40}$/;
