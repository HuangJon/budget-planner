/** The screen's shared state and the services every screen uses, filled in by main.js. */
export const A = {
  repo: null, preview: false, user: null,
  status: 'loading',            // loading | ready
  budgetIds: [],                // your budgets, in the order you joined
  budgets: {},                  // id -> budget, or null when it can't be opened
  transactions: {},             // id -> [transactions]
  route: { name: 'home' },      // home | budget | transactions
  month: null,                  // 'YYYY-MM' being looked at
  form: null, sheet: null, undo: null,
};
let renderFn = () => {};
export const setRender = fn => { renderFn = fn; };
export const render = () => renderFn();

/** Handlers for data-action buttons, data-input boxes and data-change pickers, registered by each screen. */
export const actions = {};
export const inputs = {};
export const changes = {};
