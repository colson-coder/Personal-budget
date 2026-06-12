// =============================================================================
// util.js — Date/timezone, currency formatting, and small DOM helpers.
//
// All month-boundary logic is computed against CONFIG.TIMEZONE
// (America/Costa_Rica, UTC-6) and never against the browser's local UTC offset.
// =============================================================================

import { CONFIG } from './config.js';

// Return "YYYY-MM-DD" for *today* in the app's fixed timezone (not UTC, not the
// device's local zone). Uses Intl with the en-CA locale, which formats as
// ISO-style YYYY-MM-DD.
export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CONFIG.TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// First day ("YYYY-MM-01") and last day of the month that a given ISO date
// falls in, evaluated on the calendar. Because our stored dates are plain
// "YYYY-MM-DD" strings already anchored to the CR calendar, we can slice them
// directly without re-applying a timezone offset.
export function monthBounds(isoDate) {
  const [y, m] = isoDate.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

// True if an ISO date string is within the current CR calendar month.
export function isThisMonth(isoDate) {
  return isoDate.slice(0, 7) === todayISO().slice(0, 7);
}

// "June 2026"-style label for the current month.
export function currentMonthLabel() {
  const [y, m] = todayISO().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Format a number as a currency string. Falls back gracefully for codes that
// Intl doesn't recognize.
export function fmtMoney(amount, currency = CONFIG.BASE_CURRENCY) {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export function fmtUSD(amount) {
  return fmtMoney(amount, 'USD');
}

// Validate a "YYYY-MM-DD" string and that it's a real calendar date.
export function isValidISODate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

// --- tiny DOM helpers --------------------------------------------------------

// Create an element with attributes and children. Children may be nodes or
// strings (strings become text nodes — safe against HTML injection).
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== null && v !== undefined && v !== false) {
      node.setAttribute(k, v);
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// Lightweight toast notification.
export function toast(message, kind = 'info') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host' });
    document.body.appendChild(host);
  }
  const t = el('div', { class: `toast toast-${kind}` }, message);
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 3200);
}
