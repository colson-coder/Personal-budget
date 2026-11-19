// Unit tests for js/insights.js (the free money coach).
// Run with:  node tests/insights.test.mjs
import assert from 'node:assert/strict';
import { simulateFunds } from '../js/finance.js';
import { buildInsights, detectRepeats } from '../js/insights.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('✓', name); };
const tx = (type, date, amount, category_id, extra = {}) => ({ type, date, amount, amount_usd: amount, category_id, ...extra });

const cats = [
  { id: 'inc', name: 'Income', kind: 'income' },
  { id: 'side', name: 'Side income', kind: 'income', tax_treatment: 'owed' },
  { id: 'rent', name: 'Housing & Bills', kind: 'hard', monthly_budget_usd: 1500 },
  { id: 'food', name: 'Food', kind: 'soft', monthly_budget_usd: 400 },
  { id: 'fun', name: 'Fun', kind: 'soft' },
];
const catById = new Map(cats.map((c) => [c.id, c]));
const todayYM = '2026-11';
const MODS = { plan: true, debts: true, income: false, taxes: false };

function data({ txs, funds = [], debts = [], settings = {}, rules = [{ id: 'r', fund_id: 'x', method: 'percent_income', value: 10 }] }) {
  const s = { modules: MODS, plan: { start_month: '2026-08', rules }, ...settings };
  const sim = simulateFunds({ settings: s, funds, txs, catById, todayYM });
  return { settings: s, categories: cats, catById, txs, funds, debts, streams: [], sim, todayYM };
}
const run = (o, today = '2026-11-03') => buildInsights(data(o), { today, max: 30 });
const ids = (list) => list.map((x) => x.id);
const stepOf = (list) => list.find((x) => x.step || x.id === 'step-done')?.id;

// Typical month: earn `inc`, rent 1500, food 300, fun 100 (spend 1900).
const months = (inc = 3000, extra = []) => ['2026-08', '2026-09', '2026-10'].flatMap((m) => [
  tx('income', m + '-01', inc, 'inc'), tx('expense', m + '-02', 1500, 'rent'),
  tx('expense', m + '-10', 300, 'food'), tx('expense', m + '-12', 100, 'fun'),
  ...extra.map((e) => tx(e[0], m + e[1], e[2], e[3])),
]);
const ef = (bal) => ({ id: 'ef', name: 'Emergency Fund', kind: 'savings', starting_balance: bal });
const card = { id: 'card', name: 'Credit card', principal: 3000, apr: 24, payment: 120, start_month: '2026-11', due_day: 28 };
const car = { id: 'car', name: 'Car loan', principal: 8000, apr: 5, payment: 250, start_month: '2026-11', due_day: 28 };

test('empty account → getting-started tip only', () => {
  assert.deepEqual(ids(run({ txs: [] })), ['start']);
});

test('ladder 1: spending more than you earn comes first', () => {
  const r = run({ txs: months(1800), funds: [ef(5000)] });
  assert.equal(stepOf(r), 'step-1');
  assert.equal(r.find((x) => x.id === 'step-1').tone, 'warn');
});

test('ladder 2: keep a tenth; in debt → Arkad 70/10/20', () => {
  const r = run({ txs: months(2000), funds: [ef(5000)] });                 // keeps 5%
  assert.equal(stepOf(r), 'step-2');
  assert.ok(!/70%/.test(r.find((x) => x.id === 'step-2').body));
  const d = run({ txs: months(2000), funds: [ef(5000)], debts: [car] });
  assert.match(d.find((x) => x.id === 'step-2').body, /live on 70%, save 10%/);
});

test('ladder 3: starter cushion before attacking debt', () => {
  assert.equal(stepOf(run({ txs: months(), debts: [card] })), 'step-3');            // no fund at all
  assert.equal(stepOf(run({ txs: months(), funds: [ef(900)], debts: [card] })), 'step-3'); // < 1 month
});

test('ladder 4: expensive debt, highest rate first; cheap debt waits', () => {
  const r = run({ txs: months(), funds: [ef(2000)], debts: [car, card] });
  assert.equal(stepOf(r), 'step-4');
  assert.match(r.find((x) => x.id === 'step-4').title, /Credit card \(24%\)/);
  // A 5% car loan alone is not "expensive" → move on to the full cushion.
  assert.equal(stepOf(run({ txs: months(), funds: [ef(2000)], debts: [car] })), 'step-5');
});

test('ladder 5 → 6 → done', () => {
  assert.equal(stepOf(run({ txs: months(), funds: [ef(3000)] })), 'step-5');          // 1.9 months
  assert.equal(stepOf(run({ txs: months(), funds: [ef(6000)] })), 'step-6');          // 3+ months, nothing invested
  const done = run({ txs: months(), funds: [ef(6000), { id: 'ret', name: 'Retirement', kind: 'savings', starting_balance: 100 }] });
  assert.equal(stepOf(done), 'step-done');
  assert.equal(done.filter((x) => x.step).length, 0);
});

test('only one ladder step at a time; every insight cites a principle', () => {
  const r = run({ txs: [...months(2000), tx('expense', '2026-11-02', 500, 'food')], debts: [card] });
  assert.equal(r.filter((x) => x.step).length, 1);
  for (const x of r) assert.ok(x.why, `${x.id} has a why`);
});

