// =============================================================================
// dashboard.js — Home: the master board. One screen with everything
// simplified: this month's money (left to assign, income, spent, set aside)
// with quick actions (add income, add expense, assign money), then one small
// tile per area — budgets, funds, debts, taxes, passive income, upcoming
// bills — each linking to its full page, and recent activity.
// Use ‹ › to look back at past months (?month=YYYY-MM).
// =============================================================================

import { db } from '../db.js';
import { CONFIG } from '../config.js';
import { loadAll } from '../store.js';
import { debtLedger, streamLedger, taxSummary } from '../finance.js';
import { el, fmtUSD, todayISO, monthLabel, nextMonthYM, prevMonthYM, progress, shortMonth } from '../util.js';
import { navigate } from '../router.js';
import { buildInsights } from '../insights.js';
import { aiCoachAvailable, openCoachChat } from './coachchat.js';
import { incomeSheet, assignSheet } from './quick.js';
import { fundSheet } from './funds.js';

export async function renderDashboard(params = {}) {
  const data = await loadAll();
  const { settings, categories, catById, txs, funds, debts, streams, sim, todayYM } = data;
  const m = settings.modules;
  const ym = /^\d{4}-\d{2}$/.test(params.month || '') ? params.month : todayYM;
  const isCurrent = ym === todayYM;
  const reload = () => navigate(isCurrent ? '/dashboard' : `/dashboard?month=${ym}`);

  const plan = sim.planFor(ym);
  const s = plan.summary;
  const spent = s.hard + s.debt + s.soft + (s.tax || 0);
  const setAside = plan.autoAssigned + plan.manual;

  const root = el('div', { class: 'view view-dashboard' });
  root.append(el('div', { class: 'view-head' }, [
    el('h1', {}, settings.name ? `Hi, ${settings.name}` : 'Home'),
    el('div', { class: 'month-nav' }, [
      el('button', { class: 'icon-btn', title: 'Previous month', onClick: () => navigate(`/dashboard?month=${prevMonthYM(ym)}`) }, '‹'),
      el('span', { class: 'month-label' }, monthLabel(ym)),
      el('button', { class: 'icon-btn', title: 'Next month', disabled: isCurrent ? 'disabled' : null, onClick: () => navigate(`/dashboard?month=${nextMonthYM(ym)}`) }, '›'),
    ]),
  ]));

  // --- Hero: this month's money + quick actions ------------------------------------
  const openAssign = (suggest) => assignSheet({
    funds, available: plan.leftToAssign, suggest, onDone: reload,
    onNewFund: () => fundSheet(null, reload),
  });
  const hero = el('div', { class: 'card hero-card' }, [
    el('div', { class: 'hero-main' }, [
      el('span', { class: 'hero-label' }, m.plan ? 'Left to assign' : 'Left this month'),
      el('span', { class: 'hero-value ' + ((m.plan ? plan.leftToAssign : s.net) < 0 ? 'neg' : '') },
        fmtUSD(m.plan ? plan.leftToAssign : s.net)),
      el('span', { class: 'hero-sub' }, m.plan
        ? (s.income === 0 && plan.leftToAssign === 0 ? 'Add your income to get started.'
          : plan.leftToAssign > 0 ? 'Give this money a job — move it into a fund.'
          : plan.leftToAssign < 0 ? 'You’ve spent or assigned more than came in.' : 'Every dollar has a job. Nice.')
        : 'Income minus spending'),
    ]),
    el('div', { class: 'hero-stats' }, [
      heroStat('Income', fmtUSD(s.income), 'pos'),
      heroStat('Spent', fmtUSD(spent)),
      m.plan ? heroStat('Set aside', fmtUSD(setAside)) : null,
    ]),
    isCurrent ? el('div', { class: 'hero-actions' }, [
      el('button', { class: 'btn btn-primary', onClick: () => incomeSheet({ categories: [...catById.values()], onDone: reload, onAssign: (amt) => { reload(); setTimeout(() => openAssignAfter(amt), 350); } }) }, ['＋ ', el('span', {}, 'Income')]),
      el('button', { class: 'btn', onClick: () => navigate('/add') }, ['＋ ', el('span', {}, 'Expense')]),
      m.plan ? el('button', { class: 'btn', onClick: () => openAssign() }, [el('span', {}, 'Assign'), el('span', { class: 'wide-only' }, '\u00a0money')]) : null,
    ]) : null,
  ]);
  root.append(hero);
  if (isCurrent) { const c = coachCard(data); if (c) root.append(c); }

  // After adding income the board reloads; reopen Assign with fresh numbers.
  async function openAssignAfter(amount) {
    const d = await loadAll();
    const p = d.sim.planFor(d.todayYM);
    assignSheet({ funds: d.funds, available: p.leftToAssign, suggest: amount, onDone: () => navigate('/dashboard'), onNewFund: () => fundSheet(null, () => navigate('/dashboard')) });
  }

  // --- Tiles -------------------------------------------------------------------------
  const grid = el('div', { class: 'board-grid' });
  grid.append(budgetsTile(categories, txs, ym));
  if (m.plan) grid.append(fundsTile(sim, () => openAssign()));
  if (m.debts && debts.length) grid.append(debtsTile(debts, txs, todayYM));
  if (m.taxes) grid.append(taxesTile(data));
  if (m.income && streams.length) grid.append(incomeTile(streams, txs, todayYM));
  if (isCurrent) {
    const up = await upcomingTile(catById);
    if (up) grid.append(up);
  }
  grid.append(recentTile(txs, catById));
  root.append(grid);
  return root;
}

