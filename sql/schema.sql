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
