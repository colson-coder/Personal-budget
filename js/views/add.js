// =============================================================================
// add.js — Add Transaction form. Converts the entered amount to USD using the
// rate for the transaction's OWN date, then stores original + USD + exact rate.
// =============================================================================

import { db } from '../db.js';
import { CONFIG } from '../config.js';
import { convertToUSD } from '../rates.js';
import { el, toast, todayISO, isValidISODate } from '../util.js';
import { navigate } from '../router.js';

export async function renderAdd() {
  const categories = await db.listCategories();

  const root = el('div', { class: 'view view-add' });
  root.append(el('div', { class: 'view-head' }, [el('h1', {}, 'Add transaction')]));

  const typeIncome = el('input', { type: 'radio', name: 'type', value: 'income', id: 'type-income' });
  const typeExpense = el('input', { type: 'radio', name: 'type', value: 'expense', id: 'type-expense', checked: 'checked' });

  const amountInput = el('input', { type: 'number', step: '0.01', min: '0', id: 'f-amount', placeholder: '0.00', required: 'required', inputmode: 'decimal' });
  const currencySel = el('select', { id: 'f-currency' },
    CONFIG.CURRENCIES.map((c) => el('option', { value: c, selected: c === CONFIG.BASE_CURRENCY ? 'selected' : null }, c)));
  const categorySel = el('select', { id: 'f-category', required: 'required' },
    categories.length
      ? categories.map((c) => el('option', { value: c.id }, c.name))
      : [el('option', { value: '' }, 'No categories — add some first')]);
  const dateInput = el('input', { type: 'date', id: 'f-date', value: todayISO(), max: todayISO(), required: 'required' });
  const descInput = el('input', { type: 'text', id: 'f-desc', placeholder: 'e.g. Groceries at Auto Mercado' });

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
    el('div', { class: 'field' }, [el('label', { for: 'f-desc' }, 'Description'), descInput]),
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
      toast('Transaction saved', 'success');
      navigate('/dashboard');
    } catch (err) {
      console.error(err);
      toast('Could not save: ' + (err.message || 'rate unavailable'), 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save transaction';
    }
  });

  root.append(form);
  return root;
}