// --- Coach: plain-rule tips from the user's own numbers (js/insights.js) ----------
function coachCard(data) {
  const all = buildInsights(data, { fmt: fmtUSD, today: todayISO() });
  if (!all.length) return null;
  const SHOW = 2;
  const card = el('div', { class: 'card coach-card' });
  const item = (x) => el('a', { class: 'coach-item tone-' + x.tone, href: x.href }, [
    el('span', { class: 'coach-dot' }),
    el('span', { class: 'coach-text' }, [
      x.step ? el('span', { class: 'coach-step' }, `Step ${x.step.n} of ${x.step.of}`) : null,
      el('span', { class: 'coach-title' }, x.title),
      el('span', { class: 'coach-body' }, x.body),
      x.why ? el('span', { class: 'coach-why' }, x.why) : null,
    ]),
  ]);
  let open = false;
  function draw() {
    const list = open ? all : all.slice(0, SHOW);
    card.replaceChildren(
      el('div', { class: 'card-head' }, [
        el('h2', {}, 'Coach'),
        all.length > SHOW ? el('button', { class: 'link coach-toggle', onClick: () => { open = !open; draw(); } },
          open ? 'Show less' : `All ${all.length} tips`) : null,
      ]),
      ...list.map(item),
      aiCoachAvailable() ? el('button', { class: 'btn btn-sm coach-ask', onClick: () => openCoachChat(data) }, 'Ask the coach') : null,
    );
  }
  draw();
  return card;
}

function heroStat(label, value, tone) {
  return el('div', { class: 'hero-stat' }, [
    el('span', { class: 'hero-stat-label' }, label),
    el('span', { class: 'hero-stat-value ' + (tone || '') }, value),
  ]);
}

function tile(title, href, body, cta) {
  return el('div', { class: 'card board-tile' }, [
    el('div', { class: 'card-head' }, [
      el('h2', {}, title),
      el('a', { class: 'link', href }, cta || 'Open'),
    ]),
    ...body,
  ]);
}

function lineRow(label, value, tone) {
  return el('div', { class: 'tile-row' }, [
    el('span', { class: 'tile-row-label' }, label),
    el('span', { class: 'tile-row-value ' + (tone || '') }, value),
  ]);
}

