// =============================================================================
// dashboard.js — Total balance (USD), a month's spend vs budget per category,
// total spend that month, and the 5 most recent transactions. Use ←/→ to view
// past months (?month=YYYY-MM query param).
// =============================================================================

import { db } from '../db.js';
import { getRate } from '../rates.js';
import { el, fmtUSD, monthBounds, todayISO, monthLabel, nextMonthYM, prevMonthYM } from '../util.js';
import { navigate } from '../router.js';

export async function renderDashboard(params = {}) {
  const [categories, allTx] = await Promise.all([
    db.listCategories(),
    db.listTransactions(),
  ]);
  const catById = new Map(categories.map((c) => [c.id, c]));

  // Which month are we viewing? Defaults to the current CR-calendar month.
  const thisMonth = todayISO().slice(0, 7);
  const ym = /^\d{4}-\d{2}$/.test(params.month || '') ? params.month : thisMonth;
  const isCurrent = ym === thisMonth;

  // Total balance = income USD − expense USD, across all time.
  let income = 0, expense = 0;
  for (const t of allTx) {
    if (t.type === 'income') income += Number(t.amount_usd) || 0;
    else expense += Number(t.amount_usd) || 0;
  }
  const balance = income - expense;

  // The viewed month's expenses, grouped by category.
  const { start, end } = monthBounds(`${ym}-01`);
  const monthExpenses = allTx.filter(
    (t) => t.type === 'expense' && t.date >= start && t.date <= end
  );
  const spentByCat = new Map();
  let monthTotal = 0;
  for (const t of monthExpenses) {
    const v = Number(t.amount_usd) || 0;
    monthTotal += v;
    spentByCat.set(t.category_id, (spentByCat.get(t.category_id) || 0) + v);
  }

  const root = el('div', { class: 'view view-dashboard' });
  root.append(el('div', { class: 'view-head' }, [
    el('h1', {}, 'Dashboard'),
    el('div', { class: 'month-nav' }, [
      el('button', {
        class: 'icon-btn', title: 'Previous month',
        onClick: () => navigate(`/dashboard?month=${prevMonthYM(ym)}`),
      }, '‹'),
      el('span', { class: 'month-label' }, monthLabel(ym)),
      el('button', {
        class: 'icon-btn', title: 'Next month',
        disabled: isCurrent ? 'disabled' : null,
        onClick: () => navigate(`/dashboard?month=${nextMonthYM(ym)}`),
      }, '›'),
    ]),
  ]));

  // Summary cards
  root.append(el('div', { class: 'grid cards-3' }, [
    summaryCard('Total balance', fmtUSD(balance), balance >= 0 ? 'pos' : 'neg'),
    summaryCard('Income (all time)', fmtUSD(income), 'pos'),
    summaryCard(isCurrent ? 'Spent this month' : `Spent in ${monthLabel(ym)}`, fmtUSD(monthTotal), 'neg'),
  ]));

  // Budgets
  const budgetCats = categories
    .filter((c) => Number(c.monthly_budget_usd) > 0 || spentByCat.get(c.id))
    .sort((a, b) => (spentByCat.get(b.id) || 0) - (spentByCat.get(a.id) || 0));

  const budgetCard = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', {}, isCurrent ? 'Budgets this month' : `Budgets — ${monthLabel(ym)}`),
      el('a', { class: 'link', href: '#/categories' }, 'Edit'),
    ]),
  ]);

  if (!budgetCats.length) {
    budgetCard.append(el('p', { class: 'muted' },
      'No budgets set yet. Add budgets on the Categories page.'));
  } else {
    for (const c of budgetCats) {
      const spent = spentByCat.get(c.id) || 0;
      const base = Number(c.monthly_budget_usd) || 0;
      // Envelope rollover (YNAB/Actual-style): unspent budget from previous
      // months carries forward; overspending eats into this month.
      const carry = c.rollover ? carryoverUSD(c, allTx, ym) : 0;
      const budget = base > 0 || carry !== 0 ? Math.max(0, base + carry) : 0;
      const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
      const over = budget > 0 ? spent > budget : (c.rollover && base + carry < spent);
      budgetCard.append(el('div', { class: 'budget-row' }, [
        el('div', { class: 'budget-line' }, [
          el('span', {}, [
            c.name,
            c.rollover && Math.abs(carry) >= 0.01
              ? el('span', { class: 'carry ' + (carry >= 0 ? 'pos' : 'neg') },
                  ` ${carry >= 0 ? '+' : '−'}${fmtUSD(Math.abs(carry))} carried`)
              : null,
          ]),
          el('span', { class: over ? 'neg' : 'muted' },
            budget > 0 ? `${fmtUSD(spent)} / ${fmtUSD(budget)}` : fmtUSD(spent)),
        ]),
        el('div', { class: 'progress' }, [
          el('div', {
            class: 'progress-bar' + (over ? ' over' : ''),
            style: `width:${budget > 0 ? pct : 0}%`,
          }),
        ]),
      ]));
    }
  }
  root.append(budgetCard);

  // Upcoming recurring bills/income this month + projected month-end balance
  // (only meaningful when viewing the current month).
  if (isCurrent) {
    const upcoming = await upcomingCard(balance, catById);
    if (upcoming) root.append(upcoming);
  }

  // Recent transactions
  const recent = allTx.slice(0, 5);
  const recentCard = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', {}, 'Recent transactions'),
      el('a', { class: 'link', href: '#/transactions' }, 'View all'),
    ]),
  ]);
  if (!recent.length) {
    recentCard.append(el('p', { class: 'muted' }, [
      'No transactions yet. ',
      el('a', { class: 'link', href: '#/add' }, 'Add your first one'),
      '.',
    ]));
  } else {
    const list = el('ul', { class: 'tx-list' });
    for (const t of recent) {
      const cat = catById.get(t.category_id);
      list.append(el('li', {
        class: 'tx-item',
        onClick: () => navigate('/transactions'),
      }, [
        el('div', { class: 'tx-main' }, [
          el('span', { class: 'tx-desc' }, t.description || (cat?.name ?? 'Transaction')),
          el('span', { class: 'tx-meta' }, `${cat?.name ?? 'Uncategorized'} · ${t.date}`),
        ]),
        el('div', { class: 'tx-amt ' + (t.type === 'income' ? 'pos' : 'neg') }, [
          (t.type === 'income' ? '+' : '−') + fmtUSD(Math.abs(Number(t.amount_usd) || 0)),
          el('span', { class: 'tx-orig' },
            t.currency !== 'USD' ? `${Number(t.amount).toLocaleString()} ${t.currency}` : ''),
        ]),
      ]));
    }
    recentCard.append(list);
  }
  root.append(recentCard);

  return root;
}

