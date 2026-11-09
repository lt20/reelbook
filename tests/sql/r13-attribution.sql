-- P8 R13: SQL checks of the attribution section, run by hand on a throwaway database (never production):
--   docker run -d --name rb-pg13 -e POSTGRES_PASSWORD=postgres public.ecr.aws/supabase/postgres:17.6.1.166
--   stubs (auth.users email_confirmed_at / phone_confirmed_at, storage.buckets / objects / foldername), then
--   supabase/schema.sql twice, then this file, all as supabase_admin -d postgres; then docker rm -f rb-pg13.
-- Everything runs in rolled-back transactions: nothing is kept. « R13 checks: all passed » is the expected notice.
\set ON_ERROR_STOP 1
begin;
do $$
declare
  a uuid := gen_random_uuid(); x uuid := gen_random_uuid(); tok text; m text; ok boolean; msg text;
  midnight timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  mk constant text := 'insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values ($1, $2, $3, $4, $5)';
begin
  -- 1. No settings row, nobody with an origin: the line as before, no new figure
  execute mk using a, 'a@x.io', now(), now() - interval '10 days', '{}'::jsonb;
  m := public.beta_alert_message()->>'message';
  assert m like 'beta off (no settings row) · accounts 1 · sign-ups today % (yesterday %) · photos 0.0 GB · %', m;
  assert m not like '%via %', 'no « via » when n = 0: ' || m;
  -- 2. Origins: a code, a token, none, a malformed one, an exempt account; one yesterday, one two days ago
  execute mk using gen_random_uuid(), 'b@x.io', now(), now(), '{"ref":"story"}'::jsonb;
  execute mk using gen_random_uuid(), 'c@x.io', now(), now(), '{"ref":"AbCdEfGhIjKlMnOpQrStUv","invite":"AbCdEfGhIjKlMnOpQrStUv"}'::jsonb;
  execute mk using gen_random_uuid(), 'd@x.io', now(), now(), '{}'::jsonb;
  execute mk using gen_random_uuid(), 'e@x.io', now(), now(), '{"ref":"Bad Code"}'::jsonb;
  execute mk using gen_random_uuid(), 'f@x.io', null::timestamptz, now() - interval '2 hours', '{"ref":"hn"}'::jsonb;   -- never confirmed: not a sign-up
  execute mk using x, 'x@x.io', now(), now(), '{"ref":"text"}'::jsonb;
  insert into public.account_quotas (user_id, note) values (x, 'exempt: maintainer');
  execute mk using gen_random_uuid(), 'g@x.io', now(), midnight - interval '6 hours', '{"ref":"app"}'::jsonb;  -- yesterday
  execute mk using gen_random_uuid(), 'h@x.io', now(), midnight - interval '30 hours', '{"ref":"app"}'::jsonb; -- the day before
  assert public.beta_signups_ref(midnight - interval '1 day') = 3, 'story + token + app yesterday: ' || public.beta_signups_ref(midnight - interval '1 day');
  assert public.beta_signups_ref(midnight) = 2, 'today: story + token';
  m := public.beta_alert_message()->>'message';
  assert m like 'beta off (no settings row) · accounts 7 · sign-ups today 4 (yesterday 1) · via shares: 3 · photos %', m;
  assert m !~ '@|story|AbCdEf|Bad Code|maintainer', 'never an email, a code or a token: ' || m;
  -- 3. The locks on and the beta full: an invite admits an account past it; the seats leave it out, the line counts it
  insert into public.sessions (user_id, slug, title, theme) values (a, 'kicks', 'Kicks', 'mma');
  insert into public.session_shares (owner, session_slug, sender_name) values (a, 'kicks', 'Laurent') returning token into tok;
  insert into public.beta_settings (seats_total, seats_offset, signups_per_day) values (7, 0, 100);
  assert public.beta_accounts() = 7, 'seven seats taken: ' || public.beta_accounts();
  m := public.beta_alert_message()->>'message';
  assert m like 'seats 7/7 · sign-ups today 4/100 (yesterday 1) · via shares: 3 · photos %', m;
  execute mk using gen_random_uuid(), 'i@x.io', now(), now(), jsonb_build_object('invite', tok, 'ref', tok);
  assert public.beta_accounts() = 7, 'the admitted account takes no seat';
  m := public.beta_alert_message()->>'message';
  assert m like 'seats 7/7 · via invites: 1 · sign-ups today 5/100 (yesterday 1) · via shares: 4 · photos %', m;
  assert m !~ ('@|' || tok), 'never the token: ' || m;
  -- an admission past the hour, never confirmed, gives its invite back: no longer counted
  update auth.users set email_confirmed_at = null, created_at = now() - interval '2 hours' where email = 'i@x.io';
  m := public.beta_alert_message()->>'message';
  assert m like 'seats 7/7 · sign-ups today 4/100 (yesterday 1) · via shares: 3 · photos %', m;
  -- 4. The waiting list keeps the origin (the beta is full: the form is open)
  assert public.join_waitlist('Zoe', 'zoe@x.io', 'en', true, null, 'story') = 'ok';
  assert (select ref from public.beta_waitlist where email = 'zoe@x.io') = 'story', 'six arguments: the code';
  assert public.join_waitlist('Zoe', 'zoe@x.io', 'en', true, null, 'hn') = 'ok', 'listed: the same answer';
  assert (select ref from public.beta_waitlist where email = 'zoe@x.io') = 'story', 'the first origin wins';
  assert public.join_waitlist('Yan', 'yan@x.io', 'en', true, null, 'Bad Code') = 'ok', 'a malformed code: the same answer';
  assert (select ref from public.beta_waitlist where email = 'yan@x.io') is null, 'and no origin';
  assert public.join_waitlist('Yan', 'yan@x.io', 'en', true, null, 'hn') = 'ok';
  assert (select ref from public.beta_waitlist where email = 'yan@x.io') = 'hn', 'a listed row without an origin gets one';
  assert public.join_waitlist('Wes', 'wes@x.io', 'en', true, tok) = 'ok';
  assert (select ref || ' ' || share_token from public.beta_waitlist where email = 'wes@x.io') = tok || ' ' || tok, 'five arguments: the token is the origin (and kept, R12)';
  assert public.join_waitlist('Val', 'val@x.io', 'en', true, tok, 'story') = 'ok';
  assert (select ref from public.beta_waitlist where email = 'val@x.io') = tok, 'the token before the code';
  assert public.join_waitlist('Uma', 'uma@x.io', 'en', true) = 'ok';
  assert (select ref from public.beta_waitlist where email = 'uma@x.io') is null, 'four arguments: no origin, as before';
  begin perform public.join_waitlist('Tom', 'tom@x.io', 'en', false, null, 'story'); ok := true;
  exception when others then ok := false; msg := sqlerrm; end;
  assert not ok and msg = 'waitlist: consent required', 'six arguments: the same checks: ' || coalesce(msg, 'passed');
  begin insert into public.beta_waitlist (first_name, email, consent_at, ref) values ('Bad', 'bad@x.io', now(), 'Not A Code'); ok := true;
  exception when check_violation then ok := false; end;
  assert not ok, 'the column refuses a malformed origin';
  m := public.beta_alert_message()->>'message';
  assert m like '% · waiting list 5 (+5 since yesterday)', m;
  raise notice 'R13 checks: all passed';
