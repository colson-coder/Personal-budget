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
  is_default        boolean not null default false,
  created_at        timestamptz not null default now()
);

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
