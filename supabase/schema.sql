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
  note         text,            -- error details
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
  select * into s from public.beta_settings b where b.id;
  if not found then return new; end if;
  perform pg_advisory_xact_lock(hashtext('reelbook beta'), hashtext('links'));
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
-- The schedule only exists where pg_cron and pg_net are enabled (Dashboard › Database › Extensions): without them
-- the block at the end does nothing and the rest of this file runs as before (own backends). Enable both BEFORE
-- running this file, or run it again after enabling them.
-- The ntfy topic is a secret (anybody who knows it reads the notifications): it lives in Supabase Vault, named
-- reelbook_ntfy_topic, never in this file nor in a table clients can read. Paste it yourself in the SQL editor:
--   select vault.create_secret('<your topic>', 'reelbook_ntfy_topic');
-- (a topic name; a full https://… URL also works, its last segment is the topic). Without it the job fails at each
-- run with « beta alert: no topic » (Integrations › Cron › the job's runs) and sends nothing.
-- pg_cron runs in UTC: the job runs at 06:00 and 07:00 UTC and sends once, at the run that is 08:00 in Zurich
-- (summer and winter time). By hand, at any hour: select public.beta_alert();
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
  select coalesce(sum(d.links) filter (where d.day = today), 0)::int,
         coalesce(sum(d.links) filter (where d.day = today - 1), 0)::int,
         coalesce(sum(d.waitlist), 0)::int
    into videos_today, videos_yesterday, listed_new from public.beta_daily d where d.day >= today - 1;
  select count(*)::int into listed from public.beta_waitlist;
  select * into s from public.beta_settings b where b.id;
  if not found then
    -- beta_daily counts links only once the row exists: here, the links still there (a deleted one is not counted)
    select (count(*) filter (where r.created_at >= midnight))::int, (count(*) filter (where r.created_at < midnight))::int
      into videos_today, videos_yesterday from public.requests r where r.created_at >= midnight - interval '1 day';
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

-- The schedule, only with both extensions (cron.schedule with an existing name updates that job: re-runs are safe).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('reelbook-daily-alert', '0 6,7 * * *', 'select public.beta_alert(true)');
  end if;
end $$;
