// =============================================================================
// import.js — Bank import. Upload a CSV / TSV / OFX / QFX → check the column
// mapping (remembered per bank layout) → review a preview where every row can
// be unticked or re-categorized → import.
//
// Smart parts:
//   • Parsing (separators, number/date formats, OFX) lives in js/importer.js.
//   • The column mapping for each file layout is saved, so the next import
//     from the same bank is one click.
//   • Category per row: the file's own category column → a rule learned from
//     your past corrections (merchant → category) → keyword guess → Other.
//     Changing a row's category teaches the rule for next time.
//   • Likely duplicates (same date, amount, currency, description as an
//     existing transaction or another row) start unticked.
// =============================================================================

import { db } from '../db.js';
import { CONFIG } from '../config.js';
import { convertToBase } from '../rates.js';
import { getSettings, saveSettings, kindOf } from '../store.js';
import {
  isOFX, parseOFX, parseDelimited, parseAmount, parseDate, detectDateOrder, guessColumns, merchantKey, layoutKey,
} from '../importer.js';
import { el, toast, isValidISODate, fmtMoney } from '../util.js';

export async function renderImport() {
  const categories = await db.listCategories();
  const existing = await db.listTransactions();
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const other = byName.get('other') || categories[0];
  const incomeCat = byName.get('income') || categories.find((c) => kindOf(c) === 'income');
  const existingSig = new Set(existing.map(sig));

  const root = el('div', { class: 'view view-import' });
  root.append(el('div', { class: 'view-head' }, [el('h1', {}, 'Import')]));

  const fileInput = el('input', { type: 'file', accept: '.csv,.tsv,.txt,.ofx,.qfx,text/csv' });
  const mapHost = el('div', {});
  const previewHost = el('div', {});
  root.append(el('div', { class: 'card' }, [
    el('h2', {}, 'Bring in your bank transactions'),
    el('p', { class: 'muted small hint' },
      'In your bank’s website or app, look for “Download” or “Export” transactions and choose CSV, OFX or QFX. Then pick the file here.'),
    el('label', { class: 'file-drop' }, [fileInput, el('span', {}, 'Choose a file'), el('span', { class: 'muted small' }, 'CSV · TSV · OFX · QFX')]),
  ]));
  root.append(mapHost, previewHost);

  let parsed = null;

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    parsed = isOFX(text) ? parseOFX(text) : parseDelimited(text);
    parsed.fileName = file.name;
    previewHost.replaceChildren();
    if (!parsed.rows.length) {
      mapHost.replaceChildren(el('div', { class: 'card' }, [el('p', { class: 'neg' }, 'No transactions found in this file.')]));
      return;
    }
    drawMapping();
  });

  // --- Step 2: columns --------------------------------------------------------------
  function drawMapping() {
    const key = layoutKey(parsed.headers);
    const saved = getSettings().import_layouts?.[key];
    const g = saved?.columns || guessColumns(parsed.headers);
    const two = (g.amount ?? -1) < 0 && ((g.out ?? -1) >= 0 || (g.in ?? -1) >= 0);

    const colSelect = (value, allowNone = true) => el('select', {}, [
      allowNone ? el('option', { value: '-1' }, '— none —') : null,
      ...parsed.headers.map((h, i) => el('option', { value: String(i), selected: value === i ? 'selected' : null }, `${h}  (e.g. ${sample(i)})`)),
    ]);
    const sel = {
      date: colSelect(g.date), description: colSelect(g.description), amount: colSelect(g.amount),
      out: colSelect(g.out), in: colSelect(g.in), currency: colSelect(g.currency), category: colSelect(g.category),
    };
    const amountMode = el('select', {}, [
      el('option', { value: 'one', selected: !two ? 'selected' : null }, 'One amount column'),
      el('option', { value: 'two', selected: two ? 'selected' : null }, 'Separate money in / money out columns'),
    ]);
    const signs = el('select', {}, [
      el('option', { value: 'neg', selected: (saved?.signs || 'neg') === 'neg' ? 'selected' : null }, 'Spending is negative (−12.50)'),
      el('option', { value: 'pos', selected: saved?.signs === 'pos' ? 'selected' : null }, 'Spending is positive (credit-card style)'),
    ]);
    const dateValues = () => parsed.rows.map((r) => r[Number(sel.date.value)]);
    const order = el('select', {}, [
      el('option', { value: 'mdy' }, 'Month first (11/05 = Nov 5)'),
      el('option', { value: 'dmy' }, 'Day first (05/11 = Nov 5)'),
    ]);
    order.value = saved?.order || detectDateOrder(dateValues());
    sel.date.addEventListener('change', () => { order.value = detectDateOrder(dateValues()); });
    // Default signs: if every amount is positive it's probably a card export.
    if (!saved && g.amount >= 0) {
      const amts = parsed.rows.map((r) => parseAmount(r[g.amount])).filter((n) => !isNaN(n));
      if (amts.length && amts.every((n) => n >= 0)) signs.value = 'pos';
    }

    const f = (label, node, hint) => el('div', { class: 'field' }, [el('label', {}, label), node, hint ? el('div', { class: 'field-hint' }, hint) : null]);
    const oneBox = el('div', { class: 'map-grid' }, [f('Amount', sel.amount), f('How is spending shown?', signs)]);
    const twoBox = el('div', { class: 'map-grid' }, [f('Money out (spending)', sel.out), f('Money in (deposits)', sel.in)]);
    const sync = () => { oneBox.style.display = amountMode.value === 'one' ? '' : 'none'; twoBox.style.display = amountMode.value === 'two' ? '' : 'none'; };
    amountMode.addEventListener('change', sync); sync();

    const go = el('button', { class: 'btn btn-primary' }, saved ? 'Preview (saved layout)' : 'Preview');
    go.addEventListener('click', () => {
      const n = (s) => Number(s.value);
      const columns = {
        date: n(sel.date), description: n(sel.description), currency: n(sel.currency), category: n(sel.category),
        amount: amountMode.value === 'one' ? n(sel.amount) : -1,
        out: amountMode.value === 'two' ? n(sel.out) : -1,
        in: amountMode.value === 'two' ? n(sel.in) : -1,
      };
      if (columns.date < 0) return toast('Pick the date column', 'error');
      if (columns.amount < 0 && columns.out < 0 && columns.in < 0) return toast('Pick the amount column(s)', 'error');
      buildPreview({ key, columns, signs: signs.value, order: order.value });
    });

    mapHost.replaceChildren(el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', {}, `Check the columns`),
        el('span', { class: 'muted small' }, `${parsed.rows.length} rows · ${parsed.fileName}`),
      ]),
      saved ? el('p', { class: 'small pos hint' }, 'We remembered how this bank’s file is laid out.') : null,
      el('div', { class: 'map-grid' }, [f('Date', sel.date), f('Date format', order), f('Description', sel.description), f('Amounts', amountMode)]),
      oneBox, twoBox,
      el('details', { class: 'more-opts' }, [
        el('summary', {}, 'Currency & category columns (optional)'),
        el('div', { class: 'map-grid' }, [f('Currency', sel.currency, `Leave as none if everything is in ${CONFIG.BASE_CURRENCY}`), f('Category', sel.category)]),
      ]),
      go,
    ]));
  }

  function sample(i) {
    const v = parsed.rows.find((r) => r[i])?.[i] || '';
    return v.length > 18 ? v.slice(0, 18) + '…' : v || '—';
  }

  // --- Step 3: preview -----------------------------------------------------------------
  function buildPreview(cfg) {
    const { columns: c, signs, order } = cfg;
    const rules = getSettings().import_rules || {};
    const seen = new Set();
    const rows = parsed.rows.map((cells) => {
      const date = parseDate(cells[c.date], order);
      const description = c.description >= 0 ? cells[c.description] || '' : '';
      const currency = (c.currency >= 0 ? (cells[c.currency] || '').toUpperCase() : '') || CONFIG.BASE_CURRENCY;
      let amount, type;
      if (c.amount >= 0) {
        const n = parseAmount(cells[c.amount]);
        const isOut = signs === 'neg' ? n < 0 : n > 0;
        amount = Math.abs(n); type = isOut ? 'expense' : 'income';
      } else {
        const out = c.out >= 0 ? parseAmount(cells[c.out]) : NaN;
        const inn = c.in >= 0 ? parseAmount(cells[c.in]) : NaN;
        if (Math.abs(out) > 0) { amount = Math.abs(out); type = 'expense'; } else { amount = Math.abs(inn); type = 'income'; }
      }
      const flags = [];
      if (!isValidISODate(date)) flags.push('unreadable date');
      if (!(amount > 0)) flags.push('no amount');
      if (!CONFIG.CURRENCIES.includes(currency)) flags.push(`${currency || '?'} not in your currencies`);

      // Category, most confident first.
      const fileCat = c.category >= 0 ? byName.get((cells[c.category] || '').toLowerCase()) : null;
      const mkey = merchantKey(description);
      const learned = mkey && rules[mkey] && catById.get(rules[mkey]);
      const guessedNames = guessCategory(description);
      const guessed = guessedNames ? guessedNames.split('|').map((n) => byName.get(n.toLowerCase())).find(Boolean) : null;
      let category = fileCat || learned || guessed || (type === 'income' ? incomeCat : other);
      const source = fileCat ? 'file' : learned ? 'learned' : guessed ? 'guessed' : 'default';

      const r = { date, description, currency, amount, type, flags, ok: !flags.length, category_id: category?.id, source, mkey, changed: false };
      const s = sig(r);
      r.duplicate = r.ok && (existingSig.has(s) || seen.has(s));
      if (r.ok) seen.add(s);
      r.include = r.ok && !r.duplicate;
      return r;
    });
    drawPreview(rows, cfg);
  }

  function drawPreview(rows, cfg) {
    const opts = (selected) => categories.map((cat) => el('option', { value: cat.id, selected: cat.id === selected ? 'selected' : null }, cat.name));
    const counter = el('span', { class: 'muted small' });
    const importBtn = el('button', { class: 'btn btn-primary' });
    const update = () => {
      const n = rows.filter((r) => r.include).length;
      counter.textContent = `${n} of ${rows.length} selected · ${rows.filter((r) => r.duplicate).length} possible duplicates · ${rows.filter((r) => !r.ok).length} can’t be read`;
      importBtn.textContent = `Import ${n} transaction${n === 1 ? '' : 's'}`;
      importBtn.disabled = n === 0;
    };

    const list = el('div', { class: 'imp-list' }, rows.map((r) => {
      const box = el('input', { type: 'checkbox', checked: r.include ? 'checked' : null, disabled: r.ok ? null : 'disabled' });
      box.addEventListener('change', () => { r.include = box.checked; update(); });
      const cat = el('select', { class: 'imp-cat' }, opts(r.category_id));
      cat.addEventListener('change', () => { r.category_id = cat.value; r.changed = true; tag.textContent = 'you picked'; tag.className = 'tag tag-ok'; });
      const tag = el('span', { class: 'tag ' + (r.source === 'learned' ? 'tag-ok' : r.source === 'guessed' ? 'tag-ok' : 'tag-dim') },
        r.source === 'learned' ? 'learned' : r.source === 'guessed' ? 'auto' : r.source === 'file' ? 'from file' : 'default');
      return el('label', { class: 'imp-row' + (r.ok ? '' : ' bad') + (r.duplicate ? ' dup' : '') }, [
        box,
        el('div', { class: 'imp-main' }, [
          el('span', { class: 'imp-desc' }, r.description || '(no description)'),
          el('span', { class: 'imp-meta muted small' }, [
            r.date || '—',
            r.duplicate ? el('span', { class: 'tag tag-warn' }, 'possible duplicate') : null,
            ...r.flags.map((x) => el('span', { class: 'tag tag-bad' }, x)),
          ]),
        ]),
        el('div', { class: 'imp-cat-wrap' }, [cat, tag]),
        el('span', { class: 'imp-amt ' + (r.type === 'income' ? 'pos' : '') },
          r.amount > 0 ? `${r.type === 'income' ? '+' : '−'}${fmtMoney(r.amount, CONFIG.CURRENCIES.includes(r.currency) ? r.currency : CONFIG.BASE_CURRENCY)}` : '—'),
      ]);
    }));

    const selectAll = el('button', { class: 'btn btn-sm btn-ghost', onClick: () => {
      const all = rows.filter((r) => r.ok).every((r) => r.include);
      rows.forEach((r, i) => { if (r.ok) { r.include = !all; list.children[i].querySelector('input').checked = !all; } });
      update();
    } }, 'Select all / none');

    importBtn.addEventListener('click', async () => {
      const chosen = rows.filter((r) => r.include);
      importBtn.disabled = true;
      importBtn.textContent = 'Importing…';
      try {
        const toInsert = [];
        for (const r of chosen) {
          const { amount_usd, exchange_rate } = await convertToBase(r.amount, r.currency, r.date);
          toInsert.push({ type: r.type, date: r.date, amount: r.amount, currency: r.currency, amount_usd, exchange_rate, category_id: r.category_id, description: r.description });
        }
        await db.createTransactionsBulk(toInsert);
        // Remember this layout and any categories the user corrected.
        const s = getSettings();
        const learnedRules = { ...(s.import_rules || {}) };
        for (const r of rows) if (r.changed && r.mkey) learnedRules[r.mkey] = r.category_id;
        await saveSettings({
          import_layouts: { ...(s.import_layouts || {}), [cfg.key]: { columns: cfg.columns, signs: cfg.signs, order: cfg.order } },
          import_rules: learnedRules,
        }).catch(() => {});
        const learnedN = rows.filter((r) => r.changed && r.mkey).length;
        mapHost.replaceChildren();
        previewHost.replaceChildren(el('div', { class: 'card empty' }, [
          el('p', { class: 'pos' }, `Imported ${toInsert.length} transaction${toInsert.length === 1 ? '' : 's'}.`),
          learnedN ? el('p', { class: 'muted small' }, `Learned ${learnedN} merchant${learnedN === 1 ? '' : 's'} — they’ll be categorized automatically next time.`) : null,
          el('a', { class: 'btn btn-primary btn-sm', href: '#/transactions' }, 'See them in Activity'),
        ]));
        toast('Import complete', 'success');
      } catch (err) {
        console.error(err);
        toast('Import failed: ' + (err.message || 'rate unavailable'), 'error');
        update();
      }
    });

    update();
    previewHost.replaceChildren(el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', {}, 'Review'), selectAll]),
      counter,
      el('p', { class: 'muted small hint' }, 'Untick anything you don’t want. Change a category and we’ll remember it for that merchant.'),
      list,
      importBtn,
    ]));
  }

  return root;
}

