// P8 R12: static checks of the invitations section of supabase/schema.sql (no database in CI). The SQL itself was run
// twice on a throwaway supabase/postgres container, then tests/sql/r12-invites.sql (admission when full, third admission
// refused, admitted accounts out of the seats, waiting list keeps the token): see progress/2026-11-09-R12.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');
const start = sql.indexOf('-- Invitations (P8 R12)');
const next = sql.indexOf('-- Attribution (P8 R13)', start);   // R13's section follows (tests/attribution-schema.test.cjs)
const section = sql.slice(start, next > start ? next : undefined);
const code = section.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const flat = code.replace(/\s+/g, ' ');
const fn = name => {   // the body of one function, from its create to its closing $$;
  const i = flat.indexOf(`create or replace function public.${name}(`);
  assert.ok(i > -1, name);
  return flat.slice(i, flat.indexOf('$$;', flat.indexOf('$$', i) + 2) + 3);
};
const SEATED = "(u.email_confirmed_at is not null or u.phone_confirmed_at is not null or u.created_at > now() - interval '1 hour')";

test('the section comes after the beta locks and the session shares it reads', () => {
  assert.ok(start > -1);
  assert.ok(start > sql.indexOf('create table if not exists public.session_shares'));
  assert.ok(start > sql.indexOf('create or replace function public.beta_on_signup'));
  assert.ok(start > sql.indexOf('create or replace function public.join_waitlist'));
});

