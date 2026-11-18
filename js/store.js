// =============================================================================
// store.js — Settings cache + one-call data loading for the finance pages.
// Still goes through db.js only (no direct storage access).
// =============================================================================

import { db } from './db.js';
import { CONFIG, DEFAULT_SETTINGS, DEFAULT_CATEGORIES } from './config.js';
import { simulateFunds, DEFAULT_TAX } from './finance.js';
import { todayISO } from './util.js';

let settings = structuredClone(DEFAULT_SETTINGS);

function merge(base, over) {
  const out = { ...base, ...(over || {}) };
  out.modules = { ...base.modules, ...(over?.modules || {}) };
  out.plan = { ...base.plan, ...(over?.plan || {}) };
  out.plan.rules = Array.isArray(out.plan.rules) ? out.plan.rules : [];
  out.tax = { ...DEFAULT_TAX, ...(base.tax || {}), ...(over?.tax || {}) };
  return out;
}

// Apply the user's home currency, timezone and currency list app-wide.
function applyCurrencies() {
  if (settings.base_currency) CONFIG.BASE_CURRENCY = settings.base_currency;
  if (settings.timezone) CONFIG.TIMEZONE = settings.timezone;
  const list = settings.currencies?.length ? settings.currencies : ['USD'];
  // Home currency first, so every dropdown defaults to it.
  const withBase = [CONFIG.BASE_CURRENCY, ...list.filter((c) => c !== CONFIG.BASE_CURRENCY)];
  CONFIG.CURRENCIES.splice(0, CONFIG.CURRENCIES.length, ...withBase);
}

export async function loadSettings() {
  let saved = null;
  try { saved = await db.getSettings(); } catch (err) {
    // Older Supabase projects may not have the settings table yet.
    console.warn('Settings unavailable:', err.message);
  }
  settings = merge(DEFAULT_SETTINGS, saved);
  // Existing users from before setup existed: don't force the wizard on them
  // if they already have data.
  if (!saved) {
    try {
      const tx = await db.listTransactions({ limit: 1 });
      if (tx.length) settings.setup_done = true;
    } catch { /* ignore */ }
  }
  applyCurrencies();
  return settings;
}

export function getSettings() {
  return settings;
}

export async function saveSettings(patch) {
  settings = merge(settings, patch);
  applyCurrencies();
  try { await db.saveSettings(settings); } catch (err) {
    console.warn('Could not save settings:', err.message);
    throw err;
  }
  return settings;
}

// Category kind with a fallback for categories created before kinds existed.
const DEFAULT_KIND = new Map(DEFAULT_CATEGORIES.map((c) => [c.name.toLowerCase(), c.kind]));
const DEFAULT_TREATMENT = new Map(DEFAULT_CATEGORIES.filter((c) => c.tax_treatment).map((c) => [c.name.toLowerCase(), c.tax_treatment]));
export function kindOf(cat) {
  if (!cat) return 'soft';
  return cat.kind || DEFAULT_KIND.get((cat.name || '').toLowerCase()) || 'soft';
}

async function safeList(table) {
  try { return await db.list(table); } catch (err) {
    console.warn(`${table} unavailable:`, err.message);
    return [];
  }
}

// Everything the finance pages need, fetched in parallel.
export async function loadAll() {
  const [categories, txs, funds, debts, streams] = await Promise.all([
    db.listCategories(),
    db.listTransactions(),
    safeList('funds'),
    safeList('debts'),
    safeList('income_streams'),
  ]);
  const catById = new Map(categories.map((c) => [c.id, {
    ...c, kind: kindOf(c),
    tax_treatment: c.tax_treatment || DEFAULT_TREATMENT.get((c.name || '').toLowerCase()) || null,
  }]));
  const todayYM = todayISO().slice(0, 7);
  const sim = simulateFunds({ settings, funds, txs, catById, todayYM });
  return { settings, categories, catById, txs, funds, debts, streams, sim, todayYM };
}

// Find a category by name, creating it (with a kind) if missing.
export async function ensureCategory(name, kind) {
  const cats = await db.listCategories();
  const found = cats.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  return db.createCategory({ name, kind, monthly_budget_usd: 0 });
}
