// =============================================================================
// finance.js — Pure calculation engine (no DOM, no storage). Every number on
// the Plan, Funds, Debts and Rentals pages comes from here, so it is unit-
// tested in isolation (see tests/finance.test.mjs).
//
// Concepts (generalized from a real household spreadsheet):
//   • Month summary   income − hard − debt − soft = net income
//   • Money plan      ordered rules that distribute net income into funds:
//                       percent_income     e.g. "20% of income → Tax reserve"
//                       percent_net        e.g. "10% of net → Giving"
//                       fixed              e.g. "$150/month → Business Reserve"
//                       percent_remainder  e.g. "25% of what's left → Emergency
//                                           (10% once its goal is reached)"
//   • Funds           earmarked balances (envelopes): starting balance
//                     + plan allocations + money added − money spent from it
//                     + interest (APY, credited monthly for completed months)
//   • Debts           monthly amortization ledger driven by logged payments
//   • Passive income  received vs expected per stream
//   • Taxes           estimated tax on income not taxed at source, deductions,
//                     payments, full-year projection and payment periods
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
// Counts only "plan" cash flow: money paid from a fund was already set aside and
// transfers just move money between funds, so neither is income or spending here.
export function monthSummary(ym, txs, catById) {
  let income = 0, hard = 0, soft = 0, debt = 0, tax = 0;
  for (const t of txs) {
    if (ymOf(t) !== ym || t.fund_id) continue;
    if (t.type === 'income') {
      income += usd(t);
    } else if (t.type === 'expense') {
      const kind = catById?.get(t.category_id)?.kind;
      if (t.debt_id || kind === 'debt') debt += usd(t);
      else if (kind === 'tax') tax += usd(t);
      else if (kind === 'hard') hard += usd(t);
      else soft += usd(t);
    }
  }
  const net = income - hard - debt - soft - tax;
  return { ym, income: r2(income), hard: r2(hard), debt: r2(debt), soft: r2(soft), tax: r2(tax), net: r2(net) };
}

// --- Money plan ---------------------------------------------------------------
const ORDER = { percent_income: 0, percent_net: 1, fixed: 2, percent_remainder: 3 };

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
    if (r.method === 'percent_income') {
      const amt = r2(Math.max(0, summary.income) * (Number(r.value) || 0) / 100);
      lines.push({ rule: r, fund_id: r.fund_id, amount: amt, note: `${r.value}% of income` });
      used += amt;
    } else if (r.method === 'percent_net') {
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
  const interestByMonth = new Map();
  for (const ym of monthRange(first, todayYM)) {
    const startBal = { ...bal };
    const delta = {};
    for (const f of funds || []) delta[f.id] = { alloc: 0, added: 0, spent: 0, interest: 0 };

    if (ym >= start) {
      const summary = monthSummary(ym, txs, catById);
      const plan = allocate(summary, rules, fundsById, startBal);
      plans.set(ym, withManual({ summary, ...plan }, ym, txs));
      for (const l of plan.lines) {
        if (delta[l.fund_id]) { delta[l.fund_id].alloc += l.amount; bal[l.fund_id] += l.amount; }
      }
    }
    for (const t of txs) {
      if (!t.fund_id || !delta[t.fund_id] || ymOf(t) !== ym) continue;
      if (t.type === 'expense') { delta[t.fund_id].spent += usd(t); bal[t.fund_id] -= usd(t); }
      else if (t.subtype === 'interest') { delta[t.fund_id].interest += usd(t); bal[t.fund_id] += usd(t); } // logged interest
      else { delta[t.fund_id].added += usd(t); bal[t.fund_id] += usd(t); } // transfer / income into fund
    }
    // Estimated interest is credited at the end of each completed month — only
    // for funds kept somewhere that pays interest (cash in hand earns nothing).
    if (ym < todayYM) {
      for (const f of funds || []) {
        if (interestMode(f) !== 'auto') continue;
        const i = r2(Math.max(0, bal[f.id]) * (Number(f.apy) || 0) / 100 / 12);
        delta[f.id].interest += i;
        bal[f.id] += i;
      }
    }
    interestByMonth.set(ym, r2((funds || []).reduce((a, f) => a + delta[f.id].interest, 0)));
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
      interestThisMonth: interestMode(f) === 'auto' ? r2(Math.max(0, b) * (Number(f.apy) || 0) / 100 / 12) : 0, // projected
      interestMode: interestMode(f),
      totals: mapR2(totals[f.id]),
      history: history[f.id],
      thisMonth: history[f.id].find((h) => h.ym === todayYM) || null,
    };
  });

  return {
    funds: result,
    total: r2(result.reduce((s, x) => s + x.balance, 0)),
    interestToDate: r2(result.reduce((s, x) => s + x.totals.interest, 0)),
    interestByMonth,
    plans,
    planFor(ym) {
      if (plans.has(ym)) return plans.get(ym);
      // Months outside the simulated window (future, or before plan start):
      // compute a standalone plan using current balances.
      const summary = monthSummary(ym, txs, catById);
      return withManual({ summary, ...allocate(summary, rules, fundsById, { ...bal }) }, ym, txs);
    },
  };
}

