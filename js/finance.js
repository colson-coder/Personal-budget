// =============================================================================
// finance.js — Pure calculation engine (no DOM, no storage). Every number on
// the Plan, Funds, Debts and Rentals pages comes from here, so it is unit-
// tested in isolation (see tests/finance.test.mjs).
//
// Concepts (generalized from a real household spreadsheet):
//   • Month summary   income − hard − debt − soft = net income
//   • Money plan      ordered rules that distribute net income into funds:
//                       percent_net        e.g. "10% of net → Giving"
//                       fixed              e.g. "$150/month → Business Reserve"
//                       percent_remainder  e.g. "25% of what's left → Emergency
//                                           (10% once its goal is reached)"
//   • Funds           earmarked balances (envelopes): starting balance
//                     + plan allocations + money added − money spent from it
//                     + interest (APY, credited monthly for completed months)
//   • Debts           monthly amortization ledger driven by logged payments
//   • Rentals         rent due vs received → running balance owed, deposits held
//
// All amounts are USD (transactions already store amount_usd). Months are
// "YYYY-MM" strings on the app's fixed calendar.
// =============================================================================

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

// Inclusive list of months from a to b ("YYYY-MM"); empty if a > b.
export function monthRange(a, b) {
  const out = [];
  for (let ym = a; ym <= b && out.length < 1200; ym = addMonths(ym, 1)) out.push(ym);
  return out;
}

const usd = (t) => Number(t.amount_usd) || 0;
const ymOf = (t) => (t.date || '').slice(0, 7);

// --- Month summary -------------------------------------------------------------
// Counts only "plan" cash flow: money paid from a fund was already set aside,
// transfers just move money between envelopes, and rental deposits are held
// (refundable), so none of those are income or spending here.
export function monthSummary(ym, txs, catById) {
  let income = 0, hard = 0, soft = 0, debt = 0;
  for (const t of txs) {
    if (ymOf(t) !== ym || t.fund_id || t.subtype === 'deposit') continue;
    if (t.type === 'income') {
      income += usd(t);
    } else if (t.type === 'expense') {
      const kind = catById?.get(t.category_id)?.kind;
      if (t.debt_id || kind === 'debt') debt += usd(t);
      else if (kind === 'hard') hard += usd(t);
      else soft += usd(t);
    }
  }
  const net = income - hard - debt - soft;
  return { ym, income: r2(income), hard: r2(hard), debt: r2(debt), soft: r2(soft), net: r2(net) };
}

// --- Money plan ---------------------------------------------------------------
const ORDER = { percent_net: 0, fixed: 1, percent_remainder: 2 };

export function sortRules(rules) {
  return [...(rules || [])].sort((a, b) => (ORDER[a.method] ?? 9) - (ORDER[b.method] ?? 9));
}

// Distribute one month's net income. `balances` = fund balances at the start
// of the month (used to switch to the after-goal percentage).
export function allocate(summary, rules, fundsById, balances = {}) {
  const lines = [];
  const pos = Math.max(0, summary.net);
  let used = 0;
  for (const r of sortRules(rules)) {
    if (r.method === 'percent_net') {
      const amt = r2(pos * (Number(r.value) || 0) / 100);
      lines.push({ rule: r, fund_id: r.fund_id, amount: amt, note: `${r.value}% of net income` });
      used += amt;
    } else if (r.method === 'fixed') {
      // Like the spreadsheet: fixed set-asides only apply in months with income.
      const amt = summary.income > 0 ? r2(r.value) : 0;
      lines.push({ rule: r, fund_id: r.fund_id, amount: amt, note: 'Fixed amount each month' });
      used += amt;
    }
  }
  const remainder = r2(summary.net - used);
  const remBase = Math.max(0, remainder);
  let usedRem = 0;
  for (const r of sortRules(rules)) {
    if (r.method !== 'percent_remainder') continue;
    const f = fundsById.get(r.fund_id);
    const goal = Number(f?.goal_usd) || 0;
    const reached = goal > 0 && (balances[r.fund_id] ?? 0) >= goal;
    const hasAfter = r.value_after_goal !== null && r.value_after_goal !== undefined && r.value_after_goal !== '';
    const pct = reached && hasAfter ? Number(r.value_after_goal) : Number(r.value) || 0;
    const amt = r2(remBase * pct / 100);
    lines.push({
      rule: r, fund_id: r.fund_id, amount: amt,
      note: `${pct}% of what's left${reached ? ' (goal reached)' : ''}`,
    });
    usedRem += amt;
  }
  return { lines, remainder, unallocated: r2(remainder - usedRem) };
}

