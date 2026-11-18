// =============================================================================
// income.js — Passive income: rentals, dividends, interest, royalties, side
// businesses. Each stream tracks what came in, optionally against an expected
// monthly amount (behind / ahead). Rentals can also hold a security deposit.
// Payments are income transactions linked by stream_id.
// =============================================================================

import { db } from '../db.js';
import { CONFIG } from '../config.js';
import { loadAll, ensureCategory } from '../store.js';
import { streamLedger } from '../finance.js';
import { convertToBase } from '../rates.js';
import {
  el, fmtBase, toast, todayISO, openSheet, field, shortMonth, sparkline, isValidISODate,
} from '../util.js';
import { navigate } from '../router.js';

export const STREAM_KINDS = [
  { value: 'rental', label: 'Rental property', icon: '⌂' },
  { value: 'dividends', label: 'Dividends', icon: '◈' },
  { value: 'interest', label: 'Interest', icon: '%' },
  { value: 'royalties', label: 'Royalties', icon: '♪' },
  { value: 'business', label: 'Side business', icon: '◆' },
  { value: 'other', label: 'Other', icon: '✦' },
];
const kindMeta = (k) => STREAM_KINDS.find((x) => x.value === k) || STREAM_KINDS[5];
const refresh = () => navigate('/income');

export async function renderIncome() {
  const { streams, txs, todayYM } = await loadAll();

  const root = el('div', { class: 'view view-income' });
  root.append(el('div', { class: 'view-head' }, [
    el('h1', {}, 'Passive income'),
    el('button', { class: 'btn btn-primary btn-sm', onClick: () => streamSheet(null) }, '＋ Add stream'),
  ]));

  if (!streams.length) {
    root.append(el('div', { class: 'card empty' }, [
      el('p', {}, 'Money that comes in without a paycheck: rent, dividends, interest, royalties, a side business.'),
      el('p', { class: 'muted small' }, 'Add a stream to see what each one earns per month and per year.'),
      el('button', { class: 'btn btn-primary btn-sm', onClick: () => streamSheet(null) }, 'Add your first stream'),
    ]));
    return root;
  }

  const ledgers = streams.map((s) => ({ s, l: streamLedger(s, txs, todayYM) }));
  root.append(el('div', { class: 'grid cards-3' }, [
    tile('This month', fmtBase(ledgers.reduce((a, x) => a + x.l.thisMonth, 0)), 'pos'),
    tile('Last 12 months', fmtBase(ledgers.reduce((a, x) => a + x.l.last12, 0)), 'pos'),
    tile('Average per month', fmtBase(ledgers.reduce((a, x) => a + x.l.avgMonthly, 0))),
  ]));

  const grid = el('div', { class: 'fund-grid' });
  for (const { s, l } of ledgers) grid.append(streamCard(s, l));
  root.append(grid);
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

function streamCard(s, l) {
  const meta = kindMeta(s.kind);
  const expected = Number(s.expected_monthly) || 0;
  const isRental = s.kind === 'rental';

  const stats = [
    stat('Last 12 months', fmtBase(l.last12), 'pos'),
    stat('Avg / month', fmtBase(l.avgMonthly)),
  ];
  if (expected > 0) {
    stats.push(stat(l.behind > 0 ? (isRental ? 'Tenant owes' : 'Behind expected') : 'Ahead of expected',
      fmtBase(Math.abs(l.behind)), l.behind > 0 ? 'neg' : 'pos'));
  }
  if (isRental) stats.push(stat('Deposit held', fmtBase(l.deposit)));

  const card = el('div', { class: 'card fund-card' }, [
    el('div', { class: 'fund-top' }, [
      el('span', { class: 'fund-icon' }, meta.icon),
      el('div', { class: 'rec-main' }, [
        el('span', { class: 'rec-desc' }, s.name),
        el('span', { class: 'rec-meta' }, [meta.label, expected ? ` · expect ${fmtBase(expected)}/mo` : ''].join('')),
      ]),
      el('button', { class: 'icon-btn', title: 'Edit', onClick: () => streamSheet(s) }, '✎'),
    ]),
    el('div', { class: 'fund-balance pos' }, fmtBase(l.thisMonth)),
    el('div', { class: 'muted small' }, 'received this month'),
  ]);
  const hist = l.rows.slice(-12).map((r) => r.received);
  if (hist.length > 1) card.append(sparkline(hist, { width: 260, height: 36 }));
  card.append(el('div', { class: 'stat-grid' }, stats));

  card.append(el('div', { class: 'fund-actions' }, [
    el('button', { class: 'btn btn-primary btn-sm', onClick: () => receivedSheet(s, false) }, 'Log income'),
    isRental ? el('button', { class: 'btn btn-sm', onClick: () => receivedSheet(s, true) }, 'Deposit') : null,
  ]));

  card.append(el('details', { class: 'ledger' }, [
    el('summary', {}, 'Month by month'),
    el('div', { class: 'ytable ledger-table' }, [
      el('div', { class: 'yrow yhead' }, (expected ? ['Month', 'Expected', 'Received', isRental ? 'Owed' : 'Behind'] : ['Month', 'Received']).map((h) => el('span', {}, h))),
      ...l.rows.slice().reverse().map((r) => el('div', { class: 'yrow' + (expected ? '' : ' yrow-2') }, expected ? [
        el('span', {}, shortMonth(r.ym)),
        el('span', {}, fmtBase(r.expected)),
        el('span', { class: r.received ? 'pos' : 'muted' }, r.received ? fmtBase(r.received) : '—'),
        el('span', { class: r.behind > 0 ? 'neg' : '' }, fmtBase(r.behind)),
      ] : [
        el('span', {}, shortMonth(r.ym)),
        el('span', { class: r.received ? 'pos' : 'muted' }, r.received ? fmtBase(r.received) : '—'),
      ])),
    ]),
  ]));
  return card;
}

export function streamSheet(s, onDone = refresh) {
  openSheet(s ? `Edit ${s.name}` : 'Add an income stream', (close) => {
    const name = el('input', { type: 'text', value: s?.name || '', placeholder: 'e.g. Duplex rent, Index fund dividends' });
    const kind = el('select', {}, STREAM_KINDS.map((k) => el('option', { value: k.value, selected: (s?.kind || 'rental') === k.value ? 'selected' : null }, k.label)));
    const expected = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: s?.expected_monthly || '', placeholder: 'optional' });
    const start = el('input', { type: 'month', value: s?.start_month || todayISO().slice(0, 7) });
    const deposit = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: s?.deposit_start || '', placeholder: '0' });
    const depositField = field('Deposit already held', deposit);
    const syncKind = () => { depositField.style.display = kind.value === 'rental' ? '' : 'none'; };
    kind.addEventListener('change', syncKind);
    syncKind();
    const save = el('button', { class: 'btn btn-primary btn-block' }, s ? 'Save' : 'Add stream');

    save.addEventListener('click', async () => {
      const row = {
        name: name.value.trim(), kind: kind.value,
        expected_monthly: parseFloat(expected.value) || 0,
        start_month: start.value || todayISO().slice(0, 7),
        deposit_start: kind.value === 'rental' ? parseFloat(deposit.value) || 0 : 0,
      };
      if (!row.name) return toast('Give the stream a name', 'error');
      save.disabled = true;
      try {
        if (s) await db.update('income_streams', s.id, row); else await db.create('income_streams', row);
        toast('Saved', 'success'); close(); onDone();
      } catch (err) { toast('Could not save: ' + err.message, 'error'); save.disabled = false; }
    });

    const body = el('div', { class: 'sheet-body' }, [
      field('Name', name),
      el('div', { class: 'row-2' }, [field('Type', kind), field(`Expected per month (${CONFIG.BASE_CURRENCY})`, expected)]),
      el('div', { class: 'row-2' }, [field('Tracking starts', start), depositField]),
      save,
    ]);
    if (s) {
      body.append(el('button', { class: 'btn btn-ghost btn-block danger', onClick: async () => {
        if (!confirm(`Delete "${s.name}"? Its transactions are kept.`)) return;
        await db.remove('income_streams', s.id);
        toast('Stream deleted', 'info'); close(); onDone();
      } }, 'Delete stream'));
    }
    return body;
  });
}

