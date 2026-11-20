// Unit tests for js/finance.js, checked against figures from a real
// household spreadsheet. Run with:  node tests/finance.test.mjs
import assert from 'node:assert/strict';
import {
  addMonths, monthRange, nper, debtLedger, projectDebt, streamLedger,
  monthSummary, allocate, simulateFunds, pmt, minimumPayment, bracketTax, taxSummary, taxYearOf, goalPace,
} from '../js/finance.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('✓', name); };
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const tx = (o) => ({ amount_usd: o.amount, ...o });

test('month helpers', () => {
  assert.equal(addMonths('2026-11', 2), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.deepEqual(monthRange('2026-11', '2027-01'), ['2026-11', '2026-12', '2027-01']);
});

// House loan: $100,000 at 4% from Jun 2026, payments 900/500/600/800/1600,
// nothing in Nov (prepaid). Spreadsheet: Oct end 97,254.06; Nov 97,578.24;
// total paid 4,400; interest paid 1,978.24; 316 months left; payoff Mar 2053.
const loan = { id: 'L', principal: 100000, apr: 4, payment: 500, start_month: '2026-06', due_day: 20 };
const loanTx = [
  ['2026-06-15', 900], ['2026-07-15', 500], ['2026-08-15', 600],
  ['2026-09-15', 800], ['2026-10-15', 1600],
].map(([date, amount]) => tx({ type: 'expense', date, amount, debt_id: 'L' }));

test('debt ledger matches spreadsheet (Nov payment not yet due)', () => {
  const d = debtLedger(loan, loanTx, '2026-11', 18);
  near(d.rows[0].interest, 333.33);
  near(d.rows[0].end, 99433.33);
  near(d.rows[4].end, 97254.06);
  near(d.balance, 97578.24);
  near(d.totalPaid, 4400);
  near(d.interestPaid, 1978.24);
  near(d.principalPaid, 2421.76);
  near(d.pctPaid, 0.0242, 0.0001);
  assert.equal(d.monthsLeft, 316);
  assert.equal(d.payoffYM, '2053-03');
});

test('nper edge cases', () => {
  assert.equal(nper(0.01, 50, 10000), Infinity); // payment < interest
  assert.equal(nper(0, 100, 1000), 10);
  assert.equal(nper(0.01, 100, 0), 0);
});

test('extra payment what-if shortens payoff', () => {
  const base = projectDebt(97578.24, 4, 500);
  const extra = projectDebt(97578.24, 4, 500, 300);
  assert.equal(base.months, 316);
  assert.ok(extra.months < base.months);
  assert.ok(extra.interest < base.interest);
});

test('minimum payment is assumed each month; logged payments replace it', () => {
  const d = { id: 'C', principal: 10000, apr: 12, payment: 300, start_month: '2026-01' };
  const t = [tx({ type: 'expense', date: '2026-02-05', amount: 1000, debt_id: 'C' })]; // extra in Feb
  const l = debtLedger(d, t, '2026-04');
  assert.deepEqual(l.rows.map((r) => r.status), ['assumed', 'extra', 'assumed', 'assumed']);
  assert.deepEqual(l.rows.map((r) => r.paid), [300, 1000, 300, 300]);
  near(l.extraPaid, 700);
  // Jan: 10000 + 100 − 300 = 9800; Feb: 9800 + 98 − 1000 = 8898
  near(l.rows[1].end, 8898);
  const none = debtLedger(d, [], '2026-04');
  assert.ok(l.balance < none.balance);
  assert.ok(l.monthsLeft < none.monthsLeft);
});

test('minimum payment from loan term', () => {
  near(pmt(0.06 / 12, 360, 200000), 1199.10);
  near(minimumPayment({ principal: 200000, apr: 6, term_months: 360 }), 1199.10);
  assert.equal(minimumPayment({ principal: 5000, apr: 5, payment: 150, term_months: 12 }), 150);
});

test('passive income stream ledger (behind expected)', () => {
  const p = { id: 'P', kind: 'business', expected_monthly: 1500, start_month: '2026-05' };
  const t = [['2026-05-03', 1500], ['2026-06-03', 1500], ['2026-07-03', 500], ['2026-08-03', 2408]]
    .map(([date, amount]) => tx({ type: 'income', date, amount, stream_id: 'P' }));
  const r = streamLedger(p, t, '2026-09');
  assert.deepEqual(r.rows.map((x) => x.behind), [0, 0, 1000, 92, 1592]);
  assert.equal(r.received, 5908);
});

// Money plan from the spreadsheet: 10% charity, $150 business reserve,
// $200 personal spending, emergency fund 25% of remainder until $1,500.
const cats = new Map([
  ['inc', { id: 'inc', kind: 'income' }], ['bills', { id: 'bills', kind: 'hard' }],
  ['food', { id: 'food', kind: 'soft' }], ['debt', { id: 'debt', kind: 'debt' }],
]);
const funds = [
  { id: 'give', name: 'Charity', goal_usd: 0, apy: 0 },
  { id: 'biz', name: 'Business Reserve', apy: 8 },
  { id: 'fun', name: 'Personal Spending', apy: 0 },
  { id: 'emg', name: 'Emergency Fund', goal_usd: 1500, apy: 8 },
  { id: 'sav', name: 'Savings', starting_balance: 8977.83, apy: 8 },
];
const rules = [
  { fund_id: 'emg', method: 'percent_remainder', value: 25, value_after_goal: 10 },
  { fund_id: 'give', method: 'percent_net', value: 10 },
  { fund_id: 'biz', method: 'fixed', value: 150 },
  { fund_id: 'fun', method: 'fixed', value: 200 },
];

test('month summary splits hard / soft / debt; ignores fund flows', () => {
  const t = [
    tx({ type: 'income', date: '2026-11-01', amount: 3000, category_id: 'inc' }),
    tx({ type: 'expense', date: '2026-11-02', amount: 40, category_id: 'bills' }),
    tx({ type: 'expense', date: '2026-11-03', amount: 500, category_id: 'debt', debt_id: 'L' }),
    tx({ type: 'expense', date: '2026-11-04', amount: 260, category_id: 'food' }),
    tx({ type: 'expense', date: '2026-11-05', amount: 99, category_id: 'food', fund_id: 'fun' }), // from fund
    tx({ type: 'transfer', date: '2026-11-07', amount: 50, fund_id: 'sav' }),                   // transfer
  ];
  const s = monthSummary('2026-11', t, cats);
  assert.deepEqual([s.income, s.hard, s.debt, s.soft, s.net], [3000, 40, 500, 260, 2200]);
});

test('allocation follows rule order and goal switch', () => {
  const byId = new Map(funds.map((f) => [f.id, f]));
  const s = { income: 3000, net: 2200 };
  const a = allocate(s, rules, byId, { emg: 0 });
  const amt = (id) => a.lines.find((l) => l.fund_id === id).amount;
  assert.equal(amt('give'), 220);       // 10% of 2200
  assert.equal(amt('biz'), 150);
  assert.equal(amt('fun'), 200);
  assert.equal(a.remainder, 1630);      // 2200 − 220 − 150 − 200
  assert.equal(amt('emg'), 407.5);      // 25% of 1630
  assert.equal(a.unallocated, 1222.5);
  const after = allocate(s, rules, byId, { emg: 1500 });
  assert.equal(after.lines.find((l) => l.fund_id === 'emg').amount, 163); // 10% after goal
});

test('no income month: fixed set-asides skipped, negative net not allocated', () => {
  const byId = new Map(funds.map((f) => [f.id, f]));
  const a = allocate({ income: 0, net: -100 }, rules, byId, {});
  assert.ok(a.lines.every((l) => l.amount === 0));
  assert.equal(a.unallocated, -100);
});

test('fund simulation: allocations, spending, transfers, interest', () => {
  const t = [
    tx({ type: 'income', date: '2026-11-01', amount: 3000, category_id: 'inc' }),
    tx({ type: 'expense', date: '2026-11-04', amount: 800, category_id: 'food' }),
    tx({ type: 'expense', date: '2026-11-20', amount: 120, category_id: 'food', fund_id: 'give' }),
    tx({ type: 'transfer', date: '2026-11-21', amount: 100, fund_id: 'sav' }),
  ];
  const sim = simulateFunds({
    settings: { plan: { start_month: '2026-11', rules } },
    funds, txs: t, catById: cats, todayYM: '2026-12',
  });
  const f = (id) => sim.funds.find((x) => x.fund.id === id);
  // Nov: net 2200 → give 220 (then −120 donated) = 100; no interest (apy 0)
  assert.equal(f('give').balance, 100);
  // Savings: 8977.83 + 100 transfer = 9077.83, + Nov interest 9077.83 × 8%/12 = 60.52
  near(f('sav').balance, 9138.35);
  near(f('sav').totals.interest, 60.52);
  // Business reserve: 150 + 1.00 interest
  near(f('biz').balance, 151);
  // Dec has no income → nothing allocated, balance unchanged (no Dec interest yet)
  assert.equal(sim.plans.get('2026-12').lines.every((l) => l.amount === 0), true);
});

test('income stream without expected amount just totals', () => {
  const s = { id: 'D', kind: 'dividends', start_month: '2026-01' };
  const t = [tx({ type: 'income', date: '2026-03-10', amount: 42, stream_id: 'D' }),
             tx({ type: 'income', date: '2026-06-10', amount: 58, stream_id: 'D' })];
  const r = streamLedger(s, t, '2026-06');
  assert.equal(r.received, 100);
  assert.equal(r.behind, 0);
  near(r.avgMonthly, 16.67);
});

test('interest only for funds that earn it; logged interest counts', () => {
  const fs = [
    { id: 'bank', name: 'Savings', starting_balance: 12000, apy: 6 },                      // auto
    { id: 'cash', name: 'Pocket', starting_balance: 500, apy: 6, interest_mode: 'none' },  // cash
    { id: 'cd', name: 'CD', starting_balance: 1000, apy: 5, interest_mode: 'manual' },
  ];
  const t = [tx({ type: 'income', date: '2026-01-31', amount: 4.2, fund_id: 'cd', subtype: 'interest' })];
  const sim = simulateFunds({ settings: { plan: { start_month: '2026-01', rules: [] } }, funds: fs, txs: t, catById: cats, todayYM: '2026-02' });
  const f = (id) => sim.funds.find((x) => x.fund.id === id);
  assert.equal(f('bank').balance, 12060);  // 12000 × 6%/12
  assert.equal(f('cash').balance, 500);    // no interest on cash
  assert.equal(f('cd').balance, 1004.2);   // only what was logged
  near(sim.interestByMonth.get('2026-01'), 64.2);
});

test('percent of income rule (tax set-aside) comes first', () => {
  const byId = new Map([['tax', { id: 'tax' }], ['give', { id: 'give' }]]);
  const a = allocate({ income: 4000, net: 1000 }, [
    { fund_id: 'give', method: 'percent_net', value: 10 },
    { fund_id: 'tax', method: 'percent_income', value: 20 },
  ], byId, {});
  assert.equal(a.lines[0].fund_id, 'tax');
  assert.equal(a.lines[0].amount, 800);
  assert.equal(a.remainder, 100);   // 1000 − 800 − 100
});

test('tax: flat estimate on owed income, minus deductions & payments', () => {
  const c = new Map([
    ['pay', { id: 'pay', name: 'Income', kind: 'income' }],                                  // withheld by default
    ['side', { id: 'side', name: 'Freelance', kind: 'income', tax_treatment: 'owed' }],
    ['gift', { id: 'gift', name: 'Gifts', kind: 'income', tax_treatment: 'none' }],
    ['tools', { id: 'tools', name: 'Work tools', kind: 'soft', tax_deductible: true }],
    ['taxes', { id: 'taxes', name: 'Taxes', kind: 'tax' }],
  ]);
  const t = [
    tx({ type: 'income', date: '2026-01-15', amount: 4000, category_id: 'pay' }),
    tx({ type: 'income', date: '2026-02-15', amount: 3000, category_id: 'side' }),
    tx({ type: 'income', date: '2026-02-20', amount: 200, category_id: 'gift' }),
    tx({ type: 'expense', date: '2026-02-21', amount: 500, category_id: 'tools' }),
    tx({ type: 'expense', date: '2026-03-10', amount: 300, category_id: 'taxes' }),
    tx({ type: 'income', date: '2025-12-15', amount: 9999, category_id: 'side' }),          // last tax year
  ];
  const s = taxSummary({ tax: { rate: 20 }, txs: t, catById: c, interestByMonth: new Map(), todayYM: '2026-03' });
  assert.equal(s.income.withheld, 4000);
  assert.equal(s.income.owed, 3000);
  assert.equal(s.income.none, 200);
  assert.equal(s.deductions, 500);
  assert.equal(s.estimated, 500);          // (3000 − 500) × 20%
  assert.equal(s.paid, 300);
  assert.equal(s.remaining, 200);
  assert.equal(s.projectedYear, 2000);     // pace × 4
  assert.equal(s.periods.length, 4);
  assert.equal(s.periods[0].estimated, 500);
  assert.equal(s.periods[0].paid, 300);
});

test('tax: brackets charge only the part not covered by withholding', () => {
  const b = [{ from: 0, rate: 10 }, { from: 10000, rate: 30 }];
  assert.equal(bracketTax(15000, b), 2500);
  const c = new Map([['pay', { id: 'pay', name: 'Income', kind: 'income' }], ['side', { id: 'side', name: 'Side', kind: 'income' }]]);
  const t = [tx({ type: 'income', date: '2026-01-10', amount: 9000, category_id: 'pay' }),
             tx({ type: 'income', date: '2026-01-11', amount: 3000, category_id: 'side' })];
  const s = taxSummary({ tax: { mode: 'brackets', brackets: b }, txs: t, catById: c, interestByMonth: new Map(), todayYM: '2026-01' });
  // all 12000 → 1000 + 600 = 1600; withheld 9000 → 900; owed on side = 700
  assert.equal(s.estimated, 700);
});

test('tax projection uses pace since the user started tracking', () => {
  const c = new Map([['side', { id: 'side', name: 'Freelance', kind: 'income', tax_treatment: 'owed' }]]);
  const t = [tx({ type: 'income', date: '2026-11-05', amount: 4000, category_id: 'side' })];
  const s = taxSummary({ tax: { rate: 25 }, txs: t, catById: c, interestByMonth: new Map(), todayYM: '2026-11' });
  assert.equal(s.estimated, 1000);
  assert.equal(s.projectedYear, 2000);          // Nov actual + 1 more month (Dec) at the same pace
  assert.equal(s.periods[0].tracked, false);    // Jan–Mar was before tracking began
  assert.equal(s.suggestedMonthly, 1000);       // 2000 left over Nov + Dec
});

test('tax year can start in any month', () => {
  assert.deepEqual(taxYearOf('2026-03', 4), { start: '2025-04', end: '2026-03', label: '2025–26' });
  assert.equal(taxYearOf('2026-07', 7).start, '2026-07');
});

test('assigning money by hand lowers what is left to assign', () => {
  const fs = [{ id: 'trip', name: 'Trip' }];
  const t = [
    tx({ type: 'income', date: '2026-11-02', amount: 3000, category_id: 'inc' }),
    tx({ type: 'expense', date: '2026-11-03', amount: 1000, category_id: 'food' }),
    tx({ type: 'transfer', date: '2026-11-05', amount: 400, fund_id: 'trip' }),
  ];
  const sim = simulateFunds({ settings: { plan: { start_month: '2026-11', rules: [] } }, funds: fs, txs: t, catById: cats, todayYM: '2026-11' });
  const p = sim.planFor('2026-11');
  assert.equal(p.unallocated, 2000);
  assert.equal(p.manual, 400);
  assert.equal(p.leftToAssign, 1600);
  assert.equal(sim.funds[0].balance, 400);
});

test('goal dates: per month, on track, behind, reached, overdue', () => {
  const hist = (deltas) => deltas.map((d, i) => ({ ym: `2026-0${6 + i}`, start: 0, end: d }));
  const f = (balance, deltas) => ({ goal: 1800, balance, history: [...hist(deltas), { ym: '2026-11', start: balance, end: balance }] });
  // $640 saved, $1,160 to go, Nov..Jun = 8 months → $145/month.
  const a = goalPace(f(640, [200, 200, 200]), '2027-06', '2026-11');
  assert.equal(a.monthsLeft, 8); near(a.perMonth, 145); assert.equal(a.status, 'on_track');
  assert.equal(a.projectedYM, '2027-04'); // 1160 / 200 → 6 months: Nov..Apr
  const b = goalPace(f(640, [50, 50, 50]), '2027-06', '2026-11');
  assert.equal(b.status, 'behind');
  assert.equal(goalPace(f(1900, [100]), '2027-06', '2026-11').status, 'reached');
  assert.equal(goalPace(f(640, [100]), '2026-09', '2026-11').status, 'overdue');
  assert.equal(goalPace({ goal: 1800, balance: 0, history: [{ ym: '2026-11', start: 0, end: 0 }] }, '2027-06', '2026-11').status, 'new');
  assert.equal(goalPace({ goal: 0, balance: 0, history: [] }, '2027-06', '2026-11'), null);
  // A fund created this month has no pace yet, even if the plan is older.
  const born = { ...f(100, [0, 0, 0]), fund: { created_at: '2026-11-10T00:00:00Z' } };
  assert.equal(goalPace(born, '2027-06', '2026-11').status, 'new');
});

test('interest can go to the same fund, another fund, or everyday money', () => {
  const fs = [
    { id: 'sv', name: 'Savings', kind: 'savings', starting_balance: 12000, apy: 6, interest_mode: 'auto' },
    { id: 'sp', name: 'Spending', kind: 'spending', starting_balance: 0, apy: 0, interest_mode: 'none' },
  ];
  const run = (to) => simulateFunds({ settings: { plan: { start_month: '2026-01', rules: [] }, interest_to: to }, funds: fs, txs: [], catById: new Map(), todayYM: '2026-02' });
  const same = run({});
  assert.equal(same.funds[0].balance, 12060);           // 6%/12 of 12,000
  const moved = run({ sv: 'sp' });
  assert.equal(moved.funds[0].balance, 12000);
  assert.equal(moved.funds[1].balance, 60);
  assert.equal(moved.interestToDate, 60);
  const everyday = run({ sv: 'everyday' });
  assert.equal(everyday.funds[0].balance + everyday.funds[1].balance, 12000);
  assert.equal(everyday.planFor('2026-02').leftToAssign, 60); // shows up next month
  assert.equal(everyday.interestByMonth.get('2026-01'), 60);   // still taxable income
  assert.equal(run({ sv: 'deleted-fund' }).funds[0].balance, 12060); // unknown target → stays put
});

console.log(`\n${passed} tests passed`);
