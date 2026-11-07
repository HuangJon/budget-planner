/** Blue, light, dark or pride, chosen behind your icon. Blue unless someone picks another, and remembered on this device. */
const KEY = 'wmm:look';
const COLORS = { blue: '#edf3f8', light: '#E3DED3', dark: '#1C1B19', pride: '#F8F5FB' };

export function currentLook() {
  try { const v = localStorage.getItem(KEY); return COLORS[v] ? v : 'blue'; } catch { return 'blue'; }
}
export function applyLook(look = currentLook()) {
  document.documentElement.dataset.look = look;
  document.getElementById('themeColor')?.setAttribute('content', COLORS[look]);
}
export function setLook(look) {
  try { localStorage.setItem(KEY, look); } catch { /* this device just won't remember */ }
  applyLook(look);
}

const LOOKS = [['blue', 'Blue'], ['light', 'Light'], ['dark', 'Dark'], ['pride', 'Pride (Wes)']];
export const lookPicker = () => `<div class="look-row"><span>Theme</span><div class="seg" role="group" aria-label="Theme">${LOOKS.map(([k, label]) => `<button type="button" data-action="set-look" data-id="${k}" aria-pressed="${currentLook() === k}">${label}</button>`).join('')}</div></div>`;
