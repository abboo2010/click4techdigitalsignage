-- Step 5: Ticker and side-panel colours and fonts
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run more than once. The defaults keep the current look.

alter table public.screens
  add column if not exists ticker_bg         text not null default '#0a0a0a',
  add column if not exists ticker_color      text not null default '#ffffff',
  add column if not exists ticker_font       text not null default 'default',
  add column if not exists panel_text_color  text not null default '#ffffff',
  add column if not exists panel_font        text not null default 'default';
