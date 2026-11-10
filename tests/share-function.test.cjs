// P8 R11: the Edge Function share's unit tests (supabase/functions/share/core.test.ts) are Deno tests, run here when
// Deno is installed (skipped otherwise, with the reason). No network: --no-remote, an in-memory store; read access
// to the function's own folder (a test checks its source never names notes, practice_log or account_quotas) and to
// templates/ (what the html cleaning must keep). store.test.ts: store.ts over a fake client (PostgREST's row cap).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');

const hasDeno = (() => { try { execFileSync('deno', ['--version'], {stdio: 'ignore'}); return true; } catch { return false; } })();
const dir = path.join(__dirname, '../supabase/functions/share'), templates = path.join(__dirname, '../templates');

test('share core and store: Deno unit tests (GET limits, revoke, dedup by URL and title, slug collision and cut, notes kept, photo paths, html cleaning, idempotence and reservation, quota, pages of share_files, no notes or log, backend without the table; P11 G5: the glossary words of the copied sheets, merge, passes, missing tables, failure, replay)', {skip: hasDeno ? false : 'deno is not installed'}, () => {
  const r = spawnSync('deno', ['test', '--no-remote', '--quiet', `--allow-read=${dir},${templates}`, path.join(dir, 'core.test.ts'), path.join(dir, 'store.test.ts')], {encoding: 'utf8', timeout: 60000, env: {...process.env, NO_COLOR: '1'}});
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
});

test('share core and store type-check (deno check, no network)', {skip: hasDeno ? false : 'deno is not installed'}, () => {
  const r = spawnSync('deno', ['check', '--no-remote', '--quiet', path.join(dir, 'core.ts'), path.join(dir, 'clean.ts'), path.join(dir, 'store.ts'), path.join(dir, 'words.ts')], {encoding: 'utf8', timeout: 60000, env: {...process.env, NO_COLOR: '1'}});
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
});
