// =============================================================================
// reports.js — Spending trends & "Month in Review". The most-missed feature of
// the late Mint: history, not just the current month.
//
// Everything is computed client-side from already-stored amount_usd values and
// rendered as dependency-free inline SVG (no chart library, no build step).
// =============================================================================

import { db } from '../db.js';
import { el, fmtUSD, todayISO, monthLabel, prevMonthYM } from '../util.js';

export async function renderReports() {
  const [categories, allTx] = await Promise.all([
    db.listCategories(),
    db.listTransactions(),
  ]);
  const catById = new Map(categories.map((c) => [c.id, c]));

  const root = el('div', { class: 'view view-reports' });
  root.append(el('div', { class: 'view-head' }, [el('h1', {}, 'Reports')]));

  if (!allTx.length) {
    root.append(el('div', { class: 'card' }, [
      el('p', { class: 'muted' }, 'No data yet — add some transactions and come back.'),
    ]));
    return root;
  }

  // ---- aggregate per month: { 'YYYY-MM': { income, expense, byCat: Map } } --
  const months = new Map();
  for (const t of allTx) {
    const ym = t.date.slice(0, 7);
    let m = months.get(ym);
    if (!m) months.set(ym, (m = { income: 0, expense: 0, byCat: new Map() }));
    const v = Number(t.amount_usd) || 0;
    if (t.type === 'income') m.income += v;
    else {
      m.expense += v;
      m.byCat.set(t.category_id, (m.byCat.get(t.category_id) || 0) + v);
    }
  }

  const thisMonth = todayISO().slice(0, 7);
  const lastMonth = prevMonthYM(thisMonth);

  root.append(monthInReviewCard(months, thisMonth, lastMonth, catById, allTx));
  root.append(trendChartCard(months, thisMonth));
  root.append(topCategoriesCard(months, thisMonth, catById));

  return root;
}

// --- Month in Review (Monarch-style narrative digest) ------------------------
function monthInReviewCard(months, thisMonth, lastMonth, catById, allTx) {
  const cur = months.get(thisMonth) || { income: 0, expense: 0, byCat: new Map() };
  const prev = months.get(lastMonth) || { income: 0, expense: 0, byCat: new Map() };

  const card = el('div', { class: 'card' }, [
    el('h2', {}, `Month in review — ${monthLabel(thisMonth)}`),
  ]);

  // Spend vs last month
  const delta = cur.expense - prev.expense;
  const deltaPct = prev.expense > 0 ? Math.round((delta / prev.expense) * 100) : null;
  card.append(stat('Spent so far', fmtUSD(cur.expense),
    prev.expense > 0
      ? `${delta >= 0 ? '▲' : '▼'} ${fmtUSD(Math.abs(delta))}${deltaPct !== null ? ` (${Math.abs(deltaPct)}%)` : ''} vs ${monthLabel(lastMonth)}`
      : 'no data for last month',
    delta > 0 ? 'neg' : 'pos'));

  // Savings rate
  if (cur.income > 0) {
    const rate = Math.round(((cur.income - cur.expense) / cur.income) * 100);
    card.append(stat('Savings rate', `${rate}%`, 'of this month’s income kept', rate >= 0 ? 'pos' : 'neg'));
  }

  // Largest single expense this month
  const biggest = allTx
    .filter((t) => t.type === 'expense' && t.date.slice(0, 7) === thisMonth)
    .sort((a, b) => (b.amount_usd || 0) - (a.amount_usd || 0))[0];
  if (biggest) {
    card.append(stat('Largest expense', fmtUSD(biggest.amount_usd),
      `${biggest.description || catById.get(biggest.category_id)?.name || ''} · ${biggest.date}`, 'neg'));
  }

  // Top category movers vs last month
  const moves = [];
  const catIds = new Set([...cur.byCat.keys(), ...prev.byCat.keys()]);
  for (const id of catIds) {
    const d = (cur.byCat.get(id) || 0) - (prev.byCat.get(id) || 0);
    if (Math.abs(d) >= 1) moves.push({ id, d });
  }
  moves.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  if (moves.length) {
    const list = el('div', { class: 'movers' });
    for (const m of moves.slice(0, 3)) {
      list.append(el('div', { class: 'mover-row' }, [
        el('span', {}, catById.get(m.id)?.name ?? 'Uncategorized'),
        el('span', { class: m.d > 0 ? 'neg' : 'pos' },
          `${m.d > 0 ? '▲' : '▼'} ${fmtUSD(Math.abs(m.d))}`),
      ]));
    }
    card.append(el('div', { class: 'stat-block' }, [
      el('div', { class: 'summary-label' }, 'Biggest changes vs last month'), list,
    ]));
  }

  return card;
}

