// =============================================================================
// demo.js — "Try a demo": explore the app with realistic sample data.
//
// The demo runs in device-only (local) mode. Any device-only data already in
// this browser is backed up first and put back when the demo ends, so trying
// the demo never touches someone's real data. Signed-in accounts are never
// involved.
//
// Sample data is generated relative to today (the last 3 months plus this
// month so far), so the demo always looks current.
// =============================================================================

import { setLocalMode } from './db.js';
import { todayISO } from './util.js';

const DEMO_FLAG = 'pb_demo';
const BACKUP = 'pb_demo_backup';
const KEYS = ['pb_local_transactions', 'pb_local_categories', 'pb_local_recurring', 'pb_local_settings',
  'pb_local_funds', 'pb_local_debts', 'pb_local_income_streams', 'pb_local_mode', 'pb_theme', 'pb_last_currency'];

export const isDemo = () => { try { return localStorage.getItem(DEMO_FLAG) === '1'; } catch { return false; } };

export function startDemo() {
  if (!isDemo()) {
    const saved = {};
    for (const k of KEYS) { const v = localStorage.getItem(k); if (v !== null) saved[k] = v; }
    localStorage.setItem(BACKUP, JSON.stringify(saved));
  }
  for (const k of KEYS) localStorage.removeItem(k);
  const d = demoData(todayISO());
  localStorage.setItem('pb_local_categories', JSON.stringify(d.categories));
  localStorage.setItem('pb_local_transactions', JSON.stringify(d.transactions));
  localStorage.setItem('pb_local_funds', JSON.stringify(d.funds));
  localStorage.setItem('pb_local_debts', JSON.stringify(d.debts));
  localStorage.setItem('pb_local_income_streams', '[]');
  localStorage.setItem('pb_local_recurring', '[]');
  localStorage.setItem('pb_local_settings', JSON.stringify(d.settings));
  localStorage.setItem(DEMO_FLAG, '1');
  setLocalMode(true);
}

// Leave the demo and put back whatever was on this device before.
export function endDemo() {
  for (const k of KEYS) localStorage.removeItem(k);
  try {
    const saved = JSON.parse(localStorage.getItem(BACKUP) || '{}');
    for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
  } catch { /* nothing to restore */ }
  localStorage.removeItem(BACKUP);
  localStorage.removeItem(DEMO_FLAG);
  if (!localStorage.getItem('pb_local_mode')) setLocalMode(false);
}

