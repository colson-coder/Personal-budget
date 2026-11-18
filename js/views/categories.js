// =============================================================================
// categories.js — Budgets. A simple grouped list (Bills, Everyday spending,
// Debt payments, Taxes, Income): each row shows this month's spending against
// its budget. Tap a row to edit; advanced options (type, rollover, tax) live
// in the edit sheet, not on every row.
// =============================================================================

import { db, isLocalMode, TABLES } from '../db.js';
import { CATEGORY_KINDS, CONFIG, TAX_TREATMENTS, SUGGESTED_CATEGORIES } from '../config.js';
import { getSettings, kindOf, defaultTreatment } from '../store.js';
import { carryoverUSD } from './dashboard.js';
import { el, fmtUSD, toast, todayISO, monthLabel, openSheet, field, progress } from '../util.js';
import { navigate } from '../router.js';

const GROUPS = [
  { kind: 'hard', title: 'Bills', hint: 'Fixed costs: rent, utilities, subscriptions' },
  { kind: 'soft', title: 'Everyday spending', hint: 'Food, transport, shopping, fun' },
  { kind: 'debt', title: 'Debt payments' },
  { kind: 'tax', title: 'Taxes', module: 'taxes' },
  { kind: 'income', title: 'Income' },
];
const refresh = () => navigate('/categories');

export async function renderCategories() {
  const ym = todayISO().slice(0, 7);
  const [cats, txs] = await Promise.all([db.listCategories(), db.listTransactions()]);
  const spent = new Map();
  const received = new Map();
  for (const t of txs) {
    if (t.date.slice(0, 7) !== ym) continue;
    const v = Number(t.amount_usd) || 0;
    if (t.type === 'expense') spent.set(t.category_id, (spent.get(t.category_id) || 0) + v);
    else if (t.type === 'income') received.set(t.category_id, (received.get(t.category_id) || 0) + v);
  }

  // Effective budget = monthly budget + any rollover carried in.
  const rows = cats.map((c) => {
    const base = Number(c.monthly_budget_usd) || 0;
    const carry = c.rollover ? carryoverUSD(c, txs, ym) : 0;
    const kind = kindOf(c);
    return {
      c, kind, carry,
      budget: base > 0 || carry !== 0 ? Math.max(0, base + carry) : 0,
      amount: kind === 'income' ? received.get(c.id) || 0 : spent.get(c.id) || 0,
    };
  });

  const root = el('div', { class: 'view view-categories' });
  root.append(el('div', { class: 'view-head' }, [
    el('div', {}, [el('h1', {}, 'Budgets'), el('div', { class: 'muted small' }, monthLabel(ym))]),
    el('button', { class: 'btn btn-primary btn-sm', onClick: () => categorySheet(null) }, '＋ Category'),
  ]));

  // --- Summary -----------------------------------------------------------------
  const out = rows.filter((r) => r.kind !== 'income');
  const budgeted = out.reduce((a, r) => a + r.budget, 0);
  const spentTotal = out.reduce((a, r) => a + r.amount, 0);
  const left = budgeted - spentTotal;
  const summary = el('div', { class: 'card budget-summary' }, [
    el('div', { class: 'bs-row' }, [
      stat('Budgeted', fmtUSD(budgeted)),
      stat('Spent', fmtUSD(spentTotal)),
      stat(left >= 0 ? 'Left' : 'Over', fmtUSD(Math.abs(left)), left >= 0 ? 'pos' : 'neg'),
    ]),
  ]);
  if (budgeted > 0) summary.append(progress(spentTotal / budgeted, { over: spentTotal > budgeted }));
  else summary.append(el('p', { class: 'muted small' }, 'Tap a category to give it a monthly budget.'));
  root.append(summary);

  // --- Groups --------------------------------------------------------------------
  // Only categories in use (a budget, or money this month) are listed; the
  // rest are tucked into one collapsed "Other categories" section.
  const modules = getSettings().modules;
  const active = (r) => r.budget > 0 || r.amount > 0;
  const unused = [];
  let shownGroups = 0;
  for (const g of GROUPS) {
    if (g.module && !modules[g.module]) continue;
    const all = rows.filter((r) => r.kind === g.kind);
    unused.push(...all.filter((r) => !active(r)));
    const list = all.filter(active).sort((a, b) =>
      (b.budget > 0) - (a.budget > 0) || b.amount - a.amount || a.c.name.localeCompare(b.c.name));
    if (!list.length) continue;
    shownGroups++;
    const gBudget = list.reduce((a, r) => a + r.budget, 0);
    const gAmount = list.reduce((a, r) => a + r.amount, 0);
    root.append(el('div', { class: 'card budget-group' }, [
      el('div', { class: 'bg-head' }, [
        el('h2', {}, g.title),
        el('span', { class: 'muted small' }, g.kind === 'income'
          ? `${fmtUSD(gAmount)} received`
          : gBudget > 0 ? `${fmtUSD(gAmount)} of ${fmtUSD(gBudget)}` : fmtUSD(gAmount)),
      ]),
      ...list.map((r) => budgetRow(r)),
    ]));
  }
  if (unused.length) {
    unused.sort((a, b) => a.c.name.localeCompare(b.c.name));
    // Brand-new users have nothing in use yet — show the list open.
    root.append(el('details', { class: 'card budget-group unused', open: shownGroups === 0 ? 'open' : null }, [
      el('summary', { class: 'bg-head' }, [
        el('h2', {}, shownGroups ? 'Other categories' : 'Your categories'),
        el('span', { class: 'muted small' }, `${unused.length} not used this month`),
      ]),
      el('p', { class: 'muted small unused-hint' }, 'Tap one to give it a budget.'),
      ...unused.map((r) => budgetRow(r)),
    ]));
  }
  root.append(suggestionsCard(cats));
  return root;
}

