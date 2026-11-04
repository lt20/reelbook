// L32: static checks of the beta locks in supabase/schema.sql (no database in CI). The SQL itself was run on a
// local Postgres (PGlite, Supabase auth / storage stubbed) by the lot: see the PR. Here: what must stay true of the text.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');
const start = sql.indexOf('-- Beta locks (L32)');
const beta = sql.slice(start);
const code = beta.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');   // statements, comments out
const flat = code.replace(/\s+/g, ' ');
const fn = name => {   // the body of one function, from its create to its closing $$;
  const i = flat.indexOf(`create or replace function public.${name}(`);
  assert.ok(i > -1, name);
  return flat.slice(i, flat.indexOf('$$;', flat.indexOf('$$', i) + 2) + 3);
};
const midnight = "date_trunc('day', now() at time zone 'utc') at time zone 'utc'";

test('the beta section exists and comes after the quotas (it reads account_quotas)', () => {
  assert.ok(start > sql.indexOf('create table if not exists public.account_quotas'));
  assert.ok(start > sql.indexOf('create or replace function public.my_quota'));
});

test('additive and idempotent: nothing dropped but the triggers it recreates; the only delete is the waiting list at a confirmed sign-up', () => {
  assert.doesNotMatch(code, /\bdrop\s+(table|column|function|index|schema|policy)\b/i);
  assert.doesNotMatch(code, /\b(truncate|alter\s+table\s+\S+\s+drop)\b/i);
  assert.deepEqual([...flat.matchAll(/delete from (\S+)/g)].map(m => m[1]), ['public.beta_waitlist']);
  assert.match(flat, /create table if not exists public\.beta_settings/);
  assert.match(flat, /create table if not exists public\.beta_waitlist/);
  for (const m of code.matchAll(/create (?:unique )?index (\S+ \S+ \S+ \S+)/g)) assert.match(m[1], /^if not exists /, m[0]);
  for (const m of code.matchAll(/create trigger (\w+) [^;]*? on (\S+) for each row/g)) {
    const [whole, name, table] = m;
    const drop = flat.indexOf(`drop trigger if exists ${name} on ${table};`);
    assert.ok(drop > -1 && drop < flat.indexOf(whole.replace(/\s+/g, ' ')), `trigger ${name} dropped if it exists before being created`);
  }
  for (const m of code.matchAll(/create (or replace )?function (\S+?)\(/g)) assert.ok(m[1], `${m[2]}: create or replace`);
});

test('beta_settings: one row at most, the columns of the spec, off by default (no row inserted)', () => {
  assert.match(flat, /id boolean primary key default true check \(id\)/);
  for (const col of ['seats_total int not null default 50', 'seats_offset int not null default 0', 'signups_per_day int not null default 10',
    'max_photos_gb int not null default 10', 'max_videos_per_day int not null default 300', 'signups_open boolean not null default true',
    'captures_open boolean not null default true', 'uploads_open boolean not null default true', 'updated_at timestamptz not null default now()']) {
    assert.ok(flat.includes(col), col);
  }
  assert.doesNotMatch(code, /insert into public\.beta_settings/, 'the row is Laurent\'s step, never the migration\'s');
  assert.match(flat, /create trigger beta_settings_touch before update on public\.beta_settings for each row execute function public\.beta_settings_touch\(\)/);
});

test('beta_waitlist: the columns and checks of the spec, unique per email whatever the case', () => {
  assert.match(flat, /id bigint generated always as identity primary key/);
  assert.match(flat, /first_name text not null check \(char_length\(first_name\) between 1 and 60\)/);
  assert.match(flat, /email text not null check \(char_length\(email\) <= 254 and email ~ '[^']+'\)/);
  assert.match(flat, /lang text check \(lang in \('fr', 'en'\)\)/);
  assert.match(flat, /consent_at timestamptz not null/);
  assert.match(flat, /create unique index if not exists beta_waitlist_email_key on public\.beta_waitlist \(lower\(email\)\)/);
});

test('both tables: RLS on, no policy, no grant to clients', () => {
  for (const t of ['beta_settings', 'beta_waitlist', 'beta_daily']) {
    assert.match(flat, new RegExp(`alter table public\\.${t} enable row level security`), t);
    assert.match(flat, new RegExp(`revoke all on public\\.${t} from anon, authenticated`), t);
    assert.doesNotMatch(flat, new RegExp(`create policy "[^"]+" on public\\.${t}\\b`), t);
    assert.doesNotMatch(flat, new RegExp(`grant [^;]* on (table )?public\\.${t}\\b`), t);
  }
  assert.match(flat, /revoke all on sequence public\.beta_waitlist_id_seq from anon, authenticated/);
});

test('exempt accounts: an account_quotas note starting with « exempt », read by the seat count too', () => {
  assert.match(fn('beta_exempt'), /from public\.account_quotas q where q\.user_id = uid and lower\(q\.note\) like 'exempt%'/);
  assert.match(fn('beta_accounts'), /and not exists \(select 1 from public\.account_quotas q where q\.user_id = u\.id and lower\(q\.note\) like 'exempt%'\)/);
  assert.doesNotMatch(code, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'no user id in the file');
  assert.doesNotMatch(code, /insert into public\.account_quotas/, 'the migration never guesses an account');
});

test('lock 2: before insert on auth.users, off without the row, closed / full / closed today, one sign-up at a time', () => {
  assert.match(flat, /create trigger beta_signup before insert on auth\.users for each row execute function public\.beta_on_signup\(\)/);
  const f = fn('beta_on_signup');
  assert.match(f, /if exists \(select 1 from public\.beta_settings\) then perform pg_advisory_xact_lock\(hashtext\('reelbook beta'\), hashtext\('signup'\)\);/);
  assert.match(f, /if not s\.signups_open then raise exception using errcode = 'P0001', message = 'beta: closed'/);
  assert.match(f, /if s\.seats_offset \+ public\.beta_accounts\(\) >= s\.seats_total then raise exception using errcode = 'P0001', message = 'beta: full'/);
  assert.ok(f.includes(`if public.beta_accounts(${midnight}) >= s.signups_per_day then raise exception using errcode = 'P0001', message = 'beta: closed today'`),
    'sign-ups of the day, UTC, counted like the seats');
  assert.doesNotMatch(f, /delete from/, 'an unconfirmed sign-up deletes nothing');
});

test('who takes a seat: confirmed accounts, or pending ones for an hour; never the exempt ones', () => {
  const f = fn('beta_accounts');
  assert.match(f, /^create or replace function public\.beta_accounts\(since timestamptz default '-infinity'\) returns int language sql stable/);
  assert.match(f, /where u\.created_at >= since and \(u\.email_confirmed_at is not null or u\.phone_confirmed_at is not null or u\.created_at > now\(\) - interval '1 hour'\)/);
  assert.doesNotMatch(f, /is_anonymous|deleted_at/, 'only columns every recent Supabase Auth has');
});

test('the waiting-list row goes once the email is confirmed, not at an unconfirmed sign-up', () => {
  assert.match(flat, /create trigger beta_waitlist_done after insert or update of email, email_confirmed_at on auth\.users for each row execute function public\.beta_waitlist_done\(\)/);
  const f = fn('beta_waitlist_done');
  assert.match(f, /if new\.email is not null and new\.email_confirmed_at is not null and \(tg_op = 'INSERT' or old\.email_confirmed_at is null or new\.email is distinct from old\.email\) then delete from public\.beta_waitlist w where lower\(w\.email\) = lower\(new\.email\);/);
  assert.doesNotMatch(f, /beta_settings/, 'with or without the settings row');
});

test('lock 3 and 4, links: a second before insert trigger on requests, a counter of the day that deletes do not lower', () => {
  assert.match(flat, /create trigger requests_beta before insert on public\.requests for each row execute function public\.beta_on_request\(\)/);
  assert.match(flat, /create table if not exists public\.beta_daily \( day date primary key, links int not null default 0 \)/);
  const f = fn('beta_on_request');
  assert.match(f, /today date := \(now\(\) at time zone 'utc'\)::date;/);
  assert.match(f, /if not found then return new; end if; perform pg_advisory_xact_lock\(hashtext\('reelbook beta'\), hashtext\('links'\)\); if not public\.beta_exempt\(new\.user_id\) then/);
  assert.match(f, /if not s\.captures_open then raise exception using errcode = 'P0001', message = 'beta: paused'/);
  assert.match(f, /select d\.links into n from public\.beta_daily d where d\.day = today;/);
  assert.match(f, /if coalesce\(n, 0\) >= s\.max_videos_per_day then raise exception using errcode = 'P0001', message = 'beta: project limit, try tomorrow'/);
  assert.match(f, /end if; end if; insert into public\.beta_daily as d \(day, links\) values \(today, 1\) on conflict \(day\) do update set links = d\.links \+ 1; return new;/,
    'every link counted, exempt ones too, after the checks');
  assert.doesNotMatch(f, /from public\.requests/, 'not the rows still there: a delete gives no slot back');
});

test('lock 3 and 4, photos: photo_quota_ok calls the beta check, which reads the whole sheets bucket', () => {
  const ph = sql.slice(sql.indexOf('create or replace function public.photo_quota_ok'), sql.indexOf('revoke execute on function public.photo_quota_ok'));
  assert.match(ph.replace(/\s+/g, ' '), /if to_regprocedure\('public\.beta_upload_ok\(uuid\)'\) is not null then perform public\.beta_upload_ok\(uid\); end if; return true;/,
    'after the per-account check; a backend without the beta section keeps uploading');
  const f = fn('beta_upload_ok');
  assert.match(f, /language plpgsql volatile/);
  assert.match(f, /if not found or public\.beta_exempt\(uid\) then return true; end if;/);
  assert.match(f, /if not s\.uploads_open then raise exception using errcode = 'P0001', message = 'beta: paused'/);
  assert.match(f, /from storage\.objects o where o\.bucket_id = 'sheets';/);
  assert.match(f, /if used >= s\.max_photos_gb::bigint \* 1073741824 then raise exception using errcode = 'P0001', message = 'beta: project limit of photos'/);
});

test('beta_seats: taken (offset included), total, open; null without the row; never an email or an id', () => {
  const f = fn('beta_seats');
  assert.match(f, /language sql stable security definer/);
  assert.match(f, /jsonb_build_object\('taken', t\.taken, 'total', s\.seats_total, 'open', s\.signups_open and t\.taken < s\.seats_total\)/);
  assert.match(f, /select s\.seats_offset \+ public\.beta_accounts\(\) as taken/);
  assert.match(f, /from public\.beta_settings s,/, 'no row: no result, so null');
  assert.doesNotMatch(f, /email|'id'|u\.id\b/);
});

test('join_waitlist: consent, shape, only when full or closed, 200 a day, the same ok for a listed email', () => {
  const f = fn('join_waitlist');
  assert.match(f, /^create or replace function public\.join_waitlist\(first_name text, email text, lang text, consent boolean\) returns text language plpgsql volatile security definer/);
  assert.match(f, /if join_waitlist\.consent is not true then raise exception using errcode = 'P0001', message = 'waitlist: consent required'/);
  assert.match(f, /if char_length\(fname\) not between 1 and 60 then/);
  assert.match(f, /if char_length\(mail\) > 254 or mail !~ /);
  assert.match(f, /if not found or \(s\.signups_open and s\.seats_offset \+ public\.beta_accounts\(\) < s\.seats_total\) then raise exception using errcode = 'P0001', message = 'waitlist: seats open'/);
  assert.match(f, /pg_advisory_xact_lock\(hashtext\('reelbook beta'\), hashtext\('waitlist'\)\)/);
  assert.ok(f.includes(`from public.beta_waitlist w where w.created_at >= ${midnight}; if n >= 200 then`));
  const cap = f.indexOf('if n >= 200'), listed = f.indexOf("if exists (select 1 from public.beta_waitlist w where lower(w.email) = lower(mail)) then return 'ok'; end if;");
  assert.ok(listed > -1 && cap > listed, 'a listed email gets ok, even on a day the 200 are reached');
  assert.match(f, /insert into public\.beta_waitlist \(first_name, email, lang, consent_at\) values \(fname, mail, lng, now\(\)\); return 'ok';/);
  assert.doesNotMatch(f, /update public\.beta_waitlist|on conflict/, 'a listed row is never changed');
});

test('functions: security definer with an empty search_path; internals closed; beta_seats and join_waitlist public', () => {
  const fns = [...code.matchAll(/create or replace function (public\.\w+)\(/g)].map(m => m[1]).sort();
  assert.deepEqual(fns, ['public.beta_accounts', 'public.beta_exempt', 'public.beta_on_request', 'public.beta_on_signup',
    'public.beta_seats', 'public.beta_settings_touch', 'public.beta_upload_ok', 'public.beta_waitlist_done', 'public.join_waitlist']);
  for (const name of fns) assert.match(fn(name.slice(7)), /security definer set search_path = ''/, name);
  for (const sig of ['beta_settings_touch\\(\\)', 'beta_exempt\\(uuid\\)', 'beta_accounts\\(timestamptz\\)', 'beta_on_signup\\(\\)', 'beta_waitlist_done\\(\\)', 'beta_on_request\\(\\)', 'beta_upload_ok\\(uuid\\)']) {
    assert.match(flat, new RegExp(`revoke execute on function public\\.${sig} from public, anon, authenticated;`), sig);
  }
  assert.match(flat, /revoke execute on function public\.beta_seats\(\) from public; grant execute on function public\.beta_seats\(\) to anon, authenticated;/);
  assert.match(flat, /revoke execute on function public\.join_waitlist\(text, text, text, boolean\) from public; grant execute on function public\.join_waitlist\(text, text, text, boolean\) to anon, authenticated;/);
  assert.equal((flat.match(/errcode = 'P0001'/g) || []).length, 12);
});

test('the privacy draft has the waiting-list paragraph, inside the draft note', () => {
  const privacy = fs.readFileSync(path.join(__dirname, '../docs/privacy.md'), 'utf8');
  assert.match(privacy, /^> \*\*Draft — not in force/);
  const i = privacy.indexOf('## Waiting list');
  assert.ok(i > -1);
  assert.match(privacy.slice(i, privacy.indexOf('\n## ', i + 3)), /first name and (your )?email[\s\S]*deleted[\s\S]*sign up[\s\S]*(ask|request)/i);
});
