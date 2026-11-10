// P8 R13: static checks of the attribution section of supabase/schema.sql (no database in CI). The SQL itself was run
// twice on a throwaway supabase/postgres container, then tests/sql/r13-attribution.sql (the alert line with and
// without origins and admissions, the waiting list's ref, the rights): see progress/2026-11-09-R13.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');
const start = sql.indexOf('-- Attribution (P8 R13)');
const next = sql.indexOf('-- Glossary (P11 G1)', start);   // P11 G1's section follows (tests/glossary-schema.test.cjs)
const section = sql.slice(start, next > start ? next : undefined);
const code = section.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const flat = code.replace(/\s+/g, ' ');
const fnAt = (name, from = 0) => {   // the body of one function, from its create to its closing $$;
  const i = flat.indexOf(`create or replace function public.${name}(`, from);
  assert.ok(i > -1, name);
  return flat.slice(i, flat.indexOf('$$;', flat.indexOf('$$', i) + 2) + 3);
};
const ORIGIN = "'^([a-z0-9-]{1,32}|[A-Za-z0-9_-]{22})$'";

test('the section is the last one that defines a function, after the alert, the beta locks and the invitations it redefines', () => {
  assert.ok(start > -1);
  for (const s of ['-- Daily alert (L33)', '-- Invitations (P8 R12)', '-- Technique family (P8 R14)', '-- Session shares (P8 R11)']) assert.ok(start > sql.indexOf(s), s);
  // what follows it (the glossary's table, P11 G1) defines no function: nothing redefines what this section redefined
  assert.doesNotMatch(next > start ? sql.slice(next) : '', /create\s+(or\s+replace\s+)?function/i, 'no function after it');
});