end $$;
rollback;
-- Rights: the count and the line are internal; the six-argument form is the forms'.
begin;
set local role anon;
do $$ begin perform public.beta_signups_ref(now()); raise exception 'anon ran'; exception when insufficient_privilege then raise notice 'anon beta_signups_ref: denied'; end $$;
do $$ begin perform public.beta_alert_message(); raise exception 'anon ran'; exception when insufficient_privilege then raise notice 'anon beta_alert_message: denied'; end $$;
do $$ begin perform public.join_waitlist('A', 'a@x.io', 'en', true, null, 'story'); exception when insufficient_privilege then raise exception 'anon join_waitlist (6) denied'; when others then raise notice 'anon join_waitlist (6): allowed (%)', sqlerrm; end $$;
rollback;
begin;
set local role authenticated;
do $$ begin perform public.beta_signups_ref(now()); raise exception 'auth ran'; exception when insufficient_privilege then raise notice 'authenticated beta_signups_ref: denied'; end $$;
do $$ begin perform public.join_waitlist('A', 'a@x.io', 'en', true, null, 'story'); exception when insufficient_privilege then raise exception 'authenticated join_waitlist (6) denied'; when others then raise notice 'authenticated join_waitlist (6): allowed (%)', sqlerrm; end $$;
rollback;
