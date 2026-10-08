-- Step 1: Offline alerts (heartbeat)
-- Run this once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run more than once.

-- 1) Remember when each screen last checked in.
alter table public.screens
  add column if not exists last_seen_at timestamptz;

-- 2) A tiny function the public player calls every minute.
--    It can ONLY update last_seen_at for the screen slug it is given,
--    so we do not have to open up write access on the screens table.
create or replace function public.screen_heartbeat(p_slug text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.screens
     set last_seen_at = now()
   where slug = p_slug;
$$;

revoke all on function public.screen_heartbeat(text) from public;
grant execute on function public.screen_heartbeat(text) to anon, authenticated;
