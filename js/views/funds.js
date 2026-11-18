// =============================================================================
// funds.js — Savings funds / envelopes: emergency fund, giving, reserves,
// spending allowances. Balances = starting balance + plan allocations + money
// added − money spent from the fund + interest (see finance.simulateFunds).
// =============================================================================

import { db } from '../db.js';
import { CONFIG } from '../config.js';
import { loadAll, ensureCategory } from '../store.js';
import { convertToUSD } from '../rates.js';
import { el, fmtUSD, toast, todayISO, openSheet, field, sparkline, progress, isValidISODate } from '../util.js';
import { interestMode } from '../finance.js';
import { navigate } from '../router.js';

export const FUND_KINDS = [
  { value: 'savings', label: 'Savings', icon: '◆' },
  { value: 'giving', label: 'Giving', icon: '♥' },
  { value: 'reserve', label: 'Reserve', icon: '▣' },
  { value: 'spending', label: 'Spending money', icon: '◎' },
];
const kindMeta = (k) => FUND_KINDS.find((x) => x.value === k) || FUND_KINDS[0];
const INTEREST_LABEL = (f) => f.interestMode === 'auto' ? `earns ${f.fund.apy}% APY`
  : f.interestMode === 'manual' ? 'interest logged by you' : 'no interest (cash)';
export const INTEREST_MODES = [
  { value: 'auto', label: 'In an account that pays interest — estimate it for me' },
  { value: 'manual', label: 'In an account that pays interest — I’ll enter what I get' },
  { value: 'none', label: 'Cash / checking — earns no interest' },
];
const refresh = () => navigate('/funds');

export async function renderFunds() {
  const data = await loadAll();
  const { sim } = data;

  const root = el('div', { class: 'view view-funds' });
  root.append(el('div', { class: 'view-head' }, [
    el('h1', {}, 'Funds'),
    el('button', { class: 'btn btn-primary btn-sm', onClick: () => fundSheet(null) }, '＋ New fund'),
  ]));

  root.append(el('div', { class: 'grid cards-3' }, [
    tile('Total in funds', fmtUSD(sim.total)),
    tile('Interest earned so far', fmtUSD(sim.interestToDate), 'pos'),
    tile('Interest this month (est.)', fmtUSD(sim.funds.reduce((a, f) => a + f.interestThisMonth, 0)), 'pos'),
  ]));

  if (!sim.funds.length) {
    root.append(el('div', { class: 'card empty' }, [
      el('p', {}, 'Funds are pots of money for a purpose — an emergency fund, giving, a business reserve, a vacation.'),
      el('p', { class: 'muted small' }, 'Your money plan fills them automatically each month.'),
      el('button', { class: 'btn btn-primary btn-sm', onClick: () => fundSheet(null) }, 'Create your first fund'),
    ]));
    return root;
  }

  const grid = el('div', { class: 'fund-grid' });
  for (const f of sim.funds) grid.append(fundCard(f, data));
  root.append(grid);
  return root;
}

function tile(label, value, tone) {
  return el('div', { class: 'card summary-card' }, [
    el('div', { class: 'summary-label' }, label),
    el('div', { class: 'summary-value ' + (tone || '') }, value),
  ]);
}