function stat(label, value, sub, tone) {
  return el('div', { class: 'stat-block' }, [
    el('div', { class: 'summary-label' }, label),
    el('div', { class: 'stat-value ' + (tone || '') }, value),
    sub ? el('div', { class: 'stat-sub muted' }, sub) : null,
  ]);
}

// --- 12-month income vs expense bar chart (inline SVG) ------------------------
function trendChartCard(months, thisMonth) {
  // Build the last 12 month keys, oldest → newest.
  const keys = [];
  let ym = thisMonth;
  for (let i = 0; i < 12; i++) { keys.unshift(ym); ym = prevMonthYM(ym); }
  const data = keys.map((k) => ({
    ym: k,
    income: months.get(k)?.income || 0,
    expense: months.get(k)?.expense || 0,
  }));
  const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)));

  const W = 720, H = 220, padB = 28, padL = 4, padR = 4;
  const plotH = H - padB;
  const slot = (W - padL - padR) / 12;
  const barW = Math.min(16, slot / 2.6);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'trend-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Income vs expenses, last 12 months');

  const ns = (tag, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  data.forEach((d, i) => {
    const cx = padL + slot * i + slot / 2;
    const ih = (d.income / max) * (plotH - 10);
    const eh = (d.expense / max) * (plotH - 10);
    // income bar (green) left, expense bar (red) right
    svg.append(ns('rect', {
      x: cx - barW - 1, y: plotH - ih, width: barW, height: Math.max(ih, d.income > 0 ? 2 : 0),
      rx: 2, fill: 'var(--accent)',
    }));
    svg.append(ns('rect', {
      x: cx + 1, y: plotH - eh, width: barW, height: Math.max(eh, d.expense > 0 ? 2 : 0),
      rx: 2, fill: 'var(--neg)',
    }));
    const lbl = ns('text', {
      x: cx, y: H - 8, 'text-anchor': 'middle',
      fill: 'var(--text-dim)', 'font-size': '11',
    });
    const [y, m] = d.ym.split('-').map(Number);
    lbl.textContent = new Date(Date.UTC(y, m - 1, 1))
      .toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    svg.append(lbl);
  });
  // baseline
  svg.append(ns('line', { x1: 0, y1: plotH + 0.5, x2: W, y2: plotH + 0.5, stroke: 'var(--border)', 'stroke-width': 1 }));

  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', {}, 'Last 12 months'),
      el('span', { class: 'legend' }, [
        el('span', { class: 'legend-dot dot-pos' }), 'Income ',
        el('span', { class: 'legend-dot dot-neg' }), 'Expenses',
      ]),
    ]),
    svg,
  ]);
}

// --- Top categories over the last 12 months -----------------------------------
function topCategoriesCard(months, thisMonth, catById) {
  const totals = new Map();
  let ym = thisMonth;
  for (let i = 0; i < 12; i++) {
    const m = months.get(ym);
    if (m) for (const [id, v] of m.byCat) totals.set(id, (totals.get(id) || 0) + v);
    ym = prevMonthYM(ym);
  }
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = rows[0]?.[1] || 1;

  const card = el('div', { class: 'card' }, [el('h2', {}, 'Top categories (12 months)')]);
  if (!rows.length) {
    card.append(el('p', { class: 'muted' }, 'No expenses recorded yet.'));
    return card;
  }
  for (const [id, v] of rows) {
    card.append(el('div', { class: 'budget-row' }, [
      el('div', { class: 'budget-line' }, [
        el('span', {}, catById.get(id)?.name ?? 'Uncategorized'),
        el('span', { class: 'muted' }, fmtUSD(v)),
      ]),
      el('div', { class: 'progress' }, [
        el('div', { class: 'progress-bar', style: `width:${(v / max) * 100}%` }),
      ]),
    ]));
  }
  return card;
}
