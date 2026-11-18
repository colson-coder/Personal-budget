// =============================================================================
// plan.js — The monthly money plan: where this month's income went and where
// the rest is assigned. Generalizes a spreadsheet's "Monthly Summary",
// "Allocations" and "Income & Expenses" tabs.
// =============================================================================

import { loadAll } from '../store.js';
import { addMonths, monthRange } from '../finance.js';
import { el, fmtUSD, monthLabel, shortMonth } from '../util.js';
import { navigate } from '../router.js';

export async function renderPlan(params = {}) {
  const data = await loadAll();
  const { sim, todayYM, funds, settings } = data;
  const ym = /^\d{4}-\d{2}$/.test(params.month || '') ? params.month : todayYM;
  const fundsById = new Map(funds.map((f) => [f.id, f]));
  const plan = sim.planFor(ym);
  const s = plan.summary;

  const root = el('div', { class: 'view view-plan' });
  root.append(el('div', { class: 'view-head' }, [
    el('h1', {}, 'Plan'),
    el('div', { class: 'month-nav' }, [
      el('button', { class: 'icon-btn', title: 'Previous month', onClick: () => navigate(`/plan?month=${addMonths(ym, -1)}`) }, '‹'),
      el('span', { class: 'month-label' }, monthLabel(ym)),
      el('button', {
        class: 'icon-btn', title: 'Next month', disabled: ym >= todayYM ? 'disabled' : null,
        onClick: () => navigate(`/plan?month=${addMonths(ym, 1)}`),
      }, '›'),
    ]),
  ]));

  // --- Cash flow -------------------------------------------------------------------
  const flow = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', {}, 'Cash flow'), el('span', { class: 'muted small' }, ym === todayYM ? 'so far this month' : '')]),
    flowRow('Income', s.income, 'pos'),
    flowRow('Fixed bills', -s.hard),
    flowRow('Debt payments', -s.debt),
    flowRow('Flexible spending', -s.soft),
    s.tax ? flowRow('Taxes paid', -s.tax) : null,
    el('div', { class: 'flow-total' }, [
      el('span', {}, 'Net income'),
      el('span', { class: 'flow-total-value ' + (s.net >= 0 ? 'pos' : 'neg') }, fmtUSD(s.net)),
    ]),
  ]);
  if (s.income > 0) flow.append(stackBar(s));
  root.append(flow);

  // --- Where it goes -----------------------------------------------------------------
  const alloc = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', {}, 'Where it goes'),
      el('a', { class: 'link', href: '#/settings?section=plan' }, 'Edit plan'),
    ]),
  ]);
  if (!plan.lines.length) {
    alloc.append(el('div', { class: 'empty' }, [
      el('p', {}, 'You haven’t set a money plan yet.'),
      el('p', { class: 'muted small' }, 'Decide once — e.g. “10% to giving, $150 to a business reserve, 25% of what’s left to the emergency fund” — and every month is split for you.'),
      el('a', { class: 'btn btn-primary btn-sm', href: '#/settings?section=plan' }, 'Set up my plan'),
    ]));
  } else {
    for (const l of plan.lines) {
      const f = fundsById.get(l.fund_id);
      alloc.append(el('div', { class: 'alloc-row' }, [
        el('div', { class: 'rec-main' }, [
          el('span', { class: 'rec-desc' }, f?.name ?? 'Deleted fund'),
          el('span', { class: 'rec-meta' }, l.note),
        ]),
        el('span', { class: 'alloc-amt' }, fmtUSD(l.amount)),
      ]));
    }
    alloc.append(el('div', { class: 'flow-total' }, [
      el('span', {}, [
        'Left unassigned',
        el('span', { class: 'muted small block' }, s.net < 0 ? 'You spent more than you earned this month' : 'Stays in your everyday balance'),
      ]),
      el('span', { class: 'flow-total-value ' + (plan.unallocated >= 0 ? '' : 'neg') }, fmtUSD(plan.unallocated)),
    ]));
  }
  if (settings.plan.start_month && ym < settings.plan.start_month) {
    alloc.append(el('p', { class: 'muted small' }, `Your plan starts ${monthLabel(settings.plan.start_month)} — earlier months aren’t assigned to funds.`));
  }
  root.append(alloc);

  // --- Year table (Income & Expenses tab) ---------------------------------------------
  root.append(yearCard(data, ym));

  return root;
}

