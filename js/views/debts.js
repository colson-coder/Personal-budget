// =============================================================================
// debts.js — Loans, mortgages, cards. Each debt has a monthly amortization
// ledger driven by logged payments, payoff projection, and an "extra payment"
// what-if. Payments are ordinary expense transactions linked by debt_id.
// =============================================================================

import { db } from '../db.js';
import { CONFIG } from '../config.js';
import { loadAll, ensureCategory } from '../store.js';
import { debtLedger, projectDebt, addMonths } from '../finance.js';
import { convertToUSD } from '../rates.js';
import {
  el, fmtUSD, toast, todayISO, openSheet, field, progress, shortMonth, fmtMonths, isValidISODate,
} from '../util.js';
import { navigate } from '../router.js';

const refresh = () => navigate('/debts');

export async function renderDebts() {
  const data = await loadAll();
  const { debts, txs, todayYM } = data;

  const root = el('div', { class: 'view view-debts' });
  root.append(el('div', { class: 'view-head' }, [
    el('h1', {}, 'Debts'),
    el('button', { class: 'btn btn-primary btn-sm', onClick: () => debtSheet(null) }, '＋ Add debt'),
  ]));

  if (!debts.length) {
    root.append(el('div', { class: 'card empty' }, [
      el('p', {}, 'Track a mortgage, car loan, student loan or credit card — see the balance fall, interest paid, and your payoff date.'),
      el('button', { class: 'btn btn-primary btn-sm', onClick: () => debtSheet(null) }, 'Add a debt'),
    ]));
    return root;
  }

  const ledgers = debts.map((d) => ({ debt: d, l: debtLedger(d, txs, todayYM) }));
  const totalBal = ledgers.reduce((a, x) => a + x.l.balance, 0);
  const totalInt = ledgers.reduce((a, x) => a + x.l.monthlyInterestNow, 0);
  root.append(el('div', { class: 'grid cards-3' }, [
    tile('Total owed', fmtUSD(totalBal), 'neg'),
    tile('Interest per month', fmtUSD(totalInt), 'neg'),
    tile('Paid so far', fmtUSD(ledgers.reduce((a, x) => a + x.l.totalPaid, 0)), 'pos'),
  ]));

  for (const { debt, l } of ledgers) root.append(debtCard(debt, l, todayYM));
  return root;
}

function tile(label, value, tone) {
  return el('div', { class: 'card summary-card' }, [
    el('div', { class: 'summary-label' }, label),
    el('div', { class: 'summary-value ' + (tone || '') }, value),
  ]);
}

function stat(label, value, tone) {
  return el('div', { class: 'mini-stat' }, [
    el('span', { class: 'mini-value ' + (tone || '') }, value),
    el('span', { class: 'mini-label' }, label),
  ]);
}

