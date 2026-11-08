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