// --- Funds simulation ---------------------------------------------------------
// Walks month by month from the earliest relevant month to `todayYM`,
// producing each fund's history and the plan for every month.
export function simulateFunds({ settings, funds, txs, catById, todayYM }) {
  const fundsById = new Map((funds || []).map((f) => [f.id, f]));
  const rules = (settings?.plan?.rules || []).filter((r) => fundsById.has(r.fund_id));
  const start = settings?.plan?.start_month || todayYM;

  let first = start;
  for (const t of txs) if (t.fund_id && fundsById.has(t.fund_id) && ymOf(t) && ymOf(t) < first) first = ymOf(t);

  const bal = {};
  const history = {};
  const totals = {};
  for (const f of funds || []) {
    bal[f.id] = Number(f.starting_balance) || 0;
    history[f.id] = [];
    totals[f.id] = { allocated: 0, added: 0, spent: 0, interest: 0 };
  }

  const plans = new Map();
  for (const ym of monthRange(first, todayYM)) {
    const startBal = { ...bal };
    const delta = {};
    for (const f of funds || []) delta[f.id] = { alloc: 0, added: 0, spent: 0, interest: 0 };

    if (ym >= start) {
      const summary = monthSummary(ym, txs, catById);
      const plan = allocate(summary, rules, fundsById, startBal);
      plans.set(ym, { summary, ...plan });
      for (const l of plan.lines) {
        if (delta[l.fund_id]) { delta[l.fund_id].alloc += l.amount; bal[l.fund_id] += l.amount; }
      }
    }
    for (const t of txs) {
      if (!t.fund_id || !delta[t.fund_id] || ymOf(t) !== ym) continue;
      if (t.type === 'expense') { delta[t.fund_id].spent += usd(t); bal[t.fund_id] -= usd(t); }
      else { delta[t.fund_id].added += usd(t); bal[t.fund_id] += usd(t); } // transfer / income into fund
    }
    // Interest is credited at the end of each completed month.
    if (ym < todayYM) {
      for (const f of funds || []) {
        const i = r2(Math.max(0, bal[f.id]) * (Number(f.apy) || 0) / 100 / 12);
        delta[f.id].interest = i;
        bal[f.id] += i;
      }
    }
    for (const f of funds || []) {
      const d = delta[f.id];
      totals[f.id].allocated += d.alloc; totals[f.id].added += d.added;
      totals[f.id].spent += d.spent; totals[f.id].interest += d.interest;
      history[f.id].push({ ym, start: r2(startBal[f.id]), ...mapR2(d), end: r2(bal[f.id]) });
    }
  }

  const result = (funds || []).map((f) => {
    const b = r2(bal[f.id]);
    const goal = Number(f.goal_usd) || 0;
    return {
      fund: f,
      balance: b,
      goal,
      pctOfGoal: goal > 0 ? Math.min(1, Math.max(0, b / goal)) : null,
      leftToGoal: goal > 0 ? r2(Math.max(0, goal - b)) : null,
      interestThisMonth: r2(Math.max(0, b) * (Number(f.apy) || 0) / 100 / 12), // projected
      totals: mapR2(totals[f.id]),
      history: history[f.id],
      thisMonth: history[f.id].find((h) => h.ym === todayYM) || null,
    };
  });

  return {
    funds: result,
    total: r2(result.reduce((s, x) => s + x.balance, 0)),
    interestToDate: r2(result.reduce((s, x) => s + x.totals.interest, 0)),
    plans,
    planFor(ym) {
      if (plans.has(ym)) return plans.get(ym);
      // Months outside the simulated window (future, or before plan start):
      // compute a standalone plan using current balances.
      const summary = monthSummary(ym, txs, catById);
      return { summary, ...allocate(summary, rules, fundsById, { ...bal }) };
    },
  };
}

function mapR2(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = r2(v);
  return out;
}

