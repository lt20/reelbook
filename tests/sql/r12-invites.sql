-- P8 R12: SQL checks of the invitations section, run by hand on a throwaway database (never production):
--   docker run -d --name rb-pg -e POSTGRES_PASSWORD=postgres public.ecr.aws/supabase/postgres:17.6.1.166
--   stubs (auth.users email_confirmed_at / phone_confirmed_at, storage.buckets / objects / foldername), then
--   supabase/schema.sql twice, then this file, all as supabase_admin -d postgres; then docker rm -f rb-pg.
-- Everything runs in rolled-back transactions: nothing is kept. « R12 checks: all passed » is the expected notice.
\set ON_ERROR_STOP 1
begin;
do $$
declare
  a uuid := gen_random_uuid(); tok text; n int; ok boolean; msg text; j jsonb; u uuid; t2 text;
  mk_user constant text := 'insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values ($1, $2, now(), now(), $3)';
begin
  -- the sender, before the locks: a seat-free backend
  execute mk_user using a, 'a@x.io', '{}'::jsonb;
  insert into public.sessions (user_id, slug, title, theme) values (a, 'kicks', 'Kicks', 'mma');
  insert into public.session_shares (owner, session_slug, sender_name) values (a, 'kicks', 'Laurent') returning token into tok;
  assert public.share_invites(tok) is null, 'no settings row: no invite answer';
  -- 3 seats, all taken by a and two others
  insert into public.beta_settings (seats_total, seats_offset, signups_per_day) values (3, 0, 100);
  execute mk_user using gen_random_uuid(), 'b@x.io', '{}'::jsonb;
  execute mk_user using gen_random_uuid(), 'c@x.io', '{}'::jsonb;
  assert public.beta_accounts() = 3, 'three seats taken';
  assert (public.beta_seats()->>'open')::boolean = false, 'beta full';
  assert (public.share_invites(tok)->>'left')::int = 2, 'two invites left';
  -- full, no invite: refused as before
  begin execute mk_user using gen_random_uuid(), 'd@x.io', '{}'::jsonb; ok := true;
  exception when others then ok := false; msg := sqlerrm; end;
  assert not ok and msg = 'beta: full', 'full without invite: ' || coalesce(msg, 'passed');
  -- a bad or unknown token: refused
  begin execute mk_user using gen_random_uuid(), 'd@x.io', '{"invite":"AAAAAAAAAAAAAAAAAAAAAA"}'::jsonb; ok := true;
  exception when others then ok := false; msg := sqlerrm; end;
  assert not ok and msg = 'beta: full', 'unknown token refused';
  -- admission when full (1 and 2)
  u := gen_random_uuid();
  execute mk_user using u, 'e@x.io', jsonb_build_object('invite', tok);
  assert exists (select 1 from public.share_admissions s where s.account = u and s.owner = a and s.token = tok), 'admission recorded';
  execute mk_user using gen_random_uuid(), 'f@x.io', jsonb_build_object('invite', tok);
  -- admitted accounts take no seat
  assert public.beta_accounts() = 3, 'admitted accounts excluded from seats: ' || public.beta_accounts();
  assert public.beta_signups('-infinity') = 5, 'but counted as sign-ups';
  assert (public.share_invites(tok)->>'left')::int = 0, 'no invite left';
  -- third admission refused
  begin execute mk_user using gen_random_uuid(), 'g@x.io', jsonb_build_object('invite', tok); ok := true;
  exception when others then ok := false; msg := sqlerrm; end;
  assert not ok and msg = 'beta: full', 'third admission refused: ' || coalesce(msg, 'passed');
  assert (select count(*) from public.share_admissions) = 2, 'the refused one left no admission';
  -- an admitted account that never confirms gives the invite back after an hour
  update auth.users set email_confirmed_at = null, created_at = now() - interval '2 hours' where id = u;
  assert (public.share_invites(tok)->>'left')::int = 1, 'unconfirmed for an hour: invite back';
  update auth.users set email_confirmed_at = now(), created_at = now() where id = u;
  -- the daily cap counts admitted accounts: 5 today, cap 5 (another sender, with its 2 invites)
  u := gen_random_uuid();
  update public.beta_settings set seats_total = 4;
  execute mk_user using u, 'o@x.io', '{}'::jsonb;
  update public.beta_settings set seats_total = 3;
  insert into public.sessions (user_id, slug, title, theme) values (u, 'arms', 'Arms', 'mma');
  insert into public.session_shares (owner, session_slug, sender_name) values (u, 'arms', 'Olga') returning token into t2;
  update public.beta_settings set signups_per_day = 6;
  assert (public.beta_seats()->>'today_left')::int = 0, 'today_left counts admitted';
  begin execute mk_user using gen_random_uuid(), 'h@x.io', jsonb_build_object('invite', t2); ok := true;
  exception when others then ok := false; msg := sqlerrm; end;
  assert not ok and msg = 'beta: closed today', 'daily cap applies to invited: ' || coalesce(msg, 'passed');
  assert (select count(*) from public.share_admissions) = 2, 'rolled back with the sign-up';
  -- closed: refused even with an invite
  update public.beta_settings set signups_per_day = 100, signups_open = false;
  begin execute mk_user using gen_random_uuid(), 'i@x.io', jsonb_build_object('invite', t2); ok := true;
  exception when others then ok := false; msg := sqlerrm; end;
  assert not ok and msg = 'beta: closed', 'closed applies to invited';
  update public.beta_settings set signups_open = true;
  -- a revoked link admits nobody (Olga's link, both invites left)
  assert (public.share_invites(t2)->>'left')::int = 2, 'Olga has 2';
  update public.session_shares set revoked_at = now() where token = t2;
  assert public.share_invites(t2) is null, 'revoked: no answer';
  begin execute mk_user using gen_random_uuid(), 'j@x.io', jsonb_build_object('invite', t2); ok := true;
  exception when others then ok := false; msg := sqlerrm; end;
  assert not ok and msg = 'beta: full', 'revoked link refused';
  -- seats left: an invite is not used (no admission), the account takes a seat
  insert into public.sessions (user_id, slug, title, theme) values (a, 'legs', 'Legs', 'mma');
  insert into public.session_shares (owner, session_slug, sender_name) values (a, 'legs', 'Laurent') returning token into t2;
  update public.beta_settings set seats_total = 10;
  u := gen_random_uuid();
  execute mk_user using u, 'k@x.io', jsonb_build_object('invite', t2);
  assert not exists (select 1 from public.share_admissions s where s.account = u), 'seats left: no admission';
  assert public.beta_accounts() = 5, 'it takes a seat (a, b, c, Olga, k)';
  update public.beta_settings set seats_total = 5;
  -- my_invites for the sender
  perform set_config('request.jwt.claim.sub', a::text, true);
  j := public.my_invites();
  assert (j->>'left')::int = 0 and (j->>'total')::int = 2, 'my_invites ' || j::text;
  perform set_config('request.jwt.claim.sub', '', true);
  -- waitlist keeps the token (new row, live link), never on a row already listed
  assert public.join_waitlist('Sam', 'sam@x.io', 'en', true, t2) = 'ok';
  assert (select w.share_token from public.beta_waitlist w where w.email = 'sam@x.io') = t2, 'waitlist keeps the token';
  assert public.join_waitlist('Max', 'max@x.io', 'en', true, 'AAAAAAAAAAAAAAAAAAAAAA') = 'ok';
  assert (select w.share_token from public.beta_waitlist w where w.email = 'max@x.io') is null, 'unknown token not kept';
  assert public.join_waitlist('Samuel', 'SAM@x.io', 'fr', true, tok) = 'ok';
  assert (select w.share_token from public.beta_waitlist w where w.email = 'sam@x.io') = t2, 'a token kept: the first link wins';
  assert public.join_waitlist('Zoe', 'zoe@x.io', 'en', true) = 'ok', 'four arguments still work';
  -- Codex #118 pass 2: an address listed without a link (landing, or before R12) keeps the link it comes back with;
  -- nothing else of its row changes
  assert (select w.share_token from public.beta_waitlist w where w.email = 'zoe@x.io') is null, 'listed without a link';
  select w.first_name || '|' || coalesce(w.lang, '') || '|' || w.consent_at::text into msg from public.beta_waitlist w where w.email = 'zoe@x.io';
  assert public.join_waitlist('Zoé', 'ZOE@x.io', 'fr', true, t2) = 'ok';
  assert (select w.share_token from public.beta_waitlist w where w.email = 'zoe@x.io') = t2, 'listed row gets the link';
  assert (select w.first_name || '|' || coalesce(w.lang, '') || '|' || w.consent_at::text from public.beta_waitlist w where w.email = 'zoe@x.io') = msg, 'the rest of the row unchanged';
  assert (select count(*) from public.beta_waitlist w where lower(w.email) = 'zoe@x.io') = 1, 'still one row';
  -- the person signs up later (a seat opened): the token moves to share_pending at the confirmation
  update public.beta_settings set seats_total = 50;
  u := gen_random_uuid();
  insert into auth.users (id, email, created_at, raw_user_meta_data) values (u, 'sam@x.io', now(), '{}');
  assert exists (select 1 from public.beta_waitlist w where w.email = 'sam@x.io'), 'unconfirmed: row kept';
  update auth.users set email_confirmed_at = now() where id = u;
  assert not exists (select 1 from public.beta_waitlist w where w.email = 'sam@x.io'), 'confirmed: row deleted';
  assert (select p.token from public.share_pending p where p.account = u) = t2, 'token pending for the account';
  perform set_config('request.jwt.claim.sub', u::text, true);
  -- Codex #118 pass 2: read without being consumed, gone only on the acknowledgement of that token
  assert public.pending_share_invite() = t2, 'pending';
  assert public.pending_share_invite() = t2, 'still pending: an answer lost on the way is read again';
  assert public.ack_share_invite('AAAAAAAAAAAAAAAAAAAAAA') = false, 'another token: nothing goes';
  perform set_config('request.jwt.claim.sub', a::text, true);
  assert public.ack_share_invite(t2) = false, 'another account: nothing goes';
  perform set_config('request.jwt.claim.sub', u::text, true);
  assert public.pending_share_invite() = t2, 'still there';
  assert public.ack_share_invite(t2) = true, 'acknowledged';
  assert public.pending_share_invite() is null, 'then gone';
  raise notice 'R12 checks: all passed';
end $$;
rollback;
-- rights
begin;
set local role anon;
select public.share_invites('AAAAAAAAAAAAAAAAAAAAAA') is null as anon_share_invites_ok;
do $$ begin perform public.pending_share_invite(); raise exception 'anon read'; exception when insufficient_privilege then raise notice 'anon pending_share_invite: denied'; end $$;
do $$ begin perform public.ack_share_invite('AAAAAAAAAAAAAAAAAAAAAA'); raise exception 'anon ack'; exception when insufficient_privilege then raise notice 'anon ack_share_invite: denied'; end $$;
do $$ begin perform 1 from public.share_admissions; raise exception 'anon read'; exception when insufficient_privilege then raise notice 'anon share_admissions: denied'; end $$;
rollback;
begin;
set local role authenticated;
do $$ begin perform 1 from public.share_pending; raise exception 'auth read'; exception when insufficient_privilege then raise notice 'authenticated share_pending: denied'; end $$;
do $$ begin perform public.share_invites_used(gen_random_uuid()); raise exception 'auth ran'; exception when insufficient_privilege then raise notice 'authenticated share_invites_used: denied'; end $$;
select public.my_invites() is null as signed_out_my_invites_null;
rollback;
