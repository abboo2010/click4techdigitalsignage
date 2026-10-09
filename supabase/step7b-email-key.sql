-- Step 7b: Save your Resend email key (run once, then again only if the key changes).
-- 1) Replace re_PASTE_YOUR_KEY_HERE with your real key from resend.com -> API Keys.
-- 2) Replace the "from" line if you verified your own domain in Resend.
--    (Until then, keep onboarding@resend.dev -- it can only email YOUR Resend login address.)
-- NEVER save the real key in GitHub. Only run it here in the SQL Editor.

insert into public.app_secrets (key, value) values
  ('resend_api_key', 're_PASTE_YOUR_KEY_HERE'),
  ('alert_from',     'Click 4 Tech Signage <onboarding@resend.dev>')
on conflict (key) do update set value = excluded.value;
