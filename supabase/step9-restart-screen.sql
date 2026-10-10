-- Step 9: "Restart screen" button
-- Run once in Supabase -> SQL Editor -> New query -> Run. Safe to run more than once.
alter table public.screens
  add column if not exists restart_requested_at timestamptz;
