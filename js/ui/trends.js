/** Trends: where the money went, what changed, month by month, plan vs real, and saving. */
import { A, actions } from './state.js';
import { esc, fmtMonth, today, toast } from './dom.js';
import { monthBar, writeAssigned } from './budget.js';
import { monthTotals, categoryCompare, notableChanges, planVsReal, savingThisMonth, targetProgress } from '../core/trends.js';
import { money } from '../core/money.js';

const short = m => new Date(`${m}-15T12:00:00`).toLocaleDateString('en', { month: 'short' });
const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);
/** Rounds a plan up to a tidy figure: the next $5, or $1 under $20. */
const tidy = c => (c < 2000 ? Math.ceil(c / 100) * 100 : Math.ceil(c / 500) * 500);

function whereItWent(c) {
  if (!c.rows.length) return '<p class="small muted">No spending this month yet.</p>';
  const max = Math.max(...c.rows.map(r => Math.max(r.spent, r.usual)), 1);
  return `<ul class="cmp-list">${c.rows.slice(0, 8).map(r => `<li>
      <div class="row between"><span class="wrap-any">${esc(r.name)}</span><span class="amt">${money(r.spent)}</span></div>
      <div class="cmp-track" aria-hidden="true"><i style="width:${pct(r.spent, max)}%"></i>${r.usual && c.monthsCompared ? `<b style="left:${pct(r.usual, max)}%"></b>` : ''}</div>
      ${c.monthsCompared ? `<span class="tiny muted">Usual${c.partial ? ' by now' : ''}: ${money(r.usual)}</span>` : ''}
    </li>`).join('')}</ul>
    ${c.rows.length > 8 ? `<p class="tiny muted">And ${c.rows.length - 8} more.</p>` : ''}
    ${c.monthsCompared ? `<p class="tiny muted"><span class="key-tick" aria-hidden="true"></span> marks what's usual, from the last ${c.monthsCompared} ${c.monthsCompared === 1 ? 'month' : 'months'}${c.partial ? ' up to the same day' : ''}.</p>` : ''}`;
}

function changes(list, c) {
  if (c.monthsCompared < 2) return '<p class="small muted">After two months of spending, this shows what’s up or down compared with usual.</p>';
  if (!list.length) return '<p class="small muted">Nothing unusual. Spending is close to normal everywhere.</p>';
  return `<ul class="change-list">${list.map(r => `<li class="row between">
    <span class="wrap-any"><strong>${esc(r.name)}</strong> is ${r.change > 0 ? `<span class="owe">up ${r.pct}%</span>` : `down ${-r.pct}%`}</span>
    <span class="small muted nowrap">${r.change > 0 ? `${money(r.change)} more` : `${money(-r.change)} less`}</span>
  </li>`).join('')}</ul>`;
}

function monthByMonth(rows) {
  const max = Math.max(...rows.flatMap(r => [r.income, r.spent]), 1);
  return `<div class="cols" role="img" aria-label="Income and spending for the last ${rows.length} months">${rows.map(r => `<div class="col">
      <div class="col-bars"><i class="in" style="height:${pct(r.income, max)}%"></i><i class="out" style="height:${pct(r.spent, max)}%"></i></div>
      <span class="tiny muted">${short(r.month)}</span>
    </div>`).join('')}</div>
    <div class="legend small"><span><i class="in"></i>Came in</span><span><i class="out"></i>Spent</span></div>
    <table class="mini-table"><tbody>${rows.slice().reverse().slice(0, 3).map(r => `<tr><th scope="row">${esc(fmtMonth(r.month))}</th><td class="amt owed">+${money(r.income)}</td><td class="amt owe">−${money(r.spent)}</td><td class="amt ${r.income - r.spent < 0 ? 'owe' : ''}">${money(r.income - r.spent)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td></td><td class="tiny muted">In</td><td class="tiny muted">Out</td><td class="tiny muted">Difference</td></tr></tfoot></table>`;
}

function planReal(rows) {
  if (!rows.length) return '<p class="small muted">Your plan matches what you really spend. Categories that keep running over will show here.</p>';
  return `<ul class="change-list">${rows.map(r => `<li class="stack tight">
    <div class="row between"><strong class="wrap-any">${esc(r.name)}</strong><span class="small owe nowrap">Over ${r.over} of ${r.counted} months</span></div>
    <span class="small muted">Usually spends ${money(r.usualSpent)}; you plan ${money(r.usualPlanned)}.</span>
    <button type="button" class="btn small" data-action="plan-usual" data-id="${r.id}" data-amount="${tidy(r.usualSpent)}">Plan ${money(tidy(r.usualSpent))} this month</button>
  </li>`).join('')}</ul>`;
}

function saving(s, targets) {
  const rate = s.rate === null ? '' : `<p><span class="big-amt amt">${Math.round(s.rate * 100)}%</span> <span class="muted">of this month's income is planned for saving</span></p><p class="small muted">${money(s.saved)} of ${money(s.income)}, counting categories in groups that start with “Sav”.</p>`;
  return `${rate || '<p class="small muted">Add this month’s income to see how much of it goes to saving.</p>'}
    ${targets.length ? `<ul class="cmp-list">${targets.map(t => `<li>
      <div class="row between"><span class="wrap-any">${esc(t.name)}</span><span class="small muted nowrap">${money(Math.max(0, t.done))} of ${money(t.amount)}</span></div>
      <div class="cmp-track ${t.type === 'byDate' ? 'save' : ''}" aria-hidden="true"><i style="width:${pct(Math.max(0, t.done), t.amount)}%"></i></div>
      <span class="tiny muted">${t.type === 'yearly' ? 'Spent this year' : `Saved toward ${esc(fmtMonth(t.date))}`}</span>
    </li>`).join('')}</ul>` : ''}`;
}

export function trendsScreen(b) {
  const list = A.transactions[b.id] || [];
  const now = today();
  const compare = categoryCompare(b, list, A.month, now);
  const all = monthTotals(list, A.month, 6);
  const first = all.findIndex(r => r.income || r.spent);
  const totals = first > 0 && all.length - first >= 2 ? all.slice(first) : all;
  const enough = totals.filter(r => r.income || r.spent).length;
  return `${monthBar()}
    ${enough < 2 ? '<p class="notice">Trends get more useful after a month or two of spending. Here’s what there is so far.</p>' : ''}
    <section class="panel pad stack"><div class="row between"><h2>Where it went</h2><span class="amt">${money(compare.total)}</span></div>${whereItWent(compare)}</section>
    <section class="panel pad stack"><h2>Worth a look</h2>${changes(notableChanges(compare), compare)}</section>
    <section class="panel pad stack"><h2>Month by month</h2>${monthByMonth(totals)}</section>
    <section class="panel pad stack"><h2>Plan vs real</h2>${planReal(planVsReal(b, list, A.month))}</section>
    <section class="panel pad stack"><h2>Saving</h2>${saving(savingThisMonth(b, list, A.month), targetProgress(b, list, A.month))}</section>`;
}

actions['plan-usual'] = el => {
  const b = A.budgets[A.route.id], id = el.dataset.id, amount = Number(el.dataset.amount);
  const current = b.assigned?.[A.month]?.[id] || 0;
  if (current >= amount) return toast(`${b.categories[id].name} already has ${money(current)} planned.`);
  writeAssigned(b, A.month, { ...(b.assigned?.[A.month] || {}), [id]: amount }, `${b.categories[id].name}: ${money(amount)} planned`);
};