test('urgent alerts outrank the ladder', () => {
  const over = run({ txs: [...months(), tx('income', '2026-11-01', 1000, 'inc'), tx('expense', '2026-11-02', 1500, 'rent')] }, '2026-11-05');
  assert.equal(over[0].id, 'overspent');
  const stuck = run({ txs: months(), debts: [{ id: 'x', name: 'Store card', principal: 5000, apr: 30, payment: 100, start_month: '2026-10', due_day: 1 }] });
  assert.equal(stuck[0].id, 'debt-stuck-x');
});

test('budgets: over, pacing (flexible only), spike', () => {
  assert.ok(ids(run({ txs: [...months(), tx('expense', '2026-11-03', 450, 'food')] }, '2026-11-04')).includes('over-budget'));
  const pace = run({ txs: [...months(), tx('expense', '2026-11-01', 1500, 'rent'), tx('expense', '2026-11-03', 300, 'food')] }, '2026-11-08');
  const p = pace.find((x) => x.id === 'pace');
  assert.ok(p && p.title.startsWith('Food'), 'pace flags Food, never rent');
  assert.ok(ids(run({ txs: [...months(), tx('expense', '2026-11-03', 260, 'fun')] }, '2026-11-08')).includes('spike'));
});

test('fixed bills over 60% of income', () => {
  assert.ok(ids(run({ txs: months(2400), funds: [ef(9000)] })).includes('fixed-high'));   // 62.5%
  assert.ok(!ids(run({ txs: months(3000), funds: [ef(9000)] })).includes('fixed-high'));  // 50%
});

test('spare savings vs expensive debt only once the 3-month cushion is full', () => {
  assert.ok(ids(run({ txs: months(), funds: [ef(7000)], debts: [card] })).includes('debt-vs-cash'));
  assert.ok(!ids(run({ txs: months(), funds: [ef(4000)], debts: [card] })).includes('debt-vs-cash'));
});

test('tax gap warns when owed tax is not set aside', () => {
  const txs = months(3000, [['income', '-05', 2000, 'side']]);
  const r = run({ txs, settings: { modules: { ...MODS, taxes: true }, tax: { mode: 'flat', rate: 25 } } }, '2026-11-06');
  assert.ok(ids(r).includes('tax-gap'), ids(r).join(','));
});

test('no plan rules → pay-yourself-first nudge (unless the ladder already says it)', () => {
  assert.ok(ids(run({ txs: months(), funds: [ef(6000)], rules: [] })).includes('no-rules'));
  assert.ok(!ids(run({ txs: months(2000), funds: [ef(6000)], rules: [] })).includes('no-rules'));
});

test('a dated goal that is behind gets a tip', () => {
  const trip = { id: 'trip', name: 'Trip to Lisbon', kind: 'savings', starting_balance: 100, goal_usd: 1800 };
  const r = run({ txs: months(), funds: [ef(6000), trip], settings: { modules: MODS, fund_targets: { trip: '2027-02' } } });
  const g = r.find((x) => x.id === 'goal-trip');
  assert.ok(g && /behind/.test(g.title), ids(r).join(','));
});

test('repeating charges: subscriptions found, groceries and known rules skipped', () => {
  const m4 = ['2026-08', '2026-09', '2026-10', '2026-11'];
  const txs = [
    ...m4.map((m) => tx('expense', m + '-04', 15.49, 'fun', { description: 'NETFLIX.COM 8XK2', currency: 'USD' })),
    tx('expense', '2026-10-05', 15.49, 'fun', { description: 'NETFLIX.COM 9QQ1', currency: 'USD' }), // a double charge
    ...m4.slice(1).map((m, i) => tx('expense', m + '-0' + (5 + i), 11.99, 'fun', { description: 'Spotify', currency: 'USD' })),
    ...m4.map((m, i) => tx('expense', m + '-1' + i, 80 + i * 30, 'food', { description: 'Whole Foods', currency: 'USD' })), // amounts vary
    ...m4.map((m) => tx('expense', m + '-02', 1500, 'rent', { description: 'Rent', currency: 'USD' })),
    ...['2026-07', '2026-08', '2026-09'].map((m) => tx('expense', m + '-03', 9.99, 'fun', { description: 'Old app', currency: 'USD' })), // stopped
  ];
  const r = detectRepeats(txs, { todayYM: '2026-11', rules: [{ description: 'Rent' }] });
  assert.deepEqual(r.map((x) => x.description).sort(), ['NETFLIX.COM 8XK2', 'Spotify']);
  assert.equal(r.find((x) => x.description === 'Spotify').day, 6);
  assert.equal(detectRepeats(txs, { todayYM: '2026-11', dismissed: ['spotify'] }).some((x) => x.description === 'Spotify'), false);
  const coach = run({ txs: [...months(), ...txs] }, '2026-11-08');
  assert.ok(coach.some((x) => x.id === 'subs' && /2 repeating charges/.test(x.title)), coach.map((x) => x.title).join(' | '));
});

console.log(`\n${passed} insight tests passed`);
