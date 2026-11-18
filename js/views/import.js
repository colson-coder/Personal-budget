// =============================================================================
// import.js — CSV import. Upload → map columns → preview (with per-row flags) →
// confirm → bulk insert.
//
// Failure handling per spec:
//   • invalid date     → row flagged, excluded from import
//   • unknown currency → row flagged, excluded from import
//   • category name with no match → mapped to "Other"
//   • likely duplicates (same date+amount+currency+desc already present) → warned
// =============================================================================

import { db } from '../db.js';
import { CONFIG } from '../config.js';
import { convertToUSD } from '../rates.js';
import { el, toast, isValidISODate } from '../util.js';

export async function renderImport() {
  const categories = await db.listCategories();
  const existing = await db.listTransactions();
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const other = categories.find((c) => c.name.toLowerCase() === 'other') || categories[0];

  // Existing-row signatures for duplicate detection.
  const existingSig = new Set(existing.map(sig));

  const root = el('div', { class: 'view view-import' });
  root.append(el('div', { class: 'view-head' }, [el('h1', {}, 'Import CSV')]));

  const fileInput = el('input', { type: 'file', accept: '.csv,text/csv' });
  const mapHost = el('div', {});
  const previewHost = el('div', {});

  root.append(el('div', { class: 'card' }, [
    el('p', { class: 'muted' }, 'Upload a CSV, map its columns, then preview before importing.'),
    fileInput,
    mapHost,
    previewHost,
  ]));

  let parsed = null; // { headers, rows }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    parsed = parseCSV(text);
    if (!parsed.rows.length) {
      mapHost.replaceChildren(el('p', { class: 'neg' }, 'No data rows found in this file.'));
      previewHost.replaceChildren();
      return;
    }
    drawMapping();
  });

  // Column → field mapping UI. Auto-guesses by header name.
  const fields = ['date', 'amount', 'currency', 'description', 'category'];
  function drawMapping() {
    const guess = (names) => parsed.headers.findIndex((h) => names.some((n) => h.toLowerCase().includes(n)));
    const guesses = {
      date: guess(['date']),
      amount: guess(['amount', 'value', 'total']),
      currency: guess(['currency', 'ccy']),
      description: guess(['desc', 'memo', 'note', 'detail']),
      category: guess(['categ', 'type', 'tag']),
    };
    const selects = {};
    const rows = fields.map((f) => {
      const sel = el('select', {}, [
        el('option', { value: '' }, '— none —'),
        ...parsed.headers.map((h, i) =>
          el('option', { value: String(i), selected: guesses[f] === i ? 'selected' : null }, h)),
      ]);
      selects[f] = sel;
      return el('div', { class: 'field' }, [el('label', {}, f[0].toUpperCase() + f.slice(1)), sel]);
    });
    mapHost.replaceChildren(
      el('h2', {}, 'Map columns'),
      el('div', { class: 'map-grid' }, rows),
      el('button', { class: 'btn btn-primary', onClick: () => buildPreview(selects) }, 'Preview'),
    );
  }

  async function buildPreview(selects) {
    const idx = Object.fromEntries(fields.map((f) => [f, selects[f].value === '' ? -1 : Number(selects[f].value)]));
    if (idx.date < 0 || idx.amount < 0) {
      return toast('Date and Amount columns are required', 'error');
    }
    previewHost.replaceChildren(el('p', { class: 'muted' }, 'Validating & fetching rates…'));

    // Bank exports commonly use signed amounts (negative = debit). If this file
    // has BOTH signs, trust the sign for income/expense detection. If every
    // amount is positive, fall back to the category name ("Income" → income).
    const signedAmounts = parsed.rows.map((cells) =>
      parseFloat(String(cells[idx.amount] || '').replace(/[^0-9.\-]/g, '')));
    const hasMixedSigns =
      signedAmounts.some((a) => a < 0) && signedAmounts.some((a) => a > 0);

    const prepared = [];
    const seenInFile = new Set(); // duplicate detection within the file itself
    for (const cells of parsed.rows) {
      const dateRaw = (cells[idx.date] || '').trim();
      const amountRaw = (cells[idx.amount] || '').trim();
      const currency = ((idx.currency >= 0 ? cells[idx.currency] : CONFIG.BASE_CURRENCY) || '').trim().toUpperCase() || CONFIG.BASE_CURRENCY;
      const description = idx.description >= 0 ? (cells[idx.description] || '').trim() : '';
      const catNameRaw = idx.category >= 0 ? (cells[idx.category] || '').trim() : '';

      const date = normalizeDate(dateRaw);
      const amount = parseFloat(String(amountRaw).replace(/[^0-9.\-]/g, ''));
      const flags = [];

      if (!isValidISODate(date)) flags.push('invalid date');
      if (!CONFIG.CURRENCIES.includes(currency)) flags.push('unknown currency');
      if (!(Math.abs(amount) > 0)) flags.push('invalid amount');

      // Category resolution, in order of confidence:
      //   1. exact name match on the file's category column
      //   2. keyword auto-categorization from the description (UBER → Transport…)
      //   3. fall back to "Other"
      const matched = byName.get(catNameRaw.toLowerCase());
      const guessedName = matched ? null : guessCategory(description || catNameRaw);
      const guessed = guessedName ? byName.get(guessedName.toLowerCase()) : null;
      const category = matched || guessed || other;
      const categoryMapped = !!catNameRaw && !matched && !guessed;
      const categoryGuessed = !!guessed;

      // Income vs expense.
      const looksIncome =
        (matched || guessed)?.name?.toLowerCase() === 'income';
      const type = hasMixedSigns
        ? (amount < 0 ? 'expense' : 'income')
        : (looksIncome ? 'income' : 'expense');

      const rec = {
        ok: flags.length === 0,
        flags,
        categoryMapped,
        categoryGuessed,
        catName: category?.name,
        type,
        date,
        amount: Math.abs(amount),
        currency,
        description,
        category_id: category?.id,
      };
      const s = sig(rec);
      rec.duplicate = rec.ok && (existingSig.has(s) || seenInFile.has(s));
      if (rec.ok) seenInFile.add(s);
      prepared.push(rec);
    }

    drawPreview(prepared);
  }

  function drawPreview(prepared) {
    const importable = prepared.filter((r) => r.ok);
    const skipped = prepared.length - importable.length;

    const table = el('div', { class: 'tx-table preview-table' });
    for (const r of prepared) {
      const tags = [];
      if (!r.ok) r.flags.forEach((f) => tags.push(el('span', { class: 'tag tag-bad' }, f)));
      if (r.categoryGuessed) tags.push(el('span', { class: 'tag tag-ok' }, `auto: ${r.catName}`));
      if (r.categoryMapped) tags.push(el('span', { class: 'tag tag-warn' }, '→ Other'));
      if (r.duplicate) tags.push(el('span', { class: 'tag tag-warn' }, 'possible duplicate'));
      table.append(el('div', { class: 'txr' + (r.ok ? '' : ' txr-bad') }, [
        el('div', { class: 'txr-cell', dataset: { label: 'Date' } }, r.date || '—'),
        el('div', { class: 'txr-cell', dataset: { label: 'Amount' } }, `${r.amount || '—'} ${r.currency}`),
        el('div', { class: 'txr-cell', dataset: { label: 'Category' } }, r.catName || '—'),
        el('div', { class: 'txr-cell', dataset: { label: 'Description' } }, r.description || '—'),
        el('div', { class: 'txr-cell', dataset: { label: 'Status' } }, tags.length ? tags : el('span', { class: 'tag tag-ok' }, 'ready')),
      ]));
    }

    const importBtn = el('button', { class: 'btn btn-primary' },
      `Import ${importable.length} transaction${importable.length === 1 ? '' : 's'}`);
    importBtn.disabled = importable.length === 0;

    importBtn.addEventListener('click', async () => {
      importBtn.disabled = true;
      importBtn.textContent = 'Converting & importing…';
      try {
        const toInsert = [];
        for (const r of importable) {
          // Convert at the row's own date so imported history is period-accurate.
          const { amount_usd, exchange_rate } = await convertToUSD(r.amount, r.currency, r.date);
          toInsert.push({
            type: r.type, date: r.date, amount: r.amount, currency: r.currency,
            amount_usd, exchange_rate, category_id: r.category_id, description: r.description,
          });
        }
        await db.createTransactionsBulk(toInsert);
        toast(`Imported ${toInsert.length} transactions`, 'success');
        previewHost.replaceChildren(el('p', { class: 'pos pad' }, `Done — imported ${toInsert.length}.`));
      } catch (err) {
        console.error(err);
        toast('Import failed: ' + (err.message || 'rate unavailable'), 'error');
        importBtn.disabled = false;
        importBtn.textContent = `Import ${importable.length} transactions`;
      }
    });

    previewHost.replaceChildren(
      el('div', { class: 'preview-summary' }, [
        el('h2', {}, 'Preview'),
        el('p', { class: 'muted' },
          `${importable.length} ready · ${skipped} flagged & skipped`),
      ]),
      table,
      importBtn,
    );
  }

  return root;
}

