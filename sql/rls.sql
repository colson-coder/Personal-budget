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
