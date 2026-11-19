// =============================================================================
// quick.js — Quick money actions used from the master board (Home):
//   • incomeSheet  — log income in seconds (e.g. a side hustle), then offer to
//                    assign it
//   • assignSheet  — move money you haven't assigned yet into any fund
// =============================================================================

import { db } from '../db.js';
import { CONFIG } from '../config.js';
import { ensureCategory, getSettings } from '../store.js';
import { convertToBase } from '../rates.js';
import { el, fmtUSD, toast, todayISO, openSheet, field, isValidISODate } from '../util.js';

// Log income: a paycheck (main "Income" category, tax usually taken out) or
// side income (tax owed, so it shows up on the Taxes page).
export function incomeSheet({ categories, onDone, onAssign }) {
  openSheet('Add income', (close) => {
    const amount = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: '0.00' });
    const currency = el('select', {}, CONFIG.CURRENCIES.map((c) => el('option', { value: c }, c)));
    const what = el('input', { type: 'text', placeholder: 'e.g. Paycheck, logo design for a client' });
    const date = el('input', { type: 'date', value: todayISO(), max: todayISO() });
    const incomeCats = categories.filter((c) => c.kind === 'income' && !['Interest', 'Passive Income'].includes(c.name));
    const hasSide = incomeCats.some((c) => c.name === 'Side income');
    const cat = el('select', {}, [
      ...(hasSide ? [] : [el('option', { value: '__side' }, 'Side income')]),
      ...incomeCats.map((c) => el('option', { value: c.id }, c.name === 'Income' ? 'Paycheck / main income' : c.name)),
    ]);
    // Default to the main income category when there is one.
    const main = incomeCats.find((c) => c.name === 'Income');
    if (main) cat.value = main.id;
    const save = el('button', { class: 'btn btn-primary btn-block' }, 'Add income');

    save.addEventListener('click', async () => {
      const amt = parseFloat(amount.value);
      if (!(amt > 0)) return toast('Enter an amount', 'error');
      if (!isValidISODate(date.value)) return toast('Pick a date', 'error');
      save.disabled = true;
      try {
        let category_id = cat.value;
        if (category_id === '__side') {
          const c = await ensureCategory('Side income', 'income');
          if (!c.tax_treatment) await db.updateCategory(c.id, { tax_treatment: 'owed' }).catch(() => {});
          category_id = c.id;
        }
        const { amount_usd, exchange_rate } = await convertToBase(amt, currency.value, date.value);
        await db.createTransaction({
          type: 'income', date: date.value, amount: amt, currency: currency.value, amount_usd, exchange_rate,
          category_id, description: what.value.trim() || cat.selectedOptions[0]?.textContent || 'Income',
        });
        close();
        toast(`${fmtUSD(amount_usd)} added`, 'success');
        // Offer to put it somewhere right away.
        if (onAssign && getSettings().modules.plan) onAssign(amount_usd);
        else onDone?.();
      } catch (err) { toast('Could not save: ' + err.message, 'error'); save.disabled = false; }
    });

    return el('div', { class: 'sheet-body' }, [
      el('div', { class: 'row-2' }, [field('Amount', amount), field('Currency', currency)]),
      field('What was it for?', what),
      el('div', { class: 'row-2' }, [field('Type', cat), field('Date', date)]),
      el('p', { class: 'muted small' }, 'Pick Side income for gigs, freelance work or sales. It counts as income you owe tax on, so it shows up on the Taxes page.'),
      save,
    ]);
  });
}

// Move unassigned money into a fund. `available` is this month's left-to-
// assign; `suggest` prefills the amount (e.g. right after adding income).
export function assignSheet({ funds, available, suggest, onDone, onNewFund }) {
  openSheet('Assign money', (close) => {
    if (!funds.length) {
      return el('div', { class: 'sheet-body' }, [
        el('p', {}, 'Create a fund first — a place for the money to go, like “Emergency fund” or “Vacation”.'),
        el('button', { class: 'btn btn-primary btn-block', onClick: () => { close(); onNewFund?.(); } }, 'Create a fund'),
      ]);
    }
    const fund = el('select', {}, funds.map((f) => el('option', { value: f.id }, f.name)));
    const amount = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: '0.00',
      value: suggest ? Math.max(0, Math.min(suggest, Math.max(available, 0) || suggest)).toFixed(2) : '' });
    const quick = el('div', { class: 'chips' }, available > 0 ? [
      ['25%', 0.25], ['50%', 0.5], ['All', 1],
    ].map(([label, f]) => el('button', { class: 'chip', type: 'button', onClick: () => { amount.value = (available * f).toFixed(2); } }, label)) : []);
    const note = el('input', { type: 'text', placeholder: 'optional' });
    const save = el('button', { class: 'btn btn-primary btn-block' }, 'Assign');

    save.addEventListener('click', async () => {
      const amt = parseFloat(amount.value);
      if (!(amt > 0)) return toast('Enter an amount', 'error');
      if (amt > available + 0.005 && !confirm(`That’s more than the ${fmtUSD(available)} left to assign this month. Assign anyway?`)) return;
      save.disabled = true;
      try {
        const f = funds.find((x) => x.id === fund.value);
        await db.createTransaction({
          type: 'transfer', date: todayISO(), amount: amt, currency: CONFIG.BASE_CURRENCY,
          amount_usd: amt, exchange_rate: 1, category_id: null, fund_id: f.id,
          description: note.value.trim() || `Assigned to ${f.name}`,
        });
        toast(`${fmtUSD(amt)} → ${f.name}`, 'success'); close(); onDone?.();
      } catch (err) { toast('Could not assign: ' + err.message, 'error'); save.disabled = false; }
    });

    return el('div', { class: 'sheet-body' }, [
      el('div', { class: 'assign-available' }, [
        el('span', { class: 'muted small' }, 'Left to assign this month'),
        el('span', { class: 'assign-amt ' + (available < 0 ? 'neg' : '') }, fmtUSD(available)),
      ]),
      field('Put it in', fund),
      field(`Amount (${CONFIG.BASE_CURRENCY})`, amount),
      quick,
      field('Note', note),
      save,
    ]);
  });
}
