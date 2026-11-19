# Logging purchases automatically: what's possible

Goal: a card purchase shows up as an expense without anyone typing it in.
There are three ways to get there, and they differ a lot in cost and effort.

| Approach | Works today? | Needs a server? | Cost | Coverage |
|---|---|---|---|---|
| **1. Phone automation → quick-add link** | ✅ Built | No | Free | Tap-to-pay on iPhone (Apple Pay); Android via MacroDroid/Tasker |
| **2. Bank file import (CSV/OFX)** | ✅ Built | No | Free | Every bank that offers a download |
| **3. Live bank connection (aggregator)** | ❌ Needs setup | **Yes** | Per user or per connection | Depends on the country |

---

## 1. Phone automation (built)

Apple Wallet and Google Wallet have **no web API**, so a website can't read
them. Both phones do let their *own* automation apps react to a payment, and
that's enough.

- **iPhone, iOS 17 or later:** in the Shortcuts app, the *Wallet* automation
  (called *Transaction* on some iOS versions) runs whenever a Wallet card is
  tapped. Build it **inside the automation** (New Blank Automation), because only
  there does Shortcut Input offer **Merchant** and **Amount**. The actions are:
  1. URL Encode (Shortcut Input → Merchant)
  2. Text, containing:
     ```
     https://colson-coder.github.io/Personal-budget/#/add?auto=1&merchant=[URL Encoded Text]&amount=[Amount]
     ```
  3. Open URLs

  Once `CONFIG.SHORTCUT_URL` holds an iCloud link to a shared shortcut, users
  can tap *Get the shortcut* instead, then pick it in the Wallet automation.
- **Android:** MacroDroid (free) or Tasker reacts to the Google Wallet or bank-app
  notification, pulls the amount and shop name out of its text, and opens the
  same link.

What the app does with the link (`js/views/add.js`):
- **Amount:** reads any format: `$4.50`, `€4,50`, `₡2.500`, `1.234,56 €`.
- **Currency:** taken from the symbol or code in the amount (€ → EUR, ₡ → CRC,
  "USD"), or from an explicit `&currency=`. A bare `$` means the home currency
  when that's a dollar or peso, and USD otherwise. With no symbol at all, it
  uses the home currency.
- **Category:** chosen from what the user picked for that merchant before, then
  from rules learned during import, then from keyword guesses (Uber → Transport,
  Starbucks → Food…). If none of those match, it falls back to Other.
- **`auto=1`:** saves straight away. Without it, the form opens filled in and
  the user taps Save.
- **Setup:** in-app at **Settings → Log card purchases automatically**, with
  step-by-step instructions and a copyable link.

Limits:
- It only catches *tap-to-pay* purchases. Online purchases, bank transfers and
  physical card swipes aren't seen; bank import covers those.
- On iPhone the link opens in **Safari**, which keeps separate storage from the
  home-screen app. Users need a synced account, signed in once in Safari. The
  settings card warns local-mode users about this.

## 2. Bank file import (built)

CSV/TSV/OFX/QFX in almost any layout, with remembered column mappings,
duplicate detection and learned categories. This covers everything the phone
automation misses, at the cost of a monthly download.

## 3. Live bank connection (future: needs accounts and a server)

Every aggregator requires a **secret key that can never be in a browser**. So
this requires a small server function, which fits Supabase Edge Functions. It
also requires a business account with the provider, and usually a compliance
review before going live.

| Provider | Regions | Pricing (check current) | Notes |
|---|---|---|---|
| **SimpleFIN Bridge** | US/CA | User pays the provider directly (about $15 a year) | The simplest option. The user pastes a setup token, and our function exchanges it for read-only access. No business review. |
| **Teller** | US | Free developer tier, paid in production | Clean API, but US banks only. |
| **Plaid** | US, CA, UK, EU | Per connected account per month | Widest coverage and the industry standard, with an application and review. |
| **GoCardless Bank Account Data / Enable Banking / TrueLayer** | UK & EU (open banking) | Varies | Uses PSD2 bank consents, which must be renewed every 90–180 days. |
| **Latin America (e.g. Belvo)** | MX, BR, CO | Business contract | **Costa Rica is not covered** by the major aggregators. There, email or SMS alert parsing is the realistic path. |

### A server design for when it's time

1. `bank-link` Edge Function: creates the provider's link session and stores
   the access token **server-side** in a table that only the function can read
   (RLS denies all client access).
2. `bank-sync` Edge Function, run on a schedule (Supabase cron): pulls new
   transactions and inserts them into `transactions` with the same
   duplicate-signature check the importer uses. Merchant-to-category rules
   come from `settings.import_rules`.
3. The client shows linked accounts and a "last synced" time, and never sees a
   token.

### Why it isn't built yet

- It needs the owner's provider account and keys, so it can't be done
  unattended.
- Per-connection fees mean it belongs in a **paid tier**. It's the most common
  reason people pay for a budgeting app.
- Phone automation plus file import already covers most purchases for free.

**Recommendation:** launch with options 1 and 2. Add **SimpleFIN** as the first
live connection for US users, since it has the cheapest and fastest approval.
Then add **Plaid** when a paid tier exists.
