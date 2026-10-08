-- Step 3: Menu boards
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run more than once.

create table if not exists public.menu_boards (
  id               uuid primary key default gen_random_uuid(),
  screen_id        uuid not null references public.screens(id) on delete cascade,
  title            text not null default 'Menu',
  template         text not null default 'dark' check (template in ('dark', 'light', 'bold')),
  accent           text not null default '#8b1e1e',
  currency         text not null default 'RM',
  categories       jsonb not null default '[]'::jsonb,
  duration_seconds integer not null default 12,
  sort_order       bigint not null default 0,
  -- same optional schedule fields as images / videos
  schedule_days       smallint[],
  schedule_start      time,
  schedule_end        time,
  schedule_start_date date,
  schedule_end_date   date,
  created_at       timestamptz not null default now()
);

alter table public.menu_boards enable row level security;

-- The public player (not logged in) must be able to read menus.
drop policy if exists "menu_boards_public_read" on public.menu_boards;
create policy "menu_boards_public_read"
  on public.menu_boards for select
  to anon, authenticated
  using (true);

-- Clients manage menus for their own screens; admins manage all.
drop policy if exists "menu_boards_manage_own_org" on public.menu_boards;
create policy "menu_boards_manage_own_org"
  on public.menu_boards for all
  to authenticated
  using (
    exists (
      select 1 from public.screens s
        join public.profiles p on p.org_id = s.org_id
       where s.id = menu_boards.screen_id and p.id = auth.uid()
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (
      select 1 from public.screens s
        join public.profiles p on p.org_id = s.org_id
       where s.id = menu_boards.screen_id and p.id = auth.uid()
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

grant select on public.menu_boards to anon;
grant select, insert, update, delete on public.menu_boards to authenticated;
