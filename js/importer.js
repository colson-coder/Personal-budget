// =============================================================================
// importer.js — Bank-file parsing (pure, no DOM; unit-tested in
// tests/importer.test.mjs). Handles what real bank exports throw at you:
//   • CSV with comma, semicolon or tab separators, quoted fields, and junk
//     lines above the header
//   • OFX / QFX downloads (the "Quicken / Money" format most banks offer)
//   • amounts like 1,234.56 · 1.234,56 · (12.50) · -12.50 · 12.50- · $12 · 12 CR
//   • dates like 2026-11-05 · 05/11/2026 · 11/05/2026 · 05.11.2026 ·
//     Nov 5, 2026 · 05-Nov-2026 · 2026/11/05 · 20261105 (with day/month order
//     detected from the whole file)
// =============================================================================

// --- CSV ---------------------------------------------------------------------------
export function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n');
  const score = (d) => {
    // Count delimiters outside quotes per line; prefer consistent counts.
    const counts = sample.split('\n').filter((l) => l.trim()).map((line) => {
      let n = 0, q = false;
      for (const ch of line) { if (ch === '"') q = !q; else if (ch === d && !q) n++; }
      return n;
    });
    if (!counts.length) return 0;
    const common = mode(counts);
    return common > 0 ? common * counts.filter((c) => c === common).length : 0;
  };
  return [',', ';', '\t', '|'].map((d) => [d, score(d)]).sort((a, b) => b[1] - a[1])[0][0];
}

function mode(arr) {
  const m = new Map();
  for (const v of arr) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function parseDelimited(text, delimiter = detectDelimiter(text)) {
  text = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== '')).map((r) => r.map((c) => c.trim()));
  if (!nonEmpty.length) return { headers: [], rows: [], delimiter };
  // Banks often put account info above the real header: use the first row
  // that has the most common column count.
  const width = mode(nonEmpty.map((r) => r.length));
  const h = nonEmpty.findIndex((r) => r.length === width);
  const headers = nonEmpty[h].map((x, i) => x || `Column ${i + 1}`);
  const data = nonEmpty.slice(h + 1).filter((r) => r.length >= Math.min(2, width));
  return { headers, rows: data, delimiter };
}

// --- OFX / QFX -----------------------------------------------------------------------
export function isOFX(text) {
  return /<OFX>|OFXHEADER/i.test(text.slice(0, 2000));
}

// Returns rows in a fixed shape so the rest of the importer can treat it like
// a CSV with known columns.
export function parseOFX(text) {
  const tag = (block, name) => {
    const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
    return m ? m[1].trim() : '';
  };
  const currency = tag(text, 'CURDEF') || '';
  const rows = [];
  const re = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi;
  let m;
  while ((m = re.exec(text))) {
    const b = m[1];
    const dt = tag(b, 'DTPOSTED');
    const date = dt.length >= 8 ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : '';
    const name = tag(b, 'NAME'), memo = tag(b, 'MEMO');
    rows.push([date, tag(b, 'TRNAMT'), tag(b, 'CURRENCY') || currency, decodeEntities(name || memo), memo && name ? decodeEntities(memo) : '', tag(b, 'FITID')]);
  }
  return { headers: ['Date', 'Amount', 'Currency', 'Description', 'Memo', 'ID'], rows, delimiter: 'ofx' };
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// --- Amounts ---------------------------------------------------------------------------
// Returns a signed number, or NaN. Handles both decimal conventions by looking
// at which separator comes last.
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return NaN;
  let s = String(raw).trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/\b(DR|DEBIT)\b\.?$/i.test(s)) { neg = true; s = s.replace(/\b(DR|DEBIT)\b\.?$/i, ''); }
  s = s.replace(/\b(CR|CREDIT)\b\.?$/i, '');
  if (/-\s*$/.test(s)) { neg = true; s = s.replace(/-\s*$/, ''); }
  if (/^\s*[-−–]/.test(s)) { neg = true; }
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastComma > lastDot) {
    // "1.234,56" or "12,50" → comma is the decimal point (unless it's clearly
    // a thousands separator like "1,234").
    const after = s.length - lastComma - 1;
    if (after === 3 && lastDot === -1 && s.indexOf(',') === lastComma && s.length > 4) s = s.replace(/,/g, '');
    else s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastComma === -1 && lastDot !== -1) {
    // Dots only. "1.234.567" or "2.500" (3 digits after a single dot, as in
    // ₡2.500 or 1.234 €) are thousands; "4.50" / "0.125" are decimals.
    const parts = s.split('.');
    const thousands = parts.length > 2 ? parts.slice(1).every((p) => p.length === 3)
      : parts[1].length === 3 && /^[1-9]\d{0,2}$/.test(parts[0]);
    if (thousands) s = parts.join('');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? NaN : neg ? -n : n;
}

// --- Dates ----------------------------------------------------------------------------------
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  ene: 1, abr: 4, ago: 8, dic: 12 };

