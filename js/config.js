// =============================================================================
// config.js — App-wide configuration.
//
// SECURITY NOTE: The Supabase anon key below is PUBLIC BY DESIGN. This is a
// static client-side site, so the key ships to every browser. That is safe:
// all real security comes from Row-Level Security (RLS) policies in the
// database (see sql/rls.sql), not from hiding this key. The anon key only lets
// a client *attempt* operations; RLS decides what auth.uid() is actually
// allowed to read or write. There is no .env secret to protect here.
//
// The ExchangeRate-API key is likewise visible in client code. That is an
// accepted tradeoff for a personal, free-tier project (see README).
// =============================================================================

export const CONFIG = {
  // Product name shown in the UI, manifest and page title. Change once to rebrand.
  APP_NAME: 'Babylon\'s Purse',

  // --- Supabase ---------------------------------------------------------------
  // Fill these in from: Supabase Dashboard → Project Settings → API.
  SUPABASE_URL: 'https://gayrswwxsdgqasnipvzs.supabase.co',
  // Publishable (public) key — safe to ship; Row-Level Security protects data.
  SUPABASE_ANON_KEY: 'sb_publishable_qqn3Hn4eydjGNhM7OZK2Mw_MQEgGiZC',

  // --- Exchange rates ---------------------------------------------------------
  // ExchangeRate-API is required because our currency list includes CRC, which
  // is outside the ECB/Frankfurter set. Get a free key at
  // https://www.exchangerate-api.com (free tier: 1,500 requests/month).
  EXCHANGE_RATE_API_KEY: 'YOUR-EXCHANGERATE-API-KEY',

  // AI coach chat ("Ask the coach" on Home). Turn on only after deploying
  // supabase/functions/coach (see docs/ai-coach.md). Signed-in users only.
  AI_COACH: false,

  // iCloud link to a ready-made "Log to Babylon's Purse" shortcut. When set,
  // Settings → Log card purchases offers a one-tap "Get the shortcut" button.
  SHORTCUT_URL: '',

  // Currencies the app can log. Add more here later — nothing else hard-codes
  // this list. USD is the base/reference currency for all stored balances.
  // Replaced at boot by the currencies chosen in setup (Settings → Currencies).
  CURRENCIES: ['USD', 'EUR', 'GBP', 'CRC'],

  // Defaults only — every user picks their own home currency and timezone in
  // setup (stored in their settings and applied at boot by store.js).
  BASE_CURRENCY: 'USD',

  // All "this month" / date-boundary logic uses the user's chosen timezone, so
  // the same transaction belongs to the same month on every device.
  TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
};

// Currencies a user can pick during setup. USD stays the reference currency
// for all totals. Keyless preview rates exist for these (see rates.js); any
// other code needs an ExchangeRate-API key.
export const SUPPORTED_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'CRC', 'MXN', 'CAD', 'AUD', 'JPY', 'CHF', 'COP', 'BRL', 'INR',
];

// Starter categories for a brand-new user: three obvious ones plus Income.
// Everything else is one tap away (SUGGESTED_CATEGORIES) on the Budgets page.
// `kind` drives the money plan:
//   hard   = bills / fixed costs        soft = everyday spending
//   debt   = loan & card payments       income = money in
//   tax    = tax payments (tracked on the Taxes page)
export const DEFAULT_CATEGORIES = [
  { name: 'Housing & Bills', kind: 'hard', monthly_budget_usd: 0 },
  { name: 'Food', kind: 'soft', monthly_budget_usd: 0 },
  { name: 'Other', kind: 'soft', monthly_budget_usd: 0 },
  { name: 'Income', kind: 'income', monthly_budget_usd: 0 },
];

// One-tap additions shown on the Budgets page (only ones the user lacks).
export const SUGGESTED_CATEGORIES = [
  { name: 'Transport', kind: 'soft' },
  { name: 'Shopping', kind: 'soft' },
  { name: 'Entertainment', kind: 'soft' },
  { name: 'Health', kind: 'soft' },
  { name: 'Subscriptions', kind: 'hard' },
  { name: 'Utilities', kind: 'hard' },
  { name: 'Insurance', kind: 'hard' },
  { name: 'Phone & Internet', kind: 'hard' },
  { name: 'Childcare', kind: 'hard' },
  { name: 'Travel', kind: 'soft' },
  { name: 'Gifts', kind: 'soft' },
  { name: 'Giving', kind: 'soft' },
  { name: 'Pets', kind: 'soft' },
  { name: 'Education', kind: 'soft' },
  { name: 'Personal care', kind: 'soft' },
  { name: 'Side income', kind: 'income', tax_treatment: 'owed' },
];

// Categories the app creates itself when a feature needs them.
export const SYSTEM_CATEGORIES = [
  { name: 'Debt Payment', kind: 'debt' },
  { name: 'Taxes', kind: 'tax' },
  { name: 'Passive Income', kind: 'income', tax_treatment: 'owed' },
  { name: 'Interest', kind: 'income', tax_treatment: 'owed' },
  // Older default names, so existing users keep the right kinds.
  { name: 'Housing/Rent', kind: 'hard' },
  { name: 'Food & Dining', kind: 'soft' },
];

export const CATEGORY_KINDS = [
  { value: 'hard', label: 'Bill (fixed cost)' },
  { value: 'soft', label: 'Everyday spending' },
  { value: 'debt', label: 'Debt payment' },
  { value: 'tax', label: 'Tax payment' },
  { value: 'income', label: 'Income' },
];

export const TAX_TREATMENTS = [
  { value: 'withheld', label: 'Tax taken out already' },
  { value: 'owed', label: 'I owe tax on this' },
  { value: 'none', label: 'Not taxable' },
];

// Per-user preferences (stored via db.getSettings/saveSettings).
export const DEFAULT_SETTINGS = {
  setup_done: false,
  name: '',
  currencies: ['USD'],
  base_currency: 'USD',
  timezone: null,                     // null → device timezone
  theme: 'mono',                      // see js/theme.js
  modules: { plan: true, debts: false, income: false, taxes: false },
  tax: null,                          // null → finance.DEFAULT_TAX
  plan: { start_month: null, rules: [] },
};
