// =============================================================================
// taxes.js — Tax estimate for regular people and side-hustlers. Works for any
// country: the user picks a flat rate or their own brackets, a tax-free
// allowance, and when their tax year starts. Income categories say whether tax
// is already taken out (most paychecks), owed (side income, interest), or not
// taxable. Shows what's owed so far, what's been paid, a full-year projection,
// payment periods, deductions, and how much to set aside each month.
// ESTIMATES ONLY — not tax advice.
// =============================================================================

import { db } from '../db.js';
import { CONFIG, TAX_TREATMENTS } from '../config.js';
import { loadAll, saveSettings, ensureCategory } from '../store.js';
import { taxSummary } from '../finance.js';
import { convertToBase } from '../rates.js';
import { el, fmtBase, toast, todayISO, openSheet, field, shortMonth, progress, isValidISODate } from '../util.js';
import { navigate } from '../router.js';

const refresh = () => navigate('/taxes');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export async function renderTaxes() {
  const data = await loadAll();
  const t = taxSummary({ tax: data.settings.tax, txs: data.txs, catById: data.catById, interestByMonth: data.sim.interestByMonth, todayYM: data.todayYM });

  const root = el('div', { class: 'view view-taxes' });
  root.append(el('div', { class: 'view-head' }, [
    el('h1', {}, 'Taxes'),
    el('button', { class: 'btn btn-sm', onClick: () => settingsSheet(data.settings.tax) }, 'Tax settings'),
  ]));

  // --- Headline -------------------------------------------------------------------
  root.append(el('div', { class: 'grid cards-3' }, [
    tile(`Estimated tax · ${t.year.label}`, fmtBase(t.estimated), 'neg', 'on income so far that wasn’t taxed at source'),
    tile('Paid so far', fmtBase(t.paid), 'pos'),
    tile(t.remaining >= 0 ? 'Still to pay' : 'Overpaid', fmtBase(Math.abs(t.remaining)), t.remaining > 0 ? 'neg' : 'pos'),
  ]));

  const plan = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', {}, 'Stay ahead of it'), el('span', { class: 'muted small' }, rateLabel(t.tax))]),
    el('div', { class: 'stat-grid' }, [
      mini('Full-year estimate', fmtBase(t.projectedYear), 'at your pace so far'),
      mini('Set aside each month', fmtBase(t.suggestedMonthly), 'to cover the rest of the year', 'pos'),
    ]),
  ]);
  if (t.projectedYear > 0) {
    plan.append(progress(t.paid / t.projectedYear), el('div', { class: 'budget-line small' }, [
      el('span', { class: 'muted' }, `${Math.round(Math.min(1, t.paid / t.projectedYear) * 100)}% of the year’s estimate paid`),
      el('span', { class: 'muted' }, fmtBase(t.projectedYear)),
    ]));
  }
  plan.append(el('div', { class: 'fund-actions' }, [
    el('button', { class: 'btn btn-primary btn-sm', onClick: paymentSheet }, 'Record a tax payment'),
  ]));
  root.append(plan);

  // --- Payment periods ------------------------------------------------------------------
  if (t.tax.frequency !== 'yearly') {
    root.append(el('div', { class: 'card' }, [
      el('h2', {}, t.tax.frequency === 'monthly' ? 'Month by month' : 'Quarter by quarter'),
      el('div', { class: 'ytable' }, [
        el('div', { class: 'yrow yhead' }, ['Period', 'Estimated', 'Paid', 'Status'].map((h) => el('span', {}, h))),
        ...t.periods.map((p) => {
          const due = p.estimated - p.paid;
          const status = p.status === 'future' ? 'upcoming' : !p.tracked ? 'before tracking' : due > 0.5 ? `${fmtBase(due)} due` : p.estimated > 0 ? 'covered ✓' : 'nothing owed';
          return el('div', { class: 'yrow' + (p.status === 'current' ? ' current' : '') }, [
            el('span', {}, p.start === p.end ? shortMonth(p.start) : `${shortMonth(p.start).split(' ')[0]}–${shortMonth(p.end)}`),
            el('span', {}, p.status === 'future' || !p.tracked ? '—' : fmtBase(p.estimated)),
            el('span', { class: p.paid ? 'pos' : 'muted' }, p.paid ? fmtBase(p.paid) : '—'),
            el('span', { class: p.status !== 'future' && due > 0.5 ? 'neg' : 'muted' }, status),
          ]);
        }),
      ]),
    ]));
  }

  // --- Income breakdown ------------------------------------------------------------------
  const label = Object.fromEntries(TAX_TREATMENTS.map((x) => [x.value, x.label]));
  const income = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', {}, 'Your income this tax year'), el('a', { class: 'link', href: '#/categories' }, 'Change')]),
  ]);
  if (!t.bySource.length) income.append(el('p', { class: 'muted' }, 'No income logged this tax year yet.'));
  for (const src of t.bySource) {
    income.append(el('div', { class: 'alloc-row' }, [
      el('div', { class: 'rec-main' }, [el('span', { class: 'rec-desc' }, src.name), el('span', { class: 'rec-meta' }, label[src.treatment] || '')]),
      el('span', { class: 'alloc-amt' }, fmtBase(src.amount)),
    ]));
  }
  income.append(el('div', { class: 'stat-grid' }, [
    mini('Tax taken out already', fmtBase(t.income.withheld)),
    mini('You owe tax on', fmtBase(t.income.owed), '', 'neg'),
  ]));
  root.append(income);

  // --- Deductions -------------------------------------------------------------------------------
  const ded = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', {}, 'Deductible expenses'), el('span', { class: 'alloc-amt' }, fmtBase(t.deductions))]),
  ]);
  if (!t.deductible.length) {
    ded.append(el('p', { class: 'muted small' }, 'Mark categories as deductible on the Budgets page (for example business costs or donations, if your country allows it) and they’ll be totaled here — and lower your estimate.'));
  }
  for (const d of t.deductible) {
    ded.append(el('div', { class: 'flow-row' }, [el('span', {}, d.name), el('span', {}, fmtBase(d.amount))]));
  }
  root.append(ded);

  root.append(el('p', { class: 'disclaimer' },
    'These are estimates to help you plan, not tax advice. Tax rules depend on where you live — check with your tax authority or a tax professional before filing.'));
  return root;
}

