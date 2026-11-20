// =============================================================================
// expenses.js — Expenses in one place, in two tabs:
//   • Monthly   bills that repeat (rent, insurance, loan payments). Added once,
//               they're logged on their day every month (see js/recurring.js),
//               so the money leaves the budget automatically.
//   • One-time  everything else logged this month, with a button to add one.
// =============================================================================

import { db } from '../db.js';
import { loadAll } from '../store.js';
import { CONFIG } from '../config.js';
import { debtLedger, r2 } from '../finance.js';
import { el, fmtUSD, toast, todayISO, shortDate } from '../util.js';
import { navigate } from '../router.js';
import { recurringCard } from './add.js';
import { startAutoPay } from './debts.js';

export async function renderExpenses(params = {}) {
  const tab = params.tab === 'once' ? 'once' : 'monthly';
  const data = await loadAll();
  const { categories, txs, debts, recurring = [], settings, catById, todayYM } = data;

  const root = el('div', { class: 'view view-expenses' });
  root.append(el('div', { class: 'view-head' }, [
    el('h1', {}, 'Expenses'),
    el('a', { class: 'btn btn-primary btn-sm', href: '#/add' }, '＋ One-time'),
  ]));
  root.append(el('div', { class: 'tabs', role: 'tablist' }, [
    tabBtn('Monthly', tab === 'monthly', '/expenses'),
    tabBtn('One-time', tab === 'once', '/expenses?tab=once'),
  ]));

  if (tab === 'monthly') {
    const rules = recurring.filter((r) => r.active !== false && r.type === 'expense');
    const home = rules.filter((r) => r.currency === CONFIG.BASE_CURRENCY);
    const total = r2(home.reduce((a, r) => a + Number(r.amount || 0), 0));
    if (rules.length) {
      root.append(el('div', { class: 'card tile' }, [
        el('span', { class: 'muted small' }, 'Taken out automatically each month'),
        el('span', { class: 'tile-value' }, fmtUSD(total) + (home.length < rules.length ? ' + other currencies' : '')),
      ]));
    }

    // Loans that aren't coming out of the budget yet.
    if (settings.modules?.debts) {
      const day = Number(todayISO().slice(8, 10));
      const missing = debts.filter((d) => !recurring.some((r) => r.debt_id === d.id && r.active !== false)
        && debtLedger(d, txs, todayYM, day).balance > 0.5);
      if (missing.length) {
        root.append(el('div', { class: 'card repeat-box' }, [
          el('div', { class: 'repeat-title' }, 'Loan payments not coming out yet'),
          ...missing.map((d) => el('div', { class: 'rec-row repeat-row' }, [
            el('div', { class: 'rec-main' }, [
              el('span', { class: 'rec-desc' }, d.name),
              el('span', { class: 'rec-meta' }, `Due day ${d.due_day || 1}`),
            ]),
            el('div', { class: 'repeat-actions' }, [
              el('button', { class: 'btn btn-sm btn-primary', onClick: async (e) => {
                e.currentTarget.disabled = true;
                try { await startAutoPay(d, txs); toast(`${d.name} payment will be taken out every month`, 'success'); navigate('/expenses'); }
                catch (err) { toast('Could not set up: ' + err.message, 'error'); e.currentTarget.disabled = false; }
              } }, 'Take it out monthly'),
            ]),
          ])),
        ]));
      }
    }
    root.append(await recurringCard(categories, txs));
    return root;
  }

  // --- One-time: this month's expenses that aren't monthly bills ----------------------
  const ruleKey = (desc, cat) => `${(desc || '').trim().toLowerCase()}|${cat || ''}`;
  const fromRules = new Set(recurring.map((r) => ruleKey(r.description, r.category_id)));
  const rows = txs.filter((t) => t.type === 'expense' && !t.fund_id && !t.debt_id
    && (t.date || '').startsWith(todayYM) && !fromRules.has(ruleKey(t.description, t.category_id)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = r2(rows.reduce((a, t) => a + Number(t.amount_usd || 0), 0));

  const card = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', {}, 'One-time expenses this month'),
      el('span', { class: 'muted small' }, fmtUSD(total)),
    ]),
  ]);
  if (!rows.length) {
    card.append(el('div', { class: 'empty' }, [
      el('p', { class: 'muted' }, 'Nothing yet this month. Groceries, a dinner out, a repair: log it once with ＋ One-time.'),
    ]));
  }
  for (const t of rows) {
    card.append(el('div', { class: 'rec-row' }, [
      el('div', { class: 'rec-main' }, [
        el('span', { class: 'rec-desc' }, t.description || catById.get(t.category_id)?.name || 'Expense'),
        el('span', { class: 'rec-meta' }, `${shortDate(t.date)} · ${catById.get(t.category_id)?.name ?? '—'}`),
      ]),
      el('span', { class: 'rec-amt neg' }, fmtUSD(Number(t.amount_usd) || 0)),
    ]));
  }
  card.append(el('a', { class: 'link small', href: '#/transactions' }, 'See all activity →'));
  root.append(card);
  return root;
}

function tabBtn(label, on, path) {
  return el('button', {
    class: 'tab' + (on ? ' active' : ''), role: 'tab', 'aria-selected': on ? 'true' : 'false',
    onClick: () => navigate(path),
  }, label);
}
