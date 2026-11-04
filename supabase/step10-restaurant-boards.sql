-- Step 10: Restaurant boards (menu with photos, today's special, combo, drinks & dessert)
-- Run once in Supabase -> SQL Editor -> New query -> Run. Safe to run more than once.
--
-- What this adds to public.menu_boards:
--   board_type  which screen design to show:
--                 'menu'    full menu board (categories + items, optional photos)
--                 'special' today's special / promo (one big featured dish)
--                 'combo'   combo / set meal board (bundles with a bundle price)
--                 'drinks'  drinks & dessert board (compact grid)
--   languages   which languages the board shows: en = English, bm = Bahasa Malaysia, zh = Chinese
--   lang_mode   'stack'  = every language shown together, one under the other
--               'rotate' = one language at a time, switching on every slide
--
-- No other change is needed. Item details live inside the existing "categories" JSON,
-- so photos, BM/Chinese names, badges and "was" prices need no new columns. Each item may now have:
--   name, price, desc, soldOut         (already in use)
--   name_bm, name_zh, desc_bm, desc_zh (translations; optional)
--   image                              (storage path in the "media" bucket; optional)
--   badge                              (short label such as "Best seller"; optional)
--   was_price                          (old price shown crossed out; optional)
-- Existing menus keep working exactly as before (board_type defaults to 'menu', English only).

alter table public.menu_boards
  add column if not exists board_type text not null default 'menu';

alter table public.menu_boards
  add column if not exists languages text[] not null default array['en']::text[];

alter table public.menu_boards
  add column if not exists lang_mode text not null default 'stack';

-- Allowed values (dropped first so this file can be run again).
alter table public.menu_boards drop constraint if exists menu_boards_board_type_check;
alter table public.menu_boards
  add constraint menu_boards_board_type_check
  check (board_type in ('menu', 'special', 'combo', 'drinks'));

alter table public.menu_boards drop constraint if exists menu_boards_lang_mode_check;
alter table public.menu_boards
  add constraint menu_boards_lang_mode_check
  check (lang_mode in ('stack', 'rotate'));

alter table public.menu_boards drop constraint if exists menu_boards_languages_check;
alter table public.menu_boards
  add constraint menu_boards_languages_check
  check (languages <@ array['en', 'bm', 'zh']::text[] and cardinality(languages) >= 1);