// --- Sample data ------------------------------------------------------------------------
// Sam: a salaried worker with some freelance design work, a student loan and a
// credit card, saving for an emergency fund and a trip.
export function demoData(today) {
  let n = 0;
  const id = () => `demo-${++n}`;
  const ym0 = today.slice(0, 7);
  const addM = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + k, 1)); return d.toISOString().slice(0, 7); };
  const months = [-3, -2, -1, 0].map((k) => addM(ym0, k));
  const todayDay = Number(today.slice(8, 10));

  const cat = (name, kind, budget = 0, extra = {}) => ({ id: id(), name, kind, monthly_budget_usd: budget, user_id: 'local-user', ...extra });
  const categories = [
    cat('Housing & Bills', 'hard', 1550), cat('Food', 'soft', 500), cat('Transport', 'soft', 150),
    cat('Fun', 'soft', 150), cat('Subscriptions', 'soft', 40), cat('Other', 'soft'), cat('Debt payments', 'debt'),
    cat('Income', 'income'), cat('Side income', 'income', 0, { tax_treatment: 'owed' }), cat('Taxes', 'tax'),
  ];
  const c = (name) => categories.find((x) => x.name === name).id;

  const ef = id(), trip = id(), tax = id(), give = id(), save = id();
  const funds = [
    { id: ef, name: 'Emergency Fund', kind: 'savings', starting_balance: 1200, goal_usd: 5000, apy: 4.2, interest_mode: 'auto' },
    { id: save, name: 'Savings', kind: 'savings', starting_balance: 800, goal_usd: 0, apy: 4.2, interest_mode: 'auto' },
    { id: trip, name: 'Trip to Lisbon', kind: 'savings', starting_balance: 300, goal_usd: 1800, apy: 0, interest_mode: 'none' },
    { id: tax, name: 'Tax reserve', kind: 'reserve', starting_balance: 150, goal_usd: 0, apy: 4.2, interest_mode: 'auto' },
    { id: give, name: 'Giving', kind: 'giving', starting_balance: 40, goal_usd: 0, apy: 0, interest_mode: 'none' },
  ].map((f) => ({ ...f, user_id: 'local-user', created_at: `${months[0]}-01T00:00:00Z` }));

  const loan = id(), card = id();
  const debts = [
    { id: loan, name: 'Student loan', principal: 18400, apr: 5.1, payment: 260, start_month: months[0], due_day: 5 },
    { id: card, name: 'Credit card', principal: 2400, apr: 22.9, payment: 75, start_month: months[0], due_day: 20 },
  ].map((d) => ({ ...d, user_id: 'local-user', created_at: `${months[0]}-01T00:00:00Z` }));

  const transactions = [];
  // Seeded wobble so amounts look real but stay the same between runs.
  let seed = 7;
  const wob = (base, spread) => { seed = (seed * 9301 + 49297) % 233280; return Math.round((base + (seed / 233280 - 0.5) * 2 * spread) * 100) / 100; };
  const tx = (ym, day, type, amount, catName, description, extra = {}) => {
    if (ym === ym0 && day > todayDay) return; // nothing in the future
    const usd = extra.usd ?? amount;
    transactions.push({
      id: id(), type, date: `${ym}-${String(day).padStart(2, '0')}`, amount, currency: extra.currency || 'USD',
      amount_usd: usd, exchange_rate: Math.round((usd / amount) * 10000) / 10000, category_id: catName ? c(catName) : null,
      description, user_id: 'local-user', created_at: `${ym}-${String(day).padStart(2, '0')}T12:00:00Z`,
      ...Object.fromEntries(Object.entries(extra).filter(([k]) => !['currency', 'usd'].includes(k))),
    });
  };
  months.forEach((ym, i) => {
    tx(ym, 1, 'income', 3800, 'Income', 'Paycheck');
    tx(ym, 1, 'expense', 1350, 'Housing & Bills', 'Rent');
    tx(ym, 3, 'expense', wob(118, 20), 'Housing & Bills', 'Electric & water');
    tx(ym, 4, 'expense', 15.49, 'Subscriptions', 'Netflix');
    tx(ym, 4, 'expense', 11.99, 'Subscriptions', 'Spotify');
    tx(ym, 5, 'expense', 260, 'Debt payments', 'Student loan payment', { debt_id: loan });
    tx(ym, 20, 'expense', i === 2 ? 300 : 75, 'Debt payments', 'Credit card payment', { debt_id: card });
    for (const [d, s] of [[2, 'Trader Joe’s'], [9, 'Whole Foods'], [16, 'Trader Joe’s'], [23, 'Costco']]) tx(ym, d, 'expense', wob(105, 30), 'Food', s);
    tx(ym, 12, 'expense', wob(42, 15), 'Food', 'Thai Basil');
    tx(ym, 6, 'expense', 48, 'Transport', 'Train pass');
    tx(ym, 18, 'expense', wob(38, 10), 'Transport', 'Shell gas station');
    tx(ym, 14, 'expense', wob(65, 30), 'Fun', i % 2 ? 'Concert tickets' : 'Movie night');
    tx(ym, 22, 'expense', wob(60, 25), 'Other', 'Amazon');
    if (i !== 1) tx(ym, 10, 'income', i === 3 ? 450 : 620, 'Side income', i === 3 ? 'Logo design for a client' : 'Website mockups');
  });
  // A trip abroad last month, and a quarterly tax payment.
  tx(months[2], 26, 'expense', 60, 'Food', 'Dinner in Madrid', { currency: 'EUR', usd: 64.8 });
  tx(months[1], 15, 'expense', 300, 'Taxes', 'Quarterly tax payment');

  transactions.sort((a, b) => b.date.localeCompare(a.date));

  const settings = {
    setup_done: true, name: 'Sam', base_currency: 'USD', currencies: ['USD', 'EUR'],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', theme: 'mono',
    modules: { plan: true, debts: true, income: false, taxes: true },
    tax: { mode: 'flat', rate: 22, main_income: 'withheld', year_start_month: 1, frequency: 'quarterly', allowance: 0 },
    plan: {
      start_month: months[0],
      rules: [
        { id: 'r1', fund_id: save, method: 'percent_income', value: 10 },
        { id: 'r2', fund_id: tax, method: 'percent_income', value: 5 },
        { id: 'r3', fund_id: give, method: 'percent_net', value: 5 },
        { id: 'r4', fund_id: trip, method: 'fixed', value: 150 },
        { id: 'r5', fund_id: ef, method: 'percent_remainder', value: 25, value_after_goal: 10 },
      ],
    },
    fund_targets: { [trip]: addM(ym0, 7) },
  };
  return { categories, transactions, funds, debts, settings };
}
