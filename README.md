# Personal Budget

A multi-currency personal finance tracker. It's a static site (vanilla
HTML/CSS/JS, **no build step**) hosted on GitHub Pages, backed by
[Supabase](https://supabase.com) for storage + auth, and installable as a
standalone **PWA** on macOS (Dock) and iPhone (Home Screen) — syncing across
devices.

- **Currencies:** USD, EUR, GBP, CRC (add more in `js/config.js`).
- **Base/reference currency:** USD — all balances and budgets are in USD.
- **Rate provider:** [ExchangeRate-API](https://www.exchangerate-api.com)
  (required because CRC is outside the ECB/Frankfurter set).
- **Timezone:** all month-boundary logic uses `America/Costa_Rica` (UTC-6),
  locked globally so a transaction belongs to the same calendar month on every
  device.

---

## Features

- **Dashboard** — total balance in USD, this month's spend vs. budget per
  category (progress bars), total spend this month, and the 5 most recent
  transactions.
- **Transactions** — full list filterable by date range, category, and
  currency, with inline edit/delete.
- **Add Transaction** — type, amount, currency, category, date, description.
  Converts to USD at the **transaction's own date** and stores the original
  amount, the USD equivalent, and the exact rate used.
- **Categories & Budgets** — editable list with monthly USD budgets.
- **Recurring transactions (auto-tracking)** — set rent, salary, or
  subscriptions once (on the Add page) and the app records them automatically
  every month on their day, catching up any months missed while the app was
  closed.
- **Import** — CSV upload with column mapping and a validated preview: flags
  bad dates / unknown currencies, **auto-categorizes by description keywords**
  (UBER → Transport, NETFLIX → Subscriptions…), maps unknown category names to
  **Other**, detects income vs. expense from signed amounts, and warns on
  likely duplicates (against saved data *and* within the file), then bulk
  inserts.
- **Local mode** — "Skip login" toggle that stores everything in this device's
  browser only (no account, no sync). A persistent banner makes local mode
  unmistakable.

---

## Project structure

```
.
├── index.html                # App shell (loads everything as ES modules)
├── manifest.webmanifest      # PWA manifest (name, icons, standalone display)
├── service-worker.js         # App-shell cache (bump CACHE_VERSION on deploy)
├── css/
│   └── styles.css            # Dark theme, mobile-first responsive layout
├── js/
│   ├── config.js             # Supabase + API keys, currency list, timezone
│   ├── db.js                 # SINGLE data-access layer (Supabase OR localStorage)
│   ├── rates.js              # Exchange-rate fetch + cache + USD conversion
│   ├── router.js             # Tiny hash router
│   ├── util.js               # Date/timezone, money formatting, DOM helpers
│   ├── app.js                # Bootstrap, nav chrome, local-mode banner
│   └── views/                # One module per page
│       ├── auth.js
│       ├── dashboard.js
│       ├── transactions.js
│       ├── add.js
│       ├── categories.js
│       └── import.js
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
   [`sql/rls.sql`](sql/rls.sql) (in that order). Already ran them before the
   `recurring` table existed? Re-run both — they're idempotent
   (`create table if not exists` / `drop policy if exists`).
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