function debtCard(debt, l, todayYM) {
  const card = el('div', { class: 'card debt-card' }, [
    el('div', { class: 'fund-top' }, [
      el('span', { class: 'fund-icon debt-icon' }, '⌂'),
      el('div', { class: 'rec-main' }, [
        el('span', { class: 'rec-desc' }, debt.name),
        el('span', { class: 'rec-meta' }, `${debt.apr}% APR · ${fmtUSD(debt.payment)}/mo planned`),
      ]),
      el('button', { class: 'icon-btn', title: 'Edit', onClick: () => debtSheet(debt) }, '✎'),
    ]),
    el('div', { class: 'debt-balance-line' }, [
      el('span', { class: 'fund-balance' }, fmtUSD(l.balance)),
      el('span', { class: 'muted small' }, `of ${fmtUSD(debt.principal)}`),
    ]),
    progress(l.pctPaid),
    el('div', { class: 'budget-line small' }, [
      el('span', { class: 'muted' }, `${(l.pctPaid * 100).toFixed(1)}% paid off`),
      el('span', { class: 'muted' }, l.payoffYM ? `Debt-free ${shortMonth(l.payoffYM)}` : ''),
    ]),
    el('div', { class: 'stat-grid' }, [
      stat('Total paid', fmtUSD(l.totalPaid)),
      stat('Interest paid', fmtUSD(l.interestPaid), 'neg'),
      stat('Principal paid', fmtUSD(l.principalPaid), 'pos'),
      stat('Time left', fmtMonths(l.monthsLeft)),
    ]),
  ]);

  // Warn when payments don't keep up with interest (balance is growing).
  if (l.monthlyInterestNow > 0 && (Number(debt.payment) || 0) <= l.monthlyInterestNow) {
    card.append(el('p', { class: 'callout warn' },
      `Your planned ${fmtUSD(debt.payment)}/mo doesn’t cover the ${fmtUSD(l.monthlyInterestNow)} of interest added each month, so the balance grows.`));
  }
  const last = l.rows[l.rows.length - 1];
  if (last && last.paid === 0 && last.ym === todayYM) {
    card.append(el('p', { class: 'muted small' }, `No payment logged in ${shortMonth(todayYM)} yet — ${fmtUSD(last.interest)} of interest was added.`));
  }

  card.append(whatIf(debt, l));

  card.append(el('div', { class: 'fund-actions' }, [
    el('button', { class: 'btn btn-primary btn-sm', onClick: () => paymentSheet(debt) }, 'Log a payment'),
  ]));

  // Full ledger (spreadsheet-style), collapsed by default.
  const details = el('details', { class: 'ledger' }, [
    el('summary', {}, `Payment history (${l.rows.length} month${l.rows.length === 1 ? '' : 's'})`),
    el('div', { class: 'ytable ledger-table' }, [
      el('div', { class: 'yrow yhead' }, ['Month', 'Interest', 'Paid', 'Balance'].map((h) => el('span', {}, h))),
      ...l.rows.slice().reverse().map((r) => el('div', { class: 'yrow' }, [
        el('span', {}, shortMonth(r.ym)),
        el('span', { class: 'neg' }, fmtUSD(r.interest)),
        el('span', { class: r.paid ? 'pos' : 'muted' }, r.paid ? fmtUSD(r.paid) : '—'),
        el('span', {}, fmtUSD(r.end)),
      ])),
    ]),
  ]);
  card.append(details);
  return card;
}

// "What if I paid $X extra each month?" with a live slider.
function whatIf(debt, l) {
  const base = projectDebt(l.balance, debt.apr, debt.payment, 0);
  const slider = el('input', { type: 'range', min: '0', max: String(Math.max(500, Math.round((Number(debt.payment) || 500) * 2 / 50) * 50)), step: '25', value: '0' });
  const out = el('div', { class: 'whatif-out' });
  const label = el('span', { class: 'whatif-amt' }, '+$0/mo');

  function update() {
    const extra = Number(slider.value);
    label.textContent = `+${fmtUSD(extra)}/mo`;
    const p = projectDebt(l.balance, debt.apr, debt.payment, extra);
    const todayYM = todayISO().slice(0, 7);
    if (!isFinite(p.months)) {
      out.replaceChildren(el('span', { class: 'neg' }, 'Payment still doesn’t cover interest — try a higher amount.'));
      return;
    }
    const saved = isFinite(base.interest) ? base.interest - p.interest : null;
    const monthsSaved = isFinite(base.months) ? base.months - p.months : null;
    out.replaceChildren(
      stat('Debt-free', shortMonth(addMonths(todayYM, p.months)), 'pos'),
      stat('Time saved', monthsSaved > 0 ? fmtMonths(monthsSaved) : '—'),
      stat('Interest saved', saved !== null ? fmtUSD(saved) : '—', 'pos'),
    );
  }
  slider.addEventListener('input', update);
  update();

  return el('div', { class: 'whatif' }, [
    el('div', { class: 'budget-line' }, [el('span', {}, 'What if I paid extra?'), label]),
    slider,
    out,
  ]);
}

