// L42a: the Edge Function cli-login's unit tests (supabase/functions/cli-login/core.test.ts) are Deno tests, run here
// when Deno is installed (skipped otherwise, with the reason). No network: --no-remote, a stubbed client.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');

const hasDeno = (() => { try { execFileSync('deno', ['--version'], {stdio: 'ignore'}); return true; } catch { return false; } })();
const file = path.join(__dirname, '../supabase/functions/cli-login/core.test.ts');

test('cli-login core: Deno unit tests (session out, one answer for wrong and unknown, gate, POST JSON only, nothing secret logged)', {skip: hasDeno ? false : 'deno is not installed'}, () => {
  const r = spawnSync('deno', ['test', '--no-remote', '--quiet', file], {encoding: 'utf8', timeout: 60000, env: {...process.env, NO_COLOR: '1'}});
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
});

// L46: the SQL side of the progressive lock, as text (the behaviour itself is measured on a local stack:
// tests/e2e/cli-login-real.mjs progressive and upgrade).
test('schema.sql: progressive lock per address (15 min, 1 h, 24 h), replayable over the L42a table', () => {
  const sql = require('node:fs').readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');
  const s = sql.slice(sql.indexOf('-- cli-login limits'));
  assert.ok(s.length > 1000, 'cli-login section found');
  assert.match(s, /case lv when 0 then interval '15 minutes' when 1 then interval '1 hour' else interval '1 day' end/);
  for (const col of ['level integer not null default 0', 'locked_until timestamptz', 'last_hit timestamptz'])
    assert.ok(s.includes(`add column if not exists ${col}`), col);
  // Address rows outlive a day when their lock or last attempt says so: the purge reads all three times.
  assert.match(s, /greatest\(window_start, coalesce\(last_hit, window_start\), coalesce\(locked_until, window_start\)\) < now\(\) - interval '1 day'/);
  assert.ok(!/where window_start < now\(\) - interval '1 day'/.test(s), 'the L42a purge (window only) is gone');
  assert.match(s, /create or replace function public\.cli_login_succeeded\(p_address text, p_window timestamptz\)/);
  assert.match(s, /'address:' \|\| greatest\(1, ceil\(extract\(epoch from lu - clock_timestamp\(\)\)\)\)::bigint/);
  assert.ok(!/drop function if exists public\.cli_login_(gate|release)\(text, (text|timestamptz)\)/.test(s), 'the signatures the deployed function calls are kept');
});
