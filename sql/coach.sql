-- =============================================================================
-- coach.sql: optional, only needed for the AI coach (supabase/functions/coach).
-- A per-user daily message counter. Safe to re-run.
-- Clients can't read or write it (RLS on, no policies). Only the Edge Function
-- uses it, through the service role.
-- =============================================================================

create table if not exists public.coach_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);
alter table public.coach_usage enable row level security;

-- Atomically take one message from today's allowance. Returns false when the
-- user is at the limit.
create or replace function public.coach_take_message(p_user uuid, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  insert into public.coach_usage (user_id, day, count) values (p_user, current_date, 1)
  on conflict (user_id, day) do update set count = public.coach_usage.count + 1
  returning count into n;
  if n > p_limit then
    update public.coach_usage set count = count - 1 where user_id = p_user and day = current_date;
    return false;
  end if;
  return true;
end $$;

revoke all on function public.coach_take_message(uuid, int) from public, anon, authenticated;
