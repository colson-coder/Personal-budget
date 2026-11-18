// =============================================================================
// nav.js — Navigation model. Pages appear only when their feature is enabled
// in the user's settings, so the app adapts to each person.
// =============================================================================

import { getSettings } from './store.js';

const ALL = [
  { path: '/dashboard', label: 'Home', icon: 'home', desc: 'Your month at a glance' },
  { path: '/transactions', label: 'Activity', icon: 'list', desc: 'Every transaction, searchable' },
  { path: '/add', label: 'Add', icon: 'plus', desc: 'Log spending or income' },
  { path: '/plan', label: 'Plan', icon: 'plan', desc: 'Where this month’s money goes', module: 'plan' },
  { path: '/funds', label: 'Funds', icon: 'funds', desc: 'Savings, giving, reserves', module: 'plan' },
  { path: '/debts', label: 'Debts', icon: 'debt', desc: 'Loans, payoff dates', module: 'debts' },
  { path: '/income', label: 'Passive income', icon: 'spark', desc: 'Rentals, dividends, more', module: 'income' },
  { path: '/reports', label: 'Reports', icon: 'chart', desc: 'Trends & month in review' },
  { path: '/categories', label: 'Budgets', icon: 'tags', desc: 'Categories & monthly limits' },
  { path: '/import', label: 'Import', icon: 'upload', desc: 'Bring in a bank CSV' },
  { path: '/settings', label: 'Settings', icon: 'gear', desc: 'Currency, features, plan' },
];

export function navItems() {
  const m = getSettings().modules || {};
  return ALL.filter((n) => !n.module || m[n.module]);
}

// Phone tab bar: the four most-used pages + More.
export function bottomItems() {
  const m = getSettings().modules || {};
  const third = m.plan ? ALL.find((n) => n.path === '/plan') : ALL.find((n) => n.path === '/reports');
  return [
    ALL[0], ALL[1], ALL[2], third,
    { path: '/more', label: 'More', icon: 'more' },
  ];
}
