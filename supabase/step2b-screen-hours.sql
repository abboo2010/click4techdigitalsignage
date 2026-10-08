-- Step 2b: Screen hours (operating schedule for the whole screen)
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run more than once.
--
-- Clients can already update their own screen row (ticker speed, logo),
-- so no new permission policy is needed.

alter table public.screens
  add column if not exists hours_enabled   boolean  not null default false,
  add column if not exists hours_days      smallint[],
  add column if not exists hours_start     time,
  add column if not exists hours_end       time,
  add column if not exists off_hours_mode  text     not null default 'black'
    check (off_hours_mode in ('black', 'logo'));