test('additive and idempotent: nothing dropped; the only delete is the waiting list (moved token) and the pending token acknowledged', () => {
  assert.doesNotMatch(code, /\bdrop\s+(table|column|function|index|schema|policy|trigger)\b/i);
  assert.doesNotMatch(code, /\b(truncate|alter\s+table\s+\S+\s+drop)\b/i);
  assert.deepEqual([...flat.matchAll(/delete from (\S+)/g)].map(m => m[1]), ['public.beta_waitlist', 'public.share_pending']);
  for (const m of code.matchAll(/create (?:unique )?index (\S+ \S+ \S+)/g)) assert.match(m[1], /^if not exists/, m[0]);
  for (const m of code.matchAll(/create table (\S+ \S+ \S+)/g)) assert.match(m[1], /^if not exists/, m[0]);
  for (const m of code.matchAll(/add column (\S+ \S+ \S+)/g)) assert.match(m[1], /^if not exists/, m[0]);
  for (const m of code.matchAll(/create (or replace )?function (\S+?)\(/g)) assert.ok(m[1], `${m[2]}: create or replace`);
  assert.doesNotMatch(code, /insert into public\.beta_settings/, 'the settings row stays Laurent\'s');
});

test('share_admissions: one per account, its owner and token; no client reaches it', () => {
  assert.match(flat, /create table if not exists public\.share_admissions \( account uuid primary key references auth\.users \(id\) on delete cascade deferrable initially deferred, owner uuid not null references auth\.users \(id\) on delete cascade, token text not null/);
  assert.match(flat, /alter table public\.share_admissions enable row level security;/);
  assert.match(flat, /revoke all on public\.share_admissions from anon, authenticated;/);
  assert.match(flat, /alter table public\.beta_waitlist add column if not exists share_token text check/);
});

test('an invite is held like a seat: confirmed, or pending for an hour', () => {
  const used = fn('share_invites_used');
  assert.ok(used.includes(SEATED));
  assert.match(used, /where a\.owner = uid/);
});

test('admitted accounts take no seat, but count in the sign-ups of the day', () => {
  const seats = fn('beta_accounts');
  assert.match(seats, /not exists \(select 1 from public\.share_admissions a where a\.account = u\.id\)/);
  assert.match(seats, /lower\(q\.note\) like 'exempt%'/, 'the exempt ones stay out too');
  const day = fn('beta_signups');
  assert.doesNotMatch(day, /share_admissions/);
  assert.ok(day.includes(SEATED));
  assert.match(fn('beta_seats'), /public\.beta_signups\(date_trunc\('day', now\(\) at time zone 'utc'\) at time zone 'utc'\) as today/);
});

test('lock 2: same lock and messages; only « beta: full » lets a live invite with an invite left through, and records it', () => {
  const lock = fn('beta_on_signup');
  assert.match(lock, /pg_advisory_xact_lock\(hashtext\('reelbook beta'\), hashtext\('signup'\)\)/);
  const closed = lock.indexOf("message = 'beta: closed',"), full = lock.indexOf("message = 'beta: full'"), today = lock.indexOf("message = 'beta: closed today'");
  assert.ok(closed > -1 && closed < full && full < today, 'closed, then full, then the day: closed and the day still refuse an invited sign-up');
  assert.match(lock, /tok := new\.raw_user_meta_data->>'invite';/);
  assert.match(lock, /sh\.token = tok and sh\.revoked_at is null and sh\.session_id is not null/);
  assert.match(lock, /public\.share_invites_used\(host\) >= 2 then raise exception/);
  assert.match(lock, /insert into public\.share_admissions \(account, owner, token\) values \(new\.id, host, tok\);/);
  assert.ok(lock.indexOf('insert into public.share_admissions') < today, 'the admission rolls back with a refusal of the day');
  assert.match(lock, /public\.beta_signups\(date_trunc/);
});

test('the waiting list keeps the token of a live link, on a row that has none (new, or listed before); the four-argument form is untouched', () => {
  const join = fn('join_waitlist');   // the first one in the section: the five-argument form
  assert.match(join, /join_waitlist\(first_name text, email text, lang text, consent boolean, share_token text\)/);
  assert.doesNotMatch(join, /listed := exists/, 'Codex #118 pass 2: an address listed before keeps the link it comes back with');
  assert.match(join, /public\.join_waitlist\(join_waitlist\.first_name, join_waitlist\.email, join_waitlist\.lang, join_waitlist\.consent\)/);
  assert.match(join, /set share_token = tok where lower\(w\.email\) = lower\(mail\) and w\.share_token is null;/, 'a listed row gets a token only when it has none');
  assert.doesNotMatch(join, /set (first_name|lang|consent_at|email)\b/, 'nothing else of a listed row changes');
  assert.ok(!/create or replace function public\.join_waitlist\(first_name text, email text, lang text, consent boolean\)/.test(flat));
  const done = fn('beta_waitlist_done');
  assert.ok(done.indexOf('insert into public.share_pending') < done.indexOf('delete from public.beta_waitlist'), 'the token moves before the row goes');
  assert.match(done, /on conflict \(account\) do nothing/);
});

test('rights: the link\'s page and its form for everybody; Settings and the pending token signed in; the rest internal', () => {
  for (const sig of ['share_invites(text)', 'join_waitlist(text, text, text, boolean, text)', 'beta_seats()'])
    assert.ok(flat.includes(`grant execute on function public.${sig} to anon, authenticated;`), sig);
  for (const sig of ['my_invites()', 'pending_share_invite()', 'ack_share_invite(text)']) {
    assert.ok(flat.includes(`revoke execute on function public.${sig} from public, anon;`), sig);
    assert.ok(flat.includes(`grant execute on function public.${sig} to authenticated;`), sig);
  }
  for (const sig of ['share_invites_used(uuid)', 'beta_signups(timestamptz)', 'beta_accounts(timestamptz)', 'beta_on_signup()', 'beta_waitlist_done()'])
    assert.ok(flat.includes(`revoke execute on function public.${sig} from public, anon, authenticated;`), sig);
  // Codex #118 pass 2: read only; the token goes on an explicit acknowledgement, of that token, by its account
  assert.match(fn('pending_share_invite'), /select p\.token from public\.share_pending p where p\.account = auth\.uid\(\)/);
  assert.doesNotMatch(fn('pending_share_invite'), /delete/);
  assert.match(fn('ack_share_invite'), /delete from public\.share_pending p where p\.account = auth\.uid\(\) and p\.token = p_token;/);
  assert.doesNotMatch(flat, /take_share_invite\(/, 'the destructive first version is gone (never pushed)');
  assert.match(fn('share_invites'), /jsonb_build_object\('left', /);
  assert.doesNotMatch(fn('share_invites'), /a\.account|email/, 'never who was admitted');
});
