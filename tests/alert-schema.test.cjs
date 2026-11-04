// L33: static checks of the daily ntfy alert in supabase/schema.sql (no database in CI). The SQL itself was run on
// PGlite (no pg_cron / pg_net: the guard path; Vault and pg_net stubbed for the send) by the lot: see the PR.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');
const start = sql.indexOf('-- Daily alert (L33)');
const alert = sql.slice(start);
const code = alert.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');   // statements, comments out
const flat = code.replace(/\s+/g, ' ');
const fn = name => {
  const i = flat.indexOf(`create or replace function public.${name}(`);
  assert.ok(i > -1, name);
  return flat.slice(i, flat.indexOf('$$;', flat.indexOf('$$', i) + 2) + 3);
};

test('the alert section exists, after the beta locks (it reads their tables), at the end of the file', () => {
  assert.ok(start > -1);
  assert.ok(start > sql.indexOf('create or replace function public.join_waitlist'));
  assert.ok(start > sql.indexOf('create table if not exists public.beta_daily'));
});

test('guarded: the schedule only runs with pg_cron and pg_net, so the file runs without them', () => {
  const blocks = [...flat.matchAll(/do \$\$ (.*?) end \$\$;/g)].map(m => m[1]);
  assert.equal(blocks.length, 1, 'one guarded block');
  assert.match(blocks[0], /^begin if exists \(select 1 from pg_extension where extname = 'pg_cron'\) and exists \(select 1 from pg_extension where extname = 'pg_net'\) then perform cron\.schedule\(/);
  assert.equal((flat.match(/\bcron\./g) || []).length, 1, 'cron.* only inside the guarded block');
  assert.doesNotMatch(code, /create extension/i, 'Laurent enables the extensions, never the file');
  // net.* and vault.* only inside beta_alert (plpgsql resolves them when it runs, not when it is created)
  const send = fn('beta_alert');
  for (const ref of [...flat.matchAll(/\b(net|vault)\.\w+/g)]) assert.ok(send.includes(ref[0]), ref[0]);
  assert.match(send, /if to_regclass\('vault\.decrypted_secrets'\) is null or to_regnamespace\('net'\) is null then raise exception/);
});

test('the job: its name, twice a day in UTC, sends once at 08:00 Zurich', () => {
  assert.match(flat, /perform cron\.schedule\('reelbook-daily-alert', '0 6,7 \* \* \*', 'select public\.beta_alert\(true\)'\);/);
  assert.match(fn('beta_alert'), /if at_8_only and extract\(hour from now\(\) at time zone 'Europe\/Zurich'\) <> 8 then return null; end if;/);
  assert.match(sql, /select cron\.unschedule\('reelbook-daily-alert'\)/, 'the comment says how to stop it');
});

test('the topic: read from Vault by name, never written by the file, never a literal', () => {
  const send = fn('beta_alert');
  assert.match(send, /select btrim\(v\.decrypted_secret\) into topic from vault\.decrypted_secrets v where v\.name = 'reelbook_ntfy_topic'/);
  assert.match(send, /raise exception using errcode = 'P0001', message = 'beta alert: no topic'/);
  assert.doesNotMatch(code, /vault\.update_secret\(/);
  for (const m of code.matchAll(/vault\.create_secret\((''|')([^']*)/g)) {   // only in the hint, with the placeholder
    assert.equal(m[2], '<your topic>', 'only Laurent stores the topic');
  }
  assert.equal((flat.match(/vault\.create_secret\(/g) || []).length, 1);
  assert.match(flat, /hint = 'Store it once in the SQL editor: select vault\.create_secret\(''<your topic>'', ''reelbook_ntfy_topic''\);';/,
    'the one create_secret is text in the hint, never run by the file');
  assert.doesNotMatch(code, /'topic', '/, 'no topic literal in the body');
  // every ntfy URL in the whole file is the bare server, never server/topic
  for (const m of sql.matchAll(/https?:\/\/ntfy\.[a-z.]+(\/\S*)?/g)) assert.ok(!m[1] || m[1] === '/', m[0]);
  assert.match(alert, /vault\.create_secret\('<your topic>', 'reelbook_ntfy_topic'\)/, 'the placeholder, as in the PR');
  assert.doesNotMatch(sql, /alter table public\.beta_settings add/, 'not a column of a table');
});

test('the send: one JSON POST to ntfy, through pg_net, with the message and the topic', () => {
  const send = fn('beta_alert');
  assert.match(send, /^create or replace function public\.beta_alert\(at_8_only boolean default false\) returns bigint language plpgsql volatile security definer set search_path = ''/);
  assert.match(send, /server text := 'https:\/\/ntfy\.sh';/);
  assert.match(send, /return net\.http_post\(url := server, body := public\.beta_alert_message\(\) \|\| jsonb_build_object\('topic', topic\), headers := '\{"Content-Type": "application\/json"\}'::jsonb\);/);
});

test('the message: counts only, never an email nor a first name', () => {
  const m = fn('beta_alert_message');
  assert.match(m, /^create or replace function public\.beta_alert_message\(\) returns jsonb language plpgsql stable security definer set search_path = ''/);
  assert.doesNotMatch(m, /email|first_name|raw_user_meta_data|phone|user_id|\bu\.id\b|\bname\b(?!\s*=)/i, 'no personal column read');
  const reads = [...m.matchAll(/from (\w+\.\w+)/g)].map(x => x[1]).sort();
  assert.deepEqual([...new Set(reads)], ['public.beta_daily', 'public.beta_settings', 'public.beta_waitlist', 'storage.objects']);
  assert.match(m, /select count\(\*\)::int into listed from public\.beta_waitlist;/, 'the waiting list as a number');
  assert.match(m, /coalesce\(sum\(d\.waitlist\), 0\)::int into videos_today, videos_yesterday, listed_new from public\.beta_daily d where d\.day >= today - 1;/,
    'new entries: beta_daily.waitlist, yesterday and today');
  for (const k of ["'title', 'Reelbook beta'", "'message', line", "'tags',", "'priority',"]) assert.ok(m.includes(k), k);
  assert.doesNotMatch(m, /jsonb_build_object\([^)]*'(email|first_name|id)'/);
});

test('the message: every figure of the spec, the 70 % tag and the 90 % priority', () => {
  const m = fn('beta_alert_message');
  for (const part of ['seats %s/%s', 'sign-ups today %s/%s (yesterday %s)', 'photos %s/%s GB', 'videos today %s/%s (yesterday %s)', 'waiting list %s (+%s since yesterday)']) {
    assert.ok(m.includes(part), part);
  }
  assert.match(m, /ratio := greatest\(\(s\.seats_offset \+ accounts\)::numeric \/ nullif\(s\.seats_total, 0\), greatest\(signups_today, signups_yesterday\)::numeric \/ nullif\(s\.signups_per_day, 0\), photos::numeric \/ nullif\(s\.max_photos_gb::bigint \* 1073741824, 0\), greatest\(videos_today, videos_yesterday\)::numeric \/ nullif\(s\.max_videos_per_day, 0\)\);/);
  assert.match(m, /'tags', case when ratio >= 0\.7 then '\["70%"\]'::jsonb else '\[\]'::jsonb end, 'priority', case when ratio >= 0\.9 then 4 else 3 end\)/);
  assert.match(m, /if not found then line := format\('beta off \(no settings row\)/, 'without the settings row: counts, no limits');
});

test('both functions closed to clients; nothing dropped, nothing deleted, no table added', () => {
  assert.match(flat, /revoke execute on function public\.beta_alert_message\(\) from public, anon, authenticated;/);
  assert.match(flat, /revoke execute on function public\.beta_alert\(boolean\) from public, anon, authenticated;/);
  assert.doesNotMatch(flat, /grant execute on function public\.beta_alert/);
  assert.doesNotMatch(code, /\b(drop|truncate|delete from|create table|alter table)\b/i);
  const fns = [...code.matchAll(/create or replace function (public\.\w+)\(/g)].map(m => m[1]).sort();
  assert.deepEqual(fns, ['public.beta_alert', 'public.beta_alert_message']);
});
