// Unit tests for js/finance.js, checked against figures from a real
// household spreadsheet. Run with:  node tests/finance.test.mjs
import assert from 'node:assert/strict';
import {
  addMonths, monthRange, nper, debtLedger, projectDebt, streamLedger,
  monthSummary, allocate, simulateFunds,
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
const loan = { id: 'L', principal: 100000, apr: 4, payment: 500, start_month: '2026-06' };
const loanTx = [
  ['2026-06-15', 900], ['2026-07-15', 500], ['2026-08-15', 600],
  ['2026-09-15', 800], ['2026-10-15', 1600],
].map(([date, amount]) => tx({ type: 'expense', date, amount, debt_id: 'L' }));

test('debt ledger matches spreadsheet', () => {
  const d = debtLedger(loan, loanTx, '2026-11');
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

// Rental: rent 1,500 from May 2026. Received 1500, 1500, 500, 2408, 0.
// Spreadsheet owed: 0, 0, 1000, 92, 1592. Deposits 300 + 300 = 600.
test('passive income (rental) ledger matches spreadsheet', () => {
  const p = { id: 'P', kind: 'rental', expected_monthly: 1500, start_month: '2026-05' };
  const t = [
    ['2026-05-03', 1500], ['2026-06-03', 1500], ['2026-07-03', 500], ['2026-08-03', 2408],
  ].map(([date, amount]) => tx({ type: 'income', date, amount, stream_id: 'P' }));
  t.push(tx({ type: 'income', date: '2026-05-03', amount: 300, stream_id: 'P', subtype: 'deposit' }));
  t.push(tx({ type: 'income', date: '2026-06-03', amount: 300, stream_id: 'P', subtype: 'deposit' }));
  const r = streamLedger(p, t, '2026-09');
  assert.deepEqual(r.rows.map((x) => x.behind), [0, 0, 1000, 92, 1592]);
  assert.equal(r.deposit, 600);
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

test('month summary splits hard / soft / debt; ignores fund & deposit flows', () => {
  const t = [
    tx({ type: 'income', date: '2026-11-01', amount: 3000, category_id: 'inc' }),
    tx({ type: 'expense', date: '2026-11-02', amount: 40, category_id: 'bills' }),
    tx({ type: 'expense', date: '2026-11-03', amount: 500, category_id: 'debt', debt_id: 'L' }),
    tx({ type: 'expense', date: '2026-11-04', amount: 260, category_id: 'food' }),
    tx({ type: 'expense', date: '2026-11-05', amount: 99, category_id: 'food', fund_id: 'fun' }), // from fund
    tx({ type: 'income', date: '2026-11-06', amount: 300, subtype: 'deposit' }),                 // deposit
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

console.log(`\n${passed} tests passed`);
