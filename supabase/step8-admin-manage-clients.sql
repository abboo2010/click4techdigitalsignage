-- Step 8: Let the admin open a client's dashboard and manage it as the client would.
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run more than once. It only ADDS permission for users whose role is 'admin'.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;
grant execute on function public.is_admin() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['screens','ticker_messages','media_items','menu_boards','scenes'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
        t || '_admin_all', t);
    end if;
  end loop;
end $$;

-- Admin may upload / replace / delete files in the media bucket for any client.
drop policy if exists "media_admin_all" on storage.objects;
create policy "media_admin_all"
  on storage.objects for all to authenticated
  using (bucket_id = 'media' and public.is_admin())
  with check (bucket_id = 'media' and public.is_admin());
