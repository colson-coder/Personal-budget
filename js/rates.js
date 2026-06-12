// =============================================================================
// rates.js — Exchange-rate fetching and conversion to USD.
//
// Provider: ExchangeRate-API (https://www.exchangerate-api.com).
// We use this provider (rather than the keyless Frankfurter/ECB) because our
// currency list includes CRC (Costa Rican colón), which is outside the ECB set.
//
// Rate semantics: every rate we store and use is "USD per 1 unit of <currency>",
// i.e. amount_usd = amount * exchange_rate. For USD itself the rate is always 1.
//
// IMPORTANT design points (see build spec):
//  - We fetch the rate for the TRANSACTION'S OWN DATE, not today's, so backdated
//    and CSV-imported rows convert at a period-appropriate rate.
//  - Rates are cached per (date, currency) pair in localStorage + memory so we
//    never burn API calls re-fetching the same pair.
//  - On total failure to obtain any rate, we THROW so the caller can block the
//    save — we never silently store a zero/garbage conversion.
// =============================================================================

import { CONFIG } from './config.js';
import { todayISO } from './util.js';

const CACHE_KEY = 'pb_rate_cache_v1';
const BASE = 'https://v6.exchangerate-api.com/v6';

// In-memory cache mirrors localStorage; keyed "YYYY-MM-DD:CCC" → number.
const memCache = loadCache();

function loadCache() {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')));
  } catch {
    return new Map();
  }
}

function persistCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(memCache)));
  } catch {
    /* storage full / unavailable — memory cache still works for the session */
  }
}

function cacheGet(date, currency) {
  return memCache.get(`${date}:${currency}`);
}

function cacheSet(date, currency, rate) {
  memCache.set(`${date}:${currency}`, rate);
  persistCache();
}

// Fetch "USD per 1 <currency>" for an arbitrary historical date.
// ExchangeRate-API's history endpoint returns conversion_rates keyed by target
// code, expressed as "target per 1 base". With base = <currency>, the USD entry
// is exactly the number we want.
//
// NOTE: the /history endpoint requires a paid ExchangeRate-API plan. On the free
// tier it returns an error, so fetchRate() below transparently falls back to the
// latest rate for past dates rather than failing the save. The exact rate used
// is always stored on the transaction, so historical rows are never re-converted.
async function fetchHistorical(currency, date) {
  const [y, m, d] = date.split('-');
  const url = `${BASE}/${CONFIG.EXCHANGE_RATE_API_KEY}/history/${currency}/${Number(y)}/${Number(m)}/${Number(d)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`history HTTP ${res.status}`);
  const data = await res.json();
  if (data.result !== 'success') throw new Error(data['error-type'] || 'history failed');
  const rate = data.conversion_rates?.USD;
  if (typeof rate !== 'number') throw new Error('history missing USD rate');
  return rate;
}

// Fetch the latest "USD per 1 <currency>" via the pair endpoint.
async function fetchLatestPair(currency) {
  const url = `${BASE}/${CONFIG.EXCHANGE_RATE_API_KEY}/pair/${currency}/USD`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`pair HTTP ${res.status}`);
  const data = await res.json();
  if (data.result !== 'success') throw new Error(data['error-type'] || 'pair failed');
  const rate = data.conversion_rate;
  if (typeof rate !== 'number') throw new Error('pair missing conversion_rate');
  return rate;
}

// Public: resolve the USD-per-1-<currency> rate for a given currency on a given
// ISO date. Caches the result. Throws if no rate can be obtained at all.
export async function getRate(currency, date = todayISO()) {
  if (currency === 'USD') return 1;

  const cached = cacheGet(date, currency);
  if (typeof cached === 'number') return cached;

  let rate;
  const isPast = date < todayISO();

  if (isPast) {
    // Try the date-accurate historical rate first; fall back to latest if the
    // plan/endpoint doesn't allow history (free tier).
    try {
      rate = await fetchHistorical(currency, date);
    } catch {
      rate = await fetchLatestPair(currency); // best-effort fallback
    }
  } else {
    rate = await fetchLatestPair(currency);
  }

  if (typeof rate !== 'number' || !isFinite(rate) || rate <= 0) {
    throw new Error(`Could not obtain a valid ${currency}→USD rate for ${date}`);
  }

  cacheSet(date, currency, rate);
  return rate;
}

// Public: convert an amount in `currency` on `date` to USD.
// Returns { amount_usd, exchange_rate }. Throws on failure so callers can block
// the save with a clear error instead of storing a wrong conversion.
export async function convertToUSD(amount, currency, date) {
  const rate = await getRate(currency, date);
  return {
    exchange_rate: rate,
    amount_usd: Math.round(Number(amount) * rate * 100) / 100,
  };
}