// One tap adds a common category; "Custom" opens the full form. Only shows
// suggestions the user doesn't already have.
function suggestionsCard(cats) {
  const have = new Set(cats.map((c) => c.name.toLowerCase()));
  const missing = SUGGESTED_CATEGORIES.filter((x) => !have.has(x.name.toLowerCase())
);
  const chips = el('div', { class: 'chips' }, [
    ...missing.map((x) => el('button', {
      class: 'chip', type: 'button', onClick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          await db.createCategory({ name: x.name, kind: x.kind, monthly_budget_usd: 0, ...(x.tax_treatment ? { tax_treatment: x.tax_treatment } : {}) });
          toast(`${x.name} added`, 'success');
          refresh();
        } catch (err) { toast('Could not add: ' + err.message, 'error'); e.currentTarget.disabled = false; }
      },
    }, `＋ ${x.name}`)),
    el('button', { class: 'chip chip-custom', type: 'button', onClick: () => categorySheet(null) }, '＋ Custom…'),
  ]);
  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', {}, 'Add a category')]),
    el('p', { class: 'muted small hint' }, 'Start simple and add only what you need. To remove one, tap it and choose Delete.'),
    chips,
  ]);
}

function stat(label, value, tone) {
  return el('div', { class: 'bs-stat' }, [
    el('span', { class: 'bs-label' }, label),
    el('span', { class: 'bs-value ' + (tone || '') }, value),
  ]);
}