// --- Debts ---------------------------------------------------------------------
// Months needed to pay `pv` at monthly rate r with payment pmt (Excel NPER).
export function nper(r, pmt, pv) {
  if (pv <= 0) return 0;
  if (!(pmt > 0)) return Infinity;
  if (r === 0) return Math.ceil(pv / pmt);
  if (pmt <= pv * r) return Infinity; // payment doesn't cover interest
  return Math.ceil(-Math.log(1 - (r * pv) / pmt) / Math.log(1 + r));
}

export function debtLedger(debt, txs, todayYM) {
  const principal = Number(debt.principal) || 0;
  const r = (Number(debt.apr) || 0) / 100 / 12;
  const start = debt.start_month || todayYM;
  const paidByMonth = new Map();
  for (const t of txs) {
    if (t.debt_id !== debt.id || t.type !== 'expense') continue;
    paidByMonth.set(ymOf(t), (paidByMonth.get(ymOf(t)) || 0) + usd(t));
  }
  let bal = principal;
  const rows = [];
  let totalPaid = 0, interestPaid = 0;
  for (const ym of monthRange(start, todayYM)) {
    const interest = bal * r;
    const paid = paidByMonth.get(ym) || 0;
    const end = Math.max(0, bal + interest - paid);
    rows.push({ ym, start: r2(bal), interest: r2(interest), paid: r2(paid), principal: r2(paid - interest), end: r2(end) });
    totalPaid += paid; interestPaid += interest;
    bal = end;
  }
  const payment = Number(debt.payment) || 0;
  const monthsLeft = nper(r, payment, bal);
  return {
    rows,
    balance: r2(bal),
    totalPaid: r2(totalPaid),
    interestPaid: r2(interestPaid),
    principalPaid: r2(principal - bal),
    pctPaid: principal > 0 ? Math.max(0, (principal - bal) / principal) : 0,
    interestShare: totalPaid > 0 ? interestPaid / totalPaid : 0,
    monthsLeft,
    payoffYM: isFinite(monthsLeft) ? addMonths(todayYM, monthsLeft) : null,
    monthlyInterestNow: r2(bal * r),
  };
}

// Forward projection from a balance: returns monthly balances until paid off
// (or capped), plus total interest — used for the "pay extra" what-if.
export function projectDebt(balance, apr, payment, extra = 0, cap = 600) {
  const r = (Number(apr) || 0) / 100 / 12;
  const pmt = (Number(payment) || 0) + (Number(extra) || 0);
  let bal = balance, interest = 0;
  const points = [r2(bal)];
  while (bal > 0.005 && points.length <= cap) {
    const i = bal * r;
    if (pmt <= i) return { points, months: Infinity, interest: Infinity };
    interest += i;
    bal = Math.max(0, bal + i - pmt);
    points.push(r2(bal));
  }
  return { points, months: points.length - 1, interest: r2(interest) };
}

// --- Passive income streams ------------------------------------------------------
// Any recurring income source: rental, dividends, interest, royalties, a side
// business. Optional expected monthly amount → running "behind / ahead".
// Rentals can also hold a security deposit (subtype 'deposit', not income).
export function streamLedger(stream, txs, todayYM) {
  const expected = Number(stream.expected_monthly) || 0;
  const start = stream.start_month || todayYM;
  let behind = 0;
  let deposit = Number(stream.deposit_start) || 0;
  let received = 0;
  const rows = [];
  for (const ym of monthRange(start, todayYM)) {
    let rec = 0, dep = 0;
    for (const t of txs) {
      if (t.stream_id !== stream.id || ymOf(t) !== ym) continue;
      if (t.subtype === 'deposit') dep += t.type === 'expense' ? -usd(t) : usd(t); // refunds are expenses
      else if (t.type === 'income') rec += usd(t);
    }
    behind += expected - rec;
    deposit += dep;
    received += rec;
    rows.push({ ym, expected: r2(expected), received: r2(rec), behind: r2(behind), depositChange: r2(dep), deposit: r2(deposit) });
  }
  const months = Math.max(1, rows.length);
  const last12 = rows.slice(-12);
  return {
    rows,
    behind: expected > 0 ? r2(behind) : 0,
    deposit: r2(deposit),
    received: r2(received),
    avgMonthly: r2(received / months),
    last12: r2(last12.reduce((a, r) => a + r.received, 0)),
    thisMonth: rows.length ? rows[rows.length - 1].received : 0,
  };
}