// --- Budgets -------------------------------------------------------------------------
function budgetsTile(categories, txs, ym) {
  const spentBy = new Map();
  for (const t of txs) {
    if (t.type !== 'expense' || t.date.slice(0, 7) !== ym) continue;
    spentBy.set(t.category_id, (spentBy.get(t.category_id) || 0) + (Number(t.amount_usd) || 0));
  }
  const rows = categories.map((c) => {
    const base = Number(c.monthly_budget_usd) || 0;
    const carry = c.rollover ? carryoverUSD(c, txs, ym) : 0;
    return { c, budget: base > 0 || carry ? Math.max(0, base + carry) : 0, spent: spentBy.get(c.id) || 0 };
  }).filter((r) => r.budget > 0);
  if (!rows.length) {
    return tile('Budgets', '#/categories', [el('p', { class: 'muted small' }, 'Set a monthly limit for things like food or fun, and see how you’re doing at a glance.')], 'Set budgets');
  }
  const budget = rows.reduce((a, r) => a + r.budget, 0);
  const spent = rows.reduce((a, r) => a + r.spent, 0);
  const over = rows.filter((r) => r.spent > r.budget);
  const top = rows.sort((a, b) => b.spent / b.budget - a.spent / a.budget).slice(0, 3);
  return tile('Budgets', '#/categories', [
    el('div', { class: 'tile-big' }, [
      el('span', { class: spent > budget ? 'neg' : '' }, fmtUSD(spent)),
      el('span', { class: 'muted small' }, ` of ${fmtUSD(budget)}`),
    ]),
    progress(spent / budget, { over: spent > budget }),
    ...top.map((r) => el('div', { class: 'mini-bar-row' }, [
      el('div', { class: 'tile-row' }, [
        el('span', { class: 'tile-row-label' }, r.c.name),
        el('span', { class: 'tile-row-value ' + (r.spent > r.budget ? 'neg' : 'muted') }, `${fmtUSD(r.spent)} / ${fmtUSD(r.budget)}`),
      ]),
      progress(r.spent / r.budget, { over: r.spent > r.budget }),
    ])),
    over.length ? el('p', { class: 'small neg tile-note' }, `${over.length} categor${over.length === 1 ? 'y is' : 'ies are'} over budget`) : null,
  ]);
}

// --- Funds -----------------------------------------------------------------------------
function fundsTile(sim, onAssign) {
  if (!sim.funds.length) {
    return tile('Funds', '#/funds', [el('p', { class: 'muted small' }, 'Pots of money for a purpose — emergency fund, vacation, giving.')], 'Create one');
  }
  const top = [...sim.funds].sort((a, b) => b.balance - a.balance).slice(0, 4);
  return tile('Funds', '#/funds', [
    el('div', { class: 'tile-big' }, fmtUSD(sim.total)),
    ...top.map((f) => el('div', { class: 'mini-bar-row' }, [
      el('div', { class: 'tile-row' }, [
        el('span', { class: 'tile-row-label' }, f.fund.name),
        el('span', { class: 'tile-row-value' }, fmtUSD(f.balance)),
      ]),
      f.goal > 0 ? progress(f.pctOfGoal) : null,
    ])),
    el('button', { class: 'btn btn-sm tile-btn', onClick: onAssign }, 'Assign money'),
  ]);
}

// --- Debts -------------------------------------------------------------------------------
function debtsTile(debts, txs, todayYM) {
  const day = Number(todayISO().slice(8, 10));
  const ls = debts.map((d) => ({ d, l: debtLedger(d, txs, todayYM, day) }));
  const owed = ls.reduce((a, x) => a + x.l.balance, 0);
  const principal = debts.reduce((a, d) => a + (Number(d.principal) || 0), 0);
  const soonest = ls.filter((x) => x.l.payoffYM).sort((a, b) => a.l.payoffYM.localeCompare(b.l.payoffYM))[0];
  return tile('Debts', '#/debts', [
    el('div', { class: 'tile-big neg' }, fmtUSD(owed)),
    principal > 0 ? progress(1 - owed / principal) : null,
    ...ls.slice(0, 3).map((x) => lineRow(x.d.name, fmtUSD(x.l.balance))),
    soonest ? el('p', { class: 'muted small tile-note' }, `${soonest.d.name} paid off ${shortMonth(soonest.l.payoffYM)}`) : null,
  ]);
}

