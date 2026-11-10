-- Reelbook — database schema
-- Run this once in the SQL editor of your Supabase project (Dashboard → SQL → New query).
-- Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- A reel the user pasted from the app, waiting for Claude Code to turn it into a sheet.
create table if not exists public.requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  url          text not null,
  status       text not null default 'queued' check (status in ('queued', 'processing', 'done', 'error')),
  theme        text,            -- hint only: the theme page the link was pasted from
  slug         text,            -- set when the sheet is published
  note         text,            -- error details (who can act on a failure: requests.reason, below)
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);

-- One exercise sheet, or one session (several exercises in one page).
create table if not exists public.sheets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slug       text not null,
  kind       text not null default 'sheet' check (kind in ('sheet', 'session')),
  theme      text not null,     -- strength | yoga | fight (see app/config.js)
  "group"    text not null,     -- muscle group / technique family, free text
  title      text not null,
  summary    text not null default '',
  duration   text not null default '',
  thumbnail  text not null default '',  -- storage path, relative to <user_id>/<slug>/
  source     jsonb not null default '{}'::jsonb,  -- {author, url, platform}
  exercises  jsonb not null default '[]'::jsonb,  -- sessions only: [{anchor,title,group,summary,thumbnail}]
  html       text not null,     -- the sheet body (see templates/)
  added_at   timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

-- Personal notes, one per sheet.
create table if not exists public.notes (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slug       text not null,
  body       text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, slug)
);

create index if not exists requests_user_status_idx on public.requests (user_id, status, created_at);
create index if not exists sheets_user_theme_idx on public.sheets (user_id, theme, "group");

-- ---------------------------------------------------------------------------
-- Row level security: every row belongs to the signed-in user, nothing is shared.
-- ---------------------------------------------------------------------------

alter table public.requests enable row level security;
alter table public.sheets   enable row level security;
alter table public.notes    enable row level security;

drop policy if exists "own requests" on public.requests;
create policy "own requests" on public.requests
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own sheets" on public.sheets;
create policy "own sheets" on public.sheets
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own notes" on public.notes;
create policy "own notes" on public.notes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Storage: one private bucket, one folder per user (<user_id>/<slug>/img/...).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sheets', 'sheets', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "own sheet files read"   on storage.objects;
drop policy if exists "own sheet files insert" on storage.objects;
drop policy if exists "own sheet files update" on storage.objects;
drop policy if exists "own sheet files delete" on storage.objects;

create policy "own sheet files read" on storage.objects for select to authenticated
  using (bucket_id = 'sheets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own sheet files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'sheets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own sheet files update" on storage.objects for update to authenticated
  using (bucket_id = 'sheets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own sheet files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'sheets' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists sheets_touch on public.sheets;
create trigger sheets_touch before update on public.sheets
  for each row execute function public.touch_updated_at();

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Notebooks (themes) chosen by each user: built-in ones turned on, or custom ones.
-- ---------------------------------------------------------------------------

create table if not exists public.user_themes (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id          text not null,                 -- built-in id (see app/config.js) or custom-<slug>
  title       text not null,
  description text not null default '',      -- custom notebooks: what goes in, read by the skill
  groups      jsonb not null default '[]'::jsonb,
  builtin     boolean not null default true,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.user_themes enable row level security;
drop policy if exists "own themes" on public.user_themes;
create policy "own themes" on public.user_themes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Sessions (v2): an ordered list of exercise sheets, each with its own dose.
-- Added after the first release: re-run this whole file to create it (idempotent).
-- ---------------------------------------------------------------------------

create table if not exists public.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slug       text not null,
  theme      text not null,     -- the notebook the session belongs to (user_themes.id)
  title      text not null,
  format     text not null default '',            -- free text: « 5 rounds · 60 s rest »
  why        text not null default '',            -- video sessions only, written by Claude
  key_points jsonb not null default '[]'::jsonb,  -- video sessions only: ["…", "…"]
  source     jsonb not null default '{}'::jsonb,  -- {author, url, platform}; empty for user sessions
  origin     text not null default 'user' check (origin in ('video', 'user')),
  thumbnail  text not null default '',            -- storage path <user_id>/<sheet slug>/img/...; first item's if empty
  items      jsonb not null default '[]'::jsonb,  -- ordered [{slug, dose}]; slug = sheets.slug
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index if not exists sessions_user_theme_idx on public.sessions (user_id, theme);

alter table public.sessions enable row level security;
drop policy if exists "own sessions" on public.sessions;
create policy "own sessions" on public.sessions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists sessions_touch on public.sessions;
create trigger sessions_touch before update on public.sessions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Practice log: one row each time a sheet or a session is done (« Done today »).
-- Added after sessions: re-run this whole file to create it (idempotent, additive: nothing else changes).
-- A backend without it keeps working: the app hides every practice control and count.
-- ---------------------------------------------------------------------------

create table if not exists public.practice_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slug       text not null,                       -- a sheet slug, or session/<slug> (same key as notes)
  done_on    date not null default current_date,
  text       text not null default '',            -- free text: « 12 kg, 3x10 »
  created_at timestamptz not null default now()
);

create index if not exists practice_log_user_slug_idx on public.practice_log (user_id, slug, done_on desc);

alter table public.practice_log enable row level security;
drop policy if exists "own practice log" on public.practice_log;
create policy "own practice log" on public.practice_log
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Full-text search: the visible text of each sheet (kit pills first, at most 4 000 characters), written by
-- `rb.py publish`. Sheets published before it hold '' until `rb.py backfill-search` fills them.
-- Added after the practice log: re-run this whole file to create it (idempotent, additive: nothing else changes).
-- A backend without it keeps working: the app searches titles, summaries, groups, notebooks, authors and notes.
-- ---------------------------------------------------------------------------

alter table public.sheets add column if not exists search_text text not null default '';

-- ---------------------------------------------------------------------------
-- Faceted library (L23): the structured tags of a sheet, {"zone": [], "gear": [], "minutes": n | null, "type": ""},
-- values from the fixed vocabulary of app/config.js (`facets`), written by `rb.py publish` from meta.json. Sheets
-- published before it hold {} until `rb.py backfill-tags` derives them (group, title, search text, duration).
-- Added after the full-text search: re-run this whole file to create it (idempotent, additive: nothing else changes).
-- A backend without it keeps working: the app searches as before, without the facet chips.
-- ---------------------------------------------------------------------------

alter table public.sheets add column if not exists tags jsonb not null default '{}'::jsonb;
create index if not exists sheets_tags_idx on public.sheets using gin (tags);

-- ---------------------------------------------------------------------------
-- Failure reason (P8 R3): requests.reason says who can act on a video that failed. The app shows the fix (sign in
-- again, then « I signed in, try again »), the reason in plain words for a video nobody can read (Remove only), or
-- « We're retrying » / « Not started » for a failure Reelbook or the computer tries again. Null until the video
-- fails; requests.note keeps the free-text detail. Written by `rb.py error --reason` (and later by the hosted
-- processing). Added after the faceted library: re-run this whole file to create it (idempotent, additive: nothing
-- else changes). A backend without it keeps working: the app reads every failure as « other » (Try again).
-- ---------------------------------------------------------------------------

alter table public.requests add column if not exists reason text;
alter table public.requests drop constraint if exists requests_reason_check;
alter table public.requests add constraint requests_reason_check
  check (reason in ('signin_required','quota','needs_computer',
                    'private','removed','restricted','not_video',
                    'fetch_blocked','processing_failed','daily_cap','other'));

-- ---------------------------------------------------------------------------
-- Capture keys (L28): the iPhone shortcut (Share Sheet → Reelbook) sends a video link to the Edge Function
-- `add-link` (supabase/functions/add-link) with `Authorization: Bearer <key>`. The app creates the key in Settings,
-- shows it once and stores only its SHA-256 (token_hash); the function looks the hash up with the service role and
-- queues the link as a requests row of that account (the quota trigger of requests, below, applies). One active key
-- per account; a revoked key stays revoked. window_start / window_count: the function's rate limit (10 links a minute
-- per key). Added after the quotas, written before their section: re-run this whole file to
-- create it (idempotent, additive: nothing else changes).
-- A backend without it keeps working: Settings hides the « iPhone shortcut » section. The table is what shows that
-- section: deploy the function first (`supabase functions deploy add-link --no-verify-jwt`), then run this section,
-- so that no key is ever made for a function that is not there.
-- ---------------------------------------------------------------------------

create table if not exists public.capture_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  label        text not null default '' check (char_length(label) <= 60),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  window_start timestamptz not null default now(),
  window_count int not null default 0
);

create unique index if not exists capture_tokens_one_active on public.capture_tokens (user_id) where revoked_at is null;

alter table public.capture_tokens enable row level security;
drop policy if exists "own capture tokens" on public.capture_tokens;
create policy "own capture tokens" on public.capture_tokens
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The app writes a new key (label, hash) and a revocation; the hash, the dates and the rate-limit counters are
-- written by the database and the function only (service role).
revoke all on public.capture_tokens from anon;
revoke insert, update on public.capture_tokens from authenticated;
grant select, delete on public.capture_tokens to authenticated;
grant insert (label, token_hash), update (label, revoked_at) on public.capture_tokens to authenticated;

create or replace function public.capture_tokens_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.last_used_at := null; new.revoked_at := null;
    new.window_start := now(); new.window_count := 0;
  elsif old.revoked_at is not null then
    new.revoked_at := old.revoked_at;   -- a revoked key is never used again
  end if;
  return new;
end $$;

drop trigger if exists capture_tokens_guard on public.capture_tokens;
create trigger capture_tokens_guard before insert or update on public.capture_tokens
  for each row execute function public.capture_tokens_guard();
