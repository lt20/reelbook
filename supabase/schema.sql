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
