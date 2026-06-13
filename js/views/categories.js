// =============================================================================
// categories.js — Categories & Budgets. Editable list with monthly USD budgets.
// Add / edit / delete.
// =============================================================================

import { db, isLocalMode } from '../db.js';
import { el, fmtUSD, toast } from '../util.js';

export async function renderCategories() {
  const root = el('div', { class: 'view view-categories' });
  root.append(el('div', { class: 'view-head' }, [el('h1', {}, 'Categories & Budgets')]));

  const listHost = el('div', { class: 'card' });
  root.append(listHost);

  async function reload() {
    const cats = await db.listCategories();
    listHost.replaceChildren();
    if (!cats.length) {
      listHost.append(el('p', { class: 'muted' }, 'No categories yet.'));
    }
    for (const c of cats) listHost.append(catRow(c));
  }

  function catRow(c) {
    const name = el('input', { type: 'text', value: c.name, class: 'cat-name' });
    const budget = el('input', { type: 'number', min: '0', step: '1', value: Number(c.monthly_budget_usd) || 0, class: 'cat-budget', inputmode: 'decimal' });
    // Envelope rollover: unspent budget carries into next month (YNAB-style).
    const rollover = el('input', { type: 'checkbox', class: 'cat-rollover', checked: c.rollover ? 'checked' : null });

    const row = el('div', { class: 'cat-row' }, [
      el('div', { class: 'cat-fields' }, [
        name,
        el('div', { class: 'cat-budget-wrap' }, [el('span', { class: 'prefix' }, '$'), budget, el('span', { class: 'suffix' }, '/mo')]),
        el('label', { class: 'rollover-label', title: 'Unspent budget carries into next month' }, [rollover, 'roll over']),
      ]),
      el('div', { class: 'cat-actions' }, [
        el('button', { class: 'btn btn-sm btn-primary', onClick: async () => {
          const patch = {
            name: name.value.trim(),
            monthly_budget_usd: parseFloat(budget.value) || 0,
            rollover: rollover.checked,
          };
          if (!patch.name) return toast('Name cannot be empty', 'error');
          await db.updateCategory(c.id, patch);
          toast('Saved', 'success');
        } }, 'Save'),
        el('button', { class: 'btn btn-sm btn-ghost', onClick: async () => {
          if (!confirm(`Delete "${c.name}"? Transactions keep their data but lose this label.`)) return;
          await db.deleteCategory(c.id);
          toast('Deleted', 'info');
          reload();
        } }, 'Delete'),
      ]),
    ]);
    return row;
  }

  // Add-new form
  const newName = el('input', { type: 'text', placeholder: 'New category name' });
  const newBudget = el('input', { type: 'number', min: '0', step: '1', placeholder: '0', inputmode: 'decimal' });
  const addCard = el('div', { class: 'card add-cat' }, [
    el('h2', {}, 'Add category'),
    el('div', { class: 'cat-fields' }, [
      newName,
      el('div', { class: 'cat-budget-wrap' }, [el('span', { class: 'prefix' }, '$'), newBudget, el('span', { class: 'suffix' }, '/mo')]),
    ]),
    el('button', { class: 'btn btn-primary', onClick: async () => {
      const name = newName.value.trim();
      if (!name) return toast('Enter a name', 'error');
      await db.createCategory({ name, monthly_budget_usd: parseFloat(newBudget.value) || 0 });
      newName.value = ''; newBudget.value = '';
      toast('Category added', 'success');
      reload();
    } }, 'Add'),
  ]);
  root.append(addCard);
  root.append(dataCard());

  await reload();
  return root;
}

// --- Your data: export & restore -----------------------------------------------
// The lesson of Mint shutting down: always be able to walk away with your data.
function dataCard() {
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
          throw new Error('not a Personal Budget backup file');
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
  const [categories, transactions, recurring] = await Promise.all([
    db.listCategories(),
    db.listTransactions(),
    db.listRecurring().catch(() => []),
  ]);
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'json') {
    const blob = new Blob(
      [JSON.stringify({ exported_at: new Date().toISOString(), categories, transactions, recurring }, null, 2)],
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