function fundCard(f, data) {
  const meta = kindMeta(f.fund.kind);
  const tm = f.thisMonth;
  const isGiving = f.fund.kind === 'giving';
  const spentLabel = isGiving ? 'given' : 'spent';

  const card = el('div', { class: 'card fund-card kind-' + (f.fund.kind || 'savings') }, [
    el('div', { class: 'fund-top' }, [
      el('span', { class: 'fund-icon' }, meta.icon),
      el('div', { class: 'rec-main' }, [
        el('span', { class: 'rec-desc' }, f.fund.name),
        el('span', { class: 'rec-meta' }, [meta.label, ' · ', INTEREST_LABEL(f)].join('')),
      ]),
      el('button', { class: 'icon-btn', title: 'Edit fund', onClick: () => fundSheet(f.fund) }, '✎'),
    ]),
    el('div', { class: 'fund-balance ' + (f.balance < 0 ? 'neg' : '') }, fmtUSD(f.balance)),
  ]);

  if (f.goal > 0) {
    card.append(
      progress(f.pctOfGoal),
      el('div', { class: 'budget-line small' }, [
        el('span', { class: 'muted' }, `${Math.round(f.pctOfGoal * 100)}% of ${fmtUSD(f.goal)} goal`),
        el('span', { class: 'muted' }, f.leftToGoal > 0 ? `${fmtUSD(f.leftToGoal)} to go` : 'Goal reached ✓'),
      ]),
    );
  }

  const hist = f.history.slice(-12).map((h) => h.end);
  // Only draw the trend when the balance actually moved.
  if (hist.length > 1 && Math.max(...hist) - Math.min(...hist) > 0.005) card.append(sparkline(hist, { width: 260, height: 36 }));

  if (tm && (tm.alloc + tm.added > 0 || tm.spent > 0)) {
    card.append(el('div', { class: 'fund-month' }, [
      chip('+' + fmtUSD(tm.alloc + tm.added), 'from plan & deposits this month', 'pos'),
      chip('−' + fmtUSD(tm.spent), `${spentLabel} this month`, tm.spent ? 'neg' : 'muted'),
    ]));
  }

  if (f.totals.interest > 0) {
    card.append(el('div', { class: 'muted small fund-interest' }, `${fmtUSD(f.totals.interest)} interest earned so far`));
  }
  card.append(el('div', { class: 'fund-actions' }, [
    f.interestMode === 'manual' ? el('button', { class: 'btn btn-sm', onClick: () => moneySheet(f.fund, 'interest', data) }, 'Record interest') : null,
    el('button', { class: 'btn btn-sm', onClick: () => moneySheet(f.fund, 'in', data) }, 'Add money'),
    el('button', { class: 'btn btn-sm', onClick: () => moneySheet(f.fund, 'out', data) }, isGiving ? 'Record a gift' : 'Spend from it'),
  ]));
  return card;
}

function chip(value, label, tone) {
  return el('div', { class: 'mini-stat' }, [
    el('span', { class: 'mini-value ' + (tone || '') }, value),
    el('span', { class: 'mini-label' }, label),
  ]);
}

// Create / edit a fund.
export function fundSheet(fund, onDone = refresh) {
  openSheet(fund ? `Edit ${fund.name}` : 'New fund', (close) => {
    const name = el('input', { type: 'text', value: fund?.name || '', placeholder: 'e.g. Emergency Fund' });
    const kind = el('select', {}, FUND_KINDS.map((k) => el('option', { value: k.value, selected: (fund?.kind || 'savings') === k.value ? 'selected' : null }, k.label)));
    const start = el('input', { type: 'number', step: '0.01', inputmode: 'decimal', value: fund?.starting_balance ?? '', placeholder: '0.00' });
    const goal = el('input', { type: 'number', step: '1', min: '0', inputmode: 'decimal', value: fund?.goal_usd || '', placeholder: 'optional' });
    const apy = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: fund?.apy || '', placeholder: 'e.g. 4.5' });
    const defaultMode = fund ? interestMode(fund) : 'none';
    const mode = el('select', {}, INTEREST_MODES.map((m) => el('option', { value: m.value, selected: m.value === defaultMode ? 'selected' : null }, m.label)));
    const apyField = field('Interest rate (APY %)', apy);
    const syncMode = () => { apyField.style.display = mode.value === 'auto' ? '' : 'none'; };
    mode.addEventListener('change', syncMode);
    syncMode();
    const save = el('button', { class: 'btn btn-primary btn-block' }, fund ? 'Save' : 'Create fund');

    save.addEventListener('click', async () => {
      const row = {
        name: name.value.trim(), kind: kind.value,
        starting_balance: parseFloat(start.value) || 0,
        goal_usd: parseFloat(goal.value) || 0,
        apy: mode.value === 'auto' ? parseFloat(apy.value) || 0 : 0,
        interest_mode: mode.value,
      };
      if (row.interest_mode === 'auto' && !(row.apy > 0)) return toast('Enter the interest rate, or pick another option', 'error');
      if (!row.name) return toast('Give the fund a name', 'error');
      save.disabled = true;
      try {
        if (fund) await db.update('funds', fund.id, row); else await db.create('funds', row);
        toast(fund ? 'Fund saved' : 'Fund created', 'success');
        close(); onDone();
      } catch (err) { toast('Could not save: ' + err.message, 'error'); save.disabled = false; }
    });

    const body = el('div', { class: 'sheet-body' }, [
      field('Name', name),
      field('Type', kind),
      field('Where is this money kept?', mode, 'Money you hold as cash earns nothing, so it isn’t given interest.'),
      apyField,
      el('div', { class: 'row-2' }, [
        field(`Current balance (${CONFIG.BASE_CURRENCY})`, start, 'What’s already in it today'),
        field(`Goal (${CONFIG.BASE_CURRENCY})`, goal),
      ]),
      save,
    ]);
    if (fund) {
      body.append(el('button', { class: 'btn btn-ghost btn-block danger', onClick: async () => {
        if (!confirm(`Delete "${fund.name}"? Its plan rules stop; past transactions are kept.`)) return;
        await db.remove('funds', fund.id);
        toast('Fund deleted', 'info'); close(); onDone();
      } }, 'Delete fund'));
    }
    return body;
  });
}