test('additive and idempotent: one nullable column, nothing dropped, deleted or inserted', () => {
  assert.doesNotMatch(code, /\b(drop|truncate|delete from|insert into|create table)\b/i);
  assert.deepEqual([...flat.matchAll(/alter table (\S+) add column (if not exists )?(\w+)/g)].map(m => [m[1], m[2], m[3]]),
    [['public.beta_waitlist', 'if not exists ', 'ref']]);
  assert.match(flat, new RegExp(`add column if not exists ref text check \\(ref ~ ${ORIGIN.replace(/[()[\]{}^$|?*+.\\]/g, '\\$&')}\\);`));
  assert.doesNotMatch(flat, /ref text not null/);
  for (const m of code.matchAll(/create (or replace )?function (\S+?)\(/g)) assert.ok(m[1], `${m[2]}: create or replace`);
  assert.doesNotMatch(sql, /alter table public\.beta_settings add/, 'never a beta_settings column (alert-schema.test.cjs)');
});

test('join_waitlist: the five-argument form kept (same name, same signature) and the token as the origin; six arguments add the code', () => {
  const five = fnAt('join_waitlist');
  assert.match(five, /^create or replace function public\.join_waitlist\(first_name text, email text, lang text, consent boolean, share_token text\) returns text language plpgsql volatile security definer set search_path = ''/);
  assert.match(five, /r := public\.join_waitlist\(join_waitlist\.first_name, join_waitlist\.email, join_waitlist\.lang, join_waitlist\.consent\);/, 'the four-argument checks and answers');
  assert.ok(five.includes('update public.beta_waitlist w set share_token = tok where lower(w.email) = lower(mail) and w.share_token is null;'), 'R12 unchanged');
  assert.ok(five.includes('update public.beta_waitlist w set ref = tok where lower(w.email) = lower(mail) and w.ref is null;'), 'first origin wins');
  const six = fnAt('join_waitlist', flat.indexOf(five) + five.length);
  assert.match(six, /^create or replace function public\.join_waitlist\(first_name text, email text, lang text, consent boolean, share_token text, ref text\) returns text language plpgsql volatile security definer set search_path = ''/);
  assert.match(six, /r := public\.join_waitlist\(join_waitlist\.first_name, join_waitlist\.email, join_waitlist\.lang, join_waitlist\.consent, join_waitlist\.share_token\);/);
  assert.ok(six.includes("if code ~ '^[a-z0-9-]{1,32}$' then update public.beta_waitlist w set ref = code where lower(w.email) = lower(mail) and w.ref is null;"));
  assert.ok(six.indexOf('pg_advisory_xact_lock') < six.indexOf('r := public.join_waitlist'), 'the waiting-list lock first');
  for (const sig of ['join_waitlist(text, text, text, boolean, text)', 'join_waitlist(text, text, text, boolean, text, text)']) {
    assert.ok(flat.includes(`revoke execute on function public.${sig} from public;`), sig);
    assert.ok(flat.includes(`grant execute on function public.${sig} to anon, authenticated;`), sig);
  }
});

test('the origin count: the ref only, of the right form, counted like the sign-ups; internal', () => {
  const f = fnAt('beta_signups_ref');
  assert.match(f, /^create or replace function public\.beta_signups_ref\(since timestamptz\) returns int language sql stable security definer set search_path = ''/);
  assert.ok(f.includes(`u.raw_user_meta_data->>'ref' ~ ${ORIGIN}`));
  assert.ok(f.includes("(u.email_confirmed_at is not null or u.phone_confirmed_at is not null or u.created_at > now() - interval '1 hour')"));
  assert.ok(f.includes("not exists (select 1 from public.account_quotas q where q.user_id = u.id and lower(q.note) like 'exempt%')"));
  assert.doesNotMatch(f.replace("raw_user_meta_data->>'ref'", ''), /email(?!_confirmed_at)|first_name|raw_user_meta_data|share_name/, 'nothing else of the account');
  assert.ok(flat.includes('revoke execute on function public.beta_signups_ref(timestamptz) from public, anon, authenticated;'));
  assert.doesNotMatch(flat, /grant execute on function public\.beta_signups_ref/);
});

test('the alert line: « via invites: n » after the seats, « via shares: n » after the sign-ups, each only above 0; counts only', () => {
  const m = fnAt('beta_alert_message');
  assert.match(m, /^create or replace function public\.beta_alert_message\(\) returns jsonb language plpgsql stable security definer set search_path = ''/);
  assert.doesNotMatch(m, /email|first_name|raw_user_meta_data|phone|user_id|\bu\.id\b|share_name|\bref\b(?!\()/i, 'no personal column read, not even the ref itself');
  assert.ok(m.includes("invited int := public.beta_signups('-infinity') - public.beta_accounts();"), 'the admitted accounts holding an invite');
  assert.ok(m.includes('signups_today int := public.beta_signups(midnight);'), 'the sign-ups of the day count the admitted accounts, as lock 2');
  assert.ok(m.includes("signups_yesterday int := public.beta_signups(midnight - interval '1 day') - public.beta_signups(midnight);"));
  assert.ok(m.includes("shared int := public.beta_signups_ref(midnight - interval '1 day');"), 'the window of the sign-up figures');
  assert.ok(m.includes("via_shares text := case when shared > 0 then format(' · via shares: %s', shared) else '' end;"));
  assert.ok(m.includes("via_invites text := case when invited > 0 then format(' · via invites: %s', invited) else '' end;"));
  assert.ok(m.includes("line := format('seats %s/%s%s · sign-ups today %s/%s (yesterday %s)%s · photos %s/%s GB · videos today %s/%s (yesterday %s) · waiting list %s (+%s since yesterday)', s.seats_offset + accounts, s.seats_total, via_invites, signups_today, s.signups_per_day, signups_yesterday, via_shares,"));
  assert.ok(m.includes("line := format('beta off (no settings row) · accounts %s · sign-ups today %s (yesterday %s)%s · photos %s GB · videos today %s (yesterday %s) · waiting list %s (+%s since yesterday)', accounts + invited, signups_today, signups_yesterday, via_shares,"));
  // the rest as L33's: the seats ratio still on the seats (admitted accounts take none), the tag and the priority
  assert.ok(m.includes('ratio := greatest((s.seats_offset + accounts)::numeric / nullif(s.seats_total, 0), greatest(signups_today, signups_yesterday)::numeric / nullif(s.signups_per_day, 0),'));
  assert.match(m, /'tags', case when ratio >= 0\.7 then '\["70%"\]'::jsonb else '\[\]'::jsonb end, 'priority', case when ratio >= 0\.9 then 4 else 3 end\)/);
  const reads = [...m.matchAll(/from (\w+\.\w+)/g)].map(x => x[1]).sort();
  assert.deepEqual([...new Set(reads)], ['public.beta_daily', 'public.beta_settings', 'public.beta_waitlist', 'public.requests', 'storage.objects']);
  assert.ok(flat.includes('revoke execute on function public.beta_alert_message() from public, anon, authenticated;'));
  assert.doesNotMatch(flat, /grant execute on function public\.beta_alert/);
});
