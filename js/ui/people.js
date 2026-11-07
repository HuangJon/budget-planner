/** Who's in a budget, inviting people by link, and leaving. */
import { A, actions, render } from './state.js';
import { esc, toast, send, val } from './dom.js';
import { LIMITS } from '../config/app.js';

const inviteLink = code => `${location.origin}${location.pathname}#join-${code}`;
const isAdmin = b => Boolean(b.members?.[A.user?.uid]?.admin);

export function peopleScreen(b) {
  const me = A.user?.uid;
  const people = Object.entries(b.members || {}).sort(([a, x], [c, y]) => (a === me ? -1 : c === me ? 1 : (x.joinedAt || 0) - (y.joinedAt || 0)));
  const admins = people.filter(([, m]) => m.admin).length;
  const admin = isAdmin(b);
  const confirm = A.confirmRemove;
  return `<h2 class="screen-title">People</h2>
    <section class="panel people-list">${people.map(([uid, m]) => `<div class="person">
      <span class="ava" style="background:var(--m${(Math.abs([...uid].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7)) % 8) + 1})" aria-hidden="true">${esc([...(m.name || '?')][0].toUpperCase())}</span>
      <span class="grow stack tight"><strong class="wrap-any">${esc(m.name || 'Someone')}${uid === me && (m.name || '').toLowerCase() !== 'you' ? ' (you)' : ''}</strong><span class="tiny muted">${m.admin ? 'Can invite and remove people' : 'Can add and change anything in the budget'}</span></span>
      ${m.admin ? '<span class="tag you">Admin</span>' : ''}
      ${admin && uid !== me ? `<div class="person-tools">${confirm === uid
        ? `<span class="small">Remove ${esc(m.name)}? They lose access; what they added stays.</span><div class="row gap8"><button type="button" class="btn small danger" data-action="person-remove" data-id="${uid}">Remove</button><button type="button" class="btn small" data-action="person-cancel">Cancel</button></div>`
        : `<button type="button" class="link small" data-action="person-admin" data-id="${uid}">${m.admin ? 'Make not admin' : 'Make admin'}</button><button type="button" class="link small danger-link" data-action="person-ask" data-id="${uid}">Remove</button>`}</div>` : ''}
    </div>`).join('')}</section>

    ${admin && Object.keys(b.requests || {}).length ? `<section class="panel pad stack requests" aria-label="Waiting to join">
      <h3>Waiting to join</h3>
      ${Object.entries(b.requests).map(([uid, r]) => `<div class="request-row"><span class="grow stack tight"><strong class="wrap-any">${esc(r.name || 'Someone')}</strong><span class="tiny muted">Asked with your invite link</span></span><div class="row gap8"><button type="button" class="btn small primary" data-action="request-approve" data-id="${uid}">Let in</button><button type="button" class="btn small" data-action="request-decline" data-id="${uid}">Turn away</button></div></div>`).join('')}
      <p class="tiny muted">Once let in, they see and can change everything in this budget.</p>
    </section>` : ''}

    ${admin ? `<section class="panel pad stack">
      <h3>Invite someone</h3>
      <p class="small muted">Anyone with this link can ask to join after signing in. You let each person in before they see anything.</p>
      ${b.invite?.code ? `<div class="linkbox" id="inviteLink">${esc(inviteLink(b.invite.code))}</div>
        <div class="row gap8 wrap"><button type="button" class="btn primary" data-action="invite-copy">Copy link</button><button type="button" class="btn" data-action="invite-reset">Make a new link</button></div>
        <p class="tiny muted">Making a new link stops the old one from working. People already in stay in.</p>`
        : '<button type="button" class="btn primary" data-action="invite-reset">Create an invite link</button>'}
    </section>` : '<p class="small muted">Ask an admin if you want to invite someone.</p>'}

    <section class="panel pad stack">
      <h3>Your name here</h3>
      <div class="row gap8"><input id="myName" maxlength="${LIMITS.personName}" value="${esc(b.members?.[me]?.name || '')}" autocomplete="off" aria-label="Your name in this budget"><button type="button" class="btn" data-action="rename-me">Save</button></div>
    </section>

    <section class="panel pad stack">
      <h3>Privacy</h3>
      <p class="small muted">Only the people above can see this budget in the app. The app's owner sees counts and error reports, never amounts or what you typed. They run the database, so they could technically look inside it, but the app never shows them your budget.</p>
    </section>

    ${people.length > 1 ? (admin && admins === 1
      ? '<p class="small muted">You’re the only admin. Make someone else an admin before you leave.</p>'
      : `${A.confirmLeave ? `<section class="panel pad stack"><p>Leave ${esc(b.name)}? You'll need a new invite to come back.</p><div class="row gap8"><button type="button" class="btn danger" data-action="leave-yes">Leave</button><button type="button" class="btn" data-action="leave-no">Stay</button></div></section>` : '<button type="button" class="btn danger" data-action="leave-ask">Leave this budget</button>'}`) : ''}`;
}

