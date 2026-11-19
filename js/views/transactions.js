// =============================================================================
// transactions.js — Full list with date-range / category / currency filters and
// inline edit + delete. On narrow screens rows reflow into stacked cards (CSS);
// they never become a wide horizontally-scrolling table.
// =============================================================================

import { db } from '../db.js';
import { CONFIG } from '../config.js';
import { convertToUSD } from '../rates.js';
import { el, fmtUSD, toast, isValidISODate, shortDate } from '../util.js';

export async function renderTransactions() {
  const categories = await db.listCategories();
  const catById = new Map(categories.map((c) => [c.id, c]));

  const root = el('div', { class: 'view view-transactions' });
  root.append(el('div', { class: 'view-head' }, [el('h1', {}, 'Activity')]));

  // --- Filters ---------------------------------------------------------------
  const fFrom = el('input', { type: 'date' });
  const fTo = el('input', { type: 'date' });
  const fCat = el('select', {}, [el('option', { value: '' }, 'All categories'),
    ...categories.map((c) => el('option', { value: c.id }, c.name))]);
  const fCur = el('select', {}, [el('option', { value: '' }, 'All currencies'),
    ...CONFIG.CURRENCIES.map((c) => el('option', { value: c }, c))]);
  const fSearch = el('input', { type: 'search', placeholder: 'Search description or amount…' });

  const listHost = el('div', { class: 'tx-table' });

  async function reload() {
    const filters = {};
    if (fFrom.value) filters.from = fFrom.value;
    if (fTo.value) filters.to = fTo.value;
    if (fCat.value) filters.category_id = fCat.value;
    if (fCur.value) filters.currency = fCur.value;
    let rows = await db.listTransactions(filters);
    // Free-text search: case-insensitive description match, plus exact amount
    // match when the query parses as a number ("when did I last pay 60?").
    const q = fSearch.value.trim().toLowerCase();
    if (q) {
      const asNum = parseFloat(q);
      rows = rows.filter((r) =>
        (r.description || '').toLowerCase().includes(q) ||
        (!isNaN(asNum) && (Math.abs(Number(r.amount)) === Math.abs(asNum) ||
                           Math.abs(Number(r.amount_usd)) === Math.abs(asNum))));
    }
    drawRows(rows);
  }

  [fFrom, fTo, fCat, fCur].forEach((c) => c.addEventListener('change', reload));
  fSearch.addEventListener('input', reload);

  // On phones only search shows; the rest folds behind "Filters".
  const activeCount = () => [fFrom, fTo, fCat, fCur].filter((c) => c.value).length;
  const toggle = el('button', { class: 'btn filter-toggle', type: 'button', onClick: () => {
    filters.classList.toggle('open');
  } }, 'Filters');
  const syncToggle = () => { const n = activeCount(); toggle.textContent = n ? `Filters (${n})` : 'Filters'; };
  [fFrom, fTo, fCat, fCur].forEach((c) => c.addEventListener('change', syncToggle));
  const filters = el('div', { class: 'card filters' }, [
    el('div', { class: 'field filter-search' }, [el('label', {}, 'Search'),
      el('div', { class: 'filter-search-row' }, [fSearch, toggle])]),
    el('div', { class: 'field filter-more' }, [el('label', {}, 'From'), fFrom]),
    el('div', { class: 'field filter-more' }, [el('label', {}, 'To'), fTo]),
    el('div', { class: 'field filter-more' }, [el('label', {}, 'Category'), fCat]),
    el('div', { class: 'field filter-more' }, [el('label', {}, 'Currency'), fCur]),
    el('button', { class: 'btn btn-ghost filter-more', onClick: () => {
      fFrom.value = ''; fTo.value = ''; fCat.value = ''; fCur.value = ''; syncToggle(); reload();
    } }, 'Clear'),
  ]);
  root.append(filters);
  root.append(listHost);

  function drawRows(rows) {
    listHost.replaceChildren();
    if (!rows.length) {
      listHost.append(el('p', { class: 'muted pad' }, 'No transactions match these filters.'));
      return;
    }
    for (const t of rows) listHost.append(rowView(t));
  }

  // A single transaction row (display mode), with edit/delete actions.
  function rowView(t) {
    const cat = catById.get(t.category_id);
    const row = el('div', { class: 'txr' }, [
      el('div', { class: 'txr-cell txr-date', dataset: { label: 'Date' } }, t.date),
      el('div', { class: 'txr-cell txr-desc', dataset: { label: 'Description' } },
        t.description || '—'),
      el('div', { class: 'txr-cell txr-cat', dataset: { label: 'Category' } }, cat?.name ?? '—'),
      el('div', { class: 'txr-cell txr-amt', dataset: { label: 'Amount' } },
        `${Number(t.amount).toLocaleString()} ${t.currency}`),
      // Phone layout: one quiet line under the description.
      el('div', { class: 'txr-meta' }, [cat?.name ?? 'Uncategorized', shortDate(t.date),
        t.currency !== CONFIG.BASE_CURRENCY ? `${Number(t.amount).toLocaleString()} ${t.currency}` : null]
        .filter(Boolean).join(' · ')),
      el('div', { class: 'txr-cell txr-usd ' + (t.type === 'income' ? 'pos' : t.type === 'transfer' ? '' : 'neg'), dataset: { label: CONFIG.BASE_CURRENCY } },
        (t.type === 'income' ? '+' : t.type === 'transfer' ? '→ ' : '−') + fmtUSD(Math.abs(Number(t.amount_usd) || 0))),
      el('div', { class: 'txr-cell txr-actions' }, [
        el('button', { class: 'icon-btn', title: 'Edit', onClick: () => row.replaceWith(editView(t)) }, '✎'),
        el('button', { class: 'icon-btn', title: 'Delete', onClick: async () => {
          if (!confirm('Delete this transaction?')) return;
          await db.deleteTransaction(t.id);
          toast('Deleted', 'info');
          reload();
        } }, '🗑'),
      ]),
    ]);
    return row;
  }

  // Inline edit form for a single transaction.
  function editView(t) {
    const amount = el('input', { type: 'number', step: '0.01', min: '0', value: t.amount });
    const currency = el('select', {}, CONFIG.CURRENCIES.map((c) =>
      el('option', { value: c, selected: c === t.currency ? 'selected' : null }, c)));
    const date = el('input', { type: 'date', value: t.date });
    const category = el('select', {}, categories.map((c) =>
      el('option', { value: c.id, selected: c.id === t.category_id ? 'selected' : null }, c.name)));
    const type = el('select', {}, [
      el('option', { value: 'expense', selected: t.type === 'expense' ? 'selected' : null }, 'Expense'),
      el('option', { value: 'income', selected: t.type === 'income' ? 'selected' : null }, 'Income'),
      t.type === 'transfer' ? el('option', { value: 'transfer', selected: 'selected' }, 'Transfer to fund') : null,
    ]);
    const desc = el('input', { type: 'text', value: t.description || '' });

    const save = el('button', { class: 'btn btn-primary btn-sm' }, 'Save');
    const cancel = el('button', { class: 'btn btn-ghost btn-sm', onClick: () => row.replaceWith(rowView(t)) }, 'Cancel');

    const row = el('div', { class: 'txr txr-edit' }, [
      el('div', { class: 'txr-cell' }, [type]),
      el('div', { class: 'txr-cell' }, [date]),
      el('div', { class: 'txr-cell' }, [desc]),
      el('div', { class: 'txr-cell' }, [category]),
      el('div', { class: 'txr-cell' }, [amount, currency]),
      el('div', { class: 'txr-cell txr-actions' }, [save, cancel]),
    ]);

    save.addEventListener('click', async () => {
      const amt = parseFloat(amount.value);
      if (!(amt > 0)) return toast('Amount must be greater than 0', 'error');
      if (!isValidISODate(date.value)) return toast('Invalid date', 'error');
      save.disabled = true; save.textContent = '…';
      try {
        // Re-convert because amount / currency / date may have changed. Uses the
        // (possibly new) date's rate; the freshly fetched rate is stored too.
        const { amount_usd, exchange_rate } = await convertToUSD(amt, currency.value, date.value);
        await db.updateTransaction(t.id, {
          type: type.value, date: date.value, amount: amt, currency: currency.value,
          amount_usd, exchange_rate, category_id: category.value, description: desc.value.trim(),
        });
        toast('Saved', 'success');
        reload();
      } catch (err) {
        toast('Could not save: ' + (err.message || 'rate unavailable'), 'error');
        save.disabled = false; save.textContent = 'Save';
      }
    });

    return row;
  }

  await reload();
  return root;
}