function budgetRow({ c, kind, budget, amount, carry }) {
  const isIncome = kind === 'income';
  const over = budget > 0 && amount > budget;
  let right, sub = null;
  if (isIncome) {
    right = el('span', { class: 'br-amt' + (amount ? ' pos' : ' muted') }, fmtUSD(amount));
  } else if (budget > 0) {
    right = el('span', { class: 'br-amt' }, [
      el('span', { class: over ? 'neg' : '' }, fmtUSD(amount)),
      el('span', { class: 'muted' }, ` / ${fmtUSD(budget)}`),
    ]);
    sub = el('span', { class: 'br-sub ' + (over ? 'neg' : 'muted') },
      over ? `${fmtUSD(amount - budget)} over` : `${fmtUSD(budget - amount)} left`);
  } else {
    right = el('span', { class: 'br-amt' + (amount ? '' : ' muted') }, amount ? fmtUSD(amount) : '—');
    sub = el('span', { class: 'br-sub muted' }, 'No budget');
  }
  return el('button', { class: 'budget-row-btn', type: 'button', onClick: () => categorySheet(c) }, [
    el('div', { class: 'br-top' }, [
      el('span', { class: 'br-name' }, [
        c.name,
        c.rollover && Math.abs(carry) >= 0.01 ? el('span', { class: 'tag-mini ' + (carry > 0 ? 'pos' : 'neg') }, `${carry > 0 ? '+' : '−'}${fmtUSD(Math.abs(carry))} rolled over`) : null,
      ]),
      right,
    ]),
    budget > 0 && !isIncome ? progress(amount / budget, { over }) : null,
    sub,
  ]);
}

// Add / edit a category. Everything beyond name + budget is tucked under
// "More options" so the common case stays simple.
export function categorySheet(c, onDone = refresh) {
  openSheet(c ? c.name : 'New category', (close) => {
    const s = getSettings();
    const name = el('input', { type: 'text', value: c?.name || '', placeholder: 'e.g. Groceries' });
    const budget = el('input', { type: 'number', min: '0', step: '1', inputmode: 'decimal', value: Number(c?.monthly_budget_usd) || '', placeholder: 'No budget' });
    const kind = el('select', {}, CATEGORY_KINDS.filter((k) => k.value !== 'tax' || s.modules.taxes)
      .map((k) => el('option', { value: k.value, selected: (c ? kindOf(c) : 'soft') === k.value ? 'selected' : null }, k.label)));
    const rollover = el('input', { type: 'checkbox', checked: c?.rollover ? 'checked' : null });
    const defTreat = defaultTreatment(c?.name)
      || ((c?.name || '').toLowerCase() === 'income' ? s.tax.main_income : 'owed');
    const treatment = el('select', {}, TAX_TREATMENTS.map((x) => el('option', { value: x.value, selected: (c?.tax_treatment || defTreat) === x.value ? 'selected' : null }, x.label)));
    const deductible = el('input', { type: 'checkbox', checked: c?.tax_deductible ? 'checked' : null });

    const budgetField = field(`Monthly budget (${CONFIG.BASE_CURRENCY})`, budget);
    const rollRow = el('label', { class: 'check-row' }, [rollover, 'Roll unused budget into next month']);
    const treatField = field('How is this income taxed?', treatment);
    const deductRow = el('label', { class: 'check-row' }, [deductible, 'Tax-deductible (lowers your tax estimate)']);
    const sync = () => {
      const inc = kind.value === 'income';
      budgetField.style.display = inc ? 'none' : '';
      rollRow.style.display = inc ? 'none' : '';
      treatField.style.display = s.modules.taxes && inc ? '' : 'none';
      deductRow.style.display = s.modules.taxes && !inc && kind.value !== 'tax' ? '' : 'none';
    };
    kind.addEventListener('change', sync);
    sync();

    const save = el('button', { class: 'btn btn-primary btn-block' }, c ? 'Save' : 'Add category');
    save.addEventListener('click', async () => {
      const row = {
        name: name.value.trim(),
        kind: kind.value,
        monthly_budget_usd: kind.value === 'income' ? 0 : parseFloat(budget.value) || 0,
        rollover: kind.value !== 'income' && rollover.checked,
        ...(s.modules.taxes ? {
          tax_treatment: kind.value === 'income' ? treatment.value : null,
          tax_deductible: kind.value !== 'income' && deductible.checked,
        } : {}),
      };
      if (!row.name) return toast('Give it a name', 'error');
      save.disabled = true;
      try {
        if (c) await db.updateCategory(c.id, row); else await db.createCategory(row);
        toast(c ? 'Saved' : 'Category added', 'success'); close(); onDone();
      } catch (err) { toast('Could not save: ' + err.message, 'error'); save.disabled = false; }
    });

    const body = el('div', { class: 'sheet-body' }, [
      field('Name', name),
      budgetField,
      el('details', { class: 'more-opts', open: c ? null : null }, [
        el('summary', {}, 'More options'),
        field('Type', kind, 'Bills and everyday spending both count as spending; the type sorts them on your Plan.'),
        rollRow, treatField, deductRow,
      ]),
      save,
    ]);
    if (c) {
      body.append(el('button', { class: 'btn btn-ghost btn-block danger', onClick: async () => {
        if (!confirm(`Delete "${c.name}"? Its transactions are kept but lose this label.`)) return;
        await db.deleteCategory(c.id);
        toast('Category deleted', 'info'); close(); onDone();
      } }, 'Delete category'));
    }
    return body;
  });
}

