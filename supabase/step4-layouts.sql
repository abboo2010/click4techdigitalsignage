-- Step 4: Screen layouts (main area + side panel with logo, clock and side images)
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run more than once.

alter table public.screens
  add column if not exists layout text not null default 'full'
    check (layout in ('full', 'right', 'left', 'bottom'));

alter table public.screens
  add column if not exists panel_color text not null default '#8b1e1e';

-- Which area of the screen an uploaded image/video plays in.
alter table public.media_items
  add column if not exists zone text not null default 'main'
    check (zone in ('main', 'side'));
