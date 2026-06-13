// =============================================================================
// recurring.js — The auto-tracking engine.
//
// A recurring rule says "every month on day N, record this transaction"
// (e.g. rent on the 1st, salary on the 15th, Netflix on the 3rd). On every app
// launch, applyRecurring() catches up any rule whose scheduled date(s) have
// passed since it last ran — including multiple missed months if the app
// wasn't opened — and inserts real transactions for them, converted at each
// scheduled date's exchange rate.
//
// Rule shape: { id, type, amount, currency, category_id, description,
//               day_of_month (1–31, clamped to short months),
//               last_applied ("YYYY-MM" of the most recent month materialized,
//                             or null if never) }
// =============================================================================

import { db } from './db.js';
import { convertToUSD } from './rates.js';
import { todayISO } from './util.js';

// "YYYY-MM" → following month's "YYYY-MM".
function nextMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

// Clamp a day-of-month into a real date in the given month (Feb 31 → Feb 28/29).
function scheduledDate(ym, day) {
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

// Apply all due recurring rules. Returns the number of transactions created.
// Never throws — a rate failure for one rule skips that rule (it will retry on
// the next launch because last_applied wasn't advanced past it).
export async function applyRecurring() {
  let rules;
  try {
    rules = await db.listRecurring();
  } catch (err) {
    // Table may not exist yet on an old Supabase project — fail quietly.
    console.warn('Recurring rules unavailable:', err.message);
    return 0;
  }

  const today = todayISO();
  const thisMonth = today.slice(0, 7);
  let created = 0;

  for (const rule of rules) {
    if (rule.active === false) continue;

    // First month to consider: the month after the last applied one, or the
    // month the rule was created in (so a new rule doesn't backfill history).
    let ym = rule.last_applied
      ? nextMonth(rule.last_applied)
      : (rule.created_at || today).slice(0, 7);

    let lastDone = rule.last_applied;

    // Walk forward month by month, materializing each occurrence whose
    // scheduled date has arrived. Capped at 24 iterations as a safety bound.
    for (let i = 0; ym <= thisMonth && i < 24; i++, ym = nextMonth(ym)) {
      const date = scheduledDate(ym, rule.day_of_month);
      if (date > today) break; // this month's occurrence hasn't arrived yet

      try {
        const { amount_usd, exchange_rate } = await convertToUSD(
          rule.amount, rule.currency, date
        );
        await db.createTransaction({
          type: rule.type,
          date,
          amount: rule.amount,
          currency: rule.currency,
          amount_usd,
          exchange_rate,
          category_id: rule.category_id,
          description: rule.description || '(recurring)',
        });
        lastDone = ym;
        created++;
      } catch (err) {
        // Rate fetch failed — stop here; this month retries on next launch.
        console.warn(`Recurring "${rule.description}" skipped for ${ym}:`, err.message);
        break;
      }
    }

    if (lastDone !== rule.last_applied) {
      try {
        await db.updateRecurring(rule.id, { last_applied: lastDone });
      } catch (err) {
        console.warn('Could not advance recurring rule:', err.message);
      }
    }
  }

  return created;
}