// --- Your data: export & restore -----------------------------------------------
// The lesson of Mint shutting down: always be able to walk away with your data.
export function dataCard() {
  const card = el('div', { class: 'card' }, [
    el('h2', {}, 'Your data'),
    el('p', { class: 'muted hint' },
      'Download a backup anytime. The CSV re-imports through the Import page; the JSON is a full backup (restorable in local mode).'),
  ]);

  const btnJSON = el('button', { class: 'btn btn-sm' }, 'Export JSON backup');
  const btnCSV = el('button', { class: 'btn btn-sm' }, 'Export CSV');
  btnJSON.addEventListener('click', () => exportAll('json'));
  btnCSV.addEventListener('click', () => exportAll('csv'));
  const actions = el('div', { class: 'data-actions' }, [btnJSON, btnCSV]);

  // Restore is local-mode only: it overwrites this device's data wholesale.
  if (isLocalMode()) {
    const file = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
    const btnRestore = el('button', { class: 'btn btn-sm btn-ghost' }, 'Restore from JSON…');
    btnRestore.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!Array.isArray(data.transactions) || !Array.isArray(data.categories)) {
          throw new Error(`not a ${CONFIG.APP_NAME} backup file`);
        }
        if (!confirm(`Replace ALL local data with this backup (${data.transactions.length} transactions)?`)) return;
        await db.restoreAll(data);
        toast('Backup restored', 'success');
        location.reload();
      } catch (err) {
        toast('Restore failed: ' + (err.message || 'invalid file'), 'error');
      }
    });
    actions.append(btnRestore, file);
  }

  card.append(actions);
  return card;
}

async function exportAll(format) {
  const [categories, transactions, recurring, settings, ...extra] = await Promise.all([
    db.listCategories(),
    db.listTransactions(),
    db.listRecurring().catch(() => []),
    db.getSettings().catch(() => null),
    ...TABLES.map((t) => db.list(t).catch(() => [])),
  ]);
  const tables = Object.fromEntries(TABLES.map((t, i) => [t, extra[i]]));
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'json') {
    const blob = new Blob(
      [JSON.stringify({ exported_at: new Date().toISOString(), settings, categories, transactions, recurring, ...tables }, null, 2)],
      { type: 'application/json' });
    download(blob, `personal-budget-backup-${stamp}.json`);
  } else {
    // Signed amounts (income +, expense −) so our own importer round-trips it.
    const catById = new Map(categories.map((c) => [c.id, c.name]));
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Date', 'Amount', 'Currency', 'Description', 'Category'].join(',')];
    for (const t of transactions) {
      const signed = (t.type === 'income' ? 1 : -1) * Number(t.amount);
      lines.push([t.date, signed, t.currency, esc(t.description), esc(catById.get(t.category_id))].join(','));
    }
    download(new Blob([lines.join('\n')], { type: 'text/csv' }), `personal-budget-${stamp}.csv`);
  }
  toast('Export downloaded', 'success');
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