function tile(label, value, tone, sub) {
  return el('div', { class: 'card summary-card' }, [
    el('div', { class: 'summary-label' }, label),
    el('div', { class: 'summary-value ' + (tone || '') }, value),
    sub ? el('div', { class: 'muted small' }, sub) : null,
  ]);
}

function mini(label, value, sub, tone) {
  return el('div', { class: 'mini-stat' }, [
    el('span', { class: 'mini-value ' + (tone || '') }, value),
    el('span', { class: 'mini-label' }, sub ? `${label} · ${sub}` : label),
  ]);
}

function rateLabel(tax) {
  return tax.mode === 'brackets' ? 'using your tax brackets' : `using a ${tax.rate}% rate`;
}

function paymentSheet() {
  openSheet('Record a tax payment', (close) => {
    const amount = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal' });
    const currency = el('select', {}, CONFIG.CURRENCIES.map((c) => el('option', { value: c }, c)));
    const date = el('input', { type: 'date', value: todayISO(), max: todayISO() });
    const note = el('input', { type: 'text', placeholder: 'e.g. Q3 estimated payment' });
    const save = el('button', { class: 'btn btn-primary btn-block' }, 'Save');
    save.addEventListener('click', async () => {
      const amt = parseFloat(amount.value);
      if (!(amt > 0)) return toast('Enter an amount', 'error');
      if (!isValidISODate(date.value)) return toast('Pick a date', 'error');
      save.disabled = true;
      try {
        const cat = await ensureCategory('Taxes', 'tax');
        const { amount_usd, exchange_rate } = await convertToBase(amt, currency.value, date.value);
        await db.createTransaction({
          type: 'expense', date: date.value, amount: amt, currency: currency.value, amount_usd, exchange_rate,
          category_id: cat.id, description: note.value.trim() || 'Tax payment',
        });
        toast('Tax payment saved', 'success'); close(); refresh();
      } catch (err) { toast('Could not save: ' + err.message, 'error'); save.disabled = false; }
    });
    return el('div', { class: 'sheet-body' }, [
      el('div', { class: 'row-2' }, [field('Amount', amount), field('Currency', currency)]),
      field('Date', date), field('Note', note), save,
    ]);
  });
}