// 'dmy' or 'mdy' for ambiguous slash dates, decided from all values in the file.
export function detectDateOrder(values) {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    const m = String(v || '').trim().match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-]\d{2,4}/);
    if (!m) continue;
    if (Number(m[1]) > 12) dmy++;
    if (Number(m[2]) > 12) mdy++;
  }
  if (dmy > mdy) return 'dmy';
  if (mdy > dmy) return 'mdy';
  // No evidence: dots usually mean day-first (European), slashes month-first.
  return values.some((v) => /^\d{1,2}\.\d{1,2}\.\d{2,4}/.test(String(v || '').trim())) ? 'dmy' : 'mdy';
}

const pad = (n) => String(n).padStart(2, '0');
const year4 = (y) => (String(y).length === 2 ? 2000 + Number(y) : Number(y));
function valid(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parseDate(raw, order = 'mdy') {
  const s = String(raw || '').trim();
  if (!s) return '';
  let m;
  // ISO and ISO-ish (with optional time)
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : '';
  }
  // Compact 20261105
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : '';
  }
  // 05/11/2026, 11-05-26, 05.11.2026
  if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/))) {
    let a = Number(m[1]), b = Number(m[2]);
    const y = year4(m[3]);
    let [d, mo] = order === 'dmy' ? [a, b] : [b, a];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // obviously swapped
    return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : '';
  }
  // 05-Nov-2026, 5 Nov 2026
  if ((m = s.match(/^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})\.?[\s\-/.,]+(\d{2,4})/))) {
    const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()];
    const y = year4(m[3]), d = Number(m[1]);
    return mo && valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : '';
  }
  // Nov 5, 2026
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})/))) {
    const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()];
    const y = year4(m[3]), d = Number(m[2]);
    return mo && valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : '';
  }
  return '';
}

// --- Column guessing & merchant keys -------------------------------------------------------------
const HINTS = {
  // English, Spanish, German, French, Portuguese, Dutch, Italian
  date: ['date', 'fecha', 'datum', 'buchungstag', 'buchungsdatum', 'wertstellung', 'valuta', 'data', 'posted', 'booking', 'transaction date', 'value date'],
  amount: ['amount', 'monto', 'importe', 'betrag', 'montant', 'valor', 'bedrag', 'importo', 'value', 'total', 'sum'],
  out: ['debit', 'withdrawal', 'money out', 'paid out', 'out', 'cargo', 'débito', 'debe', 'soll', 'débit'],
  in: ['credit', 'deposit', 'money in', 'paid in', 'in', 'abono', 'crédito', 'haber', 'haben', 'crédit'],
  currency: ['currency', 'ccy', 'moneda', 'währung', 'devise', 'moeda', 'valuta'],
  description: ['description', 'desc', 'payee', 'merchant', 'name', 'details', 'detail', 'narrative', 'memo', 'concepto', 'verwendungszweck', 'buchungstext', 'empfänger', 'beschreibung', 'libellé', 'libelle', 'descrição', 'omschrijving', 'descrizione', 'reference', 'transaction'],
  category: ['category', 'categ', 'categoría', 'kategorie', 'catégorie', 'categoria'],
};

export function guessColumns(headers) {
  const used = new Set();
  const find = (key, { exact = false } = {}) => {
    const hs = headers.map((h) => h.toLowerCase().trim());
    for (const hint of HINTS[key]) {
      const i = hs.findIndex((h, idx) => !used.has(idx) && (exact ? h === hint : h === hint || h.includes(hint)));
      if (i >= 0) { used.add(i); return i; }
    }
    return -1;
  };
  const date = find('date');
  const amount = find('amount');
  // Only look for in/out columns when there's no single amount column.
  const out = amount < 0 ? find('out') : -1;
  const inn = amount < 0 ? find('in', { exact: true }) : -1;
  const currency = find('currency');
  const category = find('category');
  const description = find('description');
  return { date, amount, out, in: inn < 0 && amount < 0 ? find('in') : inn, currency, description, category };
}

// Normalized "merchant" key from a bank description, for learned rules:
// "UBER *TRIP 8XK2 SAN JOSE 11/05" → "uber trip san"
export function merchantKey(desc) {
  return String(desc || '').toLowerCase()
    .split(/\s+/).filter((w) => !/\d/.test(w)).join(' ') // drop reference codes like 8XK2, 11/05
    .replace(/[^a-zÀ-ɏ&]+/g, ' ')
    .split(' ').filter((w) => w.length > 1 && !['pos', 'purchase', 'card', 'debit', 'credit', 'payment', 'visa', 'mastercard', 'compra', 'pago'].includes(w))
    .slice(0, 3).join(' ').trim();
}

// Stable key for a file layout, used to remember the user's column mapping.
export function layoutKey(headers) {
  return headers.map((h) => h.toLowerCase().trim()).join('|');
}