// Keyword → category auto-categorization for bank descriptions. Names can
// list alternatives ("Food|Food & Dining"); the first one the user has wins.
const CATEGORY_KEYWORDS = [
  ['Transport', ['uber', 'lyft', 'didi', 'taxi', 'gas station', 'shell', 'chevron', 'exxon', 'gasolina', 'fuel', 'parking', 'metro', 'transit', 'train', 'bahn', 'sncf', 'renfe', 'trenitalia', 'tfl', 'bvg', 'tankstelle', 'aral']],
  ['Food|Food & Dining|Groceries', ['restaurant', 'cafe', 'coffee', 'starbucks', 'mcdonald', 'grocer', 'supermarket', 'supermercado', 'whole foods', 'trader joe', 'kroger', 'safeway', 'aldi', 'lidl', 'tesco', 'walmart', 'food', 'pizza', 'bakery', 'doordash', 'uber eats', 'grubhub', 'rewe', 'edeka', 'netto', 'penny', 'carrefour', 'mercadona', 'sainsbury', 'asda', 'albert heijn', 'monoprix', 'lieferando', 'deliveroo', 'restaurante', 'bäckerei']],
  ['Subscriptions|Entertainment', ['netflix', 'spotify', 'youtube', 'icloud', 'apple.com', 'hbo', 'disney', 'prime video', 'subscription', 'openai', 'chatgpt', 'patreon']],
  ['Phone & Internet|Utilities|Housing & Bills', ['verizon', 'at&t', 't-mobile', 'comcast', 'xfinity', 'internet', 'mobile', 'phone']],
  ['Utilities|Housing & Bills', ['electric', 'water', 'power', 'utility', 'gas bill', 'energy']],
  ['Housing & Bills|Housing/Rent|Rent', ['rent', 'alquiler', 'mortgage', 'hoa', 'landlord']],
  ['Health', ['pharmacy', 'farmacia', 'cvs', 'walgreens', 'doctor', 'clinic', 'hospital', 'dental', 'gym', 'fitness']],
  ['Entertainment', ['cinema', 'movie', 'concert', 'steam', 'playstation', 'xbox', 'nintendo', 'ticketmaster']],
  ['Travel', ['airline', 'airlines', 'hotel', 'airbnb', 'booking.com', 'expedia', 'flight']],
  ['Shopping', ['amazon', 'amzn', 'ebay', 'target', 'ikea', 'etsy', 'aliexpress', 'store', 'mall']],
  ['Insurance', ['insurance', 'geico', 'progressive', 'allstate']],
  ['Income|Side income', ['salary', 'payroll', 'salario', 'paycheck', 'direct dep', 'nomina', 'nómina', 'gehalt', 'lohn', 'salaire', 'loon']],
];

// Keywords must start a word ("tfl" matches "TFL TRAVEL", not "neTFLix"),
// but may be a prefix ("grocer" matches "GROCERY").
const KEYWORD_RES = CATEGORY_KEYWORDS.map(([name, words]) => [name, words.map((w) =>
  new RegExp(`(^|[^a-z0-9\u00c0-\u024f])${w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'))]);

export function guessCategory(text) {
  const t = (text || '').toLowerCase();
  if (!t) return null;
  for (const [name, res] of KEYWORD_RES) if (res.some((re) => re.test(t))) return name;
  return null;
}

// Duplicate signature: date + amount + currency + description.
function sig(t) {
  return [t.date, Number(t.amount).toFixed(2), t.currency, (t.description || '').trim().toLowerCase()].join('|');
}
