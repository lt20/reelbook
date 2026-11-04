const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const root = path.join(__dirname, '../../..');
const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');
const functionPath = path.join(root, 'supabase/functions/add-link/index.ts');
const corePath = path.join(root, 'supabase/functions/add-link/core.ts');

test('L28 Step B — capture_tokens has the specified columns and hashed storage', () => {
  const table = schema.match(/create table if not exists public\.capture_tokens\s*\(([\s\S]*?)\n\);/i)?.[1];
  assert.ok(table, 'idempotent capture_tokens table exists');
  for (const column of ['id', 'user_id', 'token_hash', 'label', 'created_at', 'last_used_at', 'revoked_at']) {
    assert.match(table, new RegExp('\\b' + column + '\\s+', 'i'), column);
  }
  assert.doesNotMatch(table, /\btoken\s+text\b/i, 'the plaintext token is not a column');
});

test('L28 Step B — capture_tokens enables RLS and restricts signed-in users to their own rows', () => {
  assert.match(schema, /alter table public\.capture_tokens enable row level security/i);
  assert.match(schema, /create policy[\s\S]*?on public\.capture_tokens[\s\S]*?to authenticated[\s\S]*?using\s*\(\s*user_id\s*=\s*auth\.uid\(\)\s*\)[\s\S]*?with check\s*\(\s*user_id\s*=\s*auth\.uid\(\)\s*\)/i);
});

test('L28 Step B — the Edge Function has one POST route, bearer auth, service-role lookup and a requests insert', () => {
  const source = fs.readFileSync(functionPath, 'utf8');
  assert.match(source, /POST/);
  assert.match(source, /Authorization|authorization/);
  assert.match(source, /Bearer/);
  assert.match(source, /capture_tokens/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /requests/);
  assert.doesNotMatch(source, /console\.(?:log|info|debug)\s*\(/, 'do not log token-bearing requests');
});

const denoCheck = async body => {
  const script = `import * as core from ${JSON.stringify('file://' + corePath)};\n${body}`;
  return execFileSync('deno', ['eval', '--no-remote', script], {encoding: 'utf8', timeout: 15000});
};

test('L28 Step B — function validation accepts the app platforms and rejects invalid or unsupported links', async () => {
  await denoCheck(`
    const good = ['https://www.instagram.com/reel/abc/', 'https://www.tiktok.com/@a/video/123', 'https://youtu.be/abc', 'https://www.youtube.com/watch?v=abc', 'https://www.facebook.com/watch/?v=123', 'https://fb.watch/abc/'];
    const bad = ['', 'not a URL', 'https://example.test/watch', 'https://youtube.com.evil.test/watch', 'javascript:alert(1)'];
    for (const url of good) if (!core.validateLink(url)) throw Error('rejected supported URL: ' + url);
    for (const url of bad) if (core.validateLink(url)) throw Error('accepted unsupported URL: ' + url);
  `);
});

test('L28 Step B — token hashing is deterministic SHA-256 and never returns the plaintext', async () => {
  await denoCheck(`
    const token = 'reelbook-token-test';
    const digest = await core.hashToken(token);
    if (digest !== 'e7c55e6396f50e745cdf70868e8089585623b1bc37e40fd3f0d927c742bdd16e') {
      const bytes = new TextEncoder().encode(token);
      const expected = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      if (digest !== expected) throw Error('token hash is not SHA-256');
    }
    if (digest === token || !/^[a-f0-9]{64}$/.test(digest)) throw Error('invalid token digest');
    if (await core.hashToken(token) !== digest) throw Error('unstable token digest');
    if (await core.hashToken(token + '2') === digest) throw Error('different tokens share a digest');
  `);
});
