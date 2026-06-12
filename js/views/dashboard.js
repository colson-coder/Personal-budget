// =============================================================================
// dashboard.js — Total balance (USD), this month's spend vs budget per category,
// total spend this month, and the 5 most recent transactions.
// =============================================================================

import { db } from '../db.js';
import { el, fmtUSD, monthBounds, todayISO, currentMonthLabel, navigate } from '../util.js';

export async function renderDashboard() {
  const [categories, allTx] = await Promise.all([
    db.listCategories(),
    db.listTransactions(),
  ]);
  const catById = new Map(categories.map((c) => [c.id, c]));

  // Total balance = income USD − expense USD, across all time.
  let income = 0, expense = 0;
  for (const t of allTx) {
    if (t.type === 'income') income += Number(t.amount_usd) || 0;
    else expense += Number(t.amount_usd) || 0;
  }
  const balance = income - expense;

  // This month's expenses, grouped by category.
  const { start, end } = monthBounds(todayISO());
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
    el('span', { class: 'muted' }, currentMonthLabel()),
  ]));

  // Summary cards
  root.append(el('div', { class: 'grid cards-3' }, [
    summaryCard('Total balance', fmtUSD(balance), balance >= 0 ? 'pos' : 'neg'),
    summaryCard('Income (all time)', fmtUSD(income), 'pos'),
    summaryCard('Spent this month', fmtUSD(monthTotal), 'neg'),
  ]));

  // Budgets
  const budgetCats = categories
    .filter((c) => Number(c.monthly_budget_usd) > 0 || spentByCat.get(c.id))
    .sort((a, b) => (spentByCat.get(b.id) || 0) - (spentByCat.get(a.id) || 0));

  const budgetCard = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', {}, 'Budgets this month'),
      el('a', { class: 'link', href: '#/categories' }, 'Edit'),
    ]),
  ]);

  if (!budgetCats.length) {
    budgetCard.append(el('p', { class: 'muted' },
      'No budgets set yet. Add budgets on the Categories page.'));
  } else {
    for (const c of budgetCats) {
      const spent = spentByCat.get(c.id) || 0;
      const budget = Number(c.monthly_budget_usd) || 0;
      const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
      const over = budget > 0 && spent > budget;
      budgetCard.append(el('div', { class: 'budget-row' }, [
        el('div', { class: 'budget-line' }, [
          el('span', {}, c.name),
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
