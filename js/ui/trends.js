/**
 * Trends: a short summary first, then sections that fold: pace, upcoming bills, where it went,
 * changes, month by month (3/6/12 months or this year), categories over time, biggest purchases,
 * plan vs real, saving, and an opt-in look at who spent what. Tap a category for its own trend.
 */
import { A, actions, changes, render } from './state.js';
import { esc, svg, fmtMonth, fmtDate, today, toast, send, openSheet, closeSheet, sheetHead, openChild, registerSheet } from './dom.js';
import { monthBar, writeAssigned, catSheet } from './budget.js';
import {
  monthTotals, categoryCompare, notableChanges, planVsReal, savingThisMonth, targetProgress,
  pace, upcomingBills, categoryHistory, biggestPurchases, byPerson, categoryTotals, headlines, rangeMonths, byYear, byQuarter, firstMonth,
} from '../core/trends.js';
import { money } from '../core/money.js';
import { addMonths } from '../core/budget.js';
import { openSearch } from './search.js';

const short = m => new Date(`${m}-15T12:00:00`).toLocaleDateString('en', { month: 'short' });
const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);
/** Rounds a plan up to a tidy figure: the next $5, or $1 under $20. */
const tidy = c => (c < 2000 ? Math.ceil(c / 100) * 100 : Math.ceil(c / 500) * 500);
const CHEV = '<path d="M6 9l6 6 6-6"/>';

/* Remembered on this device: the range and which sections are folded. */
const store = (key, fallback) => { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return A[`mem:${key}`] ?? fallback; } };
const keep = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { A[`mem:${key}`] = value; } };
const range = () => store('wmm:trendsRange', '6');
// Summary, Pace and Coming up start open; the rest start folded so the page opens short.
const folded = () => store('wmm:trendsFolded', ['where', 'changes', 'months', 'categories', 'biggest', 'plan', 'saving', 'limits', 'people']);
const RANGES = [['3', 'Last 3 months'], ['6', 'Last 6 months'], ['12', 'Last 12 months'], ['year', 'This year'], ['24', 'Last 2 years'], ['36', 'Last 3 years'], ['60', 'Last 5 years'], ['all', 'All time'], ['custom', 'Pick months…']];
const monthShort = m => new Date(`${m}-15T12:00:00`).toLocaleDateString('en', { month: 'short', year: 'numeric' });
const rangeLabel = (r, month, months) => (r === 'year' ? `${month.slice(0, 4)} so far`
  : r === 'all' ? 'all time'
  : r === 'custom' ? `${monthShort(months[0])} to ${monthShort(months.at(-1))}`
  : Number(r) >= 24 ? `last ${Number(r) / 12} years` : `last ${r} months`);
/** The months the chosen range covers, with what each kind of range needs. */
const custom = () => store('wmm:trendsCustom', null);
const rangeFor = (r, list) => {
  const c = custom() || { from: addMonths(A.month, -11), to: A.month };
  return rangeMonths(r, A.month, { first: firstMonth(list), from: c.from, to: c.to });
};

function section(key, title, body, right = '') {
  const isFolded = folded().includes(key);
  return `<section class="panel trend ${isFolded ? 'folded' : ''}" data-section="${key}">
    <button type="button" class="trend-head" data-action="trend-fold" data-id="${key}" aria-expanded="${!isFolded}">
      <h2 class="grow">${esc(title)}</h2>${right ? `<span class="amt">${right}</span>` : ''}<span class="fold-chev" aria-hidden="true">${svg(CHEV)}</span>
    </button>
    ${isFolded ? '' : `<div class="trend-body stack">${body}</div>`}
  </section>`;
}

/* ---------- Pieces ---------- */