revoke execute on function public.capture_tokens_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Quotas per account (L29): what one account may add to a shared backend. Defaults: 10 video links a day
-- (requests added since midnight UTC), 300 sheets (rows of public.sheets; the sessions table is not counted),
-- 200 MB of photos (the account's files in the sheets bucket). A row of account_quotas overrides them for one account
-- (a null column keeps the default). Enforced by the database, whatever the client: triggers on requests and sheets,
-- and the storage insert / update policies. Limits only refuse what would add: nothing already stored is touched,
-- and republishing a sheet the account already has is never refused by the sheet count.
-- Your own backend: lift the limits of your account with one insert (README, « Limits on a shared backend »):
--   insert into public.account_quotas (user_id, max_requests_per_day, max_sheets, max_storage_mb, note)
--   values ('<your user id>', 1000, 100000, 100000, 'owner') on conflict (user_id) do nothing;
-- Added after the faceted library: re-run this whole file to create it (idempotent, additive: nothing else changes).
-- A backend without it keeps working: no limit, and the app hides the usage line of Settings.
-- ---------------------------------------------------------------------------

create table if not exists public.account_quotas (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  max_requests_per_day int check (max_requests_per_day >= 0),   -- null: the default (10)
  max_sheets           int check (max_sheets >= 0),             -- null: the default (300)
  max_storage_mb       int check (max_storage_mb >= 0),         -- null: the default (200)
  note                 text                                     -- why (« maintainer », « asked on 4 Nov »)
);

-- A user reads its own row (the app shows its limits), never writes one: only the SQL editor (or the service role) does.
alter table public.account_quotas enable row level security;
drop policy if exists "own quota read" on public.account_quotas;
create policy "own quota read" on public.account_quotas
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.account_quotas from anon, authenticated;

create index if not exists requests_user_created_idx on public.requests (user_id, created_at);

-- The limits of one account: its account_quotas row, or the defaults.
create or replace function public.quota_limits(uid uuid)
returns table (max_requests_per_day int, max_sheets int, max_storage_mb int)
language sql stable security definer set search_path = '' as $$
  select coalesce(q.max_requests_per_day, 10), coalesce(q.max_sheets, 300), coalesce(q.max_storage_mb, 200)
  from (select 1) as one left join public.account_quotas q on q.user_id = uid
$$;

-- What one account uses now: links added today (UTC), sheet rows, bytes of photos under <uid>/ in the sheets bucket.
create or replace function public.quota_usage(uid uuid)
returns table (requests_today int, sheets int, storage_bytes bigint)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*)::int from public.requests r
      where r.user_id = uid and r.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
    (select count(*)::int from public.sheets s where s.user_id = uid),
    (select coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint end), 0)::bigint
      from storage.objects o where o.bucket_id = 'sheets' and o.name like uid::text || '/%')
$$;

-- Internal: another account's limits or usage are nobody's business (the triggers run them as their owner).
revoke execute on function public.quota_limits(uuid) from public, anon, authenticated;
revoke execute on function public.quota_usage(uuid) from public, anon, authenticated;

-- Links: counted by the day they were added. created_at is the server's clock on insert and never changes after,
-- so a client cannot date a link in the past (or move it) to dodge the count. Deleting a link of today frees its
-- slot: the limit bounds what is stored, Supabase's own rate limits bound the traffic.
create or replace function public.enforce_request_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim int; n int;
begin
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    if new.user_id is not distinct from old.user_id then return new; end if;   -- a status change, a retry: free
  else
    new.created_at := now();
  end if;
  -- one account's inserts one at a time, so that two at once cannot both take the last slot
  perform pg_advisory_xact_lock(hashtext('reelbook quota'), hashtext(new.user_id::text));
  select l.max_requests_per_day into lim from public.quota_limits(new.user_id) l;
  select count(*) into n from public.requests r
    where r.user_id = new.user_id and r.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  if n >= lim then
    raise exception using errcode = 'P0001', message = format('quota: %s links per day', lim),
      hint = 'The count starts again at midnight UTC. For more, ask whoever runs this backend.';
  end if;
  return new;
end $$;

drop trigger if exists requests_quota on public.requests;
create trigger requests_quota before insert or update on public.requests
  for each row execute function public.enforce_request_quota();

-- Sheets: a new slug is refused once the account has its maximum; an upsert of a slug it already has (republish,
-- « Something wrong? » redo) ends as an update and goes through, as does any update that keeps the owner.
create or replace function public.enforce_sheet_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim int; n int;
begin
  if tg_op = 'UPDATE' and new.user_id is not distinct from old.user_id then return new; end if;
  perform pg_advisory_xact_lock(hashtext('reelbook quota'), hashtext(new.user_id::text));
  if exists (select 1 from public.sheets s where s.user_id = new.user_id and s.slug = new.slug) then return new; end if;
  select l.max_sheets into lim from public.quota_limits(new.user_id) l;
  select count(*) into n from public.sheets s where s.user_id = new.user_id;
  if n >= lim then
    raise exception using errcode = 'P0001', message = format('quota: %s sheets', lim),
      hint = 'Delete sheets you no longer need, or ask whoever runs this backend for more.';
  end if;
  return new;
end $$;

drop trigger if exists sheets_quota on public.sheets;
create trigger sheets_quota before insert or update on public.sheets
  for each row execute function public.enforce_sheet_quota();