export function settingsSheet(tax, onDone = refresh) {
  openSheet('Tax settings', (close) => {
    const start = el('select', {}, MONTHS.map((m, i) => el('option', { value: i + 1, selected: Number(tax.year_start_month) === i + 1 ? 'selected' : null }, m)));
    const mode = el('select', {}, [
      el('option', { value: 'flat', selected: tax.mode !== 'brackets' ? 'selected' : null }, 'One rate (simple)'),
      el('option', { value: 'brackets', selected: tax.mode === 'brackets' ? 'selected' : null }, 'Tax brackets'),
    ]);
    const rate = el('input', { type: 'number', step: 'any', min: '0', max: '100', inputmode: 'decimal', value: tax.rate });
    const allowance = el('input', { type: 'number', step: 'any', min: '0', inputmode: 'decimal', value: tax.allowance || '', placeholder: '0' });
    const freq = el('select', {}, [['quarterly', 'Every quarter'], ['monthly', 'Every month'], ['yearly', 'Once a year']]
      .map(([v, l]) => el('option', { value: v, selected: tax.frequency === v ? 'selected' : null }, l)));
    const main = el('select', {}, TAX_TREATMENTS.map((x) => el('option', { value: x.value, selected: tax.main_income === x.value ? 'selected' : null }, x.label)));

    const brackets = (tax.brackets || []).map((b) => ({ ...b }));
    const bList = el('div', { class: 'bracket-list' });
    const drawB = () => bList.replaceChildren(
      ...brackets.map((b, i) => {
        const from = el('input', { type: 'number', min: '0', inputmode: 'decimal', value: b.from });
        const r = el('input', { type: 'number', min: '0', max: '100', step: 'any', inputmode: 'decimal', value: b.rate });
        from.addEventListener('input', () => { b.from = parseFloat(from.value) || 0; });
        r.addEventListener('input', () => { b.rate = parseFloat(r.value) || 0; });
        return el('div', { class: 'bracket-row' }, [
          el('span', { class: 'muted small' }, 'From'), from, el('span', { class: 'muted small' }, 'taxed at %'), r,
          el('button', { class: 'icon-btn', type: 'button', onClick: () => { brackets.splice(i, 1); drawB(); } }, '✕'),
        ]);
      }),
      el('button', { class: 'btn btn-sm', type: 'button', onClick: () => { brackets.push({ from: (brackets.at(-1)?.from || 0) + 10000, rate: (brackets.at(-1)?.rate || 10) + 10 }); drawB(); } }, '＋ Add bracket'),
    );
    drawB();
    const rateField = field('Tax rate on income you owe tax on (%)', rate, 'Tip: use your top rate (marginal rate) for side income.');
    const bField = el('div', { class: 'field' }, [el('label', {}, `Brackets (yearly income in ${CONFIG.BASE_CURRENCY})`), bList]);
    const sync = () => { rateField.style.display = mode.value === 'flat' ? '' : 'none'; bField.style.display = mode.value === 'brackets' ? '' : 'none'; };
    mode.addEventListener('change', sync); sync();

    const save = el('button', { class: 'btn btn-primary btn-block' }, 'Save');
    save.addEventListener('click', async () => {
      await saveSettings({ tax: {
        ...tax, year_start_month: Number(start.value), mode: mode.value, rate: parseFloat(rate.value) || 0,
        allowance: parseFloat(allowance.value) || 0, frequency: freq.value, main_income: main.value,
        brackets: brackets.filter((b) => b.rate >= 0).sort((a, b) => a.from - b.from),
      } });
      toast('Tax settings saved', 'success'); close(); onDone();
    });

    return el('div', { class: 'sheet-body' }, [
      el('div', { class: 'row-2' }, [field('Tax year starts in', start), field('I pay estimated tax', freq)]),
      field('My main paycheck', main, 'Most employers take tax out before you’re paid.'),
      field('How to estimate', mode),
      rateField, bField,
      field(`Tax-free allowance / standard deduction (${CONFIG.BASE_CURRENCY})`, allowance),
      save,
    ]);
  });
}