function summary(lines, month) {
  if (!lines.length) return '';
  return `<section class="panel pad summary" aria-label="Summary"><ul>${lines.map(l => {
    if (l.text === 'pace') {
      const over = l.budgeted && l.projected > l.budgeted;
      return `<li class="${over ? 'bad' : ''}"><span class="dot" aria-hidden="true"></span><span>On pace to spend <strong class="amt ${over ? 'owe' : ''}">${money(l.projected)}</strong> this month${l.budgeted ? `, with ${money(l.budgeted)} to spend` : ''}</span></li>`;
    }
    if (l.text === 'leftover') {
      return l.amount >= 0
        ? `<li><span class="dot" aria-hidden="true"></span><span><strong class="amt owed">${money(l.amount)}</strong> left over in ${esc(fmtMonth(l.month).split(' ')[0])}</span></li>`
        : `<li class="bad"><span class="dot" aria-hidden="true"></span><span>Spent <strong class="amt owe">${money(-l.amount)}</strong> more than came in during ${esc(fmtMonth(l.month).split(' ')[0])}</span></li>`;
    }
    return `<li class="${l.kind === 'up' ? 'bad' : ''}"><span class="dot" aria-hidden="true"></span><button type="button" class="link-text" data-action="cat-trend" data-id="${l.id}">${esc(l.text)}</button></li>`;
  }).join('')}</ul></section>`;
}

