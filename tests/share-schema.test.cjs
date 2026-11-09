// P8 R11: static checks of the session_shares section of supabase/schema.sql (no database in CI). The section was run
// twice on a throwaway Supabase Postgres, with the checks listed in progress/2026-11-09-R11.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');
const flat = sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n').replace(/\s+/g, ' ');
const at = s => { const i = flat.indexOf(s); assert.ok(i >= 0, s); return i; };

test('the table: a 22-character URL-safe token made by the database, the owner by default, a first name of 1 to 40', () => {
  at('create table if not exists public.session_shares (');
  at("token text primary key default translate(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/=', '-_') check (token ~ '^[A-Za-z0-9_-]{22}$')");
  at('owner uuid not null default auth.uid() references auth.users (id) on delete cascade');
  at('sender_name text not null check (char_length(sender_name) between 1 and 40)');
  at('revoked_at timestamptz );');
});

test('a share belongs to the session id, not its slug: deleting the session deletes its shares (Codex #114: a reused slug)', () => {
  at('session_id uuid references public.sessions (id) on delete cascade, sender_name');
  at('alter table public.session_shares add column if not exists session_id uuid references public.sessions (id) on delete cascade;');
  at('update public.session_shares set revoked_at = now() where session_id is null and revoked_at is null;');
  const guard = sql.slice(sql.indexOf('create or replace function public.session_shares_guard()'), sql.indexOf('drop trigger if exists session_shares_guard'));
  for (const s of ['new.session_id := (select s.id from public.sessions s where s.user_id = new.owner and s.slug = new.session_slug);',
    "raise exception 'session_shares: no such session'", 'new.session_id := old.session_id;'])
    assert.ok(guard.includes(s), s);
  assert.ok(!/grant [^;]*session_id[^;]* on public\.session_shares to authenticated/.test(flat), 'the app never writes session_id');
});

test('one live token per (owner, session): sharing again finds the same row', () => {
  at('create unique index if not exists session_shares_one_live on public.session_shares (owner, session_slug) where revoked_at is null;');
});

test('RLS: the owner reads, shares its own sessions only, and revokes; nobody else, no delete, no anon', () => {
  at('alter table public.session_shares enable row level security;');
  at('create policy "own session shares read" on public.session_shares for select to authenticated using (owner = auth.uid());');
  at('create policy "own session shares insert" on public.session_shares for insert to authenticated with check (owner = auth.uid() and exists (select 1 from public.sessions s where s.user_id = auth.uid() and s.slug = session_slug));');
  at('create policy "own session shares revoke" on public.session_shares for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());');
  at('revoke all on public.session_shares from anon, authenticated;');
  at('grant insert (session_slug, sender_name), update (revoked_at) on public.session_shares to authenticated;');
  assert.ok(!/grant [^;]*delete[^;]* on public\.session_shares/.test(flat), 'no delete: a revoked token stays');
});

test('the guard: token, owner, session, name and dates are the database\'s; a revoked token stays revoked', () => {
  const body = sql.slice(sql.indexOf('create or replace function public.session_shares_guard()'), sql.indexOf('drop trigger if exists session_shares_guard'));
  for (const s of ['new.token := old.token', 'new.owner := old.owner', 'new.session_slug := old.session_slug', 'new.sender_name := old.sender_name',
    'when old.revoked_at is not null then old.revoked_at', 'when new.revoked_at is not null then now()', 'new.revoked_at := null'])
    assert.ok(body.includes(s), s);
  at('create trigger session_shares_guard before insert or update on public.session_shares for each row execute function public.session_shares_guard();');
});

test('one copy per (recipient, token), marked in sessions.source', () => {
  at("create unique index if not exists sessions_one_copy_per_share on public.sessions (user_id, (source->>'share')) where (source->>'share') is not null;");
});

test('Codex #114 pass 2: one copy at a time per recipient (at most one reservation per account), so the quota check reads a stable state', () => {
  at("create unique index if not exists sessions_one_copying on public.sessions (user_id) where (source->>'share_state') = 'copying';");
});

test('the planning functions run for service_role only, and read photos under the owner folder of the sheets bucket only', () => {
  at('drop function if exists public.share_recipient(uuid, text[], text[]);');
  for (const sig of ['share_files(uuid, text[])', 'share_recipient(uuid, text[], text[], text)']) {
    at(`revoke execute on function public.${sig} from public, anon, authenticated;`);
    at(`grant execute on function public.${sig} to service_role;`);
  }
  const files = sql.slice(sql.indexOf('create or replace function public.share_files'), sql.indexOf('create or replace function public.share_recipient'));
  assert.ok(files.includes("o.bucket_id = 'sheets' and o.name like p_owner::text || '/%'"));
  const rec = sql.slice(sql.indexOf('create or replace function public.share_recipient'), sql.indexOf('revoke execute on function public.share_files'));
  for (const s of ['public.quota_limits(p_uid)', 'public.quota_usage(p_uid)', 'public.beta_upload_ok(p_uid)', "o.name like p_uid::text || '/%'"]) assert.ok(rec.includes(s), s);
  assert.ok(!/practice_log/.test(files + rec), 'never the log');
  // the notes: only their keys, for the slugs they keep (Codex #114: an old note on a new session), never their text
  assert.ok(!/\bbody\b/.test(rec) && !/public\.notes/.test(files), 'never the text of a note');
  for (const s of ["n.slug ~ '^session/[^/]+(/[1-9][0-9]*)?$' and split_part(n.slug, '/', 2) like ses_pat", "n.slug not like 'session/%' and n.slug like b.pat", "'ses_taken', ses_taken"])
    assert.ok(rec.includes(s), s);
  // collisions by stem (the slug as the function cuts it), not by the full slug (Codex #114: an 80-character slug)
  assert.ok(rec.includes("|| '%' as pat from unnest(p_stems) x") && !rec.includes("b.pat || '-%'"), 'like <stem>%');
});

test('the section comes last, after the quotas and beta locks it calls', () => {
  assert.ok(at('create table if not exists public.session_shares') > at('create or replace function public.beta_upload_ok'));
  assert.ok(at('create table if not exists public.session_shares') > at('create or replace function public.quota_usage'));
});
