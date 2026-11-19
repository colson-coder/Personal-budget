// =============================================================================
// insights.js — The free money coach. Plain rules over the user's own numbers
// (no AI, nothing leaves the device). Pure and unit-tested
// (tests/insights.test.mjs).
//
// The advice follows principles that the classic personal-finance books agree on:
//
//  • The Richest Man in Babylon (Clason): the seven cures:
//      1 keep at least a tenth of all you earn   2 control your spending
//      3 make your money multiply                4 guard it from loss
//      5 own your home   6 insure a future income   7 increase your ability to earn
//    plus Arkad's debt plan: live on 70%, save 10%, pay creditors 20%.
//  • A widely shared order of priorities (e.g. The Total Money Makeover, the
//    Bogleheads "prime directive"): stop the bleeding, build a small cushion,
//    clear expensive debt, fill a full 3–6 month cushion, then invest for the
//    future.
//  • Spending guides like 50/30/20 (All Your Worth) and the "conscious spending
//    plan" (I Will Teach You to Be Rich): fixed costs ideally ≤ 50–60% of income.
//  • The Psychology of Money: leave room for error, and focus on one thing at a time.
//
// The coach shows ONE "next step" from that ladder, plus specific alerts
// (overspending, budgets, taxes, debts that never shrink). It's general
// guidance about the user's own numbers. It doesn't recommend specific
// investments and isn't financial advice.
//
// Each insight has the shape:
//   { id, tone: 'warn' | 'tip' | 'good', title, body, href, score, why?, step? }
// A higher score means more important, and the list comes back sorted.
// =============================================================================

import { addMonths, monthSummary, debtLedger, projectDebt, taxSummary, r2 } from './finance.js';

const ymOf = (t) => (t.date || '').slice(0, 7);
const usd = (t) => Number(t.amount_usd) || 0;

// Debt at or above this APR is "expensive": paying it off beats any safe return.
export const HIGH_APR = 8;
const BABYLON = 'The Richest Man in Babylon';
const LADDER = 6;

