-- Step 2c: Different opening hours for each day of the week
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run more than once.
--
-- Stores the week as JSON keyed by day number (0 = Sunday ... 6 = Saturday),
-- e.g. {"1":{"start":"08:00:00","end":"18:00:00"},"6":{"start":"09:00:00","end":"13:00:00"}}
-- A day that is missing means the screen is closed that day.
-- (The earlier hours_days / hours_start / hours_end columns are no longer used.)

alter table public.screens
  add column if not exists hours_week jsonb;
