// =============================================================================
// categories.js — Categories & Budgets. Editable list with monthly USD budgets.
// Add / edit / delete.
// =============================================================================

import { db } from '../db.js';
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

    const row = el('div', { class: 'cat-row' }, [
      el('div', { class: 'cat-fields' }, [
        name,
        el('div', { class: 'cat-budget-wrap' }, [el('span', { class: 'prefix' }, '$'), budget, el('span', { class: 'suffix' }, '/mo')]),
      ]),
      el('div', { class: 'cat-actions' }, [
        el('button', { class: 'btn btn-sm btn-primary', onClick: async () => {
          const patch = { name: name.value.trim(), monthly_budget_usd: parseFloat(budget.value) || 0 };
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

  await reload();
  return root;
}