export function buildInsights(data, { fmt = (n) => String(r2(n)), today = null, max = 8 } = {}) {
  const { settings = {}, catById = new Map(), categories = [], txs = [], debts = [], streams = [], sim, todayYM } = data;
  const m = settings.modules || {};
  const day = today ? Number(today.slice(8, 10)) : 15;
  const daysInMonth = new Date(Number(todayYM.slice(0, 4)), Number(todayYM.slice(5, 7)), 0).getDate();
  const out = [];
  const add = (x) => out.push(x);

  if (!txs.length) {
    add({ id: 'start', tone: 'tip', score: 100, href: '#/add',
      title: 'Start with this month’s income',
      body: 'Add what you earned and a few expenses. Tips will appear here once there’s enough to go on.' });
    return out;
  }

  // ---- The user's typical month ---------------------------------------------------
  // Up to the last 3 complete months with any activity. With no history yet,
  // fall back to this month so far (still useful in week one).
  const active = new Set(txs.map(ymOf));
  const past = [1, 2, 3].map((i) => addMonths(todayYM, -i)).filter((ym) => active.has(ym));
  const sums = (past.length ? past : [todayYM]).map((ym) => monthSummary(ym, txs, catById));
  const fromHistory = past.length > 0;
  const avg = (k) => sums.reduce((a, s) => a + s[k], 0) / sums.length;
  const income = avg('income');
  const essentials = avg('hard') + avg('debt');           // what must be paid every month
  const spend = essentials + avg('soft') + avg('tax');
  const rate = income > 0 ? (income - spend) / income : null; // share of income kept
  const period = !fromHistory ? 'So far this month' : past.length === 1 ? 'Last month' : `Over the last ${past.length} months`;

  // ---- Funds: cushion and money put to work ----------------------------------------
  const funds = (m.plan && sim) ? sim.funds : [];
  const ef = funds.find((f) => /emergency|rainy|cushion|safety/i.test(f.fund.name))
    || funds.find((f) => f.fund.kind === 'savings' && !/trip|holiday|vacation|car|wedding|gift/i.test(f.fund.name));
  const cushion = ef && essentials > 0 ? ef.balance / essentials : null; // months covered
  const working = funds.some((f) => /invest|retire|pension|401|ira|isa|brokerage|stocks|index/i.test(f.fund.name))
    || (m.income && streams.length > 0);

  // ---- Debts -------------------------------------------------------------------------
  const ledgers = (m.debts ? debts : [])
    .map((d) => ({ d, apr: Number(d.apr) || 0, l: debtLedger(d, txs, todayYM, day) }))
    .filter((x) => x.l.balance > 0.5)
    .sort((a, b) => b.apr - a.apr);                        // avalanche order
  const payable = ledgers.filter((x) => isFinite(x.l.monthsLeft));
  const expensive = payable.filter((x) => x.apr >= HIGH_APR);

  // ---- Urgent alerts -----------------------------------------------------------------
  for (const { d, l } of ledgers) {
    if (!isFinite(l.monthsLeft)) add({ id: 'debt-stuck-' + d.id, tone: 'warn', score: 92, href: '#/debts',
      title: `${d.name} will never shrink at the minimum`,
      body: `Its interest is about ${fmt(l.monthlyInterestNow)} a month, and that’s more than the payment, so the balance keeps growing. Pay more than ${fmt(l.monthlyInterestNow)} a month, or ask the lender for a lower rate.`,
      why: 'Guard your money from loss' });
  }

  if (m.plan && sim) {
    const plan = sim.planFor(todayYM);
    if (plan.leftToAssign < -0.5) {
      add({ id: 'overspent', tone: 'warn', score: 95, href: '#/plan',
        title: `${fmt(-plan.leftToAssign)} more went out than came in this month`,
        body: 'Cover it on purpose, by spending from a fund or cutting back for the rest of the month, so it doesn’t turn into debt.',
        why: `${BABYLON} · control your spending` });
    } else if (plan.leftToAssign > 0.5 && plan.summary.income > 0) {
      add({ id: 'unassigned', tone: 'tip', score: 70, href: '#/dashboard',
        title: `${fmt(plan.leftToAssign)} doesn’t have a job yet`,
        body: 'Money without a plan tends to get spent. Use Assign to move it into a fund now, even a small part of it.',
        why: 'Tell your money where to go' });
    }
  }

  // ---- The ladder: one next step -----------------------------------------------------
  const step = nextStep();
  if (step) add(step);

  function nextStep() {
    const S = (n, o) => ({ step: { n, of: LADDER }, href: '#/plan', ...o, id: 'step-' + n });

    // 1. Spend less than you earn.
    if (rate !== null && rate < 0 && fromHistory) return S(1, { tone: 'warn', score: 88, href: '#/reports',
      title: 'First: spend less than you earn',
      body: `${period} you spent about ${fmt(spend - income)} a month more than came in. Before anything else, close that gap. Start with your biggest flexible category, then any bill you can cancel or renegotiate.`,
      why: `${BABYLON} · control your spending` });

    // 2. Keep a tenth (Arkad's 70/10/20 plan if in debt).
    if (rate !== null && rate < 0.1 && income > 0) {
      const tenth = fmt(income * 0.1);
      return S(2, { tone: 'tip', score: 80,
        title: 'Next: keep a tenth of everything you earn',
        body: ledgers.length
          ? `You keep about ${Math.max(0, Math.round(rate * 100))}% now. Arkad’s plan for people in debt: live on 70%, save 10% (${tenth} a month), and pay 20% (${fmt(income * 0.2)}) to what you owe. A plan rule can set the 10% aside before you can spend it.`
          : `You keep about ${Math.max(0, Math.round(rate * 100))}% now. Keeping 10% means ${tenth} a month. Add a plan rule so it’s set aside the moment you’re paid, before it looks spendable.`,
        why: `${BABYLON} · the first cure` });
    }

    if (!m.plan || essentials <= 0) return null; // the rest needs funds + known costs

    // 3. A starter cushion: one month of essentials.
    if (!ef || cushion < 1) return S(3, { tone: 'tip', score: 78, href: '#/funds',
      title: ef ? `Next: grow ${ef.fund.name} to one month of bills` : 'Next: start an emergency fund',
      body: ef
        ? `It holds ${fmt(ef.balance)}. One month of bills and debt payments is about ${fmt(essentials)}. That small cushion means a surprise bill won’t send you to a credit card.`
        : `Your bills and debt payments are about ${fmt(essentials)} a month. Saving that first, as a starter cushion, stops a surprise bill from becoming new debt.`,
      why: `${BABYLON} · guard your money from loss` });

    // 4. Clear expensive debt, highest rate first.
    if (expensive.length) {
      const top = expensive[0];
      const extra = Math.max(25, Math.round((income * 0.2 - avg('debt')) / 5) * 5, 0) || 50;
      const base = projectDebt(top.l.balance, top.apr, top.l.minimum, 0);
      const more = projectDebt(top.l.balance, top.apr, top.l.minimum, extra);
      const saved = base.interest - more.interest;
      return S(4, { tone: 'tip', score: 76, href: '#/debts',
        title: `Next: pay off ${top.d.name} (${top.apr}%)`,
        body: `It has your highest rate${expensive.length > 1 ? ' of ' + expensive.length + ' expensive debts' : ''}. Pay the minimum on everything else and put any extra here.`
          + (isFinite(saved) && saved > 1 ? ` Adding ${fmt(extra)} a month clears it ${base.months - more.months} months sooner and saves about ${fmt(saved)} in interest.` : ''),
        why: 'Highest interest first (the avalanche method)' });
    }

    // 5. A full cushion: 3–6 months of essentials.
    if (cushion < 3) return S(5, { tone: 'tip', score: 60, href: '#/funds',
      title: `Next: build ${ef.fund.name} to 3 months`,
      body: `It covers ${cushion.toFixed(1)} months now. ${fmt(essentials * 3 - ef.balance)} more reaches 3 months (${fmt(essentials * 3)}). That gives you room for error if income stops.`,
      why: 'Leave room for error (The Psychology of Money)' });

    // 6. Make your money multiply / provide for the future.
    if (!working) return S(6, { tone: 'tip', score: 50, href: '#/funds',
      title: 'Next: put your money to work',
      body: 'Your cushion is in place and your expensive debt is gone. Money you won’t need for 5+ years can now earn for you, for example in a retirement account or a low-cost, diversified fund. Add a fund for it so the plan feeds it every month. Learn the basics first, and avoid anything that promises quick or certain gains.',
      why: `${BABYLON} · make your money multiply` });

    return { id: 'step-done', tone: 'good', score: 18, href: '#/reports',
      title: 'Your foundations are in place',
      body: `You spend less than you earn, keep ${Math.round((rate || 0) * 100)}%, have a cushion, carry no expensive debt and have money working. From here the biggest lever is earning more: skills, a raise, or a side income.`,
      why: `${BABYLON} · increase your ability to earn` };
  }

  // ---- Encouragement ----------------------------------------------------------------
  if (rate !== null && rate >= 0.2 && fromHistory && step?.id !== 'step-done') add({ id: 'rate-good', tone: 'good', score: 15, href: '#/reports',
    title: `You keep ${Math.round(rate * 100)}% of what you earn`,
    body: 'That’s double the one-tenth rule. Keep it up.',
    why: `${BABYLON} · the first cure` });
  if (cushion !== null && cushion >= 6) add({ id: 'ef-full', tone: 'good', score: 14, href: '#/funds',
    title: `${ef.fund.name} covers ${Math.floor(cushion)} months`,
    body: 'That’s a full cushion. New savings can go to debt, investing or a goal instead.',
    why: 'Leave room for error' });

  // ---- Spending structure ------------------------------------------------------------
  if (income > 0 && fromHistory && avg('hard') / income > 0.6) add({ id: 'fixed-high', tone: 'tip', score: 38, href: '#/categories',
    title: `Fixed bills take ${Math.round(avg('hard') / income * 100)}% of your income`,
    body: 'A common guide is to keep fixed costs to 50–60%, so there’s room for saving and living. Housing is usually the biggest lever: a cheaper place, a roommate, or renegotiating. Next come insurance, phone and subscriptions.',
    why: '50/30/20 rule · conscious spending plan' });

  // Spare savings while expensive debt grows. Only once the full cushion exists.
  if (expensive.length && cushion !== null && cushion > 3) {
    const spare = ef.balance - essentials * 3;
    if (spare > 100) add({ id: 'debt-vs-cash', tone: 'tip', score: 40, href: '#/debts',
      title: `Your extra savings could pay down ${expensive[0].d.name}`,
      body: `You have about ${fmt(spare)} beyond a 3-month cushion while ${expensive[0].d.name} charges ${expensive[0].apr}%. Paying it down earns that rate, with no risk.`,
      why: 'Highest interest first' });
  }

  // ---- Taxes: is enough being set aside? ---------------------------------------------
  if (m.taxes) {
    const t = taxSummary({ tax: settings.tax, txs, catById, interestByMonth: sim?.interestByMonth, todayYM });
    if (t.projectedRemaining > 1) {
      const reserve = funds.filter((f) => /tax/i.test(f.fund.name)).reduce((a, f) => a + f.balance, 0);
      const gap = t.remaining - reserve;
      if (gap > Math.max(50, t.remaining * 0.15)) add({ id: 'tax-gap', tone: 'warn', score: 65, href: '#/taxes',
        title: `About ${fmt(gap)} of tax isn’t set aside`,
        body: `You likely owe ${fmt(t.remaining)} so far this tax year, and your tax fund holds ${fmt(reserve)}. Setting aside ${fmt(t.suggestedMonthly)} a month keeps you on track. Tax money isn’t yours to spend.`,
        why: 'Guard your money from loss' });
    }
  }

  // ---- Budgets this month ------------------------------------------------------------
  const spentBy = new Map();
  for (const t of txs) {
    if (t.type !== 'expense' || ymOf(t) !== todayYM) continue;
    spentBy.set(t.category_id, (spentBy.get(t.category_id) || 0) + usd(t));
  }
  const over = [], pacing = [];
  for (const c of categories) {
    const b = Number(c.monthly_budget_usd) || 0;
    if (b <= 0) continue;
    const s = spentBy.get(c.id) || 0;
    if (s > b) over.push({ c, s, b });
    // Pace only flexible spending; fixed bills land in one go.
    else if (catById.get(c.id)?.kind === 'soft' && day >= 5 && day < daysInMonth - 2
      && s / b > (day / daysInMonth) * 1.25 && s / b > 0.5) pacing.push({ c, s, b });
  }
  if (over.length) {
    const o = over.sort((a, b) => (b.s - b.b) - (a.s - a.b))[0];
    add({ id: 'over-budget', tone: 'warn', score: 68, href: '#/categories',
      title: over.length === 1 ? `${o.c.name} is ${fmt(o.s - o.b)} over budget` : `${over.length} budgets are over this month`,
      body: (over.length === 1 ? '' : `The biggest is ${o.c.name}, at ${fmt(o.s - o.b)} over. `)
        + 'Cover it from another category, or raise the budget if it was too low. Then decide whether next month needs a different number.',
      why: `${BABYLON} · control your spending` });
  }
  if (pacing.length) {
    const p = pacing.sort((a, b) => b.s / b.b - a.s / a.b)[0];
    add({ id: 'pace', tone: 'tip', score: 42, href: '#/categories',
      title: `${p.c.name} is running ahead of schedule`,
      body: `You’ve used ${Math.round(p.s / p.b * 100)}% of its budget with ${daysInMonth - day} days left. Slowing down now avoids going over.`,
      why: `${BABYLON} · control your spending` });
  }

  // ---- A flexible category that jumped well above its usual level --------------------
  if (past.length >= 2) {
    const usual = new Map();
    for (const t of txs) {
      if (t.type !== 'expense' || t.fund_id || !past.includes(ymOf(t))) continue;
      if (catById.get(t.category_id)?.kind !== 'soft') continue;
      usual.set(t.category_id, (usual.get(t.category_id) || 0) + usd(t) / past.length);
    }
    let spike = null;
    for (const [id, u] of usual) {
      const now = spentBy.get(id) || 0;
      const jump = now - u;
      if (u > 0 && now > u * 1.5 && jump > 50 && (!spike || jump > spike.jump)) spike = { id, now, u, jump };
    }
    if (spike) add({ id: 'spike', tone: 'tip', score: 35, href: '#/transactions',
      title: `${catById.get(spike.id)?.name || 'A category'} is up this month`,
      body: `${fmt(spike.now)} so far, compared with about ${fmt(spike.u)} in a usual month. Was that a need or a want?`,
      why: `${BABYLON} · tell needs from wants` });
  }

  // ---- No plan rules yet: automate paying yourself first ------------------------------
  if (m.plan && !(settings.plan?.rules || []).length && income > 0 && step?.id !== 'step-2') {
    add({ id: 'no-rules', tone: 'tip', score: 48, href: '#/settings',
      title: 'Pay yourself first, automatically',
      body: `Add a plan rule like “10% of income to Savings”. Then ${fmt(income * 0.1)} a month is set aside before you ever see it as spendable.`,
      why: `${BABYLON} · the first cure` });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, max);
}
