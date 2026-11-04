-- Step 12: Patient queue boards (clinics and hospitals)
-- Run once in Supabase -> SQL Editor -> New query -> Run. Safe to run more than once.
--
-- A queue board has one or more rooms (for example "Room 1 - Dr. Lim"). Each room shows
-- who is being served now, who is next, and who is waiting.
--
--   queue_boards   the board's settings (title, look, chime). Public read: it holds no patient data.
--   queue_rooms    the rooms and who is being served now.   Staff only.
--   queue_waiting  the patients waiting, one row each.      Staff only.
--
-- Patient names are NOT readable directly by the public. The TV reads one board at a time
-- through queue_snapshot(), and the staff page uses queue_call_next() / queue_recall() / queue_clear().

-- ---------- tables ----------

create table if not exists public.queue_boards (
  id               uuid primary key default gen_random_uuid(),
  screen_id        uuid not null references public.screens(id) on delete cascade,
  scene_id         uuid references public.scenes(id) on delete set null,
  title            text not null default 'Patient Queue',
  template         text not null default 'light' check (template in ('dark', 'light', 'bold')),
  accent           text not null default '#0e6e6e',
  chime            boolean not null default true,
  duration_seconds integer not null default 20,
  sort_order       bigint not null default 0,
  created_at       timestamptz not null default now()
);

create table if not exists public.queue_rooms (
  id            uuid primary key default gen_random_uuid(),
  board_id      uuid not null references public.queue_boards(id) on delete cascade,
  name          text not null default 'Room 1',
  doctor        text not null default '',
  current_label text not null default '',
  called_at     timestamptz,
  sort_order    bigint not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists public.queue_waiting (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.queue_rooms(id) on delete cascade,
  label      text not null,
  created_at timestamptz not null default now()
);

create index if not exists queue_rooms_board_idx   on public.queue_rooms (board_id);
create index if not exists queue_waiting_room_idx  on public.queue_waiting (room_id, created_at);

-- ---------- who may manage a queue ----------

create or replace function public.queue_can_manage(p_board uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
      or exists (
        select 1 from public.queue_boards b
          join public.screens  s on s.id = b.screen_id
          join public.profiles p on p.org_id = s.org_id
         where b.id = p_board and p.id = auth.uid()
      );
$$;

create or replace function public.queue_room_can_manage(p_room uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.queue_can_manage(r.board_id) from public.queue_rooms r where r.id = p_room), false);
$$;

-- ---------- row level security ----------

alter table public.queue_boards  enable row level security;
alter table public.queue_rooms   enable row level security;
alter table public.queue_waiting enable row level security;

-- Board settings: anyone (the TV) may read; staff of the screen's organization may change.
drop policy if exists "queue_boards_public_read" on public.queue_boards;
create policy "queue_boards_public_read"
  on public.queue_boards for select to anon, authenticated using (true);

drop policy if exists "queue_boards_manage" on public.queue_boards;
create policy "queue_boards_manage"
  on public.queue_boards for all to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or exists (
      select 1 from public.screens s join public.profiles p on p.org_id = s.org_id
       where s.id = queue_boards.screen_id and p.id = auth.uid()
    )
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or exists (
      select 1 from public.screens s join public.profiles p on p.org_id = s.org_id
       where s.id = queue_boards.screen_id and p.id = auth.uid()
    )
  );

-- Rooms and waiting patients: staff only. There is deliberately no public (anon) policy.
drop policy if exists "queue_rooms_manage" on public.queue_rooms;
create policy "queue_rooms_manage"
  on public.queue_rooms for all to authenticated
  using (public.queue_can_manage(board_id))
  with check (public.queue_can_manage(board_id));

drop policy if exists "queue_waiting_manage" on public.queue_waiting;
create policy "queue_waiting_manage"
  on public.queue_waiting for all to authenticated
  using (public.queue_room_can_manage(room_id))
  with check (public.queue_room_can_manage(room_id));

grant select on public.queue_boards to anon;
grant select, insert, update, delete on public.queue_boards  to authenticated;
grant select, insert, update, delete on public.queue_rooms   to authenticated;
grant select, insert, update, delete on public.queue_waiting to authenticated;

-- ---------- what the TV reads ----------
-- One board at a time: its rooms, who is being served, and who is waiting (oldest first).

create or replace function public.queue_snapshot(p_board uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',        r.id,
           'name',      r.name,
           'doctor',    r.doctor,
           'current',   r.current_label,
           'called_at', r.called_at,
           'waiting',   coalesce((select jsonb_agg(w.label order by w.created_at, w.id)
                                    from public.queue_waiting w where w.room_id = r.id), '[]'::jsonb)
         ) order by r.sort_order, r.created_at), '[]'::jsonb)
    from public.queue_rooms r
   where r.board_id = p_board;
$$;

grant execute on function public.queue_snapshot(uuid) to anon, authenticated;

-- ---------- what the staff buttons do ----------
-- These run as the logged-in staff member, so the policies above still apply.

-- Call the next patient: the first waiting patient becomes "now serving".
-- If nobody is waiting, the room is simply cleared.
create or replace function public.queue_call_next(p_room uuid)
returns void
language plpgsql as $$
declare w record;
begin
  select * into w from public.queue_waiting
   where room_id = p_room order by created_at, id limit 1 for update skip locked;
  if found then
    delete from public.queue_waiting where id = w.id;
    update public.queue_rooms set current_label = w.label, called_at = now() where id = p_room;
  else
    update public.queue_rooms set current_label = '', called_at = now() where id = p_room;
  end if;
end;
$$;

-- Call the same patient again (the TV chimes again).
create or replace function public.queue_recall(p_room uuid)
returns void
language sql as $$
  update public.queue_rooms set called_at = now() where id = p_room and current_label <> '';
$$;

-- Finish with the current patient without calling anyone.
create or replace function public.queue_clear(p_room uuid)
returns void
language sql as $$
  update public.queue_rooms set current_label = '', called_at = now() where id = p_room;
$$;

-- Only logged-in staff may use the buttons; the public (TV) may not.
revoke execute on function public.queue_call_next(uuid) from public, anon;
revoke execute on function public.queue_recall(uuid)    from public, anon;
revoke execute on function public.queue_clear(uuid)     from public, anon;
grant  execute on function public.queue_call_next(uuid) to authenticated;
grant  execute on function public.queue_recall(uuid)    to authenticated;
grant  execute on function public.queue_clear(uuid)     to authenticated;