function debtSheet(debt) {
  openSheet(debt ? `Edit ${debt.name}` : 'Add a debt', (close) => {
    const name = el('input', { type: 'text', value: debt?.name || '', placeholder: 'e.g. House loan' });
    const principal = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: debt?.principal ?? '', placeholder: 'Balance when tracking starts' });
    const apr = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: debt?.apr ?? '', placeholder: 'e.g. 4' });
    const payment = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: debt?.payment ?? '', placeholder: 'Planned monthly payment' });
    const start = el('input', { type: 'month', value: debt?.start_month || todayISO().slice(0, 7) });
    const save = el('button', { class: 'btn btn-primary btn-block' }, debt ? 'Save' : 'Add debt');

    save.addEventListener('click', async () => {
      const row = {
        name: name.value.trim(), principal: parseFloat(principal.value) || 0,
        apr: parseFloat(apr.value) || 0, payment: parseFloat(payment.value) || 0,
        start_month: start.value || todayISO().slice(0, 7),
      };
      if (!row.name || !(row.principal > 0)) return toast('Enter a name and balance', 'error');
      save.disabled = true;
      try {
        if (debt) await db.update('debts', debt.id, row); else await db.create('debts', row);
        toast('Saved', 'success'); close(); refresh();
      } catch (err) { toast('Could not save: ' + err.message, 'error'); save.disabled = false; }
    });

    const body = el('div', { class: 'sheet-body' }, [
      field('Name', name),
      field(`Starting balance (${CONFIG.BASE_CURRENCY})`, principal, 'The amount owed in the starting month'),
      el('div', { class: 'row-2' }, [field('Interest rate (APR %)', apr), field('Monthly payment', payment)]),
      field('Starting month', start),
      save,
    ]);
    if (debt) {
      body.append(el('button', { class: 'btn btn-ghost btn-block danger', onClick: async () => {
        if (!confirm(`Delete "${debt.name}"? Logged payments stay as transactions.`)) return;
        await db.remove('debts', debt.id);
        toast('Debt deleted', 'info'); close(); refresh();
      } }, 'Delete debt'));
    }
    return body;
  });
}

export function paymentSheet(debt, onDone = refresh) {
  openSheet(`Payment — ${debt.name}`, (close) => {
    const amount = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: debt.payment || '' });
    const currency = el('select', {}, CONFIG.CURRENCIES.map((c) => el('option', { value: c }, c)));
    const date = el('input', { type: 'date', value: todayISO(), max: todayISO() });
    const note = el('input', { type: 'text', placeholder: 'optional, e.g. Tenant transfer' });
    const auto = el('input', { type: 'checkbox' });
    const save = el('button', { class: 'btn btn-primary btn-block' }, 'Log payment');

    save.addEventListener('click', async () => {
      const amt = parseFloat(amount.value);
      if (!(amt > 0)) return toast('Enter an amount', 'error');
      if (!isValidISODate(date.value)) return toast('Pick a date', 'error');
      save.disabled = true;
      try {
        const cat = await ensureCategory('Debt Payment', 'debt');
        const { amount_usd, exchange_rate } = await convertToUSD(amt, currency.value, date.value);
        await db.createTransaction({
          type: 'expense', date: date.value, amount: amt, currency: currency.value,
          amount_usd, exchange_rate, category_id: cat.id, debt_id: debt.id,
          description: note.value.trim() || `${debt.name} payment`,
        });
        if (auto.checked) {
          await db.createRecurring({
            type: 'expense', amount: amt, currency: currency.value, category_id: cat.id,
            debt_id: debt.id, day_of_month: Number(date.value.slice(8, 10)),
            description: `${debt.name} payment`, last_applied: date.value.slice(0, 7), active: true,
          });
        }
        toast(auto.checked ? 'Payment logged — it will repeat monthly' : 'Payment logged', 'success');
        close(); onDone();
      } catch (err) { toast('Could not save: ' + err.message, 'error'); save.disabled = false; }
    });

    return el('div', { class: 'sheet-body' }, [
      el('div', { class: 'row-2' }, [field('Amount', amount), field('Currency', currency)]),
      field('Date', date),
      field('Note', note),
      el('label', { class: 'check-row' }, [auto, 'Repeat this payment automatically every month']),
      save,
    ]);
  });
}
