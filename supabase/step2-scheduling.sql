-- Step 2: Playlist scheduling
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run more than once.

-- 1) Optional schedule fields on every image / video.
--    All empty = the item plays all the time (same as before).
alter table public.media_items
  add column if not exists schedule_days       smallint[],
  add column if not exists schedule_start      time,
  add column if not exists schedule_end        time,
  add column if not exists schedule_start_date date,
  add column if not exists schedule_end_date   date;

-- 2) Allow clients (for their own screens) and admins to EDIT media items.
--    Only created if there is no UPDATE-capable policy on the table yet,
--    so it never clashes with the policies you already have.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'media_items'
       and cmd in ('UPDATE', 'ALL')
  ) then
    create policy "media_items_update_own_org"
      on public.media_items
      for update
      to authenticated
      using (
        exists (
          select 1
            from public.screens s
            join public.profiles p on p.org_id = s.org_id
           where s.id = media_items.screen_id
             and p.id = auth.uid()
        )
        or exists (
          select 1 from public.profiles p
           where p.id = auth.uid() and p.role = 'admin'
        )
      )
      with check (
        exists (
          select 1
            from public.screens s
            join public.profiles p on p.org_id = s.org_id
           where s.id = media_items.screen_id
             and p.id = auth.uid()
        )
        or exists (
          select 1 from public.profiles p
           where p.id = auth.uid() and p.role = 'admin'
        )
      );
  end if;
end $$;
