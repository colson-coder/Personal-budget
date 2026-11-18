-- =============================================================================
-- schema.sql — Run this in the Supabase SQL editor (Dashboard → SQL Editor).
-- Creates the two tables the app uses. RLS policies live in rls.sql; run that
-- file AFTER this one.
-- =============================================================================

-- Categories: predefined + user-added spending buckets, each with a monthly USD
-- budget.
create table if not exists public.categories (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  name              text not null,
  monthly_budget_usd numeric(12,2) not null default 0,
  rollover          boolean not null default false,  -- envelope carryover
  is_default        boolean not null default false,
  created_at        timestamptz not null default now()
);

-- Upgrade path for databases created before the rollover column existed.
alter table public.categories
  add column if not exists rollover boolean not null default false;

create index if not exists categories_user_idx on public.categories (user_id);

-- Transactions: every row stores the ORIGINAL amount + currency, the USD
-- equivalent, AND the exact exchange_rate used at save time. Old rows are never
-- re-converted when rates later change.
create table if not exists public.transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  type          text not null check (type in ('income', 'expense')),
  date          date not null,
  amount        numeric(14,2) not null,           -- original amount
  currency      text not null,                    -- original currency code
  amount_usd    numeric(14,2) not null,           -- converted USD equivalent
  exchange_rate numeric(18,8) not null,           -- USD per 1 unit of `currency`
  category_id   uuid references public.categories (id) on delete set null,
  description   text default '',
  created_at    timestamptz not null default now()
);

create index if not exists transactions_user_idx on public.transactions (user_id);
create index if not exists transactions_date_idx on public.transactions (user_id, date desc);

-- Recurring rules ("auto-tracking"): every month on day_of_month, the app
-- materializes a real transaction from this template. last_applied records the
-- most recent "YYYY-MM" already materialized so launches never double-insert.
create table if not exists public.recurring (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  type          text not null check (type in ('income', 'expense')),
  amount        numeric(14,2) not null,
  currency      text not null,
  category_id   uuid references public.categories (id) on delete set null,
  description   text default '',
  day_of_month  int not null check (day_of_month between 1 and 31),
  last_applied  text,                              -- "YYYY-MM" or null
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists recurring_user_idx on public.recurring (user_id);

-- =============================================================================
-- Personalization & full-finance features (setup wizard, money plan, funds,
-- debts, passive income). Idempotent: safe to re-run on existing projects.
-- =============================================================================

-- One settings document per user: home currency, timezone, enabled features,
-- money-plan rules. Stored as JSON so new preferences need no migration.
create table if not exists public.settings (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Category kind drives the plan: hard (fixed bill), soft (flexible), debt, income.
alter table public.categories add column if not exists kind text not null default 'soft';

-- Funds: savings pots / envelopes filled by the money plan.
create table if not exists public.funds (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  name              text not null,
  kind              text not null default 'savings',   -- savings | giving | reserve | spending
  starting_balance  numeric(14,2) not null default 0,
  goal_usd          numeric(14,2) not null default 0,  -- in home currency
  apy               numeric(6,3) not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists funds_user_idx on public.funds (user_id);

-- Debts: loans, mortgages, cards. Payments are transactions with debt_id.
create table if not exists public.debts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  principal    numeric(14,2) not null,
  apr          numeric(6,3) not null default 0,
  payment      numeric(14,2) not null default 0,
  start_month  text not null,                          -- "YYYY-MM"
  created_at   timestamptz not null default now()
);
create index if not exists debts_user_idx on public.debts (user_id);

-- Passive income streams: rentals, dividends, interest, royalties, business.
create table if not exists public.income_streams (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  name              text not null,
  kind              text not null default 'other',
  expected_monthly  numeric(14,2) not null default 0,
  start_month       text not null,
  deposit_start     numeric(14,2) not null default 0,  -- rentals only
  created_at        timestamptz not null default now()
);
create index if not exists income_streams_user_idx on public.income_streams (user_id);

-- Transaction links + 'transfer' type (money moved into a fund).
alter table public.transactions add column if not exists fund_id uuid references public.funds (id) on delete set null;
alter table public.transactions add column if not exists debt_id uuid references public.debts (id) on delete set null;
alter table public.transactions add column if not exists stream_id uuid references public.income_streams (id) on delete set null;
alter table public.transactions add column if not exists subtype text;   -- 'deposit' for held rental deposits
alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check (type in ('income', 'expense', 'transfer'));
alter table public.transactions alter column category_id drop not null;

-- Recurring rules can carry the same links (e.g. auto-logged loan payments).
alter table public.recurring add column if not exists fund_id uuid references public.funds (id) on delete set null;
alter table public.recurring add column if not exists debt_id uuid references public.debts (id) on delete set null;
alter table public.recurring add column if not exists stream_id uuid references public.income_streams (id) on delete set null;
