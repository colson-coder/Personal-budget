// =============================================================================
// setup.js — First-run setup wizard. Asks a few plain questions and builds the
// user's own configuration: home currency, timezone, which features to show,
// their money plan (funds + rules), and optional first debt / income stream.
// Everything can be changed later in Settings; nothing is hard-coded to one
// person's situation.
// =============================================================================

import { db } from '../db.js';
import { CONFIG, SUPPORTED_CURRENCIES } from '../config.js';
import { saveSettings } from '../store.js';
import { STREAM_KINDS } from './income.js';
import { el, toast, todayISO, field } from '../util.js';
import { DEFAULT_TAX } from '../finance.js';

const CURRENCY_NAMES = {
  USD: 'US dollar', EUR: 'Euro', GBP: 'British pound', CRC: 'Costa Rican colón',
  MXN: 'Mexican peso', CAD: 'Canadian dollar', AUD: 'Australian dollar', JPY: 'Japanese yen',
  CHF: 'Swiss franc', COP: 'Colombian peso', BRL: 'Brazilian real', INR: 'Indian rupee',
};

// Suggest a home currency from the device locale's region (user can change it).
const REGION_CURRENCY = {
  US: 'USD', GB: 'GBP', CR: 'CRC', MX: 'MXN', CA: 'CAD', AU: 'AUD', JP: 'JPY', CH: 'CHF',
  CO: 'COP', BR: 'BRL', IN: 'INR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR',
  IE: 'EUR', PT: 'EUR', AT: 'EUR', BE: 'EUR', FI: 'EUR', GR: 'EUR',
};
function guessCurrency() {
  for (const tag of navigator.languages || [navigator.language || '']) {
    let region = '';
    try { region = new Intl.Locale(tag).maximize().region || ''; } catch { /* ignore */ }
    if (REGION_CURRENCY[region]) return REGION_CURRENCY[region];
  }
  return 'USD';
}

function timezones() {
  let list = [];
  try { list = Intl.supportedValuesOf('timeZone'); } catch { /* old browsers */ }
  // Some devices report a zone (e.g. "UTC") that isn't in the list — keep it.
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return list.includes(device) ? list : [device, ...list];
}