// Move money into a fund (transfer) or spend from it (expense paid from fund).
function moneySheet(fund, dir, data) {
  const isGiving = fund.kind === 'giving';
  const title = dir === 'interest' ? `Interest earned — ${fund.name}` : dir === 'in' ? `Add money to ${fund.name}` : isGiving ? `Record a gift from ${fund.name}` : `Spend from ${fund.name}`;
  openSheet(title, (close) => {
    const amount = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: '0.00' });
    const currency = el('select', {}, CONFIG.CURRENCIES.map((c) => el('option', { value: c }, c)));
    const date = el('input', { type: 'date', value: todayISO(), max: todayISO() });
    const desc = el('input', { type: 'text', placeholder: dir === 'in' ? 'e.g. Extra savings' : isGiving ? 'e.g. Church, Red Cross' : 'What was it for?' });
    const expenseCats = data.categories.filter((c) => data.catById.get(c.id)?.kind !== 'income');
    const cat = el('select', {}, expenseCats.map((c) => el('option', {
      value: c.id, selected: isGiving && c.name === 'Giving' ? 'selected' : null,
    }, c.name)));
    const save = el('button', { class: 'btn btn-primary btn-block' }, dir === 'in' ? 'Add money' : dir === 'interest' ? 'Record interest' : 'Save');

    save.addEventListener('click', async () => {
      const amt = parseFloat(amount.value);
      if (!(amt > 0)) return toast('Enter an amount', 'error');
      if (!isValidISODate(date.value)) return toast('Pick a date', 'error');
      save.disabled = true;
      try {
        const { amount_usd, exchange_rate } = await convertToUSD(amt, currency.value, date.value);
        let category_id = dir === 'out' ? cat.value : null;
        if (dir === 'out' && isGiving && !category_id) category_id = (await ensureCategory('Giving', 'soft')).id;
        if (dir === 'interest') category_id = (await ensureCategory('Interest', 'income')).id;
        await db.createTransaction({
          type: dir === 'in' ? 'transfer' : dir === 'interest' ? 'income' : 'expense',
          ...(dir === 'interest' ? { subtype: 'interest' } : {}),
          date: date.value, amount: amt, currency: currency.value, amount_usd, exchange_rate,
          category_id, fund_id: fund.id,
          description: desc.value.trim() || (dir === 'in' ? `Added to ${fund.name}` : dir === 'interest' ? `Interest — ${fund.name}` : ''),
        });
        toast('Saved', 'success'); close(); refresh();
      } catch (err) { toast('Could not save: ' + err.message, 'error'); save.disabled = false; }
    });

    return el('div', { class: 'sheet-body' }, [
      el('div', { class: 'row-2' }, [field('Amount', amount), field('Currency', currency)]),
      dir === 'out' ? field('Category', cat) : null,
      field('Date', date),
      field('Note', desc),
      el('p', { class: 'muted small' }, dir === 'interest'
        ? 'Interest your bank paid on this fund. It’s added to the balance and counted as taxable interest.'
        : dir === 'in'
        ? 'Moves money you already have into this fund — it isn’t counted as income.'
        : 'Paid from money already set aside, so it won’t count against this month’s plan.'),
      save,
    ]);
  });
}
