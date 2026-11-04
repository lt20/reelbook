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
-- per key). Added after the quotas, written before their section (which closes the file): re-run this whole file to
-- create it (idempotent, additive: nothing else changes).
-- A backend without it keeps working: Settings hides the « iPhone shortcut » section.
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
