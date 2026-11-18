// =============================================================================
// util.js — Date/timezone, currency formatting, and small DOM helpers.
//
// All month-boundary logic is computed against CONFIG.TIMEZONE
// (the timezone the user picked in setup), never the raw UTC offset.
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

// "June 2026"-style label for a "YYYY-MM" month (defaults to current).
export function monthLabel(ym = todayISO().slice(0, 7)) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// "YYYY-MM" arithmetic for month navigation.
export function nextMonthYM(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function prevMonthYM(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
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

// Formats in the user's home currency (name kept for compatibility).
export function fmtUSD(amount) {
  return fmtMoney(amount, CONFIG.BASE_CURRENCY);
}
export const fmtBase = fmtUSD;

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

// --- Bottom sheet / modal ------------------------------------------------------
// Slides up from the bottom on phones, centered dialog on desktop. `build`
// receives a close() function and returns the sheet's body node. Escape, the
// backdrop and the ✕ all close it.
export function openSheet(title, build) {
  const backdrop = el('div', { class: 'sheet-backdrop' });
  const panel = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = () => {
    backdrop.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => backdrop.remove(), 220);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  panel.append(
    el('div', { class: 'sheet-head' }, [
      el('h2', {}, title),
      el('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: close }, '✕'),
    ]),
    build(close),
  );
  backdrop.append(panel);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  requestAnimationFrame(() => {
    backdrop.classList.add('open');
    panel.querySelector('input, select')?.focus({ preventScroll: true });
  });
  return close;
}

// Labeled form field helper: field('Amount', inputEl)
export function field(label, input, hint) {
  return el('div', { class: 'field' }, [
    el('label', {}, label), input, hint ? el('div', { class: 'field-hint' }, hint) : null,
  ]);
}

// "Mar 2053"-style short month label.
export function shortMonth(ym) {
  if (!ym) return '—';
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Human duration for a month count: 316 → "26 yr 4 mo".
export function fmtMonths(n) {
  if (!isFinite(n)) return 'never at this payment';
  if (n <= 0) return 'paid off';
  const y = Math.floor(n / 12), m = n % 12;
  return [y ? `${y} yr` : '', m ? `${m} mo` : ''].filter(Boolean).join(' ');
}

// Tiny inline SVG line chart (sparkline). values: number[]
export function sparkline(values, { width = 120, height = 32, stroke = 'var(--accent)' } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('preserveAspectRatio', 'none'); // stretch to the card width
  svg.setAttribute('aria-hidden', 'true');
  if (values.length < 2) return svg;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) =>
    `${(i / (values.length - 1)) * width},${height - 2 - ((v - min) / span) * (height - 4)}`);
  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', pts.join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', stroke);
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(line);
  return svg;
}

// Progress bar node. pct in 0..1
export function progress(pct, { over = false } = {}) {
  return el('div', { class: 'progress' }, [
    el('div', { class: 'progress-bar' + (over ? ' over' : ''), style: `width:${Math.max(0, Math.min(1, pct)) * 100}%` }),
  ]);
}
