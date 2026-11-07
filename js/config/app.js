/** Tunable values and lists. Nothing here touches the page or storage. */
export const SCHEMA_VERSION = 1;
export const APP_NAME = "Where's my money";
export const CURRENCY = 'USD';

/** Starter categories for a new budget, grouped the way most people think about bills. */
export const STARTER_CATEGORIES = [
  { group: 'Bills', names: ['Rent', 'Utilities', 'Phone', 'Internet', 'Insurance', 'Subscriptions'] },
  { group: 'Everyday', names: ['Groceries', 'Eating out', 'Transport', 'Household'] },
  { group: 'Fun', names: ['Entertainment', 'Shopping', 'Gifts'] },
  { group: 'Saving for', names: ['Emergency fund', 'Travel'] },
];

export const LIMITS = {
  budgetName: 60, personName: 40, categoryName: 40, groupName: 40, description: 80, note: 500,
  categories: 100, members: 20,
};