actions['invite-reset'] = async el => {
  const b = A.budgets[A.route.id];
  el.disabled = true;
  try {
    await A.repo.resetInvite(b.id, b.invite?.code, b.name);
    toast(b.invite?.code ? 'New link made. The old one no longer works.' : 'Invite link ready');
  } catch { toast("Couldn't make a link. Check your connection and try again."); el.disabled = false; }
};
actions['invite-copy'] = () => {
  const box = document.getElementById('inviteLink');
  const text = box?.textContent || '';
  const selectIt = () => { const r = document.createRange(); r.selectNodeContents(box); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
  try {
    navigator.clipboard.writeText(text).then(() => toast('Link copied'), () => { selectIt(); toast('Link selected. Copy it from here.'); });
  } catch { selectIt(); toast('Link selected. Copy it from here.'); }
};
actions['person-ask'] = el => { A.confirmRemove = el.dataset.id; render(); };
actions['person-cancel'] = () => { A.confirmRemove = null; render(); };
actions['person-remove'] = el => {
  const b = A.budgets[A.route.id], uid = el.dataset.id, name = b.members[uid]?.name;
  A.confirmRemove = null;
  send(A.repo.removeMember(b.id, uid));
  toast(`${name} removed`);
};
actions['person-admin'] = el => {
  const b = A.budgets[A.route.id], uid = el.dataset.id, now = !b.members[uid].admin;
  send(A.repo.setAdmin(b.id, uid, now));
  toast(now ? `${b.members[uid].name} is now an admin` : `${b.members[uid].name} is no longer an admin`);
};
actions['rename-me'] = () => {
  const b = A.budgets[A.route.id], name = val('myName').trim().slice(0, LIMITS.personName);
  if (!name) return toast('Type a name.');
  send(A.repo.renameMe(b.id, name));
  toast('Saved');
};
actions['leave-ask'] = () => { A.confirmLeave = true; render(); };
actions['leave-no'] = () => { A.confirmLeave = false; render(); };
actions['leave-yes'] = () => {
  const b = A.budgets[A.route.id];
  A.confirmLeave = false;
  send(A.repo.leaveBudget(b.id));
  location.hash = '#home';
  toast(`You left ${b.name}`);
};

/* ---------- Joining from a link ---------- */

export function joinScreen() {
  const J = A.join;
  if (!J || J.status === 'loading') return '<section class="panel empty"><h2>Opening the invite</h2><p class="muted">One moment.</p></section>';
  if (J.status === 'gone') return '<section class="panel empty"><h2>This invite doesn\u2019t work any more</h2><p class="muted">It may have been replaced with a new link. Ask whoever sent it for a fresh one.</p><a class="btn" href="#home">See your budgets</a></section>';
  if (J.status === 'sent') return `<section class="panel empty"><h2>Request sent</h2><p class="muted">An admin of ${esc(J.name || 'the budget')} needs to let you in. It will show in your budgets as soon as they do.</p><a class="btn" href="#home">See your budgets</a></section>`;
  return `<section class="panel pad stack join">
    <span class="label">You're invited</span>
    <h2>Join ${esc(J.name || 'a shared budget')}</h2>
    <p class="small muted">An admin lets you in first. After that you'll see and change everything in this budget, and the people in it will see what you add.</p>
    <label class="f"><span>Your name in this budget</span><input id="joinName" maxlength="${LIMITS.personName}" value="${esc(A.user?.displayName || '')}" autocomplete="name"></label>
    <button type="button" class="btn primary" data-action="join-yes">Ask to join</button>
    <a class="btn" href="#home">Not now</a>
  </section>`;
}
export async function openJoin(code) {
  A.join = { status: 'loading', code };
  render();
  const invite = await A.repo.lookUpInvite(code).catch(() => null);
  if (A.join?.code !== code) return;
  if (!invite) { A.join = { status: 'gone', code }; render(); return; }
  if (A.budgetIds.includes(invite.budgetId)) { location.hash = `#b-${invite.budgetId}`; return; }
  if ((A.pending || []).some(p => p.budgetId === invite.budgetId && !p.declined)) { A.join = { status: 'sent', code, name: invite.budgetName || '' }; render(); return; }
  A.join = { status: 'ready', code, budgetId: invite.budgetId, name: invite.budgetName || '' };
  render();
}
actions['join-yes'] = async el => {
  const name = val('joinName').trim().slice(0, LIMITS.personName);
  if (!name) return toast('Type the name people should see.');
  el.disabled = true;
  try {
    await A.repo.requestToJoin(A.join.code, name);
    A.join = { ...A.join, status: 'sent' };
    render();
  } catch (e) {
    el.disabled = false;
    toast(e?.code === 'not-found' ? 'This invite no longer works. Ask for a new link.' : "Couldn't send your request. Check your connection and try again.");
  }
};
actions['request-approve'] = el => {
  const b = A.budgets[A.route.id], uid = el.dataset.id, name = b.requests?.[uid]?.name || 'They';
  send(A.repo.approveRequest(b.id, uid));
  toast(`${name} is in`);
};
actions['request-decline'] = el => {
  const b = A.budgets[A.route.id], uid = el.dataset.id, name = b.requests?.[uid]?.name || 'They';
  send(A.repo.declineRequest(b.id, uid));
  toast(`${name} was turned away`);
};
actions['pending-cancel'] = el => { send(A.repo.cancelRequest(el.dataset.id)); toast('Request cancelled'); };
actions['pending-dismiss'] = el => send(A.repo.dismissPending(el.dataset.id));