function paceBody(p, month) {
  if (p.elapsed === 0) return '<p class="small muted">This month hasn’t started yet.</p>';
  if (!p.budgeted && !p.spent) return '<p class="small muted">Nothing planned or spent yet this month.</p>';
  const done = p.elapsed >= 1;
  return `<div class="pace-bar" aria-hidden="true"><i class="${p.usedShare > p.elapsed + 0.05 ? 'fast' : ''}" style="width:${Math.min(100, Math.round((p.usedShare || 0) * 100))}%"></i>${done ? '' : `<b style="left:${Math.round(p.elapsed * 100)}%"></b>`}</div>
    <p>${done ? `Spent <strong class="amt">${money(p.spent)}</strong> of ${money(p.budgeted)} to spend in ${esc(fmtMonth(month).split(' ')[0])}.`
      : `You've used <strong>${Math.round((p.usedShare || 0) * 100)}%</strong> of your money to spend, <strong>${Math.round(p.elapsed * 100)}%</strong> of the way through the month.`}</p>
    ${done ? '' : `<p class="small muted">At this rate you'll spend ${money(p.projected)}. Bills and saving are left out, since they're paid in one go.</p>`}
    ${p.ahead.length ? `<ul class="change-list">${p.ahead.map(a => `<li class="row between"><button type="button" class="link-text" data-action="cat-trend" data-id="${a.id}"><strong>${esc(a.name)}</strong></button><span class="small owe nowrap">${Math.round(a.share * 100)}% used</span></li>`).join('')}</ul>` : ''}`;
}

function billsBody(u, b) {
  if (!u.list.length) return '<p class="small muted">No repeats in the next 30 days. Turn on "Repeat every month" when adding a bill or paycheck.</p>';
  return `<p class="small muted">${money(u.out)} going out${u.incoming ? ` and ${money(u.incoming)} coming in` : ''} over the next 30 days.${u.uncovered ? ` <span class="owe">${u.uncovered} ${u.uncovered === 1 ? 'needs' : 'need'} money planned.</span>` : ''}</p>
    <ul class="bill-list">${u.list.map(x => `<li class="row">
      <span class="bill-date"><span class="tiny muted">${esc(short(x.date.slice(0, 7)))}</span><strong>${Number(x.date.slice(8, 10))}</strong></span>
      <span class="grow stack tight"><span class="wrap-any">${esc(x.description || (x.kind === 'income' ? 'Income' : 'Bill'))}</span><span class="tiny ${x.covered === false ? 'owe' : 'muted'}">${x.kind === 'income' ? 'Coming in' : x.covered === true ? `Covered from ${esc(b.categories[x.categoryId]?.name || 'its category')}` : x.covered === false ? `Not enough in ${esc(b.categories[x.categoryId]?.name || 'its category')}` : 'Next month'}</span></span>
      <span class="amt ${x.kind === 'income' ? 'owed' : 'owe'}">${x.kind === 'income' ? '+' : '−'}${money(x.amount)}</span>
    </li>`).join('')}</ul>`;
}

function whereItWent(c) {
  if (!c.rows.length) return '<p class="small muted">No spending this month yet.</p>';
  const max = Math.max(...c.rows.map(r => Math.max(r.spent, r.usual)), 1);
  return `<ul class="cmp-list">${c.rows.slice(0, 8).map(r => `<li><button type="button" class="cmp-btn" data-action="cat-trend" data-id="${r.id}">
      <span class="row between"><span class="wrap-any">${esc(r.name)}</span><span class="amt">${money(r.spent)}</span></span>
      <span class="cmp-track" aria-hidden="true"><i style="width:${pct(r.spent, max)}%"></i>${r.usual && c.monthsCompared ? `<b style="left:${pct(r.usual, max)}%"></b>` : ''}</span>
      ${c.monthsCompared ? `<span class="tiny muted">Usual${c.partial ? ' by now' : ''}: ${money(r.usual)}</span>` : ''}
    </button></li>`).join('')}</ul>
    ${c.rows.length > 8 ? `<p class="tiny muted">And ${c.rows.length - 8} more below, under Categories over time.</p>` : ''}
    ${c.monthsCompared ? `<p class="tiny muted"><span class="key-tick" aria-hidden="true"></span> marks what's usual, from the last ${c.monthsCompared} ${c.monthsCompared === 1 ? 'month' : 'months'}${c.partial ? ' up to the same day' : ''}. Tap a category for its own trend.</p>` : ''}`;
}

function changesBody(list, c) {
  if (c.monthsCompared < 2) return '<p class="small muted">After two months of spending, this shows what’s up or down compared with usual.</p>';
  if (!list.length) return '<p class="small muted">Nothing unusual. Spending is close to normal everywhere.</p>';
  return `<ul class="change-list">${list.map(r => `<li class="row between">
    <button type="button" class="link-text wrap-any" data-action="cat-trend" data-id="${r.id}"><strong>${esc(r.name)}</strong> is ${r.change > 0 ? `<span class="owe">up ${r.pct}%</span>` : `down ${-r.pct}%`}</button>
    <span class="small muted nowrap">${r.change > 0 ? `${money(r.change)} more` : `${money(-r.change)} less`}</span>
  </li>`).join('')}</ul>`;
}

/**
 * The three ranges people use most are one tap; everything else (this year, years, all time,
 * picked months) sits in "More", which shows the choice once one is made.
 */
const QUICK = [['3', '3 mo'], ['6', '6 mo'], ['12', '12 mo']];
function rangePicker(months) {
  const r = range(), more = !QUICK.some(([k]) => k === r);
  return `<div class="range-pick">
    <div class="seg range-seg" role="group" aria-label="Time range">${QUICK.map(([k, label]) => `<button type="button" data-action="trend-range" data-id="${k}" aria-pressed="${r === k}">${label}</button>`).join('')}<label class="more-range ${more ? 'on' : ''}"><span>${more ? esc(RANGES.find(([k]) => k === r)?.[1].replace(/^Last /, '').replace('…', '') || 'More') : 'More'} ▾</span><select aria-label="More time ranges" data-change="trend-range">${more ? '' : '<option value="" selected disabled>More ranges</option>'}${RANGES.filter(([k]) => !QUICK.some(([q]) => q === k)).map(([k, label]) => `<option value="${k}" ${r === k ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
    ${r === 'custom' ? `<div class="range-custom"><label><span class="label">From</span><input type="month" value="${months[0]}" max="${months.at(-1)}" data-change="trend-from"></label><label><span class="label">To</span><input type="month" value="${months.at(-1)}" min="${months[0]}" data-change="trend-to"></label></div>` : ''}
  </div>`;
}

/**
 * The whole range at a glance: what came in, went out and was left over, the share of income
 * kept, monthly averages, and how that compares with the same stretch just before.
 */
const dollars = c => `$${Math.round(Math.abs(c) / 100).toLocaleString('en-US')}`;
function overview(rows, before, label) {
  const sum = (list, k) => list.reduce((a, r) => a + r[k], 0);
  const active = rows.filter(r => r.income || r.spent);
  if (!active.length) return '';
  const income = sum(rows, 'income'), spent = sum(rows, 'spent'), left = income - spent;
  const saved = rows.reduce((a, r) => a + (r.saved || 0), 0);
  const kept = income > 0 ? Math.round((left / income) * 100) : null;
  const n = active.length;
  const prev = before.filter(r => r.income || r.spent);
  // Only compare with a stretch before that has real data: most of its months, not a stray
  // transaction or two from the edge of an import (which made "up 9,663%").
  const enoughBefore = prev.length >= Math.max(2, Math.ceil(n / 2)) && prev.every(r => r.spent > 0);
  const prevSpent = enoughBefore ? sum(prev, 'spent') / prev.length : null;
  const change = prevSpent ? Math.round(((spent / n - prevSpent) / prevSpent) * 100) : null;
  // A month still under way isn't a fair "best", so only finished months count.
  const done = active.filter(r => r.month < today().slice(0, 7));
  const best = done.length ? done.reduce((a, r) => (r.income - r.spent > a.income - a.spent ? r : a)) : null;
  return `<div class="overview">
    <div class="ov-grid">
      <div><span class="label">Came in</span><span class="amt owed">${dollars(income)}</span><span class="tiny muted">${dollars(income / n)} a month</span></div>
      <div><span class="label">Spent</span><span class="amt owe">${dollars(spent)}</span><span class="tiny muted">${dollars(spent / n)} a month${saved ? `, incl. ${dollars(saved)} saved or invested` : ''}</span></div>
      <div><span class="label">${left >= 0 ? 'Left over' : 'Short'}</span><span class="amt ${left < 0 ? 'owe' : 'left'}">${dollars(left)}</span><span class="tiny muted">${kept !== null && left >= 0 ? `${kept}% of what came in` : 'more out than in'}</span></div>
    </div>
    <p class="small muted">${esc(label[0].toUpperCase() + label.slice(1))}${n < rows.length ? ` (${n} month${n === 1 ? '' : 's'} with activity)` : ''}.${change !== null && Math.abs(change) >= 5 ? ` Spending is ${change > 0 ? 'up' : 'down'} ${Math.abs(change)}% a month on the stretch before.` : prevSpent !== null ? ' Spending is about the same as the stretch before.' : ''}${best && done.length > 1 && best.income - best.spent > 0 ? ` Most left over: ${esc(fmtMonth(best.month))}.` : ''}</p>
  </div>`;
}

function monthByMonth(rows) {
  // Rows are months ('2026-03'), quarters ('2026-Q1') or years ('2026') for longer ranges.
  const key = rows[0]?.month || '';
  const unit = key.length === 4 ? 'year' : key.includes('Q') ? 'quarter' : 'month';
  const lab = m => (unit === 'year' ? m : unit === 'quarter' ? `${m.slice(5)} ’${m.slice(2, 4)}` : short(m));
  const full = m => (unit === 'year' ? m : unit === 'quarter' ? `${m.slice(5)} ${m.slice(0, 4)}` : fmtMonth(m));
  const max = Math.max(...rows.flatMap(r => [r.income, r.spent, Math.abs(r.income - r.spent)]), 1);
  const picked = rows.find(r => r.month === A.trendsCol) || rows.at(-1);
  const avg = k => Math.round(rows.reduce((a, r) => a + r[k], 0) / Math.max(1, rows.filter(r => r.income || r.spent).length));
  return `<div class="cols ${rows.length > 6 ? 'many' : ''}" role="group" aria-label="Income and spending by ${unit}">${rows.map(r => `<button type="button" class="col ${r.month === picked.month ? 'picked' : ''}" data-action="trend-col" data-id="${r.month}" aria-pressed="${r.month === picked.month}" aria-label="${esc(full(r.month))}: ${money(r.income)} in, ${money(r.spent)} spent, ${money(Math.abs(r.income - r.spent))} ${r.income - r.spent >= 0 ? 'left over' : 'short'}">
      <span class="col-bars"><i class="in" style="height:${pct(r.income, max)}%"></i><i class="out" style="height:${pct(r.spent, max)}%"></i><i class="${r.income - r.spent >= 0 ? 'left' : 'short'}" style="height:${pct(Math.abs(r.income - r.spent), max)}%"></i></span>
      <span class="tiny muted">${lab(r.month)}</span>
    </button>`).join('')}</div>
    <div class="legend small"><span><i class="in"></i>Came in</span><span><i class="out"></i>Spent</span><span><i class="left"></i>Left over</span>${rows.some(r => r.income < r.spent) ? '<span><i class="short"></i>Short</span>' : ''}</div>
    <div class="col-detail" aria-live="polite">
      <strong>${esc(full(picked.month))}</strong>
      <div class="row between"><span class="muted">Came in</span><span class="amt owed">+${money(picked.income)}</span></div>
      <div class="row between"><span class="muted">Spent</span><span class="amt owe">−${money(picked.spent)}</span></div>
      <div class="row between"><span class="muted">${picked.income - picked.spent >= 0 ? 'Left over' : 'Short'}</span><span class="amt ${picked.income - picked.spent < 0 ? 'owe' : 'left'}">${money(Math.abs(picked.income - picked.spent))}</span></div>
    </div>
    <p class="tiny muted">Tap a ${unit} to see its numbers. On average: ${money(avg('income'))} in and ${money(avg('spent'))} spent a ${unit}.</p>`;
}

function categoriesOverTime(rows, months, label) {
  if (!rows.length) return `<p class="small muted">No spending in the ${esc(label)}.</p>`;
  const max = rows[0].spent;
  return `<ul class="cmp-list">${rows.slice(0, 12).map(r => `<li><button type="button" class="cmp-btn" data-action="cat-trend" data-id="${r.id}">
      <span class="row between"><span class="wrap-any">${esc(r.name)}</span><span class="amt">${money(r.spent)}</span></span>
      <span class="cmp-track neutral" aria-hidden="true"><i style="width:${pct(r.spent, max)}%"></i></span>
      <span class="tiny muted">${money(r.perMonth)} a month on average</span>
    </button></li>`).join('')}</ul>${rows.length > 12 ? `<p class="tiny muted">And ${rows.length - 12} smaller ones.</p>` : ''}`;
}

function biggest(list, b, wide) {
  if (!list.length) return `<p class="small muted">No purchases ${wide ? 'in this time' : 'this month yet'}.</p>`;
  return `<ul class="tx-mini">${list.map(t => `<li><button type="button" class="tap tx-row" data-action="edit-tx" data-id="${t.id}"><span class="grow stack tight"><strong class="wrap-any two-lines">${esc(t.description || 'Spending')}</strong><span class="tiny muted">${esc(b.categories[t.categoryId]?.name || 'Removed category')} · ${fmtDate(t.date)}</span></span><span class="amt owe">−${money(t.amount)}</span></button></li>`).join('')}</ul>`;
}

function planReal(rows) {
  if (!rows.length) return '<p class="small muted">Your plan matches what you really spend. Categories that keep running over will show here.</p>';
  return `<ul class="change-list">${rows.map(r => `<li class="stack tight">
    <div class="row between"><strong class="wrap-any">${esc(r.name)}</strong><span class="small owe nowrap">Over ${r.over} of ${r.counted} months</span></div>
    <span class="small muted">Usually spends ${money(r.usualSpent)}; you plan ${money(r.usualPlanned)}.</span>
    <button type="button" class="btn small" data-action="plan-usual" data-id="${r.id}" data-amount="${tidy(r.usualSpent)}">Plan ${money(tidy(r.usualSpent))} this month</button>
  </li>`).join('')}</ul>`;
}

/** Progress bars for yearly limits and save-by-a-date goals. */
const targetBars = targets => `<ul class="cmp-list">${targets.map(t => `<li>
      <div class="row between"><span class="wrap-any">${esc(t.name)}</span><span class="small muted nowrap">${money(Math.max(0, t.done))} of ${money(t.amount)}</span></div>
      <div class="cmp-track ${t.type === 'byDate' ? 'save' : ''}" aria-hidden="true"><i style="width:${pct(Math.max(0, t.done), t.amount)}%"></i></div>
      <span class="tiny muted">${t.type === 'yearly' ? 'Spent this year' : `Saved toward ${esc(fmtMonth(t.date))}`}</span>
    </li>`).join('')}</ul>`;

/** Only categories in a saving group ("Saving for", "Savings"…): what's planned for saving, and their goals. */
function saving(s, targets) {
  const rate = s.rate === null ? '' : `<p><span class="big-amt amt">${Math.round(s.rate * 100)}%</span> <span class="muted">of this month's income is planned for saving</span></p><p class="small muted">${money(s.saved)} of ${money(s.income)}, counting categories in groups that start with “Sav”.</p>`;
  return `${rate || '<p class="small muted">Add this month’s income to see how much of it goes to saving.</p>'}
    ${targets.length ? targetBars(targets) : ''}`;
}

/** Spending categories with a yearly limit (like Clothes) or a goal by a date (like Gifts for December). */
const limits = targets => `<p class="small muted">Spending categories with a yearly limit or a goal by a date.</p>${targetBars(targets)}`;

/** "This month" or the range chosen above, for sections where both make sense. */
const spans = () => store('wmm:trendsSpan', {});
const spanOf = key => spans()[key] || 'month';
const spanPicker = (key, label) => `<div class="seg span-seg" role="group" aria-label="Which months"><button type="button" data-action="trend-span" data-id="${key}" data-span="month" aria-pressed="${spanOf(key) === 'month'}">This month</button><button type="button" data-action="trend-span" data-id="${key}" data-span="range" aria-pressed="${spanOf(key) === 'range'}">${esc(label[0].toUpperCase() + label.slice(1))}</button></div>`;
actions['trend-span'] = el => { keep('wmm:trendsSpan', { ...spans(), [el.dataset.id]: el.dataset.span }); render(); };

function people(b, list, months, label) {
  const on = Boolean(b.settings?.byPerson);
  const admin = Boolean(b.members?.[A.user?.uid]?.admin);
  if (!on && !admin) return '';
  const rows = on ? byPerson(b, list, spanOf('people') === 'range' ? months : A.month) : [];
  const total = rows.reduce((a, r) => a + r.spent, 0);
  const body = `${admin ? `<label class="form-row switch-row bordered"><span class="form-row-label">Show spending by person</span><input type="checkbox" role="switch" data-change="trend-byperson" ${on ? 'checked' : ''}></label><p class="tiny muted">Everyone in this budget will see it. Repeats added automatically aren't counted for anyone.</p>` : ''}
    ${on ? spanPicker('people', label) : ''}${on ? (rows.length ? `<ul class="cmp-list">${rows.map(r => `<li><div class="row between"><span>${esc(r.uid === A.user?.uid ? 'You' : r.name)}</span><span class="amt">${money(r.spent)}</span></div><div class="cmp-track neutral" aria-hidden="true"><i style="width:${pct(r.spent, total)}%"></i></div><span class="tiny muted">${pct(r.spent, total)}% of spending added</span></li>`).join('')}</ul>` : '<p class="small muted">No spending added this month yet.</p>') : ''}`;
  return section('people', 'By person', body);
}

export function trendsScreen(b) {
  const list = A.transactions[b.id] || [];
  const now = today();
  const r = range();
  const months = rangeFor(r, list);
  const compare = categoryCompare(b, list, A.month, now);
  const all = monthTotals(list, months.at(-1), months.length, b);
  const first = all.findIndex(x => x.income || x.spent);
  const totals = first > 0 && all.length - first >= 2 ? all.slice(first) : all;
  const enough = all.filter(x => x.income || x.spent).length;
  const isNow = A.month === now.slice(0, 7);
  const shared = Object.keys(b.members || {}).length > 1;
  const label = rangeLabel(r, A.month, months);
  const targets = targetProgress(b, list, A.month);
  // The same length of time just before, to compare against (nothing comes before "all time").
  const before = r === 'all' ? [] : monthTotals(list, addMonths(months[0], -1), months.length);
  // Columns stay wide enough to read and tap: months up to a year, quarters up to three years, then years.
  const chart = totals.length > 36 ? byYear(totals) : totals.length > 12 ? byQuarter(totals) : totals;
  return `${monthBar()}
    ${enough < 2 ? '<p class="notice">Trends get more useful after a month or two of spending. Here’s what there is so far.</p>' : ''}
    ${summary(headlines(b, list, A.month, now), A.month)}
    ${section('pace', 'Pace this month', paceBody(pace(b, list, A.month, now), A.month))}
    ${isNow ? section('bills', 'Coming up', billsBody(upcomingBills(b, list, now), b)) : ''}
    ${section('where', 'Where it went', whereItWent(compare), money(compare.total))}
    ${section('changes', 'Worth a look', changesBody(notableChanges(compare), compare))}
    ${section('months', 'Over time', rangePicker(months) + overview(totals, before, label) + monthByMonth(chart))}
    ${section('categories', 'Categories over time', rangePicker(months) + categoriesOverTime(categoryTotals(b, list, months), months, label), `<span class="small muted">${esc(label)}</span>`)}
    ${section('biggest', 'Biggest purchases', spanPicker('biggest', label) + biggest(biggestPurchases(list, spanOf('biggest') === 'range' ? months : A.month), b, spanOf('biggest') === 'range'))}
    ${section('plan', 'Plan vs real', planReal(planVsReal(b, list, A.month)))}
    ${section('saving', 'Saving', saving(savingThisMonth(b, list, A.month), targets.filter(t => t.saving)))}
    ${targets.some(t => !t.saving) ? section('limits', 'Limits and goals', limits(targets.filter(t => !t.saving))) : ''}
    ${shared ? people(b, list, months, label) : ''}`;
}

/* ---------- One category's trend ---------- */

function catTrendSheet() {
  const b = A.budgets[A.route.id], id = A.sheet.id, c = b?.categories[id];
  if (!c) { closeSheet(); return; }
  const months = rangeMonths(range() === 'year' ? 'year' : '12', A.month);
  const h = categoryHistory(A.transactions[b.id] || [], id, months);
  const max = Math.max(...h.rows.map(x => x.spent), h.average, 1);
  const here = h.rows.at(-1).spent;
  openSheet(`<div class="sheet">${sheetHead(`${c.name} over time`)}<div class="sheet-body">
    <section class="panel pad stack">
      <div class="two-stats"><div><span class="label">${esc(fmtMonth(A.month).split(' ')[0])}</span><span class="big-amt amt">${money(here)}</span></div><div><span class="label">Average month</span><span class="big-amt amt">${money(h.average)}</span></div></div>
      <div class="cols one ${months.length > 6 ? 'many' : ''}" role="img" aria-label="${esc(c.name)} spending by month">${h.rows.map(x => `<div class="col"><span class="col-bars"><i class="out" style="height:${pct(x.spent, max)}%"></i></span><span class="tiny muted">${short(x.month)}</span></div>`).join('')}${h.average ? `<span class="avg-line" style="bottom:calc(22px + (100% - 22px) * ${(pct(h.average, max) / 100).toFixed(3)})" aria-hidden="true"></span>` : ''}</div>
      <p class="tiny muted">${money(h.total)} over ${range() === 'year' ? `${A.month.slice(0, 4)} so far` : 'the last 12 months'}. The line marks the average of months with spending.</p>
    </section>
    <button type="button" class="btn" data-action="search-category" data-id="${id}">See every ${esc(c.name)} transaction</button>
    <section class="stack tight"><h3 class="date-head">Biggest purchases</h3>${h.biggest.length ? `<div class="panel tx-list">${h.biggest.map(t => `<button type="button" class="tap tx-row" data-action="edit-tx" data-id="${t.id}"><span class="grow stack tight"><strong class="wrap-any two-lines">${esc(t.description || 'Spending')}</strong><span class="tiny muted">${fmtDate(t.date)}</span></span><span class="amt owe">−${money(t.amount)}</span></button>`).join('')}</div>` : '<p class="small muted">None in this time.</p>'}</section>
    <button type="button" class="btn" data-action="trend-open-cat" data-id="${id}">Open ${esc(c.name)} in the budget</button>
  </div></div>`);
}

/* ---------- Actions ---------- */

actions['trend-fold'] = el => {
  const key = el.dataset.id, list = folded();
  keep('wmm:trendsFolded', list.includes(key) ? list.filter(k => k !== key) : [...list, key]);
  render();
};
changes['trend-range'] = el => { if (!el.value) return; keep('wmm:trendsRange', el.value); A.trendsCol = null; render(); };
actions['trend-range'] = el => { keep('wmm:trendsRange', el.dataset.id); A.trendsCol = null; render(); };
const setCustom = (key, value) => {
  if (!/^\d{4}-\d{2}$/.test(value)) return;
  const list = A.transactions[A.route.id] || [], months = rangeFor('custom', list);
  const next = { from: months[0], to: months.at(-1), [key]: value };
  if (next.from > next.to) next[key === 'from' ? 'to' : 'from'] = value;
  keep('wmm:trendsCustom', next);
  A.trendsCol = null;
  render();
};
changes['trend-from'] = el => setCustom('from', el.value);
changes['trend-to'] = el => setCustom('to', el.value);
actions['trend-col'] = el => { A.trendsCol = el.dataset.id; render(); };
actions['cat-trend'] = el => openChild({ kind: 'cat-trend', id: el.dataset.id }, catTrendSheet);
actions['trend-open-cat'] = el => openChild({ kind: 'cat', budgetId: A.route.id, id: el.dataset.id, open: {} }, catSheet);
registerSheet('cat-trend', () => catTrendSheet());
actions['plan-usual'] = el => {
  const b = A.budgets[A.route.id], id = el.dataset.id, amount = Number(el.dataset.amount);
  const current = b.assigned?.[A.month]?.[id] || 0;
  if (current >= amount) return toast(`${b.categories[id].name} already has ${money(current)} planned.`);
  writeAssigned(b, A.month, { ...(b.assigned?.[A.month] || {}), [id]: amount }, `${b.categories[id].name}: ${money(amount)} planned`);
};
changes['trend-byperson'] = el => {
  const b = A.budgets[A.route.id];
  send(A.repo.setSetting(b.id, 'byPerson', el.checked));
  toast(el.checked ? 'Spending by person is on for everyone in this budget' : 'Spending by person is off');
};

actions['search-category'] = el => openSearch(A.route.id, { categoryId: el.dataset.id });