export function renderSetup(onDone) {
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const state = {
    name: '',
    base: guessCurrency(),
    currencies: null, // set below to include the guessed base
    timezone: deviceTz,
    modules: { plan: true, debts: false, income: false, taxes: false },
    tax: { main_income: 'withheld', rate: 15, set_aside: 0, year_start_month: 1 },
    keepPct: 10,     // pay yourself first: % of ALL income into Savings
    givingPct: 0,
    emergencyGoal: 1000,
    emergencyPct: 25,
    emergencyAfterPct: 10,
    setAsides: [], // { name, amount, kind }
    savingsBalance: '',
    apy: '',
    debt: { name: '', principal: '', apr: '', payment: '' },
    stream: { name: '', kind: 'dividends', expected: '' },
  };

  state.currencies = new Set([state.base]);
  const root = el('div', { class: 'setup-wrap' });
  let step = 0;

  const steps = () => [
    stepWelcome,
    stepFeatures,
    ...(state.modules.plan ? [stepPlan] : []),
    ...(state.modules.debts ? [stepDebt] : []),
    ...(state.modules.income ? [stepIncome] : []),
    ...(state.modules.taxes ? [stepTaxes] : []),
    stepDone,
  ];

  function draw() {
    const list = steps();
    step = Math.min(step, list.length - 1);
    const body = list[step]();
    const isLast = step === list.length - 1;
    root.replaceChildren(el('div', { class: 'setup-card card' }, [
      el('div', { class: 'setup-progress' }, list.map((_, i) =>
        el('span', { class: 'dot' + (i <= step ? ' on' : '') }))),
      body,
      el('div', { class: 'setup-nav' }, [
        step > 0 ? el('button', { class: 'btn btn-ghost', onClick: () => { step--; draw(); } }, 'Back') : el('span'),
        isLast
          ? el('button', { class: 'btn btn-primary', onClick: finish }, 'Start tracking')
          : el('button', { class: 'btn btn-primary', onClick: () => { step++; draw(); } }, 'Continue'),
      ]),
      step === 0 ? el('button', { class: 'link-btn', onClick: skip }, 'Skip setup — I’ll configure it later') : null,
    ]));
    root.querySelector('input, select')?.focus({ preventScroll: true });
  }

  // --- Step 1: about you ---------------------------------------------------------
  function stepWelcome() {
    const name = el('input', { type: 'text', value: state.name, placeholder: 'optional' });
    name.addEventListener('input', () => { state.name = name.value; });

    const base = el('select', {}, SUPPORTED_CURRENCIES.map((c) =>
      el('option', { value: c, selected: c === state.base ? 'selected' : null }, `${c} — ${CURRENCY_NAMES[c] || c}`)));
    base.addEventListener('change', () => { state.base = base.value; state.currencies.add(base.value); draw(); });

    const chips = el('div', { class: 'chips' }, SUPPORTED_CURRENCIES.map((c) => {
      const on = state.currencies.has(c);
      return el('button', {
        class: 'chip' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false',
        disabled: c === state.base ? 'disabled' : null,
        onClick: () => { on ? state.currencies.delete(c) : state.currencies.add(c); draw(); },
      }, c);
    }));

    const tz = el('select', {}, timezones().map((z) =>
      el('option', { value: z, selected: z === state.timezone ? 'selected' : null }, z.replace(/_/g, ' '))));
    tz.addEventListener('change', () => { state.timezone = tz.value; });

    return el('div', { class: 'setup-step' }, [
      el('h1', {}, `Welcome to ${CONFIG.APP_NAME}`),
      el('p', { class: 'muted' }, 'A few quick questions so the app fits how you handle money. You can change everything later.'),
      field('What should we call you?', name),
      field('Home currency', base, 'All totals, budgets and reports are shown in this currency.'),
      el('div', { class: 'field' }, [el('label', {}, 'Other currencies you spend or earn in'), chips]),
      field('Your timezone', tz, 'Decides when a new month starts for you.'),
    ]);
  }

  // --- Step 2: what to track ---------------------------------------------------------
  function stepFeatures() {
    const opt = (key, title, desc, icon) => {
      const on = state.modules[key];
      return el('button', {
        class: 'feature-card' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false',
        onClick: () => { state.modules[key] = !on; draw(); },
      }, [
        el('span', { class: 'feature-icon' }, icon),
        el('span', { class: 'feature-text' }, [el('strong', {}, title), el('span', { class: 'muted small' }, desc)]),
        el('span', { class: 'feature-check' }, on ? '✓' : ''),
      ]);
    };
    return el('div', { class: 'setup-step' }, [
      el('h1', {}, 'What do you want to track?'),
      el('p', { class: 'muted' }, 'Spending, budgets and reports are always included. Turn on what applies to you.'),
      el('div', { class: 'feature-list' }, [
        opt('plan', 'Savings & money plan', 'Split each month’s income into funds: emergency, giving, reserves, goals.', '◆'),
        opt('debts', 'Debts & loans', 'Mortgage, car, student loan, cards — balance, interest, payoff date.', '⌂'),
        opt('income', 'Passive income', 'Dividends, interest, a side business — money beyond your paycheck.', '✦'),
        opt('taxes', 'Taxes', 'See what you’ll owe and how much to set aside — great for side income.', '§'),
      ]),
    ]);
  }

  // --- Step 3: money plan ---------------------------------------------------------------
  function stepPlan() {
    const num = (key, attrs = {}) => {
      const i = el('input', { type: 'number', inputmode: 'decimal', step: 'any', min: '0', value: state[key], ...attrs });
      i.addEventListener('input', () => { state[key] = i.value; });
      return i;
    };
    const rows = el('div', { class: 'setaside-list' });
    const drawRows = () => {
      rows.replaceChildren(...state.setAsides.map((r, idx) => {
        const n = el('input', { type: 'text', value: r.name, placeholder: 'e.g. Fun money' });
        const a = el('input', { type: 'number', inputmode: 'decimal', min: '0', value: r.amount, placeholder: 'Amount' });
        n.addEventListener('input', () => { r.name = n.value; });
        a.addEventListener('input', () => { r.amount = a.value; });
        return el('div', { class: 'setaside-row' }, [n, a,
          el('button', { class: 'icon-btn', type: 'button', title: 'Remove', onClick: () => { state.setAsides.splice(idx, 1); drawRows(); } }, '✕')]);
      }));
    };
    drawRows();

    return el('div', { class: 'setup-step' }, [
      el('h1', {}, 'Your money plan'),
      el('p', { class: 'muted' }, 'Each month your money gets split like this, automatically. Leave anything at 0 to skip it.'),
      el('div', { class: 'plan-group plan-group-first' }, [
        el('div', { class: 'plan-group-title' }, 'Pay yourself first'),
        el('p', { class: 'muted small' }, '“A part of all you earn is yours to keep.” This share goes to Savings the moment you’re paid, before bills or spending. 10% is the classic rule.'),
        el('div', { class: 'row-2' }, [
          field('Keep (% of income)', num('keepPct', { max: '100' })),
          field(`Already saved (${state.base})`, num('savingsBalance', { placeholder: '0' })),
        ]),
      ]),
      field('Give away (% of what’s left)', num('givingPct', { max: '100' }), 'Charity, church, causes. Counted after bills and spending.'),
      el('div', { class: 'plan-group' }, [
        el('div', { class: 'plan-group-title' }, 'Emergency fund'),
        el('div', { class: 'row-3' }, [
          field('Goal', num('emergencyGoal')),
          field('% of leftover', num('emergencyPct', { max: '100' })),
          field('% after goal', num('emergencyAfterPct', { max: '100' })),
        ]),
      ]),
      el('div', { class: 'plan-group' }, [
        el('div', { class: 'plan-group-title' }, 'Fixed amounts each month'),
        el('p', { class: 'muted small' }, 'e.g. a business reserve, fun money, a vacation fund.'),
        rows,
        el('button', { class: 'btn btn-sm', type: 'button', onClick: () => { state.setAsides.push({ name: '', amount: '' }); drawRows(); } }, '＋ Add a fixed amount'),
      ]),
      field('Interest your savings account pays (APY %)', num('apy', { placeholder: '0' }),
        'Only funds kept in that account earn it. Giving and spending money you hold as cash won’t.'),
    ]);
  }

  // --- Step 4: first debt ----------------------------------------------------------------
  function stepDebt() {
    const bind = (key, attrs) => {
      const i = el('input', { value: state.debt[key], ...attrs });
      i.addEventListener('input', () => { state.debt[key] = i.value; });
      return i;
    };
    return el('div', { class: 'setup-step' }, [
      el('h1', {}, 'Add your main debt'),
      el('p', { class: 'muted' }, 'Optional — you can add more (or skip this) and do it later.'),
      field('Name', bind('name', { type: 'text', placeholder: 'e.g. Mortgage, Car loan' })),
      field(`Current balance (${state.base})`, bind('principal', { type: 'number', inputmode: 'decimal', min: '0' })),
      el('div', { class: 'row-2' }, [
        field('Interest rate (APR %)', bind('apr', { type: 'number', inputmode: 'decimal', min: '0', step: 'any' })),
        field('Monthly payment', bind('payment', { type: 'number', inputmode: 'decimal', min: '0' })),
      ]),
    ]);
  }

  // --- Step 5: first income stream --------------------------------------------------------
  function stepIncome() {
    const name = el('input', { type: 'text', value: state.stream.name, placeholder: 'e.g. Dividends, Etsy shop' });
    name.addEventListener('input', () => { state.stream.name = name.value; });
    const kind = el('select', {}, STREAM_KINDS.map((k) => el('option', { value: k.value, selected: k.value === state.stream.kind ? 'selected' : null }, k.label)));
    kind.addEventListener('change', () => { state.stream.kind = kind.value; });
    const exp = el('input', { type: 'number', inputmode: 'decimal', min: '0', value: state.stream.expected, placeholder: 'optional' });
    exp.addEventListener('input', () => { state.stream.expected = exp.value; });
    return el('div', { class: 'setup-step' }, [
      el('h1', {}, 'Add a passive income stream'),
      el('p', { class: 'muted' }, 'Optional — add more later.'),
      field('Name', name),
      el('div', { class: 'row-2' }, [field('Type', kind), field(`Expected per month (${state.base})`, exp)]),
    ]);
  }

  // --- Step 6: taxes -------------------------------------------------------------------------
  function stepTaxes() {
    const main = el('select', {}, [
      ['withheld', 'Taken out by my employer'], ['owed', 'I pay it myself (self-employed)'], ['none', 'My income isn’t taxed'],
    ].map(([v, l]) => el('option', { value: v, selected: state.tax.main_income === v ? 'selected' : null }, l)));
    main.addEventListener('change', () => { state.tax.main_income = main.value; });
    const rate = el('input', { type: 'number', inputmode: 'decimal', min: '0', max: '100', step: 'any', value: state.tax.rate });
    rate.addEventListener('input', () => { state.tax.rate = rate.value; });
    const aside = el('input', { type: 'number', inputmode: 'decimal', min: '0', max: '100', step: 'any', value: state.tax.set_aside || '', placeholder: '0' });
    aside.addEventListener('input', () => { state.tax.set_aside = aside.value; });
    const start = el('select', {}, ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      .map((m, i) => el('option', { value: i + 1, selected: state.tax.year_start_month === i + 1 ? 'selected' : null }, m)));
    start.addEventListener('change', () => { state.tax.year_start_month = Number(start.value); });
    return el('div', { class: 'setup-step' }, [
      el('h1', {}, 'Taxes'),
      el('p', { class: 'muted' }, 'We’ll estimate tax on income that isn’t taxed before you get it — side jobs, interest, dividends. You can fine-tune brackets later.'),
      field('Tax on my main paycheck is…', main),
      el('div', { class: 'row-2' }, [
        field('Your tax rate (%)', rate, 'Your top rate is a safe guess'),
        field('Tax year starts', start),
      ]),
      state.modules.plan ? field('Set aside for taxes (% of income)', aside, 'Moves this share of every paycheck into a Tax reserve fund. Freelancers often use 25–30%.') : null,
      el('p', { class: 'muted small' }, 'Estimates only — not tax advice.'),
    ]);
  }

  // --- Done ---------------------------------------------------------------------------------
  function stepDone() {
    const items = [`Home currency: ${state.base}`, `Timezone: ${state.timezone.replace(/_/g, ' ')}`];
    if (state.modules.plan) {
      if (Number(state.keepPct) > 0) items.push(`${state.keepPct}% of all income to Savings, before anything else`);
      if (Number(state.givingPct) > 0) items.push(`${state.givingPct}% of what’s left to Giving`);
      for (const r of state.setAsides.filter((r) => r.name && Number(r.amount) > 0)) items.push(`${r.amount} ${state.base}/month to ${r.name}`);
      if (Number(state.emergencyGoal) > 0 && Number(state.emergencyPct) > 0) items.push(`${state.emergencyPct}% of what’s left to an Emergency Fund until ${state.emergencyGoal} ${state.base}`);
    }
    if (state.modules.debts && state.debt.name) items.push(`Tracking ${state.debt.name}`);
    if (state.modules.taxes) items.push(`Tax estimate at ${state.tax.rate}%${Number(state.tax.set_aside) > 0 && state.modules.plan ? `, ${state.tax.set_aside}% of income set aside` : ''}`);
    if (state.modules.income && state.stream.name) items.push(`Tracking ${state.stream.name}`);
    return el('div', { class: 'setup-step' }, [
      el('h1', {}, state.name ? `You’re all set, ${state.name}` : 'You’re all set'),
      el('p', { class: 'muted' }, 'Here’s what we’ll set up:'),
      el('ul', { class: 'setup-summary' }, items.map((t) => el('li', {}, t))),
      el('p', { class: 'muted small' }, 'Next: add a transaction or import a CSV from your bank.'),
    ]);
  }

  async function skip() {
    await saveSettings({ setup_done: true, base_currency: state.base, timezone: state.timezone, currencies: [...state.currencies] });
    onDone();
  }

  async function finish(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Setting up…';
    try {
      // Apply currency/timezone first so created rows use them.
      await saveSettings({
        name: state.name.trim(), base_currency: state.base, timezone: state.timezone,
        currencies: [...state.currencies], modules: state.modules,
        ...(state.modules.taxes ? { tax: {
          ...DEFAULT_TAX, main_income: state.tax.main_income,
          rate: parseFloat(state.tax.rate) || 0, year_start_month: state.tax.year_start_month,
        } } : {}),
      });

      const rules = [];
      const apy = parseFloat(state.apy) || 0;
      if (state.modules.plan) {
        if (state.modules.taxes && Number(state.tax.set_aside) > 0) {
          const f = await db.create('funds', { name: 'Tax reserve', kind: 'reserve', starting_balance: 0, goal_usd: 0, apy, interest_mode: apy > 0 ? 'auto' : 'none' });
          rules.push({ id: crypto.randomUUID(), fund_id: f.id, method: 'percent_income', value: Number(state.tax.set_aside) });
        }
        if (Number(state.givingPct) > 0) {
          const f = await db.create('funds', { name: 'Giving', kind: 'giving', starting_balance: 0, goal_usd: 0, apy: 0, interest_mode: 'none' });
          rules.push({ id: crypto.randomUUID(), fund_id: f.id, method: 'percent_net', value: Number(state.givingPct) });
        }
        for (const r of state.setAsides) {
          if (!r.name.trim() || !(Number(r.amount) > 0)) continue;
          const spending = /spend|fun|allowance|personal/i.test(r.name);
          const f = await db.create('funds', { name: r.name.trim(), kind: spending ? 'spending' : 'reserve', starting_balance: 0, goal_usd: 0, apy: spending ? 0 : apy, interest_mode: !spending && apy > 0 ? 'auto' : 'none' });
          rules.push({ id: crypto.randomUUID(), fund_id: f.id, method: 'fixed', value: Number(r.amount) });
        }
        if (Number(state.emergencyGoal) > 0 && Number(state.emergencyPct) > 0) {
          const f = await db.create('funds', { name: 'Emergency Fund', kind: 'savings', starting_balance: 0, goal_usd: Number(state.emergencyGoal), apy, interest_mode: apy > 0 ? 'auto' : 'none' });
          rules.push({
            id: crypto.randomUUID(), fund_id: f.id, method: 'percent_remainder',
            value: Number(state.emergencyPct), value_after_goal: Number(state.emergencyAfterPct) || 0,
          });
        }
        if (Number(state.keepPct) > 0 || Number(state.savingsBalance) > 0) {
          const f = await db.create('funds', { name: 'Savings', kind: 'savings', starting_balance: Number(state.savingsBalance) || 0, goal_usd: 0, apy, interest_mode: apy > 0 ? 'auto' : 'none' });
          if (Number(state.keepPct) > 0) rules.unshift({ id: crypto.randomUUID(), fund_id: f.id, method: 'percent_income', value: Number(state.keepPct) });
        }
      }
      if (state.modules.debts && state.debt.name.trim() && Number(state.debt.principal) > 0) {
        await db.create('debts', {
          name: state.debt.name.trim(), principal: Number(state.debt.principal),
          apr: Number(state.debt.apr) || 0, payment: Number(state.debt.payment) || 0,
          start_month: todayISO().slice(0, 7),
        });
      }
      if (state.modules.income && state.stream.name.trim()) {
        await db.create('income_streams', {
          name: state.stream.name.trim(), kind: state.stream.kind,
          expected_monthly: Number(state.stream.expected) || 0,
          start_month: todayISO().slice(0, 7),
        });
      }
      await saveSettings({ setup_done: true, plan: { start_month: todayISO().slice(0, 7), rules } });
      toast('You’re set up!', 'success');
      onDone();
    } catch (err) {
      console.error(err);
      toast('Setup failed: ' + (err.message || err), 'error');
      btn.disabled = false;
      btn.textContent = 'Start tracking';
    }
  }

  draw();
  return root;
}
