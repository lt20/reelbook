// L29: static checks of the quota migration in supabase/schema.sql (no database in CI). The SQL itself was run on a
// local Postgres (PGlite) by the lot: see the PR. Here: what must stay true of the text.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');
const start = sql.indexOf('-- Quotas per account (L29)');
const quota = sql.slice(start);
const code = quota.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');   // statements, comments out
const flat = code.replace(/\s+/g, ' ');

test('the quota section exists and comes last (after the faceted library)', () => {
  assert.ok(start > sql.indexOf('alter table public.sheets add column if not exists tags'), 'after L23');
});

test('additive and idempotent: nothing dropped but triggers and policies it recreates, every create is re-runnable', () => {
  assert.doesNotMatch(code, /\bdrop\s+(table|column|function|index|schema)\b/i);
  assert.doesNotMatch(code, /\b(delete\s+from|truncate\s+(table\s+)?public|alter\s+table\s+\S+\s+drop)\b/i);
  assert.match(flat, /create table if not exists public\.account_quotas/);
  assert.match(flat, /create index if not exists requests_user_created_idx/);
  for (const m of code.matchAll(/create (trigger|policy) ("[^"]+"|\w+) on (\S+)/g)) {
    const [, kind, name, table] = m;
    assert.ok(flat.indexOf(`drop ${kind} if exists ${name} on ${table}`) > -1 && flat.indexOf(`drop ${kind} if exists ${name} on ${table}`) < flat.indexOf(m[0].replace(/\s+/g, ' ')),
      `${kind} ${name} is dropped if it exists before being created`);
  }
  for (const m of code.matchAll(/create (or replace )?function (\S+?)\(/g)) assert.ok(m[1], `${m[2]}: create or replace`);
});

test('account_quotas: the columns of the spec; a user reads its own row and never writes', () => {
  for (const col of ['user_id uuid primary key references auth.users (id) on delete cascade', 'max_requests_per_day int', 'max_sheets int', 'max_storage_mb int', 'note text']) {
    assert.ok(flat.includes(col), col);
  }
  assert.match(flat, /alter table public\.account_quotas enable row level security/);
  const policies = [...flat.matchAll(/create policy "[^"]+" on public\.account_quotas for (\w+)/g)].map(m => m[1]);
  assert.deepEqual(policies, ['select']);
  assert.match(flat, /revoke insert, update, delete, truncate on public\.account_quotas from anon, authenticated/);
});

test('defaults 10 links a day, 300 sheets, 200 MB; a null column keeps the default', () => {
  assert.match(flat, /coalesce\(q\.max_requests_per_day, 10\), coalesce\(q\.max_sheets, 300\), coalesce\(q\.max_storage_mb, 200\)/);
  assert.match(flat, /date_trunc\('day', now\(\) at time zone 'utc'\) at time zone 'utc'/, 'links counted since midnight UTC');
});

test('enforced in the database: before insert triggers on requests and sheets, quota in the storage insert and update policies', () => {
  assert.match(flat, /create trigger requests_quota before insert or update on public\.requests for each row execute function public\.enforce_request_quota\(\)/);
  assert.match(flat, /create trigger sheets_quota before insert or update on public\.sheets for each row execute function public\.enforce_sheet_quota\(\)/);
  assert.match(flat, /create policy "own sheet files insert" on storage\.objects for insert to authenticated with check \([^;]*public\.photo_quota_ok\(bucket_id\)\)/);
  assert.match(flat, /create policy "own sheet files update" on storage\.objects for update to authenticated using \([^;]*\) with check \([^;]*public\.photo_quota_ok\(bucket_id\)\)/);
});

test('the error messages the app and rb.py read', () => {
  assert.ok(flat.includes("format('quota: %s links per day', lim)"));
  assert.ok(flat.includes("format('quota: %s sheets', lim)"));
  assert.ok(flat.includes("format('quota: %s MB of photos', lim)"));
  assert.equal((flat.match(/errcode = 'P0001'/g) || []).length, 3);
});

test('bypass paths closed in the text: server clock for created_at, upsert of an existing slug passes, owner changes counted', () => {
  const req = flat.slice(flat.indexOf('function public.enforce_request_quota'), flat.indexOf('create trigger requests_quota'));
  assert.match(req, /new\.created_at := old\.created_at/);
  assert.match(req, /new\.created_at := now\(\)/);
  assert.match(req, /pg_advisory_xact_lock/);
  const sh = flat.slice(flat.indexOf('function public.enforce_sheet_quota'), flat.indexOf('create trigger sheets_quota'));
  assert.match(sh, /if tg_op = 'UPDATE' and new\.user_id is not distinct from old\.user_id then return new/);
  assert.match(sh, /exists \(select 1 from public\.sheets s where s\.user_id = new\.user_id and s\.slug = new\.slug\) then return new/);
  assert.match(sh, /pg_advisory_xact_lock/);
  const ph = flat.slice(flat.indexOf('function public.photo_quota_ok'), flat.indexOf('revoke execute on function public.photo_quota_ok'));
  assert.match(ph, /language plpgsql volatile/, 'reads the total after the lock');
  assert.match(ph, /pg_advisory_xact_lock\(hashtext\('reelbook quota'\), hashtext\(uid::text\)\)/, 'parallel uploads checked one at a time');
});

test('functions: security definer with an empty search_path; internals not executable by clients; my_quota for the signed-in only', () => {
  const fns = [...code.matchAll(/create or replace function (public\.\w+)\([^)]*\)[\s\S]*?\$\$;/g)];
  assert.deepEqual(fns.map(m => m[1]).sort(), ['public.enforce_request_quota', 'public.enforce_sheet_quota', 'public.my_quota', 'public.photo_quota_ok', 'public.quota_limits', 'public.quota_usage']);
  for (const [body, name] of fns) assert.match(body.replace(/\s+/g, ' '), /security definer set search_path = ''/, name);
  for (const fn of ['quota_limits\\(uuid\\)', 'quota_usage\\(uuid\\)', 'enforce_request_quota\\(\\)', 'enforce_sheet_quota\\(\\)']) {
    assert.match(flat, new RegExp(`revoke execute on function public\\.${fn} from public, anon, authenticated`), fn);
  }
  assert.match(flat, /revoke execute on function public\.my_quota\(\) from public, anon; grant execute on function public\.my_quota\(\) to authenticated/);
  const my = flat.slice(flat.indexOf('function public.my_quota'));
  for (const k of ['requests_today', 'max_requests_per_day', 'sheets', 'max_sheets', 'storage_bytes', 'max_storage_mb']) assert.ok(my.includes(`'${k}'`), k);
  assert.match(my, /where auth\.uid\(\) is not null/);
});

test('the migration never guesses an account: no user id in the file', () => {
  assert.doesNotMatch(code, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.doesNotMatch(code, /insert into public\.account_quotas/);
});
