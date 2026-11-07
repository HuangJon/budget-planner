/**
 * A one-line descriptor under each screen's title, and a "?" that explains the screen in a
 * few plain points. Words only: nothing here changes data.
 */
import { A, actions } from './state.js';
import { esc, svg, openSheet, sheetHead, openChild, registerSheet } from './dom.js';

export const DESCRIBE = {
  home: 'Your budgets. Start one for yourself, or one to share.',
  budget: 'Your money, split into pots for each kind of spending. Each pot shows what’s left to spend.',
  plan: 'Give every dollar a job: put money into each pot until Ready to assign reaches $0.',
  transactions: 'Everything that came in or went out this month, and what repeats.',
  trends: 'How this month is going, and how it compares with usual.',
  people: 'Who shares this budget, and who can join.',
};

const HELP = {
  home: {
    title: 'Your budgets',
    points: [
      ['A budget', 'is one pot of money you plan together: just you, or your household.'],
      ['Start a budget', 'asks what you have now and which categories you want. You can change both later.'],
      ['Waiting to join', 'shows budgets you asked to join until an admin lets you in.'],
    ],
  },
  budget: {
    title: 'How the budget works',
    points: [
      ['Ready to assign', 'is money that has come in but has no job yet. Tap Plan money to give it one.'],
      ['Each category is a pot.', 'What you plan goes in; what you spend comes out. "To spend" is what’s left in it this month.'],
      ['Leftovers carry over.', 'Money you don’t spend stays in the pot next month.'],
      ['Over means overspent.', 'The pot went below $0. Tap it and Cover it moves money in from another pot.'],
      ['Targets', 'are what a pot needs: every month, a yearly limit, or a goal by a date. "Needs $X" means it’s short.'],
      ['Add spending', 'with the Spend button. Add income from the blue card.'],
    ],
  },
  plan: {
    title: 'Planning your money',
    points: [
      ['This is where money gets its job.', 'Type how much each pot gets this month. Ready to assign counts down as you type.'],
      ['Aim for $0 ready to assign.', 'Every dollar has a job then. Red means you planned more than you have.'],
      ['Fund bills and targets', 'fills the pots with targets first, starting with bills due soonest. It shows you what it will do before it does it.'],
      ['Copy last month', 'fills pots that have nothing yet with last month’s amounts.'],
      ['Each box saves', 'when you leave it. Undo my changes puts everything back to how it was when you opened this screen.'],
    ],
  },
  transactions: {
    title: 'Activity',
    points: [
      ['Every transaction', 'this month, newest first. Tap one to change or delete it.'],
      ['Repeats', 'are added for you on their day: weekly, every 2 weeks, or monthly. Tap one to change the amount or stop it.'],
      ['Deleting', 'can be undone from the message that appears.'],
    ],
  },
  trends: {
    title: 'Trends',
    points: [
      ['The summary', 'picks the few things worth knowing this month.'],
      ['Pace', 'compares how much of your everyday money is gone with how far through the month you are. Bills and saving are left out.'],
      ['Usual', 'is the average of the last few months, counted up to the same day of the month.'],
      ['Tap any category', 'to see its months and biggest purchases.'],
      ['Sections fold.', 'Tap a heading to open or close it; your phone remembers.'],
    ],
  },
  people: {
    title: 'People',
    points: [
      ['Everyone here', 'sees and can change everything in this budget. Every change keeps the old version.'],
      ['Admins', 'invite people, let them in, and can remove them. Whoever started the budget is its first admin.'],
      ['Invite links', 'let someone ask to join. They see nothing until an admin lets them in. Making a new link stops the old one.'],
    ],
  },
};

const Q = '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8 1c0 1.700-2.400 2-2.400 3.500"/><path d="M12 17h.01"/>';
export const helpButton = name => `<button type="button" class="icon-btn help-btn" data-action="help" data-id="${name}" aria-label="What is this screen for?">${svg(Q)}</button>`;
export const describe = name => (DESCRIBE[name] ? `<p class="screen-tip">${esc(DESCRIBE[name])}</p>` : '');

function helpSheet() {
  const h = HELP[A.sheet.id] || HELP.budget;
  openSheet(`<div class="sheet">${sheetHead(h.title)}<div class="sheet-body">
    <ul class="help-list">${h.points.map(([lead, rest]) => `<li><strong>${esc(lead)}</strong> ${esc(rest)}</li>`).join('')}</ul>
  </div></div>`);
}
actions.help = el => openChild({ kind: 'help', id: el.dataset.id }, helpSheet);
registerSheet('help', () => helpSheet());