// Money the user moved into funds by hand this month ("Assign money"). It
// comes out of what's left to assign; the plan's automatic split doesn't.
export function manualAssigned(ym, txs) {
  return r2(txs.filter((t) => t.type === 'transfer' && t.fund_id && ymOf(t) === ym)
    .reduce((a, t) => a + usd(t), 0));
}
function withManual(plan, ym, txs) {
  const manual = manualAssigned(ym, txs);
  const auto = r2(plan.lines.reduce((a, l) => a + l.amount, 0));
  return { ...plan, manual, autoAssigned: auto, leftToAssign: r2(plan.unallocated - manual) };
}

// 'auto' = estimate from APY · 'manual' = user logs actual interest · 'none' = cash
export function interestMode(f) {
  if (f.interest_mode) return f.interest_mode;
  return Number(f.apy) > 0 ? 'auto' : 'none';
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

// Standard loan payment for principal pv over n months at monthly rate r.
export function pmt(r, n, pv) {
  if (!(n > 0) || !(pv > 0)) return 0;
  if (r === 0) return pv / n;
  return (pv * r) / (1 - Math.pow(1 + r, -n));
}

// The planned (minimum) payment: entered directly, or derived from a term.
export function minimumPayment(debt) {
  const p = Number(debt.payment) || 0;
  if (p > 0) return p;
  return r2(pmt((Number(debt.apr) || 0) / 100 / 12, Number(debt.term_months) || 0, Number(debt.principal) || 0));
}

// Monthly ledger. Every month is assumed to get the minimum payment on its due
// day; if the user logs payments for a month, the logged total replaces the
// assumption (so paying more shortens the loan, paying less shows up too).
// `todayDay` lets the current month stay "not yet due" before the due day.
export function debtLedger(debt, txs, todayYM, todayDay = 31) {
  const principal = Number(debt.principal) || 0;
  const r = (Number(debt.apr) || 0) / 100 / 12;
  const start = debt.start_month || todayYM;
  const minimum = minimumPayment(debt);
  const dueDay = Number(debt.due_day) || 1;
  const loggedByMonth = new Map();
  for (const t of txs) {
    if (t.debt_id !== debt.id || t.type !== 'expense') continue;
    loggedByMonth.set(ymOf(t), (loggedByMonth.get(ymOf(t)) || 0) + usd(t));
  }
  let bal = principal;
  const rows = [];
  let totalPaid = 0, interestPaid = 0, extraPaid = 0;
  for (const ym of monthRange(start, todayYM)) {
    if (bal <= 0.005) break;
    const interest = bal * r;
    const logged = loggedByMonth.get(ym);
    let paid, status;
    if (logged !== undefined) {
      paid = logged;
      status = logged > minimum + 0.005 ? 'extra' : logged + 0.005 < minimum ? 'short' : 'paid';
      extraPaid += Math.max(0, logged - minimum);
    } else if (ym === todayYM && todayDay < dueDay) {
      paid = 0; status = 'upcoming';
    } else {
      paid = Math.min(minimum, bal + interest); status = 'assumed';
    }
    const end = Math.max(0, bal + interest - paid);
    rows.push({ ym, start: r2(bal), interest: r2(interest), paid: r2(paid), principal: r2(paid - interest), end: r2(end), status });
    totalPaid += paid; interestPaid += interest;
    bal = end;
  }
  const monthsLeft = nper(r, minimum, bal);
  return {
    rows,
    minimum: r2(minimum),
    balance: r2(bal),
    totalPaid: r2(totalPaid),
    interestPaid: r2(interestPaid),
    extraPaid: r2(extraPaid),
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
// Any income that isn't a paycheck: dividends, interest, rental income, side
// business, royalties. Optional expected monthly amount → behind / ahead.
export function streamLedger(stream, txs, todayYM) {
  const expected = Number(stream.expected_monthly) || 0;
  const start = stream.start_month || todayYM;
  let behind = 0, received = 0;
  const rows = [];
  for (const ym of monthRange(start, todayYM)) {
    let rec = 0;
    for (const t of txs) {
      if (t.stream_id === stream.id && ymOf(t) === ym && t.type === 'income') rec += usd(t);
    }
    behind += expected - rec;
    received += rec;
    rows.push({ ym, expected: r2(expected), received: r2(rec), behind: r2(behind) });
  }
  const months = Math.max(1, rows.length);
  return {
    rows,
    behind: expected > 0 ? r2(behind) : 0,
    received: r2(received),
    avgMonthly: r2(received / months),
    last12: r2(rows.slice(-12).reduce((a, r) => a + r.received, 0)),
    thisMonth: rows.length ? rows[rows.length - 1].received : 0,
  };
}

// --- Taxes ----------------------------------------------------------------------------
// Estimates only. Each income category says how it's taxed:
//   'withheld' — tax already taken out before you're paid (most paychecks)
//   'owed'     — you owe tax on it yourself (side income, interest, dividends)
//   'none'     — not taxable (gifts, refunds)
// Expense categories can be marked deductible. Tax payments are expenses in a
// category of kind 'tax'.
export const DEFAULT_TAX = {
  year_start_month: 1,       // 1 = January; e.g. 4 for UK-style, 7 for AU-style years
  mode: 'flat',              // 'flat' | 'brackets'
  rate: 15,                  // flat % on income you owe tax on
  brackets: [{ from: 0, rate: 10 }, { from: 10000, rate: 20 }],
  allowance: 0,              // tax-free amount / standard deduction for the year
  frequency: 'quarterly',    // 'quarterly' | 'monthly' | 'yearly'
  main_income: 'withheld',   // treatment for the default "Income" category
};

export function bracketTax(amount, brackets) {
  const b = [...(brackets || [])].map((x) => ({ from: Number(x.from) || 0, rate: Number(x.rate) || 0 }))
    .sort((a, c) => a.from - c.from);
  let tax = 0;
  for (let i = 0; i < b.length; i++) {
    const lo = b[i].from, hi = i + 1 < b.length ? b[i + 1].from : Infinity;
    if (amount > lo) tax += (Math.min(amount, hi) - lo) * b[i].rate / 100;
  }
  return tax;
}

export function taxYearOf(ym, startMonth = 1) {
  const [y, m] = ym.split('-').map(Number);
  const sy = m >= startMonth ? y : y - 1;
  const start = `${sy}-${String(startMonth).padStart(2, '0')}`;
  return { start, end: addMonths(start, 11), label: startMonth === 1 ? String(sy) : `${sy}–${String(sy + 1).slice(2)}` };
}

export function taxTreatment(cat, tax) {
  if (cat?.tax_treatment) return cat.tax_treatment;
  if ((cat?.name || '').toLowerCase() === 'income') return tax.main_income || 'withheld';
  return 'owed';
}

function estimate(tax, withheld, owed, deductions) {
  const allowance = Number(tax.allowance) || 0;
  if (tax.mode === 'brackets') {
    // Tax on everything, minus the part already covered by withholding.
    const all = bracketTax(Math.max(0, withheld + owed - deductions - allowance), tax.brackets);
    const covered = bracketTax(Math.max(0, withheld - allowance), tax.brackets);
    return Math.max(0, all - covered);
  }
  return Math.max(0, owed - deductions - allowance) * (Number(tax.rate) || 0) / 100;
}

export function taxSummary({ tax: taxIn, txs, catById, interestByMonth, todayYM }) {
  const tax = { ...DEFAULT_TAX, ...(taxIn || {}) };
  const year = taxYearOf(todayYM, Number(tax.year_start_month) || 1);
  const months = monthRange(year.start, todayYM);
  const inYear = (ym) => ym >= year.start && ym <= todayYM;

  const bySource = new Map();  // category name → { treatment, amount }
  const deductible = new Map(); // category name → amount
  const perMonth = new Map(months.map((m) => [m, { withheld: 0, owed: 0, none: 0, deductions: 0, paid: 0 }]));
  const add = (map, key, amt, extra = {}) => {
    const cur = map.get(key) || { amount: 0, ...extra };
    cur.amount += amt; map.set(key, cur);
  };

  for (const t of txs) {
    const ym = ymOf(t);
    if (!inYear(ym)) continue;
    const pm = perMonth.get(ym);
    const cat = catById?.get(t.category_id);
    if (t.type === 'income') {
      if (t.fund_id && t.subtype !== 'interest') continue; // money moved into a fund isn't new income
      const tr = t.subtype === 'interest' ? 'owed' : taxTreatment(cat, tax);
      pm[tr] += usd(t);
      add(bySource, t.subtype === 'interest' ? 'Interest (logged)' : cat?.name || 'Uncategorized', usd(t), { treatment: tr });
    } else if (t.type === 'expense') {
      if (cat?.kind === 'tax') pm.paid += usd(t);
      else if (cat?.tax_deductible) { pm.deductions += usd(t); add(deductible, cat.name, usd(t)); }
    }
  }
  // Estimated (auto) fund interest is taxable income too.
  let fundInterest = 0;
  for (const m of months) {
    const i = interestByMonth?.get(m) || 0;
    // Logged interest is already counted from transactions; interestByMonth
    // includes both, so only add the estimated remainder.
    const logged = txs.filter((t) => t.subtype === 'interest' && ymOf(t) === m && t.type === 'income')
      .reduce((a, t) => a + usd(t), 0);
    const est = Math.max(0, i - logged);
    if (est > 0) { perMonth.get(m).owed += est; fundInterest += est; }
  }
  if (fundInterest > 0) add(bySource, 'Interest on savings (est.)', fundInterest, { treatment: 'owed' });

  const sum = (k, list = months) => list.reduce((a, m) => a + perMonth.get(m)[k], 0);
  const withheld = sum('withheld'), owed = sum('owed'), deductions = sum('deductions'), paid = sum('paid');
  const est = estimate(tax, withheld, owed, deductions);

  // Project the full year: what's happened so far + the monthly pace since the
  // user started tracking × the months left in the tax year.
  let firstActive = todayYM;
  for (const t of txs) { const m = ymOf(t); if (inYear(m) && m < firstActive) firstActive = m; }
  const activeMonths = Math.max(1, monthRange(firstActive, todayYM).length);
  const monthsLeft = 12 - months.length;
  const proj = (x) => x + (x / activeMonths) * monthsLeft;
  const projected = estimate(tax, proj(withheld), proj(owed), proj(deductions));

  // Payment periods (cumulative estimate through each period end − paid).
  const periodLen = tax.frequency === 'monthly' ? 1 : tax.frequency === 'yearly' ? 12 : 3;
  const periods = [];
  for (let i = 0; i < 12 / periodLen; i++) {
    const pStart = addMonths(year.start, i * periodLen);
    const pEnd = addMonths(pStart, periodLen - 1);
    const done = months.filter((m) => m <= pEnd);
    const inP = months.filter((m) => m >= pStart && m <= pEnd);
    const cumEst = estimate(tax, sum('withheld', done), sum('owed', done), sum('deductions', done));
    const prevDone = months.filter((m) => m < pStart);
    const prevEst = estimate(tax, sum('withheld', prevDone), sum('owed', prevDone), sum('deductions', prevDone));
    periods.push({
      start: pStart, end: pEnd,
      status: pStart > todayYM ? 'future' : pEnd < todayYM ? 'past' : 'current',
      estimated: r2(cumEst - prevEst),
      paid: r2(sum('paid', inP)),
      tracked: pEnd >= firstActive,
    });
  }

  return {
    tax, year,
    income: { withheld: r2(withheld), owed: r2(owed), none: r2(sum('none')), total: r2(withheld + owed + sum('none')) },
    deductions: r2(deductions),
    taxableOwed: r2(Math.max(0, owed - deductions - (Number(tax.allowance) || 0))),
    estimated: r2(est),
    paid: r2(paid),
    remaining: r2(est - paid),
    projectedYear: r2(projected),
    projectedRemaining: r2(projected - paid),
    suggestedMonthly: r2(Math.max(0, projected - paid) / Math.max(1, monthsLeft + 1)),
    bySource: [...bySource.entries()].map(([name, v]) => ({ name, ...v, amount: r2(v.amount) })).sort((a, b) => b.amount - a.amount),
    deductible: [...deductible.entries()].map(([name, v]) => ({ name, amount: r2(v.amount) })).sort((a, b) => b.amount - a.amount),
    periods,
  };
}

// --- Goal dates -----------------------------------------------------------------------
// A fund with a goal and a "reach it by" month: how much to save each month,
// and whether recent saving is on pace. `f` is one entry of simulateFunds().funds.
// Pace = average net growth (plan + deposits + interest − spending) over the
// last up-to-3 complete months.
export function goalPace(f, targetYM, todayYM) {
  const goal = Number(f?.goal) || 0;
  if (!(goal > 0) || !/^\d{4}-\d{2}$/.test(targetYM || '')) return null;
  const left = Math.max(0, goal - f.balance);
  if (left <= 0.005) return { status: 'reached', left: 0, perMonth: 0, monthsLeft: 0, pace: 0, projectedYM: null };
  // Months left, counting the current month: Nov → Dec is 2 months of saving.
  const monthsLeft = monthRange(todayYM, targetYM).length;
  if (targetYM < todayYM) return { status: 'overdue', left: r2(left), perMonth: r2(left), monthsLeft: 0, pace: 0, projectedYM: null };
  const done = (f.history || []).filter((h) => h.ym < todayYM).slice(-3);
  const pace = done.length ? done.reduce((a, h) => a + (h.end - h.start), 0) / done.length : 0;
  const perMonth = left / monthsLeft;
  const projectedYM = pace > 0 ? addMonths(todayYM, Math.ceil(left / pace) - 1) : null;
  const status = !done.length ? 'new' : pace + 0.005 >= perMonth ? 'on_track' : 'behind';
  return { status, left: r2(left), perMonth: r2(perMonth), monthsLeft, pace: r2(pace), projectedYM };
}
