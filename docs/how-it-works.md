# How Babylon's Purse works

A plain-language guide to every part of the app.

## The big idea
You tell the app what money comes in and goes out. It shows where you stand,
splits what's left into goals automatically, tracks your debts and taxes, and
works in any currency.

## Pages

**Home** — Your master board. The big number is **Left to assign**: money
that came in this month that doesn't have a job yet (after spending and your
plan rules). Three buttons:
- **＋ Income** — add money in seconds, like a side hustle. It's tagged as side
  income (so the Taxes page counts it) and then offers to assign it.
- **＋ Expense** — opens the full Add form.
- **Assign money** — move any amount into a fund you choose (quick 25% / 50%
  / All buttons).
Under the big number is the **Coach**: tips worked out from your own numbers.
It shows one **next step** at a time, in the order the classic money books
agree on:
1. Spend less than you earn.
2. Keep a tenth of what you earn.
3. Save one month of bills.
4. Pay off expensive debt, highest rate first.
5. Save 3 months of bills.
6. Put your money to work.

It also flags anything urgent, like going over budget or tax that hasn't been
set aside. Tap a tip to go to the page that fixes it.

Below, one tile per area — Budgets, Funds, Debts, Taxes, Passive income,
Coming up, Recent activity — each opens its full page. Use ‹ › for past months.

**Activity** — Every transaction. Search by description or amount, filter by
date, category or currency, and tap ✎ to fix a mistake.

**Add** — Log money in or out: amount, currency, category, date, note. If you
pay in another currency it's converted to your home currency at that day's
rate. Start typing a description you've used before and it fills in the rest.
"More options" lets you say it was paid from a fund, toward a debt, or came
from a passive income stream.
*Recurring* (bottom of the page): set rent, salary or subscriptions once and
they're added automatically every month.

**Budgets** — A monthly limit per category. The top shows *Budgeted · Spent ·
Left*. Categories are grouped into Bills, Everyday spending, Debt payments,
Taxes and Income; only the ones you're using are shown, the rest sit under
"Other categories". Tap any row to change its budget. In "More options":
- *Type* — whether it's a bill, everyday spending, a debt payment, a tax
  payment, or income (this sorts it on your Plan).
- *Roll unused budget into next month* — save up unspent money (e.g. a
  $100/month clothing budget you didn't use grows to $200 next month).
- *Tax settings* — whether income is already taxed, or an expense is
  tax-deductible.

**Plan** — Your "pay yourself first" rules. Each month:
*income − bills − debt payments − everyday spending − taxes = net income*,
then your rules split it up, in this order:
1. **% of all income** (e.g. 25% to a Tax reserve)
2. **% of net income** (e.g. 10% to Giving)
3. **Fixed amounts** (e.g. $200 fun money)
4. **% of what's left** (e.g. 25% to the Emergency Fund until it reaches its
   goal, then 10%)

Whatever isn't assigned stays in your everyday balance. Change the rules in
Settings → Money plan.

**Funds** — Pots of money for a purpose: emergency fund, giving, tax reserve,
vacation. They fill up from your plan, and you can add money or spend from
them anytime. Each fund says where the money is kept:
- *Account that pays interest — estimate it* (enter the APY)
- *Account that pays interest — I'll enter what I get*
- *Cash / checking* — earns nothing
Spending from a fund doesn't count against your monthly plan, because that
money was already set aside.

**Debts** — Mortgages, car loans, student loans, cards. Enter the balance,
interest rate and minimum payment (or the loan length and we work it out).
Each month the minimum is assumed paid on its due day; log a payment when
you pay a different amount and the payoff date updates. The "What if I paid
extra?" slider shows how much time and interest extra payments save.

**Passive income** — Dividends, interest, a side business, rental income,
royalties. See what each brings in this month, over 12 months, on average,
and whether it's behind what you expected.

**Taxes** — An estimate of tax on income that wasn't taxed before you got it
(side jobs, interest, dividends). Set your rate or brackets, tax-free
allowance and when your tax year starts. You'll see estimated tax, what
you've paid, what's left, a full-year projection, how much to set aside each
month, and quarter-by-quarter status. *Estimates only — not tax advice.*

**Reports** — Month in review (spending vs last month, savings rate, biggest
expense, biggest changes), a 12-month income vs spending chart, and your top
categories.

**Import** — Upload the CSV or OFX/QFX file your bank gives you, in almost any
layout or language. It remembers how you matched each bank's columns. It
guesses categories (UBER → Transport) and learns from your changes. Possible
duplicates start unticked.

**Log card purchases automatically** (Settings) — set up once on your phone, so
every tap-to-pay purchase is logged on its own. On iPhone, use a Shortcuts
"Transaction" automation. On Android, use MacroDroid or Tasker. The phone opens
a quick-add link with the amount and shop, and the app works out the currency
and category. See [auto-logging.md](auto-logging.md).

**Settings** — Appearance (4 themes), your name, home currency, timezone,
currencies, which features to show, your money plan, automatic purchase
logging, backup/export, and "Run setup again".

## Accounts & your data
- **With an account**, your data syncs across your phone and computer.
  Each person can only ever see their own data.
- **Local mode** (no account) keeps everything on that one device only.
- **Backup** anytime in Settings → Your data (JSON backup or CSV export).