function summaryCard(label, value, tone) {
  return el('div', { class: 'card summary-card' }, [
    el('div', { class: 'summary-label' }, label),
    el('div', { class: 'summary-value ' + (tone || '') }, value),
  ]);
}

// Envelope carryover for a rollover category at month `ym`: sum of
// (monthly budget − spend) over every prior month with activity. Uses the
// category's current budget for all months (we don't store budget history).
function carryoverUSD(cat, allTx, ym) {
  const budget = Number(cat.monthly_budget_usd) || 0;
  const spentByMonth = new Map();
  let firstYM = null;
  for (const t of allTx) {
    if (t.type !== 'expense' || t.category_id !== cat.id) continue;
    const m = t.date.slice(0, 7);
    if (m >= ym) continue;
    spentByMonth.set(m, (spentByMonth.get(m) || 0) + (Number(t.amount_usd) || 0));
    if (!firstYM || m < firstYM) firstYM = m;
  }
  if (!firstYM) return 0;
  // Walk every month from first activity up to (not including) the viewed one.
  let carry = 0;
  let [y, m] = firstYM.split('-').map(Number);
  for (;;) {
    const cur = `${y}-${String(m).padStart(2, '0')}`;
    if (cur >= ym) break;
    carry += budget - (spentByMonth.get(cur) || 0);
    m++; if (m > 12) { m = 1; y++; }
  }
  return Math.round(carry * 100) / 100;
}

// "Upcoming this month" card: recurring rules whose day hasn't arrived yet,
// plus a projected month-end balance. Returns null if there's nothing pending.
async function upcomingCard(balance, catById) {
  let rules = [];
  try { rules = await db.listRecurring(); } catch { return null; }

  const today = todayISO();
  const ym = today.slice(0, 7);
  const [yy, mm] = ym.split('-').map(Number);
  const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();

  const pending = rules
    .filter((r) => r.active !== false)
    .map((r) => ({ ...r, day: Math.min(r.day_of_month, lastDay) }))
    .filter((r) => {
      const date = `${ym}-${String(r.day).padStart(2, '0')}`;
      return date > today && (r.last_applied || '') < ym;
    })
    .sort((a, b) => a.day - b.day);
  if (!pending.length) return null;

  // Convert pending amounts to USD with today's (possibly fallback) rate. A
  // failed rate just omits that row from the projection rather than blocking.
  let pendingIncome = 0, pendingExpense = 0;
  const rows = [];
  for (const r of pending) {
    let usd = null;
    try { usd = Number(r.amount) * (await getRate(r.currency, today)); } catch { /* skip */ }
    if (usd !== null) {
      if (r.type === 'income') pendingIncome += usd; else pendingExpense += usd;
    }
    rows.push(el('div', { class: 'upcoming-row' }, [
      el('span', { class: 'upcoming-day' }, `${r.day}`),
      el('div', { class: 'rec-main' }, [
        el('span', { class: 'rec-desc' }, r.description || catById.get(r.category_id)?.name || 'Recurring'),
        el('span', { class: 'rec-meta' }, catById.get(r.category_id)?.name ?? '—'),
      ]),
      el('span', { class: 'rec-amt ' + (r.type === 'income' ? 'pos' : 'neg') },
        `${r.type === 'income' ? '+' : '−'}${Number(r.amount).toLocaleString()} ${r.currency}`),
    ]));
  }

  const projected = balance + pendingIncome - pendingExpense;
  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', {}, 'Upcoming this month')]),
    ...rows,
    el('div', { class: 'projection' }, [
      el('span', { class: 'muted' }, 'Projected balance after these'),
      el('span', { class: 'stat-value ' + (projected >= 0 ? 'pos' : 'neg') }, fmtUSD(projected)),
    ]),
  ]);
}
