-- Step 6: Scenes (several screen layouts per screen, each with its own content)
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run more than once. Your existing content moves into a first scene called "Main".

-- 1) More layouts are allowed (the original four stay).
alter table public.screens drop constraint if exists screens_layout_check;
alter table public.screens add constraint screens_layout_check
  check (layout in ('full','right','left','bottom','top','split','wideright','wideleft'));

-- 2) Scenes
create table if not exists public.scenes (
  id               uuid primary key default gen_random_uuid(),
  screen_id        uuid not null references public.screens(id) on delete cascade,
  name             text not null default 'Scene',
  layout           text not null default 'full'
                   check (layout in ('full','right','left','bottom','top','split','wideright','wideleft')),
  show_ticker      boolean not null default true,
  duration_seconds integer,          -- null = move on after the scene's content has played once
  sort_order       bigint not null default 0,
  created_at       timestamptz not null default now()
);

alter table public.scenes enable row level security;

drop policy if exists "scenes_public_read" on public.scenes;
create policy "scenes_public_read"
  on public.scenes for select
  to anon, authenticated
  using (true);

drop policy if exists "scenes_manage_own_org" on public.scenes;
create policy "scenes_manage_own_org"
  on public.scenes for all
  to authenticated
  using (
    exists (
      select 1 from public.screens s
        join public.profiles p on p.org_id = s.org_id
       where s.id = scenes.screen_id and p.id = auth.uid()
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (
      select 1 from public.screens s
        join public.profiles p on p.org_id = s.org_id
       where s.id = scenes.screen_id and p.id = auth.uid()
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

grant select on public.scenes to anon;
grant select, insert, update, delete on public.scenes to authenticated;

-- 3) Content belongs to a scene
alter table public.media_items add column if not exists scene_id uuid references public.scenes(id) on delete set null;
alter table public.menu_boards add column if not exists scene_id uuid references public.scenes(id) on delete set null;

-- 4) Give every existing screen a first scene and move its content into it
insert into public.scenes (screen_id, name, layout, sort_order)
select s.id, 'Main', s.layout, 0
  from public.screens s
 where not exists (select 1 from public.scenes c where c.screen_id = s.id);

update public.media_items m
   set scene_id = (select c.id from public.scenes c where c.screen_id = m.screen_id order by c.sort_order, c.created_at limit 1)
 where m.scene_id is null;

update public.menu_boards b
   set scene_id = (select c.id from public.scenes c where c.screen_id = b.screen_id order by c.sort_order, c.created_at limit 1)
 where b.scene_id is null;