// Keyword → category auto-categorization for bank-export descriptions. First
// matching keyword wins; returns a default-category name or null.
const CATEGORY_KEYWORDS = [
  ['Transport',      ['uber', 'lyft', 'didi', 'taxi', 'gas', 'gasolina', 'fuel', 'parking', 'metro', 'bus ', 'train']],
  ['Food & Dining',  ['restaurant', 'cafe', 'coffee', 'starbucks', 'mcdonald', 'grocer', 'supermercado', 'automercado', 'walmart', 'food', 'pizza', 'soda ', 'bakery']],
  ['Subscriptions',  ['netflix', 'spotify', 'youtube', 'icloud', 'apple.com', 'hbo', 'disney', 'amazon prime', 'subscription', 'openai', 'chatgpt']],
  ['Utilities',      ['electric', 'water', 'internet', 'phone', 'kolbi', 'claro', 'movistar', 'cable', 'utility', 'ice ']],
  ['Housing/Rent',   ['rent', 'alquiler', 'mortgage', 'hoa', 'landlord']],
  ['Health',         ['pharmacy', 'farmacia', 'doctor', 'clinic', 'hospital', 'dental', 'gym']],
  ['Entertainment',  ['cinema', 'movie', 'concert', 'steam', 'playstation', 'nintendo', 'ticket']],
  ['Travel',         ['airline', 'avianca', 'volaris', 'hotel', 'airbnb', 'booking.com', 'flight']],
  ['Shopping',       ['amazon', 'ebay', 'aliexpress', 'store', 'tienda', 'mall']],
  ['Income',         ['salary', 'payroll', 'salario', 'deposit from', 'paycheck', 'nomina']],
];

function guessCategory(text) {
  const t = (text || '').toLowerCase();
  if (!t) return null;
  for (const [name, words] of CATEGORY_KEYWORDS) {
    if (words.some((w) => t.includes(w))) return name;
  }
  return null;
}

// Duplicate signature: date+amount+currency+description.
function sig(t) {
  return [t.date, Number(t.amount).toFixed(2), t.currency, (t.description || '').trim().toLowerCase()].join('|');
}

// Accepts YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY (heuristic), returns ISO or ''.
function normalizeDate(s) {
  if (!s) return '';
  s = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = '20' + y;
    // If first part > 12 it must be the day (DD/MM); otherwise assume MM/DD.
    let mm, dd;
    if (Number(a) > 12) { dd = a; mm = b; } else { mm = a; dd = b; }
    return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  return '';
}

// Minimal CSV parser supporting quoted fields, escaped quotes, and commas/newlines
// inside quotes. Good enough for hand/bank-exported CSVs.
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  const headers = nonEmpty.shift() || [];
  return { headers, rows: nonEmpty };
}
