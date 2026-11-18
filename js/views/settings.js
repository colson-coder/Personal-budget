// =============================================================================
// settings.js — Everything setup configured, editable: profile, home currency,
// timezone, currencies, features shown, and the money-plan rules.
// =============================================================================

import { CONFIG, SUPPORTED_CURRENCIES } from '../config.js';
import { getSettings, saveSettings, loadAll } from '../store.js';
import { sortRules } from '../finance.js';
import { fundSheet } from './funds.js';
import { dataCard } from './categories.js';
import { THEMES } from '../theme.js';
import { el, toast, field } from '../util.js';
import { navigate } from '../router.js';

const METHODS = [
  { value: 'percent_income', label: '% of all income' },
  { value: 'percent_net', label: '% of net income' },
  { value: 'fixed', label: 'Fixed amount' },
  { value: 'percent_remainder', label: '% of what’s left' },
];

export async function renderSettings(params = {}) {
  const s = getSettings();
  const { funds, txs } = await loadAll();
  const root = el('div', { class: 'view view-settings' });
  root.append(el('div', { class: 'view-head' }, [el('h1', {}, 'Settings')]));

  root.append(appearanceCard(s));
  root.append(profileCard(s, txs.length > 0));
  root.append(featuresCard(s));
  if (s.modules.plan) {
    const plan = planCard(s, funds);
    root.append(plan);
    if (params.section === 'plan') requestAnimationFrame(() => plan.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  root.append(dataCard());
  root.append(el('div', { class: 'card' }, [
    el('h2', {}, 'Start over'),
    el('p', { class: 'muted small hint' }, 'Run the setup questions again. Your existing data is kept.'),
    el('button', { class: 'btn btn-sm', onClick: async () => {
      await saveSettings({ setup_done: false });
      location.reload();
    } }, 'Run setup again'),
  ]));
  return root;
}

function appearanceCard(s) {
  const grid = el('div', { class: 'theme-grid' });
  const draw = (current) => grid.replaceChildren(...THEMES.map((t) => el('button', {
    class: 'theme-opt' + (t.value === current ? ' on' : ''), type: 'button', 'aria-pressed': t.value === current ? 'true' : 'false',
    onClick: async () => {
      draw(t.value);
      await saveSettings({ theme: t.value }); // applies instantly via store
      toast(`${t.label} theme on`, 'success');
    },
  }, [
    el('span', { class: 'theme-swatch', style: `background:${t.swatch[0]};border:1px solid var(--border)` }, [
      el('i', { style: `width:45%;background:${t.swatch[1]}` }),
      el('i', { style: `width:25%;background:${t.swatch[2]}` }),
    ]),
    el('span', { class: 'theme-name' }, t.label),
    el('span', { class: 'theme-desc' }, t.desc),
  ])));
  draw(s.theme || 'mono');
  return el('div', { class: 'card' }, [el('h2', {}, 'Appearance'), grid]);
}

function profileCard(s, hasData) {
  const name = el('input', { type: 'text', value: s.name || '', placeholder: 'optional' });
  const base = el('select', { disabled: hasData ? 'disabled' : null }, SUPPORTED_CURRENCIES.map((c) =>
    el('option', { value: c, selected: c === CONFIG.BASE_CURRENCY ? 'selected' : null }, c)));
  let zones;
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = []; }
  if (!zones.includes(CONFIG.TIMEZONE)) zones = [CONFIG.TIMEZONE, ...zones];
  const tz = el('select', {}, zones.map((z) => el('option', { value: z, selected: z === CONFIG.TIMEZONE ? 'selected' : null }, z.replace(/_/g, ' '))));
  const chosen = new Set(CONFIG.CURRENCIES);
  const chips = el('div', { class: 'chips' });
  const drawChips = () => chips.replaceChildren(...SUPPORTED_CURRENCIES.map((c) => {
    const on = chosen.has(c);
    return el('button', {
      class: 'chip' + (on ? ' on' : ''), type: 'button',
      disabled: c === base.value ? 'disabled' : null,
      onClick: () => { on ? chosen.delete(c) : chosen.add(c); drawChips(); },
    }, c);
  }));
  drawChips();
  base.addEventListener('change', () => { chosen.add(base.value); drawChips(); });

  const save = el('button', { class: 'btn btn-primary btn-sm' }, 'Save');
  save.addEventListener('click', async () => {
    try {
      await saveSettings({ name: name.value.trim(), base_currency: base.value, timezone: tz.value, currencies: [...chosen] });
      toast('Saved', 'success');
      navigate('/settings');
    } catch (err) { toast('Could not save: ' + err.message, 'error'); }
  });

  return el('div', { class: 'card' }, [
    el('h2', {}, 'You'),
    field('Name', name),
    el('div', { class: 'row-2' }, [
      field('Home currency', base, hasData ? 'Locked once you have transactions, so past totals stay correct.' : 'All totals use this currency.'),
      field('Timezone', tz),
    ]),
    el('div', { class: 'field' }, [el('label', {}, 'Currencies you use'), chips]),
    save,
  ]);
}

function featuresCard(s) {
  const toggle = (key, label, desc) => {
    const box = el('input', { type: 'checkbox', checked: s.modules[key] ? 'checked' : null });
    box.addEventListener('change', async () => {
      await saveSettings({ modules: { ...getSettings().modules, [key]: box.checked } });
      toast(box.checked ? `${label} turned on` : `${label} hidden`, 'success');
      // Rebuild nav to show/hide the page.
      window.dispatchEvent(new Event('pb:settings-changed'));
    });
    return el('label', { class: 'toggle-row' }, [
      el('span', { class: 'rec-main' }, [el('span', { class: 'rec-desc' }, label), el('span', { class: 'rec-meta' }, desc)]),
      el('span', { class: 'switch' }, [box, el('span', { class: 'switch-ui' })]),
    ]);
  };
  return el('div', { class: 'card' }, [
    el('h2', {}, 'Features'),
    el('p', { class: 'muted small hint' }, 'Show only what you use. Hiding a feature keeps its data.'),
    toggle('plan', 'Savings & money plan', 'Funds and monthly allocation rules'),
    toggle('debts', 'Debts & loans', 'Balances, interest, payoff dates'),
    toggle('income', 'Passive income', 'Dividends, interest, side business'),
    toggle('taxes', 'Taxes', 'Estimate what you owe and what to set aside'),
  ]);
}

function planCard(s, funds) {
  const rules = sortRules(s.plan.rules).map((r) => ({ ...r }));
  const card = el('div', { class: 'card', id: 'plan' });
  const list = el('div', { class: 'rule-list' });

  const fundOptions = (sel) => funds.map((f) => el('option', { value: f.id, selected: f.id === sel ? 'selected' : null }, f.name));

  function drawRules() {
    list.replaceChildren(...rules.map((r, idx) => {
      const fund = el('select', {}, fundOptions(r.fund_id));
      const method = el('select', {}, METHODS.map((m) => el('option', { value: m.value, selected: m.value === r.method ? 'selected' : null }, m.label)));
      const value = el('input', { type: 'number', step: 'any', min: '0', inputmode: 'decimal', value: r.value ?? '' });
      const after = el('input', { type: 'number', step: 'any', min: '0', inputmode: 'decimal', value: r.value_after_goal ?? '', placeholder: 'same' });
      const afterField = field('After goal %', after);
      const sync = () => {
        afterField.style.display = method.value === 'percent_remainder' ? '' : 'none';
        value.placeholder = method.value === 'fixed' ? CONFIG.BASE_CURRENCY : '%';
      };
      fund.addEventListener('change', () => { r.fund_id = fund.value; });
      method.addEventListener('change', () => { r.method = method.value; sync(); });
      value.addEventListener('input', () => { r.value = parseFloat(value.value) || 0; });
      after.addEventListener('input', () => { r.value_after_goal = after.value === '' ? null : parseFloat(after.value); });
      sync();
      return el('div', { class: 'rule-row' }, [
        field('Fund', fund),
        field('How much', method),
        field(method.value === 'fixed' ? 'Amount' : 'Percent', value),
        afterField,
        el('button', { class: 'icon-btn rule-del', title: 'Remove rule', onClick: () => { rules.splice(idx, 1); drawRules(); } }, '✕'),
      ]);
    }));
    if (!rules.length) list.append(el('p', { class: 'muted small' }, 'No rules yet. Add one below.'));
  }
  drawRules();

  const start = el('input', { type: 'month', value: s.plan.start_month || '' });
  const save = el('button', { class: 'btn btn-primary btn-sm' }, 'Save plan');
  save.addEventListener('click', async () => {
    const clean = rules.filter((r) => r.fund_id && Number(r.value) > 0);
    try {
      await saveSettings({ plan: { ...getSettings().plan, rules: clean, start_month: start.value || null } });
      toast('Plan saved', 'success');
      navigate('/plan');
    } catch (err) { toast('Could not save: ' + err.message, 'error'); }
  });

  card.append(
    el('h2', {}, 'Money plan'),
    el('p', { class: 'muted small hint' },
      'Applied in order: % of all income, % of net income, fixed amounts, then % of what’s left. Anything unassigned stays in your everyday balance.'),
    list,
    el('div', { class: 'rule-actions' }, [
      el('button', {
        class: 'btn btn-sm', disabled: funds.length ? null : 'disabled',
        onClick: () => { rules.push({ id: crypto.randomUUID(), fund_id: funds[0]?.id, method: 'percent_remainder', value: 10, value_after_goal: null }); drawRules(); },
      }, '＋ Add rule'),
      el('button', { class: 'btn btn-sm btn-ghost', onClick: () => fundSheet(null, () => navigate('/settings?section=plan')) }, '＋ New fund'),
    ]),
    field('Plan starts', start, 'Months before this aren’t split into funds.'),
    save,
  );
  return card;
}
