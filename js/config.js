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
  // --- Supabase ---------------------------------------------------------------
  // Fill these in from: Supabase Dashboard → Project Settings → API.
  SUPABASE_URL: 'https://YOUR-PROJECT-ref.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-SUPABASE-ANON-KEY',

  // --- Exchange rates ---------------------------------------------------------
  // ExchangeRate-API is required because our currency list includes CRC, which
  // is outside the ECB/Frankfurter set. Get a free key at
  // https://www.exchangerate-api.com (free tier: 1,500 requests/month).
  EXCHANGE_RATE_API_KEY: 'YOUR-EXCHANGERATE-API-KEY',

  // Currencies the app can log. Add more here later — nothing else hard-codes
  // this list. USD is the base/reference currency for all stored balances.
  CURRENCIES: ['USD', 'EUR', 'GBP', 'CRC'],

  BASE_CURRENCY: 'USD',

  // All "this month" / date-boundary logic uses this fixed local calendar.
  // Locked globally so the same transaction belongs to the same month on every
  // device, regardless of where you physically are.
  TIMEZONE: 'America/Costa_Rica', // UTC-6
};

// Predefined categories seeded on first use. monthly_budget_usd is editable.
export const DEFAULT_CATEGORIES = [
  { name: 'Food & Dining', monthly_budget_usd: 0 },
  { name: 'Transport', monthly_budget_usd: 0 },
  { name: 'Housing/Rent', monthly_budget_usd: 0 },
  { name: 'Utilities', monthly_budget_usd: 0 },
  { name: 'Shopping', monthly_budget_usd: 0 },
  { name: 'Entertainment', monthly_budget_usd: 0 },
  { name: 'Travel', monthly_budget_usd: 0 },
  { name: 'Health', monthly_budget_usd: 0 },
  { name: 'Subscriptions', monthly_budget_usd: 0 },
  { name: 'Income', monthly_budget_usd: 0 },
  { name: 'Other', monthly_budget_usd: 0 },
];
