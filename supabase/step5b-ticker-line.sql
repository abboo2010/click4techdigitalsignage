-- Step 5b: Colour (or removal) of the thin line above the ticker
-- Run once in Supabase -> SQL Editor. Safe to run more than once.
-- Default keeps the current red line. The value 'none' hides the line.

alter table public.screens
  add column if not exists ticker_line text not null default '#8b1e1e';