function receivedSheet(s, isDeposit) {
  openSheet(isDeposit ? `Deposit — ${s.name}` : `Income — ${s.name}`, (close) => {
    const amount = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: isDeposit ? '' : s.expected_monthly || '' });
    const currency = el('select', {}, CONFIG.CURRENCIES.map((c) => el('option', { value: c }, c)));
    const date = el('input', { type: 'date', value: todayISO(), max: todayISO() });
    const refund = el('input', { type: 'checkbox' });
    const note = el('input', { type: 'text', placeholder: 'optional' });
    const save = el('button', { class: 'btn btn-primary btn-block' }, 'Save');

    save.addEventListener('click', async () => {
      const amt = parseFloat(amount.value);
      if (!(amt > 0)) return toast('Enter an amount', 'error');
      if (!isValidISODate(date.value)) return toast('Pick a date', 'error');
      save.disabled = true;
      try {
        const cat = await ensureCategory('Passive Income', 'income');
        const { amount_usd, exchange_rate } = await convertToBase(amt, currency.value, date.value);
        const isRefund = isDeposit && refund.checked;
        await db.createTransaction({
          type: isRefund ? 'expense' : 'income',
          date: date.value, amount: amt, currency: currency.value, amount_usd, exchange_rate,
          category_id: cat.id, stream_id: s.id,
          ...(isDeposit ? { subtype: 'deposit' } : {}),
          description: note.value.trim() || (isDeposit ? (isRefund ? 'Deposit returned' : 'Security deposit') : s.name),
        });
        toast('Saved', 'success'); close(); refresh();
      } catch (err) { toast('Could not save: ' + err.message, 'error'); save.disabled = false; }
    });

    return el('div', { class: 'sheet-body' }, [
      el('div', { class: 'row-2' }, [field('Amount', amount), field('Currency', currency)]),
      field('Date', date),
      field('Note', note),
      isDeposit ? el('label', { class: 'check-row' }, [refund, 'I’m returning deposit money to the tenant']) : null,
      isDeposit ? el('p', { class: 'muted small' }, 'Deposits are held for the tenant, so they don’t count as income.') : null,
      save,
    ]);
  });
}
