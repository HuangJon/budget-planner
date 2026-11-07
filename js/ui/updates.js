/**
 * Finds new versions. Browsers only look when a page fully loads, and a phone often just resumes a
 * home-screen app, and a browser tab can sit open for days. So this also looks whenever the app comes
 * back to the screen or back online, and every so often while it stays open.
 */
const CHECK_GAP_MS = 60000, OPEN_CHECK_MS = 15 * 60000;

export function watchForUpdates({ sw, doc, win, onUpdate, now = Date.now }) {
  return sw.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      if (!sw.controller) return; // first install: nothing to update
      incoming?.addEventListener('statechange', () => {
        if (incoming.state === 'installed') onUpdate();
      });
    });
    let last = now();
    const check = () => {
      if (doc.visibilityState !== 'visible' || now() - last < CHECK_GAP_MS) return;
      last = now();
      Promise.resolve(reg.update()).catch(() => {}); // offline: the next return checks again
    };
    doc.addEventListener('visibilitychange', check);
    win.addEventListener('online', check);
    win.setInterval(check, OPEN_CHECK_MS);
    return check;
  }).catch(() => {});
}
