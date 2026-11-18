-- =============================================================================
-- rls.sql — Row-Level Security. THIS is the real security boundary for the app,
-- not the anon key (which is public by design). Run this AFTER schema.sql.
--
-- With RLS enabled and these policies in place, the public anon key can only
-- ever read or modify rows whose user_id matches the currently authenticated
-- user (auth.uid()). A signed-in user cannot see anyone else's data, and an
-- unauthenticated request (auth.uid() is null) matches no rows at all.
-- =============================================================================

-- Enable RLS. Once enabled, the default is DENY — only rows matching a policy
-- are accessible.
alter table public.categories   enable row level security;
alter table public.transactions enable row level security;

-- --- categories --------------------------------------------------------------
drop policy if exists "categories_select_own" on public.categories;
create policy "categories_select_own" on public.categories
  for select using (auth.uid() = user_id);

drop policy if exists "categories_insert_own" on public.categories;
create policy "categories_insert_own" on public.categories
  for insert with check (auth.uid() = user_id);

drop policy if exists "categories_update_own" on public.categories;
create policy "categories_update_own" on public.categories
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "categories_delete_own" on public.categories;
create policy "categories_delete_own" on public.categories
  for delete using (auth.uid() = user_id);

-- --- transactions ------------------------------------------------------------
drop policy if exists "transactions_select_own" on public.transactions;
create policy "transactions_select_own" on public.transactions
  for select using (auth.uid() = user_id);

drop policy if exists "transactions_insert_own" on public.transactions;
create policy "transactions_insert_own" on public.transactions
  for insert with check (auth.uid() = user_id);

drop policy if exists "transactions_update_own" on public.transactions;
create policy "transactions_update_own" on public.transactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "transactions_delete_own" on public.transactions;
create policy "transactions_delete_own" on public.transactions
  for delete using (auth.uid() = user_id);

-- --- recurring ---------------------------------------------------------------
alter table public.recurring enable row level security;

drop policy if exists "recurring_select_own" on public.recurring;
create policy "recurring_select_own" on public.recurring
  for select using (auth.uid() = user_id);

drop policy if exists "recurring_insert_own" on public.recurring;
create policy "recurring_insert_own" on public.recurring
  for insert with check (auth.uid() = user_id);

drop policy if exists "recurring_update_own" on public.recurring;
create policy "recurring_update_own" on public.recurring
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "recurring_delete_own" on public.recurring;
create policy "recurring_delete_own" on public.recurring
  for delete using (auth.uid() = user_id);

-- --- settings, funds, debts, income_streams ------------------------------------
-- Same rule everywhere: a user can only ever see and change their own rows.
alter table public.settings       enable row level security;
alter table public.funds          enable row level security;
alter table public.debts          enable row level security;
alter table public.income_streams enable row level security;

do $$
declare t text;
begin
  foreach t in array array['settings', 'funds', 'debts', 'income_streams'] loop
    execute format('drop policy if exists "%1$s_select_own" on public.%1$s', t);
    execute format('create policy "%1$s_select_own" on public.%1$s for select using (auth.uid() = user_id)', t);
    execute format('drop policy if exists "%1$s_insert_own" on public.%1$s', t);
    execute format('create policy "%1$s_insert_own" on public.%1$s for insert with check (auth.uid() = user_id)', t);
    execute format('drop policy if exists "%1$s_update_own" on public.%1$s', t);
    execute format('create policy "%1$s_update_own" on public.%1$s for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('drop policy if exists "%1$s_delete_own" on public.%1$s', t);
    execute format('create policy "%1$s_delete_own" on public.%1$s for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;
