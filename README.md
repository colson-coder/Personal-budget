# Babylon's Purse

> *"A part of all you earn is yours to keep."* — the first rule from *The Richest Man in Babylon*, and what the money plan automates.

A complete personal finance tracker that **adapts to whoever uses it**. A short
setup asks a few plain questions — home currency, timezone, what you want to
track, how you split your money — and the app builds itself around the
answers. Everything stays editable in Settings.

It's a static site (vanilla HTML/CSS/JS, **no build step**) hosted on GitHub
Pages, backed by [Supabase](https://supabase.com) for accounts and sync, and
installable as a standalone **PWA** on Mac, iPhone, Android and Windows.

- **Any home currency** — totals, budgets and reports use the currency each
  user picks; transactions can be in any other currency and are converted at
  the rate for their own date ([ExchangeRate-API](https://www.exchangerate-api.com),
  with approximate built-in rates until a key is added).
- **Their own calendar** — month boundaries follow the timezone chosen in setup
  (defaults to the device's), so a transaction lands in the same month on
  every device.
- **Only what they use** — features are switched on per user; hidden features
  keep their data.
- Rebrand by changing `APP_NAME` in `js/config.js` (plus `manifest.webmanifest`).

---

## Features

- **Setup wizard** — first launch asks for name, home currency (guessed from
  the device region), other currencies, timezone, which features to enable,
  and a money plan; then creates the user's funds, rules, first debt and first
  income stream. Can be re-run from Settings.
- **Money plan** — rules that split each month's net income
  (income − fixed bills − debt payments − flexible spending) into funds:
  *% of net income* (e.g. 10% giving), *fixed amounts* (e.g. a business
  reserve), and *% of what's left* with a different % once a fund's goal is
  reached (e.g. 25% to the emergency fund until it hits its goal). The Plan
  page shows cash flow, where every dollar goes, and a month-by-month table.
- **Try a demo** — sample data generated relative to today, from the sign-in
  screen or `index.html?demo=1`. Existing device-only data is backed up and
  restored afterwards.
- **Goal dates** — a fund's "reach it by" month gives a per-month target and
  on-track or behind status (`finance.goalPace`).
- **Funds** — emergency fund, giving, reserves, spending money: balances grow
  from the plan and deposits, shrink when you spend from them. Each fund says
  where the money is kept: in an account that pays interest (estimated from
  APY, or the actual interest you enter) or as cash, which earns nothing.
  Interest earned is tracked per fund and counts as taxable income.
- **Debts** — loans, mortgages, cards: built on the minimum monthly payment
  (entered, or worked out from the loan length), assumed paid every month on
  its due day. Log what you actually paid and that month's figure replaces the
  minimum, so extra payments move the payoff date. Shows % paid off, interest
  paid, extra paid, payoff date, a warning when the minimum doesn't cover the
  interest, and a "what if I paid extra?" slider.
- **Passive income** — dividends, interest, side business, rental income,
  royalties: received this month / last 12 months / average, and behind or
  ahead of an expected amount.
- **Taxes** — works for any country: one rate or your own brackets, a
  tax-free allowance, and a tax year starting in any month. Income categories
  say whether tax is already taken out, owed, or not taxable; expense
  categories can be deductible. Shows estimated tax so far, paid, still to
  pay, a full-year projection from your pace, how much to set aside monthly,
  and quarter-by-quarter status. A "% of all income" plan rule can fill a Tax
  reserve fund automatically. Estimates only — not tax advice.
- **Home (master board)** — this month's *left to assign*, income, spent and
  set aside, with quick actions: add income (e.g. a side hustle), add an
  expense, and assign money into any fund. Below, one simple tile per area —
  budgets, funds, debts, taxes, passive income, coming up, recent activity.
- **Coach** — tips worked out from the user's own numbers, on the device and
  free. It gives one "next step" at a time, in the order classic money books
  agree on: spend less than you earn, keep a tenth (*The Richest Man in
  Babylon*), save a starter cushion, pay off expensive debt, save a full
  cushion, then put money to work. It also raises alerts for overspending,
  budgets, spikes, taxes and debts that never shrink. An optional AI chat
  ("Ask the coach") is built but switched off until its server function is
  deployed; see [docs/ai-coach.md](docs/ai-coach.md).
- **Automatic card logging** — phone automations (an iOS Shortcuts Wallet
  trigger, Android MacroDroid/Tasker) open a quick-add link
  (`#/add?amount=&merchant=&auto=1`) on every tap-to-pay purchase. The
  currency comes from the amount's symbol and the category is learned per
  shop. See [docs/auto-logging.md](docs/auto-logging.md).
- **Transactions** — full list filterable by date range, category, and
  currency, with inline edit/delete.
- **Add Transaction** — type, amount, currency, category, date, description.
  Converts to the home currency at the **transaction's own date** and stores
  the original amount, the converted amount, and the exact rate used.
  "More options" links it to a fund, a debt or an income stream.
- **Categories & Budgets** — editable list with monthly budgets; each category
  has a kind (fixed bill, flexible, debt payment, income) that drives the plan.
- **Recurring transactions (auto-tracking)** — set rent, salary, or
  subscriptions once (on the Add page) and the app records them automatically
  every month on their day, catching up any months missed while the app was
  closed. The dashboard shows what's still **upcoming this month** with a
  projected month-end balance.
- **Reports** — "Month in review" digest (spend vs last month, savings rate,
  largest expense, biggest category movers), a 12-month income-vs-expense
  chart, and top categories over the last year. All computed client-side,
  rendered as dependency-free inline SVG.
- **Budget rollover (envelopes)** — per-category toggle: unspent budget
  carries into next month, overspending eats into it (YNAB/Actual-style).
- **Smart fast entry** — description autocomplete from your history that
  prefills the category and currency you used last time; remembers your
  last-used currency.
- **Search** — free-text description search plus exact-amount lookup on the
  transactions page.
- **Your data, always** — one-tap JSON backup and CSV export (re-importable);
  local-mode restores from JSON backups; "Delete all my data" with typed
  confirmation.
- **Import** — bank files in CSV/TSV/OFX/QFX, in any column layout and
  number format (`1,234.56`, `1.234,56`, separate debit/credit columns,
  headers in several languages). Column mappings are remembered per bank.
  Categories come from learned shop rules, then keywords. Likely duplicates
  start unticked.
- **Local mode** — "Skip login" toggle that stores everything in this device's
  browser only (no account, no sync). A persistent banner makes local mode
  unmistakable.

---

## Project structure

```
.
├── index.html                # App shell (loads everything as ES modules)
├── welcome.html              # Marketing landing page (linked from sign-in)
├── privacy.html              # Plain-language privacy page
├── manifest.webmanifest      # PWA manifest (name, icons, standalone display)
├── service-worker.js         # App-shell cache (bump CACHE_VERSION on deploy)
├── css/
│   └── styles.css            # Dark theme, mobile-first responsive layout
├── js/
│   ├── config.js             # App name, Supabase + API keys, defaults
│   ├── db.js                 # SINGLE data-access layer (Supabase OR localStorage)
│   ├── store.js              # Per-user settings + one-call data loading
│   ├── finance.js            # Pure calculation engine (plan, funds, debts, income)
│   ├── rates.js              # Exchange rates → home currency, cached
│   ├── recurring.js          # Auto-applies recurring transactions on launch
│   ├── nav.js / icons.js     # Adaptive navigation + SVG icon set
│   ├── router.js             # Tiny hash router
│   ├── util.js               # Dates, money formatting, DOM + sheet helpers
│   ├── app.js                # Bootstrap: auth → setup wizard → app shell
│   └── views/                # One module per page
│       ├── setup.js  settings.js  auth.js
│       ├── dashboard.js  transactions.js  add.js  reports.js
│       ├── plan.js  funds.js  debts.js  income.js  taxes.js
│       └── categories.js  import.js  more.js
├── tests/                    # node tests/<name>.test.mjs — finance (20), importer (8), insights (14)
├── supabase/functions/coach/ # Optional AI coach Edge Function (off by default)
├── icons/                    # PWA icons (192, 512, 180 apple-touch)
└── sql/
    ├── schema.sql            # Tables
    └── rls.sql               # Row-Level Security policies (the real boundary)
```

All data access flows through `js/db.js`. No page touches Supabase or
localStorage directly — that's what lets local mode and synced mode share the
exact same UI code.

---

## Setup

### 1. Create a Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a new project.
2. In **SQL Editor**, run [`sql/schema.sql`](sql/schema.sql), then
   [`sql/rls.sql`](sql/rls.sql) (in that order). Ran them before? Re-run
   both after updating — they're idempotent and add any new tables/columns.
3. In **Project Settings → API**, copy your **Project URL** and **anon public
   key**.

### 2. Configure auth redirect URLs

In **Authentication → URL Configuration**, set:

- **Site URL:** your GitHub Pages URL,
  e.g. `https://colson-coder.github.io/Personal-budget/`
- **Redirect URLs:** add the same URL (this is where email-confirmation links
  return).

### 3. Get an ExchangeRate-API key

Sign up at [exchangerate-api.com](https://www.exchangerate-api.com) (free tier:
1,500 requests/month) and copy your key.

### 4. Fill in `js/config.js`

```js
SUPABASE_URL: 'https://YOUR-PROJECT-ref.supabase.co',
SUPABASE_ANON_KEY: 'YOUR-SUPABASE-ANON-KEY',
EXCHANGE_RATE_API_KEY: 'YOUR-EXCHANGERATE-API-KEY',
```

Commit these values — see the security note below on why that's safe.

### 5. Deploy to GitHub Pages

In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a
branch**, pick your branch and the root (`/`). Your app will be live at the
Pages URL.

> **Never open `index.html` via `file://`.** The manifest, service worker,
> Supabase auth, and `fetch` all require a real HTTPS origin. Use the GitHub
> Pages URL, or run a local server for development:
>
> ```bash
> python3 -m http.server 8000   # then visit http://localhost:8000
> ```

---

## Install as an app (PWA)

The files live on GitHub Pages, but each device installs and runs the app
locally in its own window — no browser chrome.

- **macOS (Safari 17+):** open the Pages URL → **File → Add to Dock**.
- **iPhone (Safari):** open the Pages URL → **Share** → **Add to Home Screen**.

After installing, bump `CACHE_VERSION` in `service-worker.js` whenever you
deploy changes, so devices don't stay stuck on a cached old shell.

---

## Why is the anon key safe to commit? (Security model)

**Short version: the anon key is public by design, and RLS — not key secrecy —
is the security boundary.**

This is a static client-side app, so any key it uses ships to the browser and
can be read by anyone. The Supabase **anon key** is intended for exactly this.
It does not grant access on its own; it only lets a client *attempt* requests.
What those requests are allowed to do is decided entirely by **Row-Level
Security** policies in the database.

Every table here has RLS **enabled** with policies that restrict every
read/write to rows where `user_id = auth.uid()` (see
[`sql/rls.sql`](sql/rls.sql)). So:

- An unauthenticated request has `auth.uid() = null` and matches **no** rows.
- A signed-in user can only ever touch **their own** rows — never anyone
  else's, even though everyone shares the same public anon key.

There is **no `.env` secret to protect** in this project. (The ExchangeRate-API
key is likewise visible; the worst case for a leaked free-tier rate key is
someone burning your monthly request quota — acceptable for a personal app, and
revocable/rotatable at any time.)

---

## How exchange-rate conversion works

- On save, the app fetches the rate for the **transaction's own date** (not
  today's), so backdated and imported rows convert at a period-appropriate rate.
- It stores the **original amount + currency**, the **USD equivalent**, and the
  **exact rate used** (`exchange_rate`). Old transactions are **never**
  re-converted when rates later change.
- Rates are cached per `(date, currency)` pair in `localStorage` to avoid
  redundant API calls.
- If no valid rate can be obtained, the save is **blocked** with a clear error
  rather than storing a zero/garbage conversion.

> Note: ExchangeRate-API's historical endpoint requires a paid plan. On the free
> tier, `rates.js` transparently falls back to the latest rate for past dates.
> The exact rate used is always recorded on the row, so reported history stays
> stable regardless.

---

## License

[MIT](LICENSE).
