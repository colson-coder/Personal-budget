// =============================================================================
// add.js — Add Transaction form. Converts the entered amount to USD using the
// rate for the transaction's OWN date, then stores original + USD + exact rate.
// =============================================================================

import { db } from '../db.js';
import { CONFIG } from '../config.js';
import { convertToUSD } from '../rates.js';
import { el, toast, todayISO, isValidISODate } from '../util.js';

export async function renderAdd() {
  const [categories, history] = await Promise.all([
    db.listCategories(),
    db.listTransactions({ limit: 500 }), // for autocomplete + smart suggestions
  ]);

  const root = el('div', { class: 'view view-add' });
  root.append(el('div', { class: 'view-head' }, [el('h1', {}, 'Add transaction')]));

  const typeIncome = el('input', { type: 'radio', name: 'type', value: 'income', id: 'type-income' });
  const typeExpense = el('input', { type: 'radio', name: 'type', value: 'expense', id: 'type-expense', checked: 'checked' });

  // Default the currency to whatever was used last (one less tap per entry).
  const lastCurrency = localStorage.getItem('pb_last_currency') || CONFIG.BASE_CURRENCY;
  const amountInput = el('input', { type: 'number', step: '0.01', min: '0', id: 'f-amount', placeholder: '0.00', required: 'required', inputmode: 'decimal' });
  const currencySel = el('select', { id: 'f-currency' },
    CONFIG.CURRENCIES.map((c) => el('option', { value: c, selected: c === lastCurrency ? 'selected' : null }, c)));
  const categorySel = el('select', { id: 'f-category', required: 'required' },
    categories.length
      ? categories.map((c) => el('option', { value: c.id }, c.name))
      : [el('option', { value: '' }, 'No categories — add some first')]);
  const dateInput = el('input', { type: 'date', id: 'f-date', value: todayISO(), max: todayISO(), required: 'required' });
  const descInput = el('input', { type: 'text', id: 'f-desc', placeholder: 'e.g. Groceries at Auto Mercado', list: 'desc-suggestions', autocomplete: 'off' });

  // Smart entry (Cashew-style "title recognition" — a lookup, not ML):
  // autocomplete past descriptions, and when one matches, prefill the
  // category/currency you used for it last time.
  const pastByDesc = new Map(); // lowercased description → most recent tx
  for (const t of history) {
    const k = (t.description || '').trim().toLowerCase();
    if (k && !pastByDesc.has(k)) pastByDesc.set(k, t); // history is newest-first
  }
  const datalist = el('datalist', { id: 'desc-suggestions' },
    [...pastByDesc.values()].slice(0, 50).map((t) => el('option', { value: t.description })));
  descInput.addEventListener('input', () => {
    const match = pastByDesc.get(descInput.value.trim().toLowerCase());
    if (!match) return;
    if (match.category_id && [...categorySel.options].some((o) => o.value === match.category_id)) {
      categorySel.value = match.category_id;
    }
    if (CONFIG.CURRENCIES.includes(match.currency)) currencySel.value = match.currency;
    if (match.type === 'income') typeIncome.checked = true;
    else typeExpense.checked = true;
    if (!amountInput.value) amountInput.placeholder = String(match.amount);
  });

  const submitBtn = el('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Save transaction');

  const form = el('form', { class: 'card form-card' }, [
    el('div', { class: 'field' }, [
      el('label', {}, 'Type'),
      el('div', { class: 'segmented' }, [
        el('label', { class: 'seg' }, [typeExpense, el('span', {}, 'Expense')]),
        el('label', { class: 'seg' }, [typeIncome, el('span', {}, 'Income')]),
      ]),
    ]),
    el('div', { class: 'row-2' }, [
      el('div', { class: 'field' }, [el('label', { for: 'f-amount' }, 'Amount'), amountInput]),
      el('div', { class: 'field' }, [el('label', { for: 'f-currency' }, 'Currency'), currencySel]),
    ]),
    el('div', { class: 'field' }, [el('label', { for: 'f-category' }, 'Category'), categorySel]),
    el('div', { class: 'field' }, [el('label', { for: 'f-date' }, 'Date'), dateInput]),
    el('div', { class: 'field' }, [el('label', { for: 'f-desc' }, 'Description'), descInput, datalist]),
    submitBtn,
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseFloat(amountInput.value);
    const currency = currencySel.value;
    const category_id = categorySel.value;
    const date = dateInput.value;
    const type = typeIncome.checked ? 'income' : 'expense';

    if (!(amount > 0)) return toast('Enter an amount greater than 0', 'error');
    if (!category_id) return toast('Pick a category', 'error');
    if (!isValidISODate(date)) return toast('Enter a valid date', 'error');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Fetching rate…';
    try {
      // Convert using the rate for THIS transaction's date. Throws on failure,
      // which blocks the save rather than storing a bad conversion.
      const { amount_usd, exchange_rate } = await convertToUSD(amount, currency, date);
      await db.createTransaction({
        type, date, amount, currency, amount_usd, exchange_rate,
        category_id, description: descInput.value.trim(),
      });
      localStorage.setItem('pb_last_currency', currency);
      // Stay on the page for rapid entry: clear amount/description, keep
      // category/currency/date, refocus amount.
      toast('Saved — add another or head to the dashboard', 'success');
      amountInput.value = '';
      descInput.value = '';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save transaction';
      amountInput.focus();
    } catch (err) {
      console.error(err);
      toast('Could not save: ' + (err.message || 'rate unavailable'), 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save transaction';
    }
  });

  root.append(form);

  // --- Recurring rules (auto-tracking) ---------------------------------------
  // Rent, salary, subscriptions: set once, and the app records them on their
  // day every month automatically (see js/recurring.js).
  root.append(await recurringCard(categories));

  return root;
}

async function recurringCard(categories) {
  const card = el('div', { class: 'card' });

  async function reload() {
    let rules = [];
    try {
      rules = await db.listRecurring();
    } catch { /* table missing on old setups */ }

    card.replaceChildren(
      el('div', { class: 'card-head' }, [el('h2', {}, 'Recurring (automatic)')]),
      el('p', { class: 'muted hint' },
        'These are added automatically every month on their day — rent, salary, subscriptions.'),
    );

    const catById = new Map(categories.map((c) => [c.id, c]));
    if (!rules.length) {
      card.append(el('p', { class: 'muted' }, 'No recurring transactions yet.'));
    }
    for (const r of rules) {
      card.append(el('div', { class: 'rec-row' }, [
        el('div', { class: 'rec-main' }, [
          el('span', { class: 'rec-desc' }, r.description || catById.get(r.category_id)?.name || 'Recurring'),
          el('span', { class: 'rec-meta' },
            `Day ${r.day_of_month} · ${catById.get(r.category_id)?.name ?? '—'} · ${r.type}`),
        ]),
        el('span', { class: 'rec-amt ' + (r.type === 'income' ? 'pos' : 'neg') },
          `${Number(r.amount).toLocaleString()} ${r.currency}`),
        el('button', { class: 'icon-btn', title: 'Delete rule', onClick: async () => {
          if (!confirm('Stop this recurring transaction? Already-added months are kept.')) return;
          await db.deleteRecurring(r.id);
          toast('Recurring rule removed', 'info');
          reload();
        } }, '🗑'),
      ]));
    }

    // Add-rule form
    const rType = el('select', {}, [
      el('option', { value: 'expense' }, 'Expense'),
      el('option', { value: 'income' }, 'Income'),
    ]);
    const rAmount = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Amount', inputmode: 'decimal' });
    const rCurrency = el('select', {}, CONFIG.CURRENCIES.map((c) => el('option', { value: c }, c)));
    const rCat = el('select', {}, categories.map((c) => el('option', { value: c.id }, c.name)));
    const rDay = el('input', { type: 'number', min: '1', max: '31', value: '1', title: 'Day of month', inputmode: 'numeric' });
    const rDesc = el('input', { type: 'text', placeholder: 'e.g. Rent, Salary, Netflix' });
    const addBtn = el('button', { class: 'btn btn-primary btn-sm' }, 'Add recurring');

    addBtn.addEventListener('click', async () => {
      const amount = parseFloat(rAmount.value);
      const day = parseInt(rDay.value, 10);
      if (!(amount > 0)) return toast('Enter an amount greater than 0', 'error');
      if (!(day >= 1 && day <= 31)) return toast('Day must be 1–31', 'error');
      addBtn.disabled = true;
      try {
        await db.createRecurring({
          type: rType.value, amount, currency: rCurrency.value,
          category_id: rCat.value, day_of_month: day,
          description: rDesc.value.trim(), last_applied: null, active: true,
        });
        toast('Recurring rule added — it starts this month', 'success');
        reload();
      } catch (err) {
        toast('Could not add rule: ' + (err.message || 'unknown error'), 'error');
        addBtn.disabled = false;
      }
    });

    card.append(el('div', { class: 'rec-form' }, [
      el('div', { class: 'rec-form-grid' }, [
        el('div', { class: 'field' }, [el('label', {}, 'Type'), rType]),
        el('div', { class: 'field' }, [el('label', {}, 'Amount'), rAmount]),
        el('div', { class: 'field' }, [el('label', {}, 'Currency'), rCurrency]),
        el('div', { class: 'field' }, [el('label', {}, 'Day of month'), rDay]),
        el('div', { class: 'field' }, [el('label', {}, 'Category'), rCat]),
        el('div', { class: 'field' }, [el('label', {}, 'Description'), rDesc]),
      ]),
      addBtn,
    ]));
  }

  await reload();
  return card;
}
