/** Tunable values and lists. Nothing here touches the page or storage. */
export const SCHEMA_VERSION = 1;
/** Shown on the owner page and in error reports; bump with the offline cache in sw.js. */
export const APP_VERSION = 'wmm-v10';
export const APP_NAME = "Where's my money";
export const CURRENCY = 'USD';

/**
 * The checklist shown when starting a budget. `on` ones start ticked; the rest are a tap away.
 */
export const STARTER_CATEGORIES = [
  { group: 'Bills', items: [
    { name: 'Rent', on: true }, { name: 'Utilities', on: true },
    { name: 'Phone', on: true }, { name: 'Internet', on: true },
    { name: 'Insurance', on: true }, { name: 'Subscriptions', on: true },
    { name: 'Debt payments' }, { name: 'Car' },
  ] },
  { group: 'Everyday', items: [
    { name: 'Groceries', on: true }, { name: 'Eating out', on: true }, { name: 'Transport', on: true },
    { name: 'Household', on: true }, { name: 'Pets' }, { name: 'Kids' },
  ] },
  { group: 'Health', items: [
    { name: 'Medical', on: true }, { name: 'Fitness', on: true }, { name: 'Personal care', on: true },
  ] },
  { group: 'Fun', items: [
    { name: 'Entertainment', on: true }, { name: 'Shopping', on: true }, { name: 'Clothes' },
    { name: 'Gifts', on: true }, { name: 'Giving' }, { name: 'Education' },
  ] },
  { group: 'Saving for', items: [
    { name: 'Stuff I didn’t plan for', on: true }, { name: 'Emergency fund', on: true },
    { name: 'Travel' }, { name: 'Investing' },
  ] },
];

export const LIMITS = {
  budgetName: 60, personName: 40, categoryName: 40, groupName: 40, description: 80, note: 500,
  categories: 100, members: 20,
};