function flowRow(label, value, tone) {
  return el('div', { class: 'flow-row' }, [
    el('span', { class: 'muted' }, label),
    el('span', { class: tone || (value < 0 ? '' : '') }, value < 0 ? `−${fmtUSD(-value)}` : fmtUSD(value)),
  ]);
}

// Proportional bar: how income was used.
function stackBar(s) {
  const parts = [
    ['hard', s.hard], ['debt', s.debt], ['soft', s.soft], ['tax', s.tax || 0], ['net', Math.max(0, s.net)],
  ];
  const total = Math.max(s.income, s.hard + s.debt + s.soft + (s.tax || 0));
  return el('div', { class: 'stack' }, [
    el('div', { class: 'stack-bar' }, parts.filter(([, v]) => v > 0).map(([k, v]) =>
      el('span', { class: `seg-${k}`, style: `width:${(v / total) * 100}%`, title: `${k}: ${fmtUSD(v)}` }))),
    el('div', { class: 'stack-legend' }, [
      legend('seg-hard', 'Bills'), legend('seg-debt', 'Debt'), legend('seg-soft', 'Flexible'), s.tax ? legend('seg-tax', 'Tax') : null, legend('seg-net', 'Kept'),
    ]),
  ]);
}

function legend(cls, label) {
  return el('span', {}, [el('span', { class: `legend-dot ${cls}` }), label]);
}

function yearCard({ sim, todayYM, txs, settings }, ym) {
  // Start at the user's first activity so new users don't see a wall of empty months.
  let first = settings.plan.start_month || ym;
  for (const t of txs) if (t.date && t.date.slice(0, 7) < first) first = t.date.slice(0, 7);
  const from = [addMonths(ym, -11), first].sort()[1];
  const months = monthRange(from, ym).filter((m) => m <= todayYM);
  const rows = months.map((m) => ({ ym: m, ...sim.planFor(m).summary }));
  const active = rows.filter((r) => r.income || r.hard || r.debt || r.soft || r.tax);
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const n = Math.max(1, active.length);

  const table = el('div', { class: 'ytable' }, [
    el('div', { class: 'yrow yhead' }, ['Month', 'Income', 'Spent', 'Net'].map((h) => el('span', {}, h))),
    ...rows.slice().reverse().map((r) => {
      const spent = r.hard + r.debt + r.soft + (r.tax || 0);
      return el('div', { class: 'yrow' + (r.ym === ym ? ' current' : '') }, [
        el('span', {}, shortMonth(r.ym)),
        el('span', {}, r.income ? fmtUSD(r.income) : '—'),
        el('span', {}, spent ? fmtUSD(spent) : '—'),
        el('span', { class: r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : 'muted' }, r.net ? fmtUSD(r.net) : '—'),
      ]);
    }),
    el('div', { class: 'yrow ytotal' }, [
      el('span', {}, 'Total'), el('span', {}, fmtUSD(sum('income'))),
      el('span', {}, fmtUSD(sum('hard') + sum('debt') + sum('soft') + sum('tax'))), el('span', {}, fmtUSD(sum('net'))),
    ]),
    el('div', { class: 'yrow ytotal muted' }, [
      el('span', {}, 'Monthly avg'), el('span', {}, fmtUSD(sum('income') / n)),
      el('span', {}, fmtUSD((sum('hard') + sum('debt') + sum('soft') + sum('tax')) / n)), el('span', {}, fmtUSD(sum('net') / n)),
    ]),
  ]);
  return el('div', { class: 'card' }, [el('h2', {}, months.length > 1 ? `Last ${months.length} months` : 'Month summary'), table]);
}
