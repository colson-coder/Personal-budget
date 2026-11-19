# The coach: free tips plus an optional AI chat

## 1. Free coach (live now, no setup)

The **Coach** card on Home is plain rules over the user's own numbers
(`js/insights.js`). It runs on the device and costs nothing. It shows **one
next step** from a ladder that the classic money books agree on, plus specific
alerts.

| Step | Shown when | Principle |
|---|---|---|
| 1. Spend less than you earn | Spending exceeded income over recent months | *The Richest Man in Babylon*: control your spending |
| 2. Keep a tenth | Saving less than 10% (with debts: Arkad's 70/10/20 plan) | Babylon, the first cure |
| 3. Starter cushion | Emergency fund holds less than 1 month of bills and debt payments | Babylon: guard your money from loss |
| 4. Expensive debt first | Any debt at 8% APR or more; the highest rate comes first | The avalanche method |
| 5. Full cushion | Under 3 months of essentials | *The Psychology of Money*: room for error |
| 6. Put money to work | No investing or retirement fund and no passive income | Babylon: make your money multiply |
| ✓ Foundations in place | All of the above are done | Babylon: increase your ability to earn |

These alerts can appear alongside the ladder step:
- overspent this month
- a debt whose minimum doesn't cover its interest
- budgets over or on pace to go over (flexible spending only)
- a category spiking above its usual level
- fixed bills above 60% of income
- tax not set aside
- unassigned money
- no "pay yourself first" plan rule yet

Covered by 13 tests in `tests/insights.test.mjs`.

## 2. AI chat: "Ask the coach" (built, switched off)

A chat sheet where people ask questions in their own words. Answers are grounded
in a **totals-only snapshot** of their money: typical month, funds, debts, plan
rules, budgets and taxes. The snapshot never includes individual transaction
descriptions. The instructions follow the same principles as the free coach and
forbid recommending specific products.

**Pieces:**
- `supabase/functions/coach/index.ts`: a server function that holds the API key.
  It checks the user is signed in, enforces a daily limit, and calls Claude
  (`claude-opus-5-5`, low effort, prompt caching, automatic fallback if a request
  is declined).
- `sql/coach.sql`: the per-user daily message counter.
- `js/views/coachchat.js`: the chat sheet. `financeSnapshot()` in `js/insights.js`
  builds the summary.
- `CONFIG.AI_COACH` in `js/config.js`: `false` until deployed. The button only
  shows for signed-in users (not local mode).

**To switch it on (about 10 minutes, owner only):**
1. Create an API key at console.anthropic.com and add billing.
2. Install the Supabase CLI. Then run `supabase login` and
   `supabase link --project-ref gayrswwxsdgqasnipvzs`.
3. `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`
   (optional: `COACH_DAILY_LIMIT=20`,
   `ALLOWED_ORIGIN=https://colson-coder.github.io`)
4. `supabase functions deploy coach`
5. Run `sql/coach.sql` in the Supabase SQL editor.
6. Set `AI_COACH: true` in `js/config.js` and push.

**Cost (rough):** each question is about 1.5K input and 0.5K output tokens, so
**about $0.015** on Opus 5.5 ($4 / $20 per million tokens). Caching the system
prompt cuts this a little. A user hitting the 20-a-day limit every day would
cost about $9 a month, so the AI chat is a natural **premium feature**, while
the free rule-based coach stays free. A cheaper model (Haiku 5.5, about 40×
less) is a one-line change in the function if cost matters more than answer
quality.

**On "training it on finance books":** fine-tuning isn't needed and wouldn't be
the right tool. The model already knows these books well. What makes the
answers good is the **principles written into the instructions** plus the
**user's own numbers**, and both are already in place. Quoting long passages
from copyrighted books isn't something to build in.
