-- Step 11: Restaurant name and logo on menu boards
-- Run once in Supabase -> SQL Editor -> New query -> Run. Safe to run more than once.
--
-- restaurant_name  shown above the menu title in the board header (optional)
-- logo_path        path of the logo file in the "media" storage bucket (optional)
-- Existing menu boards are not changed: the name is blank and there is no logo.

alter table public.menu_boards
  add column if not exists restaurant_name text not null default '';

alter table public.menu_boards
  add column if not exists logo_path text;
