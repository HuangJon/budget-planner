/**
 * Send feedback: a problem or an idea, in your own words, to the developer. Reachable from
 * Settings, from the bottom of every "?" help popup, and from the Report button on any message
 * saying something didn't work (which fills in what failed). It goes with the screen, app version
 * and kind of device; your email only if you tick the box.
 */
import { A, actions } from './state.js';
import { esc, openSheet, sheetHead, openChild, registerSheet, finishSheet, toast } from './dom.js';
import { reportRecord, platformOf } from '../core/usage.js';
import { randomId } from '../core/ids.js';
import { APP_VERSION } from '../config/app.js';

export function openFeedback({ about = '', kind = 'problem' } = {}) {
  openChild({ kind: 'report', type: kind, about, screen: A.route?.name || 'other' }, drawReport);
}
A.openFeedback = openFeedback;

function drawReport() {
  const S = A.sheet, idea = S.type === 'idea';
  openSheet(`<div class="sheet">${sheetHead('Send feedback')}<div class="sheet-body">
    <div class="seg" role="group" aria-label="What kind of feedback">
      <button type="button" data-action="feedback-type" data-id="problem" aria-pressed="${!idea}">Something’s wrong</button>
      <button type="button" data-action="feedback-type" data-id="idea" aria-pressed="${idea}">An idea</button>
    </div>
    ${S.about ? `<p class="small panel pad about-failed"><span class="label">What didn’t work</span>${esc(S.about)}</p>` : ''}
    <label class="field"><span class="label">${idea ? 'What would make it better?' : 'What happened?'}</span>
      <textarea id="reportText" rows="6" maxlength="900" placeholder="${idea ? 'It would help if…' : 'I tapped Save on a repeat and it didn’t show up…'}">${esc(S.text || '')}</textarea></label>
    ${A.user?.email ? `<label class="row gap8 small"><input type="checkbox" id="reportEmail" ${S.withEmail ? 'checked' : ''}> <span>Include my email (${esc(A.user.email)}) so the developer can reply</span></label>` : ''}
    <p class="tiny muted">Sent along: which screen you were on, the app version and the kind of device. Nothing from your budgets. Please leave out amounts and account numbers.</p>
  </div><div class="sheet-foot"><button type="button" class="btn primary" data-action="report-send">Send</button></div></div>`);
}

const keepTyped = () => {
  A.sheet.text = document.getElementById('reportText')?.value || '';
  A.sheet.withEmail = Boolean(document.getElementById('reportEmail')?.checked);
};

actions['feedback-type'] = el => { keepTyped(); A.sheet.type = el.dataset.id; drawReport(); };

actions['report-send'] = () => {
  keepTyped();
  const S = A.sheet, typed = S.text.trim();
  if (typed.length < 3) { toast('Write a few words first.'); document.getElementById('reportText')?.focus(); return; }
  if (A.preview) { toast('Sending feedback works in the real app.'); return; }
  const text = S.about ? `[${S.about}]\n${typed}` : typed;
  const record = reportRecord({ id: randomId(), kind: S.type, text, email: S.withEmail ? A.user?.email : null, screen: S.screen, version: APP_VERSION, platform: platformOf(navigator.userAgent), at: Date.now() });
  A.repo.sendReport(record).then(
    () => toast('Sent. Thank you.'),
    () => toast('That didn’t send. Check your connection and try again.'),
  );
  finishSheet();
};

actions['feedback-open'] = () => openFeedback();
actions['report-open'] = () => openFeedback();
registerSheet('report', drawReport);