// --- Taxes ---------------------------------------------------------------------------------
function taxesTile({ settings, txs, catById, sim, todayYM }) {
  const t = taxSummary({ tax: settings.tax, txs, catById, interestByMonth: sim.interestByMonth, todayYM });
  return tile(`Taxes · ${t.year.label}`, '#/taxes', [
    el('div', { class: 'tile-big ' + (t.remaining > 0 ? 'neg' : 'pos') }, fmtUSD(Math.max(0, t.remaining))),
    el('span', { class: 'muted small' }, t.remaining > 0 ? 'still to pay (estimate)' : 'nothing owed so far'),
    lineRow('Set aside each month', fmtUSD(t.suggestedMonthly)),
    lineRow('Paid this year', fmtUSD(t.paid)),
  ]);
}

// --- Passive income --------------------------------------------------------------------------
function incomeTile(streams, txs, todayYM) {
  const ls = streams.map((s) => ({ s, l: streamLedger(s, txs, todayYM) }));
  return tile('Passive income', '#/income', [
    el('div', { class: 'tile-big pos' }, fmtUSD(ls.reduce((a, x) => a + x.l.thisMonth, 0))),
    el('span', { class: 'muted small' }, 'this month'),
    ...ls.slice(0, 3).map((x) => lineRow(x.s.name, `${fmtUSD(x.l.last12)} / yr`)),
  ]);
}

// --- Upcoming bills ------------------------------------------------------------------------------
async function upcomingTile(catById) {
  let rules = [];
  try { rules = await db.listRecurring(); } catch { return null; }
  const today = todayISO();
  const ym = today.slice(0, 7);
  const [yy, mm] = ym.split('-').map(Number);
  const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const pending = rules
    .filter((r) => r.active !== false)
    .map((r) => ({ ...r, day: Math.min(r.day_of_month, lastDay) }))
    .filter((r) => `${ym}-${String(r.day).padStart(2, '0')}` > today && (r.last_applied || '') < ym)
    .sort((a, b) => a.day - b.day);
  if (!pending.length) return null;
  return tile('Coming up', '#/add', pending.slice(0, 4).map((r) => el('div', { class: 'tile-row' }, [
    el('span', { class: 'tile-row-label' }, [el('span', { class: 'upcoming-day sm' }, String(r.day)), ' ', r.description || catById.get(r.category_id)?.name || 'Recurring']),
    el('span', { class: 'tile-row-value ' + (r.type === 'income' ? 'pos' : '') }, `${r.type === 'income' ? '+' : '−'}${Number(r.amount).toLocaleString()} ${r.currency}`),
  ])), 'Manage');
}

// --- Recent activity -------------------------------------------------------------------------------
function recentTile(txs, catById) {
  const recent = txs.slice(0, 6);
  if (!recent.length) {
    return tile('Recent activity', '#/transactions', [el('p', { class: 'muted small' }, 'Nothing yet — add your income or first expense above.')]);
  }
  return tile('Recent activity', '#/transactions', recent.map((t) => {
    const sign = t.type === 'income' ? '+' : t.type === 'transfer' ? '→ ' : '−';
    const tone = t.type === 'income' ? 'pos' : '';
    const label = t.description || catById.get(t.category_id)?.name || (t.type === 'transfer' ? 'Assigned to fund' : 'Transaction');
    return el('div', { class: 'tile-row' }, [
      el('span', { class: 'tile-row-label' }, [label, el('span', { class: 'muted small block' }, `${catById.get(t.category_id)?.name ?? (t.type === 'transfer' ? 'Transfer' : '')} · ${t.date.slice(5)}`)]),
      el('span', { class: 'tile-row-value ' + tone }, [
        sign + fmtUSD(Math.abs(Number(t.amount_usd) || 0)),
        t.currency !== CONFIG.BASE_CURRENCY ? el('span', { class: 'muted small block' }, `${Number(t.amount).toLocaleString()} ${t.currency}`) : null,
      ]),
    ]);
  }), 'All');
}

// Envelope carryover for a rollover category at month `ym`: sum of
// (monthly budget − spend) over every prior month with activity. Uses the
// category's current budget for all months (we don't store budget history).
export function carryoverUSD(cat, allTx, ym) {
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
