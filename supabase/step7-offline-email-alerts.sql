-- Step 7: Email alert when a screen goes offline (and when it is back)
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run more than once.
--
-- How it works: every 5 minutes the database looks at each screen that has an
-- alert email. If the screen has not checked in for the chosen number of minutes
-- (and it is meant to be on right now, by its Screen hours), it sends ONE email.
-- When the screen checks in again it sends ONE "back online" email.
-- Emails are sent through Resend (resend.com). The key is saved in step 7b.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 1) Settings per screen
alter table public.screens
  add column if not exists alert_email          text,
  add column if not exists alert_after_minutes  integer not null default 10,
  add column if not exists alert_active         boolean not null default false,
  add column if not exists alert_sent_at        timestamptz;

-- 2) A private place for the email key. No policies = nobody from the website
--    (or the public) can read it. Only the database functions below can.
create table if not exists public.app_secrets (
  key   text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

-- 3) Send one email through Resend
create or replace function public.send_alert_email(p_to text, p_subject text, p_html text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key  text;
  v_from text;
begin
  select value into v_key  from public.app_secrets where key = 'resend_api_key';
  select value into v_from from public.app_secrets where key = 'alert_from';
  if v_key is null or p_to is null or p_to = '' then
    return;
  end if;
  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_key,
                 'Content-Type',  'application/json'),
    body    := jsonb_build_object(
                 'from',    coalesce(v_from, 'Click 4 Tech Signage <onboarding@resend.dev>'),
                 'to',      jsonb_build_array(p_to),
                 'subject', p_subject,
                 'html',    p_html)
  );
end;
$$;
revoke all on function public.send_alert_email(text, text, text) from public, anon, authenticated;

-- 4) Is this screen meant to be showing content right now? (Malaysia time)
create or replace function public.screen_is_open_now(s public.screens)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_now   timestamp := (now() at time zone 'Asia/Kuala_Lumpur');
  v_day   int := extract(dow from v_now)::int;          -- 0 = Sunday
  v_min   int := extract(hour from v_now)::int * 60 + extract(minute from v_now)::int;
  v_prev  int := (extract(dow from v_now)::int + 6) % 7;
  w       jsonb;
  st      int;
  en      int;
begin
  if not s.hours_enabled then
    return true;
  end if;

  if s.hours_week is not null then
    w := s.hours_week -> v_day::text;
    if w is not null and (w->>'start') is not null and (w->>'end') is not null then
      st := extract(hour from (w->>'start')::time)::int * 60 + extract(minute from (w->>'start')::time)::int;
      en := extract(hour from (w->>'end')::time)::int   * 60 + extract(minute from (w->>'end')::time)::int;
      if st < en and v_min >= st and v_min < en then return true; end if;
      if st > en and v_min >= st then return true; end if;
      if st = en then return true; end if;
    end if;
    w := s.hours_week -> v_prev::text;          -- yesterday's window running past midnight
    if w is not null and (w->>'start') is not null and (w->>'end') is not null then
      st := extract(hour from (w->>'start')::time)::int * 60 + extract(minute from (w->>'start')::time)::int;
      en := extract(hour from (w->>'end')::time)::int   * 60 + extract(minute from (w->>'end')::time)::int;
      if st > en and v_min < en then return true; end if;
    end if;
    return false;
  end if;

  -- older single window
  if s.hours_start is null or s.hours_end is null then
    return true;
  end if;
  if s.hours_days is not null and array_length(s.hours_days, 1) > 0
     and not (v_day = any (s.hours_days)) then
    return false;
  end if;
  st := extract(hour from s.hours_start)::int * 60 + extract(minute from s.hours_start)::int;
  en := extract(hour from s.hours_end)::int   * 60 + extract(minute from s.hours_end)::int;
  if st < en then return v_min >= st and v_min < en; end if;
  if st > en then return v_min >= st or v_min < en; end if;
  return true;
end;
$$;

-- 5) The check that runs every 5 minutes
create or replace function public.check_offline_screens()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r         record;
  v_offline boolean;
  v_open    boolean;
  v_name    text;
  v_when    text;
begin
  for r in
    select s.*, o.name as org_name
      from public.screens s
      left join public.organizations o on o.id = s.org_id
     where s.alert_email is not null and s.alert_email <> ''
  loop
    v_name := coalesce(r.org_name || ' - ', '') || r.name;
    v_offline := r.last_seen_at is null
              or r.last_seen_at < now() - make_interval(mins => greatest(r.alert_after_minutes, 5));

    select public.screen_is_open_now(x) into v_open from public.screens x where x.id = r.id;

    if v_offline and not r.alert_active and v_open then
      v_when := case when r.last_seen_at is null then 'It has never connected.'
                else 'Last seen: ' || to_char(r.last_seen_at at time zone 'Asia/Kuala_Lumpur', 'DD Mon YYYY, HH12:MI AM') || ' (Malaysia time).' end;
      perform public.send_alert_email(
        r.alert_email,
        'Screen OFFLINE: ' || v_name,
        '<p><b>' || replace(replace(v_name, '<', '&lt;'), '>', '&gt;') || '</b> is offline.</p>'
        || '<p>' || v_when || '</p>'
        || '<p>Please check that the TV / PC is on, connected to the internet, and showing the signage.</p>'
        || '<p style="color:#888">Click 4 Tech Digital Signage</p>'
      );
      update public.screens set alert_active = true, alert_sent_at = now() where id = r.id;

    elsif not v_offline and r.alert_active then
      perform public.send_alert_email(
        r.alert_email,
        'Screen back ONLINE: ' || v_name,
        '<p><b>' || replace(replace(v_name, '<', '&lt;'), '>', '&gt;') || '</b> is back online. No action needed.</p>'
        || '<p style="color:#888">Click 4 Tech Digital Signage</p>'
      );
      update public.screens set alert_active = false where id = r.id;
    end if;
  end loop;
end;
$$;
revoke all on function public.check_offline_screens() from public, anon, authenticated;

-- 6) Run the check every 5 minutes
do $$
begin
  perform cron.unschedule('screen-offline-check');
exception when others then
  null;
end $$;

select cron.schedule('screen-offline-check', '*/5 * * * *', 'select public.check_offline_screens()');