-- Photos: a new file (insert) or an overwrite (update, `x-upsert`) is refused once the account's files reach its
-- maximum. The size of the file on its way is not known to the policy, so the last upload under the limit may pass
-- it by one file (at most 5 MB, the bucket's file size limit). One account's checks run one at a time (same lock as
-- the triggers, held to the end of the transaction; volatile, so the total is read after the lock): uploads sent in
-- parallel cannot all read the same total. Raises instead of answering false: the client gets
-- « quota: 200 MB of photos » rather than a bare row level security refusal.
create or replace function public.photo_quota_ok(bucket text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); lim int; used bigint;
begin
  if bucket is distinct from 'sheets' or uid is null then return true; end if;
  perform pg_advisory_xact_lock(hashtext('reelbook quota'), hashtext(uid::text));
  select l.max_storage_mb into lim from public.quota_limits(uid) l;
  select u.storage_bytes into used from public.quota_usage(uid) u;
  if used >= lim::bigint * 1048576 then
    raise exception using errcode = 'P0001', message = format('quota: %s MB of photos', lim),
      hint = 'Delete sheets you no longer need, or ask whoever runs this backend for more.';
  end if;
  -- the whole project's photos, during a beta (section « Beta locks », below; nothing without its settings row)
  if to_regprocedure('public.beta_upload_ok(uuid)') is not null then perform public.beta_upload_ok(uid); end if;
  return true;
end $$;

revoke execute on function public.photo_quota_ok(text) from public, anon;
grant execute on function public.photo_quota_ok(text) to authenticated;

-- The storage section above creates these two policies without the quota; they are redefined here with it.
drop policy if exists "own sheet files insert" on storage.objects;
drop policy if exists "own sheet files update" on storage.objects;
create policy "own sheet files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'sheets' and (storage.foldername(name))[1] = auth.uid()::text and public.photo_quota_ok(bucket_id));
create policy "own sheet files update" on storage.objects for update to authenticated
  using (bucket_id = 'sheets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'sheets' and (storage.foldername(name))[1] = auth.uid()::text and public.photo_quota_ok(bucket_id));

-- For the app (Settings) and rb.py: the signed-in account's limits and what it uses now; null when signed out.
create or replace function public.my_quota() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'requests_today', u.requests_today, 'max_requests_per_day', l.max_requests_per_day,
    'sheets', u.sheets, 'max_sheets', l.max_sheets,
    'storage_bytes', u.storage_bytes, 'max_storage_mb', l.max_storage_mb)
  from public.quota_limits(auth.uid()) l, public.quota_usage(auth.uid()) u
  where auth.uid() is not null
$$;

revoke execute on function public.my_quota() from public, anon;
grant execute on function public.my_quota() to authenticated;
revoke execute on function public.enforce_request_quota() from public, anon, authenticated;
revoke execute on function public.enforce_sheet_quota() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Beta locks (L32): what the whole project may hold, on the hosted backend during the beta. OFF until a row of
-- beta_settings exists: without it, sign-ups, links and photos behave exactly as before (an own backend never adds
-- it; the only thing that runs is a delete in the empty waiting list when an email is confirmed). With the row:
--   lock 2  a sign-up is refused when signups_open is false (« beta: closed »), when seats_offset + the accounts
--           reach seats_total (« beta: full »; the offset is counted as taken from the start, inside the total), or
--           when signups_per_day accounts were created today, UTC (« beta: closed today »). An account counts once
--           confirmed, or while its confirmation is pending (created less than an hour ago, Supabase's default link
--           lifetime): sign-ups with addresses nobody confirms hold no seat and no slot of the day for long;
--   lock 3  a new link is refused once the project has max_videos_per_day links today, UTC (« beta: project limit,
--           try tomorrow »), a new or changed photo once the sheets bucket holds max_photos_gb (« beta: project limit
--           of photos »; like the per-account limit, the last uploads may pass it by a file or two);
--   lock 4  kill switches: signups_open, captures_open (new links), uploads_open (photos): « beta: paused » for the
--           last two.
-- Exempt accounts: an account with an account_quotas row whose note starts with « exempt » (the maintainer's) takes
-- no seat, is not counted in the sign-ups of the day, and passes locks 3 and 4; its links and photos still count in
-- the project totals. Give that note BEFORE adding the settings row, or the account takes a seat:
--   insert into public.account_quotas (user_id, note) values ((select id from auth.users where email = '<you>'), 'exempt: maintainer')
--   on conflict (user_id) do update set note = 'exempt: ' || coalesce(public.account_quotas.note, 'maintainer');
-- then turn the locks on (values of the hosted beta), and edit the row in the table editor:
--   insert into public.beta_settings (seats_total, seats_offset, signups_per_day, max_photos_gb, max_videos_per_day)
--   values (50, 14, 10, 10, 300) on conflict (id) do nothing;
-- Deleting the row lifts every lock at once. The locks also refuse accounts added from the dashboard
-- (Authentication › Add user, invites): raise seats_total, or set signups_open, for that.
-- Waiting list: beta_waitlist, filled only through join_waitlist() and only while the beta is full or closed; an
-- account whose email is confirmed deletes the row of that email (an unconfirmed sign-up with someone else's address
-- deletes nothing). Nobody but the project owner reads it (dashboard, SQL editor).
-- Messages: links and photos get them through PostgREST and Storage like the quotas; auth.signUp does not (Supabase
-- Auth answers « Database error saving new user », HTTP 500, to any error of the insert): the app reads
-- beta_seats() before a sign-up.
-- Added after the quotas: re-run this whole file to create it (idempotent, additive: nothing else changes).
-- ---------------------------------------------------------------------------

-- One row at most (id is always true). Not readable by clients: beta_seats() says what the app needs.
create table if not exists public.beta_settings (
  id                 boolean primary key default true check (id),
  seats_total        int not null default 50  check (seats_total >= 0),
  seats_offset       int not null default 0   check (seats_offset >= 0),    -- the hosted beta: 14
  signups_per_day    int not null default 10  check (signups_per_day >= 0),
  max_photos_gb      int not null default 10  check (max_photos_gb >= 0),
  max_videos_per_day int not null default 300 check (max_videos_per_day >= 0),
  signups_open       boolean not null default true,
  captures_open      boolean not null default true,
  uploads_open       boolean not null default true,
  updated_at         timestamptz not null default now()
);

-- RLS on and no policy, and no grant either (a policy filters rows, it does not grant): only the owner reads it.
alter table public.beta_settings enable row level security;
revoke all on public.beta_settings from anon, authenticated;

create or replace function public.beta_settings_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists beta_settings_touch on public.beta_settings;
create trigger beta_settings_touch before update on public.beta_settings
  for each row execute function public.beta_settings_touch();

-- The waiting list (decision 20): first name and email, only to say a seat is free. Deleted at sign-up, once the
-- email is confirmed (trigger below), or on request (by the owner, in the table editor). Not readable nor writable by clients: join_waitlist().
create table if not exists public.beta_waitlist (
  id         bigint generated always as identity primary key,
  first_name text not null check (char_length(first_name) between 1 and 60),
  email      text not null check (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  lang       text check (lang in ('fr', 'en')),
  consent_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists beta_waitlist_email_key on public.beta_waitlist (lower(email));
create index if not exists beta_waitlist_created_idx on public.beta_waitlist (created_at);

alter table public.beta_waitlist enable row level security;
revoke all on public.beta_waitlist from anon, authenticated;
revoke all on sequence public.beta_waitlist_id_seq from anon, authenticated;

-- Exempt: an account_quotas row whose note starts with « exempt » (any case). Only the owner writes that table.
create or replace function public.beta_exempt(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.account_quotas q where q.user_id = uid and lower(q.note) like 'exempt%')
$$;

-- The accounts that take a seat (created since `since`): confirmed (email or phone), or created less than an hour ago
-- and still waiting for their confirmation; never the exempt ones. A confirmation sent later (« resend ») may let a
-- seat be taken past the total by such an account: the trigger only sees the insert.
create or replace function public.beta_accounts(since timestamptz default '-infinity') returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from auth.users u
  where u.created_at >= since
    and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null or u.created_at > now() - interval '1 hour')
    and not exists (select 1 from public.account_quotas q where q.user_id = u.id and lower(q.note) like 'exempt%')
$$;

-- Lock 2. Runs as the owner for Supabase Auth (supabase_auth_admin) at every new account: sign-up, OAuth, invite,
-- dashboard. Sign-ups are checked one at a time (advisory lock, held to the end of the transaction; each statement
-- after it sees the sign-up committed before), so that two at once cannot both take the last seat. A refusal rolls
-- the whole sign-up back: no account is created.
create or replace function public.beta_on_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.beta_settings;
begin
  if exists (select 1 from public.beta_settings) then
    perform pg_advisory_xact_lock(hashtext('reelbook beta'), hashtext('signup'));
    select * into s from public.beta_settings b where b.id;
    if not s.signups_open then
      raise exception using errcode = 'P0001', message = 'beta: closed',
        hint = 'Sign-ups are closed for now. Your own Supabase project works without limit.';
    end if;
    if s.seats_offset + public.beta_accounts() >= s.seats_total then
      raise exception using errcode = 'P0001', message = 'beta: full',
        hint = 'Every seat of the beta is taken: join the waiting list, or use your own Supabase project.';
    end if;
    if public.beta_accounts(date_trunc('day', now() at time zone 'utc') at time zone 'utc') >= s.signups_per_day then
      raise exception using errcode = 'P0001', message = 'beta: closed today',
        hint = 'Enough sign-ups for today: the count starts again at midnight UTC.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists beta_signup on auth.users;
create trigger beta_signup before insert on auth.users
  for each row execute function public.beta_on_signup();

-- The waiting list kept to its promise: deleted when the person signs up, i.e. once the email is confirmed (at the
-- insert when confirmation is off or for OAuth, at the confirmation otherwise, and after a confirmed email change).
-- Not at an unconfirmed sign-up: anybody can type someone else's address. With or without the settings row.
create or replace function public.beta_waitlist_done() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null and new.email_confirmed_at is not null
     and (tg_op = 'INSERT' or old.email_confirmed_at is null or new.email is distinct from old.email) then
    delete from public.beta_waitlist w where lower(w.email) = lower(new.email);
  end if;
  return null;
end $$;

drop trigger if exists beta_waitlist_done on auth.users;
create trigger beta_waitlist_done after insert or update of email, email_confirmed_at on auth.users
  for each row execute function public.beta_waitlist_done();

-- Locks 3 and 4 for links: a second trigger on requests, next to the per-account one (requests_quota). Only an
-- insert adds a link to the project; every writer is checked (app, add-link function, service role). One at a time.
-- The links of the day are counted as they are added (beta_daily, one row per UTC day), not as the rows still there:
-- deleting links gives no slot of the day back. Exempt accounts are counted and never refused. Counting starts
-- with the settings row; a refused or rolled-back insert is not counted. waitlist: the new rows of the waiting list
-- that day (join_waitlist, below), counted the same way.
create table if not exists public.beta_daily (
  day      date primary key,
  links    int not null default 0,
  waitlist int not null default 0
);

alter table public.beta_daily enable row level security;
revoke all on public.beta_daily from anon, authenticated;

create or replace function public.beta_on_request() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.beta_settings; n int; today date := (now() at time zone 'utc')::date;
begin
  if not exists (select 1 from public.beta_settings) then return new; end if;
  perform pg_advisory_xact_lock(hashtext('reelbook beta'), hashtext('links'));
  -- read after the lock: a link that waited for it sees a switch or a limit changed meanwhile
  select * into s from public.beta_settings b where b.id;
  if not found then return new; end if;
  if not public.beta_exempt(new.user_id) then
    if not s.captures_open then
      raise exception using errcode = 'P0001', message = 'beta: paused',
        hint = 'New videos are paused on this backend for now. What you have keeps working.';
    end if;
    select d.links into n from public.beta_daily d where d.day = today;
    if coalesce(n, 0) >= s.max_videos_per_day then
      raise exception using errcode = 'P0001', message = 'beta: project limit, try tomorrow',
        hint = 'The beta takes a set number of videos a day for everyone: the count starts again at midnight UTC.';
    end if;
  end if;
  insert into public.beta_daily as d (day, links) values (today, 1)
    on conflict (day) do update set links = d.links + 1;
  return new;
end $$;

drop trigger if exists requests_beta on public.requests;
create trigger requests_beta before insert on public.requests
  for each row execute function public.beta_on_request();

-- Locks 3 and 4 for photos: called by photo_quota_ok() (the storage insert / update policies, above) after the
-- per-account check. The total of the whole sheets bucket, every account included.
create or replace function public.beta_upload_ok(uid uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare s public.beta_settings; used bigint;
begin
  select * into s from public.beta_settings b where b.id;
  if not found or public.beta_exempt(uid) then return true; end if;
  if not s.uploads_open then
    raise exception using errcode = 'P0001', message = 'beta: paused',
      hint = 'New photos are paused on this backend for now. What you have keeps working.';
  end if;
  select coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint end), 0)::bigint
    into used from storage.objects o where o.bucket_id = 'sheets';
  if used >= s.max_photos_gb::bigint * 1073741824 then
    raise exception using errcode = 'P0001', message = 'beta: project limit of photos',
      hint = 'The beta holds a set amount of photos for everyone. Your own Supabase project works without limit.';
  end if;
  return true;
end $$;

-- For the app, signed in or not: seats taken (offset included) and total, whether a sign-up can take one now
-- (open: signups_open and a seat left; the sign-ups of the day are not in it), and today_left: the sign-ups left
-- today, UTC (signups_per_day minus today's, counted like the seats, never below 0), so the app can say « come back
-- tomorrow » when it is 0. Null without the settings row (the app then shows no counter). Never an email nor an id.
create or replace function public.beta_seats() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('taken', t.taken, 'total', s.seats_total, 'open', s.signups_open and t.taken < s.seats_total,
                            'today_left', greatest(s.signups_per_day - t.today, 0))
  from public.beta_settings s, lateral (select s.seats_offset + public.beta_accounts() as taken,
    public.beta_accounts(date_trunc('day', now() at time zone 'utc') at time zone 'utc') as today) t
  where s.id
$$;

-- The waiting-list form (shown when the beta is full or closed), signed in or not. Refuses without consent, with a
-- bad first name or email, and while a seat can be taken (or without the settings row); 200 new rows a day for the
-- whole project at most, counted as they are added (beta_daily: a row deleted later gives no slot back). A new email
-- and one already listed both get « ok », a listed row is never changed, and the daily cap answers before the lookup
-- (« waitlist: full today » for everybody, listed or not): the answer never tells who is listed.
create or replace function public.join_waitlist(first_name text, email text, lang text, consent boolean) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.beta_settings; n int; today date := (now() at time zone 'utc')::date;
  fname text := btrim(coalesce(join_waitlist.first_name, ''));
  mail text := btrim(coalesce(join_waitlist.email, ''));
  lng text := case when lower(join_waitlist.lang) in ('fr', 'en') then lower(join_waitlist.lang) end;
begin
  if join_waitlist.consent is not true then
    raise exception using errcode = 'P0001', message = 'waitlist: consent required';
  end if;
  if char_length(fname) not between 1 and 60 then
    raise exception using errcode = 'P0001', message = 'waitlist: first name';
  end if;
  if char_length(mail) > 254 or mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception using errcode = 'P0001', message = 'waitlist: email';
  end if;
  select * into s from public.beta_settings b where b.id;
  if not found or (s.signups_open and s.seats_offset + public.beta_accounts() < s.seats_total) then
    raise exception using errcode = 'P0001', message = 'waitlist: seats open';
  end if;
  perform pg_advisory_xact_lock(hashtext('reelbook beta'), hashtext('waitlist'));
  select d.waitlist into n from public.beta_daily d where d.day = today;
  if coalesce(n, 0) >= 200 then
    raise exception using errcode = 'P0001', message = 'waitlist: full today',
      hint = 'Too many requests today: try again tomorrow. If you already joined, you are still on the list.';
  end if;
  if not exists (select 1 from public.beta_waitlist w where lower(w.email) = lower(mail)) then
    insert into public.beta_waitlist (first_name, email, lang, consent_at) values (fname, mail, lng, now());
    insert into public.beta_daily as d (day, waitlist) values (today, 1)
      on conflict (day) do update set waitlist = d.waitlist + 1;
  end if;
  return 'ok';
end $$;

-- Internal functions: run by the triggers and policies as their owner, never by a client.
revoke execute on function public.beta_settings_touch() from public, anon, authenticated;
revoke execute on function public.beta_exempt(uuid) from public, anon, authenticated;
revoke execute on function public.beta_accounts(timestamptz) from public, anon, authenticated;
revoke execute on function public.beta_on_signup() from public, anon, authenticated;
revoke execute on function public.beta_waitlist_done() from public, anon, authenticated;
revoke execute on function public.beta_on_request() from public, anon, authenticated;
revoke execute on function public.beta_upload_ok(uuid) from public, anon, authenticated;
-- Public: the seats line and the waiting-list form.
revoke execute on function public.beta_seats() from public;
grant execute on function public.beta_seats() to anon, authenticated;
revoke execute on function public.join_waitlist(text, text, text, boolean) from public;
grant execute on function public.join_waitlist(text, text, text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Daily alert (L33): one ntfy notification a day at 08:00 Europe/Zurich, sent by the database itself (pg_cron +
-- pg_net), with the figures of the beta: seats, sign-ups, photos, videos, waiting list. Counts only: never an email
-- nor a first name. Tag « 70% » when a figure reaches 70 % of its limit, priority high from 90 %.
-- The schedule only exists where pg_cron and pg_net are enabled (Dashboard › Database › Extensions), with Vault
-- (supabase_vault, on by default on Supabase) for the topic: without them the block at the end does nothing and the
-- rest of this file runs as before (own backends). Enable them BEFORE running this file, or run it again after.
-- The ntfy topic is a secret (anybody who knows it reads the notifications): it lives in Supabase Vault, named
-- reelbook_ntfy_topic, never in this file nor in a table clients can read. Paste it yourself in the SQL editor:
--   select vault.create_secret('<your topic>', 'reelbook_ntfy_topic');
-- (a topic name; a full https://… URL also works, its last segment is the topic). Without it the job fails at each
-- run with « beta alert: no topic » (Integrations › Cron › the job's runs) and sends nothing.
-- pg_cron runs in UTC (cron.timezone, GMT by default): the job runs at 06:00 and 07:00 UTC and sends once, at the
-- run that is 08:00 in Zurich (summer and winter time). By hand, at any hour: select public.beta_alert();
-- Stop it: select cron.unschedule('reelbook-daily-alert');
-- ---------------------------------------------------------------------------

-- The day's line: { title, message, tags, priority } for ntfy. Sign-ups and videos: today so far (UTC) and all of
-- yesterday (the run is early in the UTC day); waiting list: its size and the rows added yesterday and today
-- (beta_daily.waitlist). Without the settings row: the counts, no limits, no tag (videos: the requests rows).
create or replace function public.beta_alert_message() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.beta_settings;
  midnight timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  today date := (now() at time zone 'utc')::date;
  accounts int := public.beta_accounts();
  signups_today int := public.beta_accounts(midnight);
  signups_yesterday int := public.beta_accounts(midnight - interval '1 day') - public.beta_accounts(midnight);
  photos bigint; videos_today int; videos_yesterday int; listed int; listed_new int; ratio numeric; line text;
begin
  select coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint end), 0)::bigint
    into photos from storage.objects o where o.bucket_id = 'sheets';
  -- videos: the higher of the links still there (requests) and the links counted as added (beta_daily, only once the
  -- settings row exists; deletes do not lower it), so neither a delete nor the day the row is added hides any. Only
  -- on the day the row is added, links added before it AND links deleted after it can make the figure low.
  select (count(*) filter (where r.created_at >= midnight))::int, (count(*) filter (where r.created_at < midnight))::int
    into videos_today, videos_yesterday from public.requests r where r.created_at >= midnight - interval '1 day';
  select greatest(videos_today, coalesce(sum(d.links) filter (where d.day = today), 0)::int),
         greatest(videos_yesterday, coalesce(sum(d.links) filter (where d.day = today - 1), 0)::int),
         coalesce(sum(d.waitlist), 0)::int
    into videos_today, videos_yesterday, listed_new from public.beta_daily d where d.day >= today - 1;
  select count(*)::int into listed from public.beta_waitlist;
  select * into s from public.beta_settings b where b.id;
  if not found then
    line := format('beta off (no settings row) · accounts %s · sign-ups today %s (yesterday %s) · photos %s GB · videos today %s (yesterday %s) · waiting list %s (+%s since yesterday)',
      accounts, signups_today, signups_yesterday, round(photos / 1073741824.0, 1), videos_today, videos_yesterday, listed, listed_new);
    return jsonb_build_object('title', 'Reelbook beta', 'message', line, 'tags', '[]'::jsonb, 'priority', 3);
  end if;
  -- the highest share of a limit (a limit of 0 is a closure, not a share: left out)
  ratio := greatest((s.seats_offset + accounts)::numeric / nullif(s.seats_total, 0),
                    greatest(signups_today, signups_yesterday)::numeric / nullif(s.signups_per_day, 0),
                    photos::numeric / nullif(s.max_photos_gb::bigint * 1073741824, 0),
                    greatest(videos_today, videos_yesterday)::numeric / nullif(s.max_videos_per_day, 0));
  line := format('seats %s/%s · sign-ups today %s/%s (yesterday %s) · photos %s/%s GB · videos today %s/%s (yesterday %s) · waiting list %s (+%s since yesterday)',
    s.seats_offset + accounts, s.seats_total, signups_today, s.signups_per_day, signups_yesterday,
    round(photos / 1073741824.0, 1), s.max_photos_gb, videos_today, s.max_videos_per_day, videos_yesterday, listed, listed_new);
  return jsonb_build_object('title', 'Reelbook beta', 'message', line,
    'tags', case when ratio >= 0.7 then '["70%"]'::jsonb else '[]'::jsonb end,
    'priority', case when ratio >= 0.9 then 4 else 3 end);
end $$;

-- Sends the day's line to ntfy (pg_net, asynchronous: the answer lands in net._http_response). at_8_only: the
-- scheduled runs, which send only when it is 08:00 in Zurich. Returns the pg_net request id, or null when skipped.
create or replace function public.beta_alert(at_8_only boolean default false) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare topic text; server text := 'https://ntfy.sh';
begin
  if at_8_only and extract(hour from now() at time zone 'Europe/Zurich') <> 8 then return null; end if;
  if to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then
    raise exception using errcode = 'P0001', message = 'beta alert: needs Vault and pg_net';
  end if;
  select btrim(v.decrypted_secret) into topic from vault.decrypted_secrets v
    where v.name = 'reelbook_ntfy_topic' order by v.created_at desc limit 1;
  if coalesce(topic, '') = '' then
    raise exception using errcode = 'P0001', message = 'beta alert: no topic',
      hint = 'Store it once in the SQL editor: select vault.create_secret(''<your topic>'', ''reelbook_ntfy_topic'');';
  end if;
  if topic ~ '^https?://' then   -- a full URL: its server, and its last segment as the topic
    server := regexp_replace(rtrim(topic, '/'), '/[^/]*$', '');
    topic := regexp_replace(rtrim(topic, '/'), '^.*/', '');
  end if;
  return net.http_post(url := server, body := public.beta_alert_message() || jsonb_build_object('topic', topic),
                       headers := '{"Content-Type": "application/json"}'::jsonb);
end $$;

-- Internal: run by the job (as the owner) or by hand in the SQL editor, never by a client.
revoke execute on function public.beta_alert_message() from public, anon, authenticated;
revoke execute on function public.beta_alert(boolean) from public, anon, authenticated;

-- The schedule, only with the three extensions (cron.schedule with an existing name updates that job: re-runs are safe).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net')
     and exists (select 1 from pg_extension where extname = 'supabase_vault') then
    perform cron.schedule('reelbook-daily-alert', '0 6,7 * * *', 'select public.beta_alert(true)');
  end if;
end $$;

-- Table rights (L44). A new Supabase project no longer grants anything on the tables of `public`: without these lines the
-- app gets `42501 permission denied for table ...` (https://github.com/orgs/supabase/discussions/45329). Each line gives
-- what the app and tools/rb.py use, no more; RLS above still decides which rows. A project that already has wider rights
-- keeps them: a grant only adds, and adds nothing there.
-- Nothing for `anon` (it only calls beta_seats and join_waitlist, granted above), and on purpose no line for beta_settings,
-- beta_waitlist and beta_daily, which their triggers and functions reach as definer. capture_tokens has its own, above.
grant select, insert, update, delete on public.requests to authenticated;
grant select, insert, update, delete on public.sheets to authenticated;
grant select, insert, update, delete on public.notes to authenticated;
grant select, insert, update, delete on public.sessions to authenticated;
grant select, insert, delete on public.user_themes to authenticated;   -- themes are added and removed; only their family is edited (P8 R14, below)
grant select, insert, delete on public.practice_log to authenticated;  -- the log grows; Undo removes the rows just logged (P8 R5)
grant select on public.account_quotas to authenticated;                -- the limits are set by the operator

-- service_role (L42a). A new project gives service_role no table right either. The Edge Functions use it:
-- add-link reads and updates capture_tokens (key lookup, rate-limit window, `select` for the returned row) and inserts
-- into requests (RLS does not apply to service_role; the quota triggers still do). cli-login reaches its table only
-- through the two definer functions below. An older project already has these rights: nothing changes there.
grant select, update on public.capture_tokens to service_role;
grant insert on public.requests to service_role;

-- cli-login limits (L42a; progressive per address since L46). The Edge Function cli-login makes the password grant for
-- `rb.py login` with the service role, which skips Turnstile: so it counts attempts itself, before Auth is asked. Keys
-- are SHA-256 hashes made by the function ('c:' + caller IP, 'a:' + lowercased email): no address or IP is stored.
-- Per caller: 20 attempts per fixed window of 15 minutes, whatever the address.
-- Per address, whatever the caller, a lock that grows: 5 wrong passwords lock the address for 15 minutes; once that
-- lock is over, 5 more lock it for 1 hour; every further 5, for 24 hours. A sign-in that succeeds through the function
-- puts the address back to the first level, and so do 24 hours with no attempt and no lock (its row is dropped).
-- Every attempt is reserved by the gate, atomically (simultaneous calls cannot get more than 5 through a series), and
-- given back by cli_login_release() for every outcome that is not a wrong password, so only failures stay counted.
-- No client reaches the table; only service_role runs the gate and the two functions that settle an attempt.
create table if not exists public.cli_login_limits (
  key          text primary key,
  window_start timestamptz not null,  -- caller: start of its 15-minute window; address: start of its current series
  hits         integer not null,      -- attempts counted in that window or series
  level        integer not null default 0,  -- address: 0 for the first series (15-minute lock), 1 (1 hour), 2 (24 hours)
  locked_until timestamptz,                  -- address: end of the lock that the series' 5th attempt started
  last_hit     timestamptz                   -- address: when its last attempt was reserved
);
alter table public.cli_login_limits enable row level security;
revoke all on public.cli_login_limits from anon, authenticated;

-- A table made before L46 gets the three columns here, once. Its address rows were counted in fixed windows of
-- 15 minutes: a window still open goes on as the address's series (with 5 failures, a lock that ends with the window);
-- an ended window counts nothing more, so its row goes: the next attempt starts a series with a new window_start. Kept
-- with hits at 0, it would keep its old window_start, the series' identifier, and a release still on its way for that
-- window (reserved just before it ended, answered after this upgrade) would then match the new series and lower its
-- count, lifting a lock that 5 newer failures started (Codex, L46 pass 1).
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'cli_login_limits' and column_name = 'locked_until') then
    alter table public.cli_login_limits
      add column if not exists level integer not null default 0,
      add column if not exists locked_until timestamptz,
      add column if not exists last_hit timestamptz;
    delete from public.cli_login_limits where key like 'a:%' and window_start <= now() - interval '15 minutes';
    update public.cli_login_limits set
        last_hit = window_start,
        locked_until = case when hits >= 5 then window_start + interval '15 minutes' end
      where key like 'a:%';
  end if;
end $$;

-- The caller's count, in fixed windows of 15 minutes.
create or replace function public.cli_login_hit(p_key text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.cli_login_limits as l (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when l.window_start <= now() - interval '15 minutes' then now() else l.window_start end,
    hits = case when l.window_start <= now() - interval '15 minutes' then 1 else l.hits + 1 end
  returning hits into n;
  return n;
end $$;

-- 'ok:<series>' (the start of the address's series that holds the reservation, UTC, to the microsecond),
-- 'caller:<seconds>' (more than 20 attempts from that caller in its window; the address is not touched) or
-- 'address:<seconds>' (the address is locked; nothing is counted for it, the caller's attempt still is), <seconds> being
-- what is left of the caller's window or of the address's lock. The address's row is read and locked by one upsert (the
-- row lock, held until the end of the call, serializes simultaneous calls): the 5th reservation of a series starts the
-- lock at once, so the calls after it are refused while the 5th still waits for Auth's answer. What is left is counted
-- from clock_timestamp(): a call that waited for the row lock has an older now() and would get a second too many.
create or replace function public.cli_login_gate(p_caller text, p_address text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  ws timestamptz;
  h integer;
  lv integer;
  lu timestamptz;
begin
  if coalesce(p_caller, '') = '' or coalesce(p_address, '') = '' then return 'caller'; end if;
  -- A caller's row a day after its window started; an address's after 24 hours with no attempt and no lock: for an
  -- address, that is the return to the first level.
  delete from public.cli_login_limits
   where greatest(window_start, coalesce(last_hit, window_start), coalesce(locked_until, window_start)) < now() - interval '1 day';
  if public.cli_login_hit('c:' || p_caller) > 20 then
    select window_start into ws from public.cli_login_limits where key = 'c:' || p_caller;
    return 'caller:' || greatest(1, ceil(extract(epoch from ws + interval '15 minutes' - clock_timestamp())))::bigint;
  end if;
  insert into public.cli_login_limits as l (key, window_start, hits) values ('a:' || p_address, now(), 0)
  on conflict (key) do update set hits = l.hits
  returning l.window_start, l.hits, l.level, l.locked_until into ws, h, lv, lu;
  if lu > now() then
    return 'address:' || greatest(1, ceil(extract(epoch from lu - clock_timestamp())))::bigint;
  end if;
  if lu is not null then  -- the lock is over: a new series, one level up
    ws := now(); h := 0; lv := least(lv + 1, 2); lu := null;
  end if;
  h := h + 1;
  if h >= 5 then
    lu := now() + case lv when 0 then interval '15 minutes' when 1 then interval '1 hour' else interval '1 day' end;
  end if;
  update public.cli_login_limits set window_start = ws, hits = h, level = lv, locked_until = lu, last_hit = now()
   where key = 'a:' || p_address;
  return 'ok:' || to_char(ws at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
end $$;

-- Gives back the attempt reserved by the gate (unconfirmed email, Auth down or limited, and the right password when
-- cli_login_succeeded() is missing), never below zero, and only in the series the gate reserved it in (p_window, as the
-- gate returned it): a release that comes once that series is over changes nothing, so it cannot lower a newer series'
-- count (Codex pass 2). An attempt given back was not a failure: if it was the series' 5th, the lock it started goes.
create or replace function public.cli_login_release(p_address text, p_window timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.cli_login_limits
     set hits = greatest(hits - 1, 0), locked_until = case when hits - 1 >= 5 then locked_until end
   where key = 'a:' || coalesce(p_address, '') and window_start = p_window;
end $$;

-- A sign-in that succeeded: the address goes back to the first level with nothing counted, in a new series, so that a
-- release still on its way for the old one changes nothing. Only while the series is the one the gate reserved in.
create or replace function public.cli_login_succeeded(p_address text, p_window timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.cli_login_limits set window_start = now(), hits = 0, level = 0, locked_until = null
   where key = 'a:' || coalesce(p_address, '') and window_start = p_window;
end $$;
-- Replaced before any deploy (L42a, Codex passes 1 and 2): a stack that ran an earlier draft loses them.
drop function if exists public.cli_login_failed(text);
drop function if exists public.cli_login_release(text);

revoke execute on function public.cli_login_hit(text) from public, anon, authenticated, service_role;
revoke execute on function public.cli_login_gate(text, text) from public, anon, authenticated;
revoke execute on function public.cli_login_release(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.cli_login_succeeded(text, timestamptz) from public, anon, authenticated;
grant execute on function public.cli_login_gate(text, text) to service_role;
grant execute on function public.cli_login_release(text, timestamptz) to service_role;
grant execute on function public.cli_login_succeeded(text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Session shares (P8 R11): « Send to a training partner ». The sender's app writes one row per shared session; its
-- token is the link `#s-<token>`. The Edge Function `share` (supabase/functions/share, service role) reads it:
--   GET  ?token=  the session's title, its notebook's title, the sender's first name and the number of exercises
--                 (no photo, no exercise list: R12 shows that to people without an account);
--   POST {token}  copies the session, its sheets (the ones the recipient does not already have by the same video
--                 URL) and their photos into the recipient's own account and storage folder.
-- Notes, the practice log and quotas are never read nor copied. The copy counts in the recipient's quotas. One live
-- token per (owner, session): sharing again gives the same link. « Stop sharing » revokes it; a revoked token never
-- opens again (sharing after that makes a new one). A share belongs to its session (sessions.id, which never changes):
-- deleting the session deletes its shares, so an old link never opens a later session that reuses the slug.
-- Added after the cli-login limits: re-run this whole file to create it (idempotent, additive: nothing else changes).
-- A backend without it keeps working: the share row says « Coming soon » and a `#s-` link « can't be opened yet ».
-- The table is what turns the share row on: deploy the function first (`supabase functions deploy share`, with the
-- gateway's JWT check: the caller is signed in, or sends the anon key for GET), then run this section.
-- ---------------------------------------------------------------------------

-- token: 22 URL-safe characters made by the database (the 16 bytes of a random UUID v4, base64url, 122 random bits).
create table if not exists public.session_shares (
  token        text primary key
               default translate(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/=', '-_')
               check (token ~ '^[A-Za-z0-9_-]{22}$'),
  owner        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_slug text not null check (char_length(session_slug) between 1 and 200),
  session_id   uuid references public.sessions (id) on delete cascade, -- set by the guard from (owner, session_slug)
  sender_name  text not null check (char_length(sender_name) between 1 and 40),
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);

create unique index if not exists session_shares_one_live on public.session_shares (owner, session_slug)
  where revoked_at is null;

-- A backend that ran the first version of this section (no session_id): the column is added, and a live share made
-- then is revoked, never bound by its slug (the session may be a later one): sharing again makes a new link.
alter table public.session_shares add column if not exists session_id uuid references public.sessions (id) on delete cascade;
create index if not exists session_shares_session_idx on public.session_shares (session_id);
update public.session_shares set revoked_at = now() where session_id is null and revoked_at is null;

-- The owner shares its own sessions, reads its own rows and revokes them. Nobody else reads the table (the function
-- reads it with the service role).
alter table public.session_shares enable row level security;
drop policy if exists "own session shares read" on public.session_shares;
drop policy if exists "own session shares insert" on public.session_shares;
drop policy if exists "own session shares revoke" on public.session_shares;
create policy "own session shares read" on public.session_shares for select to authenticated
  using (owner = auth.uid());
create policy "own session shares insert" on public.session_shares for insert to authenticated
  with check (owner = auth.uid()
    and exists (select 1 from public.sessions s where s.user_id = auth.uid() and s.slug = session_slug));
create policy "own session shares revoke" on public.session_shares for update to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- The app writes a share (session, first name) and a revocation; the token, the owner and the dates are the database's.
revoke all on public.session_shares from anon, authenticated;
grant select on public.session_shares to authenticated;
grant insert (session_slug, sender_name), update (revoked_at) on public.session_shares to authenticated;

create or replace function public.session_shares_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.revoked_at := null; new.sender_name := btrim(new.sender_name);
    -- the session itself, by its id: the share goes with it (on delete cascade)
    new.session_id := (select s.id from public.sessions s where s.user_id = new.owner and s.slug = new.session_slug);
    if new.session_id is null then
      raise exception 'session_shares: no such session' using errcode = '23503';
    end if;
  else
    new.token := old.token; new.owner := old.owner; new.session_slug := old.session_slug; new.session_id := old.session_id;
    new.sender_name := old.sender_name; new.created_at := old.created_at;
    -- revoked once, at the server's time; a revoked token is never live again
    new.revoked_at := case when old.revoked_at is not null then old.revoked_at
                           when new.revoked_at is not null then now() end;
  end if;
  return new;
end $$;

drop trigger if exists session_shares_guard on public.session_shares;
create trigger session_shares_guard before insert or update on public.session_shares
  for each row execute function public.session_shares_guard();
revoke execute on function public.session_shares_guard() from public, anon, authenticated;

-- A copy is marked in the recipient's session: sessions.source->>'share' holds the token it came from, and
-- source->>'share_state' is 'copying' while the function fills it (a reservation), then 'done'. One copy per
-- (recipient, token): a second POST gets the finished copy back, or « still copying » during a reservation.
create unique index if not exists sessions_one_copy_per_share on public.sessions (user_id, (source->>'share'))
  where (source->>'share') is not null;
-- And one copy at a time per recipient: at most one reservation per account. A copy of a second link while one is
-- running answers « still copying a session », so each copy checks the photo quota on a state no other copy is changing
-- (the copies themselves run as service role, past the Storage quota policies). The function deletes a reservation
-- only by its id and while it is still 'copying'.
create unique index if not exists sessions_one_copying on public.sessions (user_id)
  where (source->>'share_state') = 'copying';

-- What the function needs to plan a copy, in one call each (service role only).
-- The photos of some sheets of one account: the files under <owner>/<slug>/, with their size.
create or replace function public.share_files(p_owner uuid, p_slugs text[])
returns table (name text, size bigint)
language sql stable security definer set search_path = '' as $$
  select o.name, coalesce(case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint end, 0)
  from storage.objects o
  where o.bucket_id = 'sheets' and o.name like p_owner::text || '/%'
    and (storage.foldername(o.name))[2] = any (p_slugs)
  order by o.name
$$;

-- The recipient's side: its sheets with one of these video URLs (the function keeps those that are the same exercise),
-- the slugs in use that start like these stems (a copy takes a free one; a stem is the slug cut as the function cuts
-- it for a « -n » suffix):
--   taken      sheet slugs: its sheets, folders of its storage, and the notes of deleted sheets (a note is keyed by
--              the sheet slug: an old note never lands on a copied sheet);
--   ses_taken  session slugs: its sessions, and the notes kept by deleted sessions (« session/<slug> », as the
--              app's takenSlugs). Only the keys of notes are read, never their text.
-- and the room left under its quotas (section « Quotas per account ») and the beta lock on new photos (section
-- « Beta locks »).
drop function if exists public.share_recipient(uuid, text[], text[]); -- the first version of this section
create or replace function public.share_recipient(p_uid uuid, p_urls text[], p_stems text[], p_ses_stem text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare have jsonb; taken jsonb; ses_taken jsonb; room jsonb; lock_msg text; lock_hint text; ses_pat text;
begin
  select coalesce(jsonb_agg(jsonb_build_object('url', s.source->>'url', 'slug', s.slug, 'title', s.title) order by s.slug), '[]'::jsonb)
    into have from public.sheets s where s.user_id = p_uid and s.source->>'url' = any (p_urls);
  with b as (select replace(replace(replace(x, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat from unnest(p_stems) x),
       used as (
         select s.slug from public.sheets s, b where s.user_id = p_uid and s.slug like b.pat
         union
         select (storage.foldername(o.name))[2] from storage.objects o, b
          where o.bucket_id = 'sheets' and o.name like p_uid::text || '/%' and (storage.foldername(o.name))[2] like b.pat
         union
         select n.slug from public.notes n, b where n.user_id = p_uid and n.slug not like 'session/%' and n.slug like b.pat)
  select coalesce(jsonb_agg(slug order by slug), '[]'::jsonb) into taken from used;
  ses_pat := replace(replace(replace(coalesce(p_ses_stem, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  with used as (
         select s.slug from public.sessions s where s.user_id = p_uid and s.slug like ses_pat
         union
         select split_part(n.slug, '/', 2) from public.notes n
          where n.user_id = p_uid and n.slug ~ '^session/[^/]+(/[1-9][0-9]*)?$' and split_part(n.slug, '/', 2) like ses_pat)
  select coalesce(jsonb_agg(slug order by slug), '[]'::jsonb) into ses_taken from used where coalesce(p_ses_stem, '') <> '';
  select jsonb_build_object('storage_bytes', u.storage_bytes, 'max_storage_mb', l.max_storage_mb,
                            'sheets', u.sheets, 'max_sheets', l.max_sheets)
    into room from public.quota_limits(p_uid) l, public.quota_usage(p_uid) u;
  begin
    perform public.beta_upload_ok(p_uid);
  exception when sqlstate 'P0001' then
    get stacked diagnostics lock_msg = message_text, lock_hint = pg_exception_hint;
  end;
  return jsonb_build_object('have', have, 'taken', taken, 'ses_taken', ses_taken, 'room', room,
                            'photo_lock', case when lock_msg is not null then jsonb_build_object('message', lock_msg, 'hint', lock_hint) end);
end $$;

revoke execute on function public.share_files(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.share_recipient(uuid, text[], text[], text) from public, anon, authenticated;
grant execute on function public.share_files(uuid, text[]) to service_role;
grant execute on function public.share_recipient(uuid, text[], text[], text) to service_role;

-- service_role, for the function: it reads the share, the sender's session, sheets and notebook, and writes the
-- recipient's copy (a sheet or session it could not finish is deleted again; a finished one gets share_state 'done').
-- RLS does not apply to service_role;
-- the sheet quota trigger still does. Storage is reached through the Storage API (copy, remove), as service role.
grant select on public.session_shares to service_role;
grant select, insert, update, delete on public.sessions to service_role;
grant select, insert, delete on public.sheets to service_role;
grant select, insert on public.user_themes to service_role;

-- ---------------------------------------------------------------------------
-- Technique family (P8 R14): two kinds of practice, two rewards. A notebook is « repetition » (the rhythm: « 3rd
-- session this week ») or « technique » (learning a move: each sheet has a level, Learning → Getting it → Got it, and
-- the notebook shows « 4 of 9 learned »). user_themes.family is the account's choice (Notebook ⋯ › Kind of practice);
-- null means the default: app/config.js gives each built-in notebook its family, a custom notebook is repetition.
-- notes.level is the level of one sheet, on the per-sheet notes row of the user (a row with an empty body when the
-- sheet has no note); null until the sheet is practised. Written by the app only.
-- Added after the session shares: re-run this whole file to create it (idempotent, additive: nothing else changes).
-- A backend without it keeps working: the app hides the levels and treats every notebook as repetition.
-- ---------------------------------------------------------------------------

alter table public.user_themes add column if not exists family text;
alter table public.user_themes drop constraint if exists user_themes_family_check;
alter table public.user_themes add constraint user_themes_family_check
  check (family in ('repetition','technique'));

alter table public.notes add column if not exists level text;
alter table public.notes drop constraint if exists notes_level_check;
alter table public.notes add constraint notes_level_check
  check (level in ('learning','getting','got'));

-- The family is the only column of user_themes the app edits (RLS « own themes » already covers update).
grant update (family) on public.user_themes to authenticated;

-- A level saved on a sheet is not an edit of its note: « Saved <date> » under the note keeps the note's own date.
-- The app's note save sets body (and slug); a level save sets level (and slug) only.
drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update of body on public.notes
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Invitations (P8 R12): a share link (session_shares, above) is also an invitation. While the beta locks are on (a
-- beta_settings row), each account's links together admit at most 2 accounts past a full
-- beta, outside the seats:
--   - the app signs up with options.data.invite = <token> (raw_user_meta_data->>'invite'). When every seat is taken,
--     lock 2 lets the account in if the token is live and its owner has an invite left, and records it in
--     share_admissions. Lock 2's other refusals stay: sign-ups closed (« beta: closed ») and the sign-ups of the day
--     (« beta: closed today », admitted accounts counted in them). Locks 3 and 4 apply to the account as to any other;
--   - an admitted account takes no seat: beta_accounts() leaves it out, as it leaves out the exempt ones;
--   - an invite is held like a seat: by an admitted account confirmed, or created less than an hour ago;
--   - with no invite left and the beta full, the link's page offers the waiting list, which keeps the token
--     (beta_waitlist.share_token, a live link, on a row that has none yet). When that email is confirmed, the token
--     moves to share_pending; the app reads it (pending_share_invite) and shows « <sender> sent you a session », where
--     the person chooses to add it (anybody can type someone else's address in the form: nothing is copied unasked).
--     The token stays in share_pending until the app acknowledges it (ack_share_invite), once that sheet has been
--     shown or the link refused for good: an answer lost on the way, or a failure, offers it again at the next start.
-- This section redefines four functions of the beta section (beta_accounts, beta_on_signup, beta_seats,
-- beta_waitlist_done), which the file creates first: re-run the whole file, never the beta section alone after it.
-- Current accounts: nothing changes. share_admissions starts empty, so the seats and the sign-ups of the day count
-- what they counted; a sign-up without an invite, or with seats left, goes through lock 2 as before; join_waitlist
-- with four arguments is untouched (the new one, five arguments, calls it).
-- Added after the session shares: re-run this whole file to create it (idempotent, additive: nothing else changes).
-- A backend without it keeps working: the link's page shows no invite line, the sign-up sends the token for nothing
-- (lock 2 ignores it), the waiting list is joined without the token, and Settings shows no « Invites left ».
-- ---------------------------------------------------------------------------

-- One row per admitted account: who admitted it (the link's owner) and through which link. The account's own row
-- comes from lock 2, before auth.users has the account: the reference to it is checked at the end of the transaction.
create table if not exists public.share_admissions (
  account uuid primary key references auth.users (id) on delete cascade deferrable initially deferred,
  owner   uuid not null references auth.users (id) on delete cascade,
  token   text not null check (token ~ '^[A-Za-z0-9_-]{22}$'),
  at      timestamptz not null default now()
);
create index if not exists share_admissions_owner_idx on public.share_admissions (owner);

alter table public.share_admissions enable row level security;
revoke all on public.share_admissions from anon, authenticated;

-- The waiting list keeps the link it was joined from (null: joined from the landing, or the link was not live).
alter table public.beta_waitlist add column if not exists share_token text check (share_token ~ '^[A-Za-z0-9_-]{22}$');

-- A token kept by the waiting list, waiting for its account's visit to the app (pending_share_invite), until the app
-- acknowledges it (ack_share_invite).
create table if not exists public.share_pending (
  account uuid primary key references auth.users (id) on delete cascade,
  token   text not null check (token ~ '^[A-Za-z0-9_-]{22}$'),
  at      timestamptz not null default now()
);

alter table public.share_pending enable row level security;
revoke all on public.share_pending from anon, authenticated;

-- The invites one account's links hold now: its admitted accounts, confirmed or created less than an hour ago (like a
-- seat: an address nobody confirms gives the invite back after an hour; a confirmation sent later counts it again).
create or replace function public.share_invites_used(uid uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.share_admissions a join auth.users u on u.id = a.account
  where a.owner = uid
    and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null or u.created_at > now() - interval '1 hour')
$$;

-- The accounts created since `since`, counted like the seats (confirmed, or pending for an hour; never the exempt
-- ones), admitted accounts included: the sign-ups of the day.
create or replace function public.beta_signups(since timestamptz) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from auth.users u
  where u.created_at >= since
    and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null or u.created_at > now() - interval '1 hour')
    and not exists (select 1 from public.account_quotas q where q.user_id = u.id and lower(q.note) like 'exempt%')
$$;

-- Redefined (beta section): the accounts that take a seat leave out the admitted ones too.
create or replace function public.beta_accounts(since timestamptz default '-infinity') returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from auth.users u
  where u.created_at >= since
    and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null or u.created_at > now() - interval '1 hour')
    and not exists (select 1 from public.account_quotas q where q.user_id = u.id and lower(q.note) like 'exempt%')
    and not exists (select 1 from public.share_admissions a where a.account = u.id)
$$;

-- Redefined (beta section): lock 2 with the invitation. Same lock, same order and same messages; only « beta: full »
-- lets through a sign-up whose invite is a live link with an invite left, and records the admission (rolled back
-- with the sign-up if a later check refuses it). The sign-ups of the day count admitted accounts (beta_signups).
create or replace function public.beta_on_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.beta_settings; tok text; host uuid;
begin
  if exists (select 1 from public.beta_settings) then
    perform pg_advisory_xact_lock(hashtext('reelbook beta'), hashtext('signup'));
    select * into s from public.beta_settings b where b.id;
    if not s.signups_open then
      raise exception using errcode = 'P0001', message = 'beta: closed',
        hint = 'Sign-ups are closed for now. Your own Supabase project works without limit.';
    end if;
    if s.seats_offset + public.beta_accounts() >= s.seats_total then
      tok := new.raw_user_meta_data->>'invite';
      if tok ~ '^[A-Za-z0-9_-]{22}$' then
        select sh.owner into host from public.session_shares sh
        where sh.token = tok and sh.revoked_at is null and sh.session_id is not null;
      end if;
      -- one account's admissions are counted under the sign-up lock: two at once cannot both take its last invite
      if host is null or host = new.id or public.share_invites_used(host) >= 2 then
        raise exception using errcode = 'P0001', message = 'beta: full',
          hint = 'Every seat of the beta is taken: join the waiting list, or use your own Supabase project.';
      end if;
      insert into public.share_admissions (account, owner, token) values (new.id, host, tok);
    end if;
    if public.beta_signups(date_trunc('day', now() at time zone 'utc') at time zone 'utc') >= s.signups_per_day then
      raise exception using errcode = 'P0001', message = 'beta: closed today',
        hint = 'Enough sign-ups for today: the count starts again at midnight UTC.';
    end if;
  end if;
  return new;
end $$;

-- Redefined (beta section): today_left counts admitted accounts, as lock 2 does. The rest is unchanged.
create or replace function public.beta_seats() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('taken', t.taken, 'total', s.seats_total, 'open', s.signups_open and t.taken < s.seats_total,
                            'today_left', greatest(s.signups_per_day - t.today, 0))
  from public.beta_settings s, lateral (select s.seats_offset + public.beta_accounts() as taken,
    public.beta_signups(date_trunc('day', now() at time zone 'utc') at time zone 'utc') as today) t
  where s.id
$$;

-- Redefined (beta section): before the waiting-list row of a confirmed email is deleted, the link it kept moves to
-- share_pending for that account. The rest is unchanged.
create or replace function public.beta_waitlist_done() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null and new.email_confirmed_at is not null
     and (tg_op = 'INSERT' or old.email_confirmed_at is null or new.email is distinct from old.email) then
    insert into public.share_pending (account, token)
      select new.id, w.share_token from public.beta_waitlist w
      where lower(w.email) = lower(new.email) and w.share_token is not null
      order by w.id limit 1
      on conflict (account) do nothing;
    delete from public.beta_waitlist w where lower(w.email) = lower(new.email);
  end if;
  return null;
end $$;

-- The link's page, signed in or not: the invites its owner has left ({left}), or null when the link is not live or
-- the beta locks are off (no settings row: nobody needs an invite). Never who was admitted.
create or replace function public.share_invites(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('left', greatest(2 - public.share_invites_used(sh.owner), 0))
  from public.session_shares sh, public.beta_settings b
  where b.id and sh.token = p_token and sh.revoked_at is null and sh.session_id is not null
$$;

-- Settings › Reelbook: the signed-in account's invites ({left, total}); null when signed out or the locks are off.
create or replace function public.my_invites() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('left', greatest(2 - public.share_invites_used(auth.uid()), 0), 'total', 2)
  from public.beta_settings b
  where b.id and auth.uid() is not null
$$;

-- The waiting-list form of a link's page: join_waitlist (four arguments, unchanged: same checks, same answers), and
-- the row keeps the token when the link is live and the row has none yet: a new row, or an address listed before (by
-- the landing, or before R12) that now comes through a link. A listed row is otherwise never changed, as before: its
-- first name, language, consent date, and a token it already keeps (the first link wins) stay as they are. The
-- waiting-list lock is taken first, so the read of the list and the insert see the same list.
create or replace function public.join_waitlist(first_name text, email text, lang text, consent boolean, share_token text)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  mail text := btrim(coalesce(join_waitlist.email, ''));
  tok text := join_waitlist.share_token;
  r text;
begin
  perform pg_advisory_xact_lock(hashtext('reelbook beta'), hashtext('waitlist'));
  r := public.join_waitlist(join_waitlist.first_name, join_waitlist.email, join_waitlist.lang, join_waitlist.consent);
  if tok ~ '^[A-Za-z0-9_-]{22}$'
     and exists (select 1 from public.session_shares sh where sh.token = tok and sh.revoked_at is null and sh.session_id is not null) then
    update public.beta_waitlist w set share_token = tok where lower(w.email) = lower(mail) and w.share_token is null;
  end if;
  return r;
end $$;

-- The signed-in account's token kept by the waiting list (null when there is none). Read only: it stays until
-- ack_share_invite, so an answer lost on the way, or a sheet that could not open, is offered again.
-- (take_share_invite, its destructive first version in this PR, was never pushed: nothing to drop.)
create or replace function public.pending_share_invite() returns text
language sql stable security definer set search_path = '' as $$
  select p.token from public.share_pending p where p.account = auth.uid()
$$;

-- The app has shown « <sender> sent you a session » for that token, or the link is refused for good (revoked, or the
-- account's own): the pending token goes. Only that token, and only the signed-in account's (true when it went).
create or replace function public.ack_share_invite(p_token text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from public.share_pending p where p.account = auth.uid() and p.token = p_token;
  return found;
end $$;

-- Internal: run by lock 2 and the functions above as their owner.
revoke execute on function public.share_invites_used(uuid) from public, anon, authenticated;
revoke execute on function public.beta_signups(timestamptz) from public, anon, authenticated;
revoke execute on function public.beta_accounts(timestamptz) from public, anon, authenticated;
revoke execute on function public.beta_on_signup() from public, anon, authenticated;
revoke execute on function public.beta_waitlist_done() from public, anon, authenticated;
-- Public: the link's page and its waiting-list form; signed in: Settings and the token kept by the waiting list.
revoke execute on function public.beta_seats() from public;
grant execute on function public.beta_seats() to anon, authenticated;
revoke execute on function public.share_invites(text) from public;
grant execute on function public.share_invites(text) to anon, authenticated;
revoke execute on function public.join_waitlist(text, text, text, boolean, text) from public;
grant execute on function public.join_waitlist(text, text, text, boolean, text) to anon, authenticated;
revoke execute on function public.my_invites() from public, anon;
grant execute on function public.my_invites() to authenticated;
revoke execute on function public.pending_share_invite() from public, anon;
grant execute on function public.pending_share_invite() to authenticated;
revoke execute on function public.ack_share_invite(text) from public, anon;
grant execute on function public.ack_share_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Attribution (P8 R13): which shares bring people in, counted rather than estimated. No third-party analytics, no
-- cookie; the origin is one short code or a share token, never a name or an email.
--   - The origin of a sign-up is user_metadata.ref (raw_user_meta_data->>'ref'), sent by the app at sign-up: the share
--     token when the person came through a link (R11, R12), else the ?r=<code> of the address the app was opened with
--     (codes: [a-z0-9-]{1,32}; the app's own shares add r=text, r=story and r=app). The app checks the form; the counts
--     below count only a ref of that form (a user can edit their own metadata later: a count, never a lock).
--   - The waiting list keeps the same origin (beta_waitlist.ref): join_waitlist with six arguments takes a ref code,
--     and the five-argument form (a link's page) now keeps its token as the ref too. A listed row gets a ref only when it
--     has none (the first origin wins), as R12 does for the token; nothing else of a listed row changes.
--   - The daily ntfy line (beta_alert_message, redefined here) gains « via shares: n » (the sign-ups of yesterday and
--     today so far, the window of its sign-up figures, whose ref has that form) and « via invites: n » (the accounts
--     R12's invitations admitted past a full beta, which the seats leave out), each only when n > 0. Its sign-up
--     figures now count the admitted accounts, as lock 2 does (beta_signups). Counts only.
--   By hand, which origins brought whom (counts, in the SQL editor):
--     select raw_user_meta_data->>'ref' as ref, count(*) from auth.users group by 1 order by 2 desc;
--     select ref, count(*) from public.beta_waitlist group by 1 order by 2 desc;
-- This section redefines join_waitlist (five arguments, R12's) and beta_alert_message (L33's): re-run the whole file.
-- Current accounts and waiting-list rows: nothing changes (their ref is null; they are counted as before, under no
-- origin). An app without this section's calls joins as before; a backend without this section ignores the ref sent
-- at sign-up (it stays in the account's metadata), and the app falls back to the five- or four-argument join_waitlist.
-- Added after the invitations: re-run this whole file to create it (idempotent, additive: nothing else changes).
-- ---------------------------------------------------------------------------

-- The origin of a waiting-list row: a ?r= code or a share token (null: none known, or a row from before).
alter table public.beta_waitlist add column if not exists ref text
  check (ref ~ '^([a-z0-9-]{1,32}|[A-Za-z0-9_-]{22})$');

-- The accounts created since `since` whose origin is a ?r= code or a share token, counted like the sign-ups (confirmed,
-- or pending for an hour; never the exempt ones; admitted accounts included). Reads the ref only.
create or replace function public.beta_signups_ref(since timestamptz) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from auth.users u
  where u.created_at >= since
    and u.raw_user_meta_data->>'ref' ~ '^([a-z0-9-]{1,32}|[A-Za-z0-9_-]{22})$'
    and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null or u.created_at > now() - interval '1 hour')
    and not exists (select 1 from public.account_quotas q where q.user_id = u.id and lower(q.note) like 'exempt%')
$$;

-- Redefined (R12): a link's waiting-list form, as before (same checks, same answers, the token kept when the link is
-- live and the row has none), and the row's origin is that token when the row has none yet (live or not: it is where
-- the person came from).
create or replace function public.join_waitlist(first_name text, email text, lang text, consent boolean, share_token text)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  mail text := btrim(coalesce(join_waitlist.email, ''));
  tok text := join_waitlist.share_token;
  r text;
begin
  perform pg_advisory_xact_lock(hashtext('reelbook beta'), hashtext('waitlist'));
  r := public.join_waitlist(join_waitlist.first_name, join_waitlist.email, join_waitlist.lang, join_waitlist.consent);
  if tok ~ '^[A-Za-z0-9_-]{22}$' then
    if exists (select 1 from public.session_shares sh where sh.token = tok and sh.revoked_at is null and sh.session_id is not null) then
      update public.beta_waitlist w set share_token = tok where lower(w.email) = lower(mail) and w.share_token is null;
    end if;
    update public.beta_waitlist w set ref = tok where lower(w.email) = lower(mail) and w.ref is null;
  end if;
  return r;
end $$;

-- The waiting-list form with the origin: join_waitlist with five arguments (all its checks and answers), then the
-- ref code on the row when it has none yet (a token, given as share_token, already set it). A ref that is not a code
-- is ignored, never an error: the form answers the same.
create or replace function public.join_waitlist(first_name text, email text, lang text, consent boolean, share_token text, ref text)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  mail text := btrim(coalesce(join_waitlist.email, ''));
  code text := join_waitlist.ref;
  r text;
begin
  perform pg_advisory_xact_lock(hashtext('reelbook beta'), hashtext('waitlist'));
  r := public.join_waitlist(join_waitlist.first_name, join_waitlist.email, join_waitlist.lang, join_waitlist.consent,
                            join_waitlist.share_token);
  if code ~ '^[a-z0-9-]{1,32}$' then
    update public.beta_waitlist w set ref = code where lower(w.email) = lower(mail) and w.ref is null;
  end if;
  return r;
end $$;

-- Redefined (L33): the day's line. Seats as before (admitted accounts take none); « via invites: n » the admitted
-- accounts that hold an invite (beta_signups minus beta_accounts); the sign-up figures with them (beta_signups, as
-- lock 2 counts the day); « via shares: n » those of yesterday and today with an origin. Each new figure only when
-- above 0. Everything else unchanged.
create or replace function public.beta_alert_message() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.beta_settings;
  midnight timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  today date := (now() at time zone 'utc')::date;
  accounts int := public.beta_accounts();
  invited int := public.beta_signups('-infinity') - public.beta_accounts();
  signups_today int := public.beta_signups(midnight);
  signups_yesterday int := public.beta_signups(midnight - interval '1 day') - public.beta_signups(midnight);
  shared int := public.beta_signups_ref(midnight - interval '1 day');
  via_shares text := case when shared > 0 then format(' · via shares: %s', shared) else '' end;
  via_invites text := case when invited > 0 then format(' · via invites: %s', invited) else '' end;
  photos bigint; videos_today int; videos_yesterday int; listed int; listed_new int; ratio numeric; line text;
begin
  select coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint end), 0)::bigint
    into photos from storage.objects o where o.bucket_id = 'sheets';
  -- videos: as in L33's version (the higher of the requests rows and beta_daily)
  select (count(*) filter (where r.created_at >= midnight))::int, (count(*) filter (where r.created_at < midnight))::int
    into videos_today, videos_yesterday from public.requests r where r.created_at >= midnight - interval '1 day';
  select greatest(videos_today, coalesce(sum(d.links) filter (where d.day = today), 0)::int),
         greatest(videos_yesterday, coalesce(sum(d.links) filter (where d.day = today - 1), 0)::int),
         coalesce(sum(d.waitlist), 0)::int
    into videos_today, videos_yesterday, listed_new from public.beta_daily d where d.day >= today - 1;
  select count(*)::int into listed from public.beta_waitlist;
  select * into s from public.beta_settings b where b.id;
  if not found then
    line := format('beta off (no settings row) · accounts %s · sign-ups today %s (yesterday %s)%s · photos %s GB · videos today %s (yesterday %s) · waiting list %s (+%s since yesterday)',
      accounts + invited, signups_today, signups_yesterday, via_shares, round(photos / 1073741824.0, 1), videos_today, videos_yesterday, listed, listed_new);
    return jsonb_build_object('title', 'Reelbook beta', 'message', line, 'tags', '[]'::jsonb, 'priority', 3);
  end if;
  -- the highest share of a limit (a limit of 0 is a closure, not a share: left out)
  ratio := greatest((s.seats_offset + accounts)::numeric / nullif(s.seats_total, 0),
                    greatest(signups_today, signups_yesterday)::numeric / nullif(s.signups_per_day, 0),
                    photos::numeric / nullif(s.max_photos_gb::bigint * 1073741824, 0),
                    greatest(videos_today, videos_yesterday)::numeric / nullif(s.max_videos_per_day, 0));
  line := format('seats %s/%s%s · sign-ups today %s/%s (yesterday %s)%s · photos %s/%s GB · videos today %s/%s (yesterday %s) · waiting list %s (+%s since yesterday)',
    s.seats_offset + accounts, s.seats_total, via_invites, signups_today, s.signups_per_day, signups_yesterday, via_shares,
    round(photos / 1073741824.0, 1), s.max_photos_gb, videos_today, s.max_videos_per_day, videos_yesterday, listed, listed_new);
  return jsonb_build_object('title', 'Reelbook beta', 'message', line,
    'tags', case when ratio >= 0.7 then '["70%"]'::jsonb else '[]'::jsonb end,
    'priority', case when ratio >= 0.9 then 4 else 3 end);
end $$;

-- Internal: the alert and its count, never a client.
revoke execute on function public.beta_signups_ref(timestamptz) from public, anon, authenticated;
revoke execute on function public.beta_alert_message() from public, anon, authenticated;
-- Public: the waiting-list forms (the landing, #setup, a link's page).
revoke execute on function public.join_waitlist(text, text, text, boolean, text) from public;
grant execute on function public.join_waitlist(text, text, text, boolean, text) to anon, authenticated;
revoke execute on function public.join_waitlist(text, text, text, boolean, text, text) from public;
grant execute on function public.join_waitlist(text, text, text, boolean, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Glossary (P11 G1): the notebook explains its own words. One row per entry of a notebook of an account: a word in
-- one sense, its definition, the exact strings to underline (forms) and, per sheet, the place to underline (a verbatim
-- quote of the sheet's text). Contract: docs/audit-design/P11-glossary.md › Data contract.
--   - Written by tools/rb.py signed in as the account (`rb.py glossary put`, run by the glossary pass): it inserts an
--     entry, or adds sheets to one that exists; it never deletes a row.
--   - Read only by the app (underlines in a sheet, the definition, the notebook's Glossary page): the app never writes
--     here, the reader can neither remove, edit nor add a word.
--   - theme is user_themes.id, a slug of sheets or photo is sheets.slug: no foreign key on purpose. A slug that no
--     longer exists is ignored by every reader; nothing cascades from sheets. Deleting the account deletes its rows.
-- Added after the attribution: re-run this whole file to create it (idempotent, additive: nothing else changes).
-- Current accounts: nothing changes, the table is new and empty until a pass writes to it.
-- A backend without it keeps working: the app shows no glossary and no error, `rb.py glossary get` prints an empty one.
-- ---------------------------------------------------------------------------

create table if not exists public.glossary_words (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  theme      text not null,     -- the notebook (user_themes.id)
  term       text not null,     -- canonical form, in the sheets' language
  sense      text,              -- short label when the notebook has another entry with the same term
  forms      jsonb not null default '[]'::jsonb,  -- ["…", "…"]: the exact strings that can be underlined
  kind       text,              -- kept as data, never shown
  definition text not null,     -- one or two sentences
  confidence text not null check (confidence in ('sure', 'unsure')),
  doubt      text,              -- one sentence for the reader, when unsure
  spelling   text,              -- a faulty spelling found in a sheet
  photo      jsonb,             -- {"slug": "<sheet slug>", "file": "<file under img/>"}, one photo at most
  related    jsonb not null default '[]'::jsonb,  -- ["term", "term (sense)"]
  sheets     jsonb not null default '[]'::jsonb,  -- [{slug, quote, where}]; where: text | title | caption | chip
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One entry per word and sense in a notebook, the term and the sense whatever their case: the identity `rb.py` gives
-- an entry (_glossary_key ignores the case of both), so two `glossary put` at once cannot insert « le kite » and
-- « Le Kite » as two rows for one word (the second is refused, 23505, and `rb.py` merges into the first).
-- The first version of this index (glossary_words_one_entry) compared the sense as written: it is dropped once the
-- new one exists, so a backend that had it is never without the rule, and a re-run rebuilds nothing.
create unique index if not exists glossary_words_one_entry_ci
  on public.glossary_words (user_id, theme, lower(term), lower(coalesce(sense, '')));
drop index if exists public.glossary_words_one_entry;

drop trigger if exists glossary_words_touch on public.glossary_words;
create trigger glossary_words_touch before update on public.glossary_words
  for each row execute function public.touch_updated_at();

alter table public.glossary_words enable row level security;
drop policy if exists "own glossary words" on public.glossary_words;
create policy "own glossary words" on public.glossary_words
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The account on its own rows (RLS above decides which): `rb.py glossary put` inserts and updates, the app only selects.
-- Nothing for anon.
grant select, insert, update, delete on public.glossary_words to authenticated;

-- Which sheets the glossary pass has read (P11 G2a, decision 9): one row per sheet of a notebook of an account, with
-- the sheet's updated_at when the pass read it. A sheet needs the pass when it has no row here, or when its updated_at
-- is later than sheet_updated_at (it was republished). A sheet where the pass found no word gets its row too, so it is
-- not read again every night. Contract: docs/audit-design/P11-glossary.md › Data contract › Which sheets had the pass.
--   - Written by tools/rb.py signed in as the account (`rb.py glossary put`, after the entries are written): one
--     upsert on the primary key, so two commands at once (the computer and the hosted worker) leave one row per sheet.
--   - Read by tools/rb.py only (`glossary sheets --pending`, `glossary pending`); the app does not use this table.
--   - theme is user_themes.id, slug is sheets.slug: no foreign key on purpose, as glossary_words. A row whose sheet no
--     longer exists is ignored; nothing in sheets or in `rb.py publish` changes. Deleting the account deletes its rows.
-- Re-run this whole file to create it (idempotent, additive: nothing else changes).
-- Current accounts: nothing changes, the table is new and empty until a pass records a sheet; until then every sheet
-- of a technique notebook counts as not read yet.
-- A backend without it keeps working: `glossary put` writes the entries and says that passes are not recorded,
-- `glossary sheets --pending` and `glossary pending` take every sheet as not read yet.
create table if not exists public.glossary_passes (
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  theme            text not null,          -- the notebook (user_themes.id)
  slug             text not null,          -- the sheet (sheets.slug)
  sheet_updated_at timestamptz not null,   -- sheets.updated_at when the pass read the sheet
  passed_at        timestamptz not null default now(),
  primary key (user_id, theme, slug)
);

alter table public.glossary_passes enable row level security;
drop policy if exists "own glossary passes" on public.glossary_passes;
create policy "own glossary passes" on public.glossary_passes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The account on its own rows (RLS above decides which): `rb.py glossary put` upserts, the readers select.
-- Nothing for anon.
grant select, insert, update, delete on public.glossary_passes to authenticated;

-- service_role, for the Edge Function share (P11 G5, supabase/functions/share/words.ts): a session sent to a partner
-- carries the glossary words of its sheets. Once the copy is done, the function reads the sender's entries of the
-- copied sheets, inserts the entries the recipient does not have, and adds forms and sheets to those the recipient
-- has (update). It never deletes. It has no right on glossary_passes and needs none: a copied sheet stays to read,
-- the recipient's own pass reads it. RLS does not apply to service_role. Here and not in the share section: this
-- table is created after it.
-- Re-run this whole file (idempotent, additive). Current accounts and shares already made: nothing changes; the
-- function without this right, or without this table, shares the session, sheets and photos as before.
grant select, insert, update on public.glossary_words to service_role;
