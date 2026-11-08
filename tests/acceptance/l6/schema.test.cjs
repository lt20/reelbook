const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../../..');
const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

test('L6 — practice_log schema is additive and idempotent with the specified columns and defaults', () => {
  assert.match(schema, /create table if not exists public\.practice_log\s*\([\s\S]*?\bid\s+uuid\s+primary key\s+default\s+gen_random_uuid\(\)/i);
  assert.match(schema, /create table if not exists public\.practice_log\s*\([\s\S]*?\buser_id\s+uuid\s+not null\s+default\s+auth\.uid\(\)\s+references\s+auth\.users\s*\(?id\)?\s+on delete cascade/i);
  assert.match(schema, /create table if not exists public\.practice_log\s*\([\s\S]*?\bslug\s+text\s+not null/i);
  assert.match(schema, /create table if not exists public\.practice_log\s*\([\s\S]*?\bdone_on\s+date\s+not null\s+default\s+current_date/i);
  assert.match(schema, /create table if not exists public\.practice_log\s*\([\s\S]*?\btext\s+text\s+not null\s+default\s+''/i);
  assert.match(schema, /create table if not exists public\.practice_log\s*\([\s\S]*?\bcreated_at\s+timestamptz\s+not null\s+default\s+now\(\)/i);
  assert.match(schema, /create index if not exists\s+\w+\s+on\s+public\.practice_log\s*\(\s*user_id\s*,\s*slug\s*,\s*done_on\s+desc\s*\)/i);
});

test('L6 — practice_log enables RLS with own rows for all operations', () => {
  assert.match(schema, /alter table public\.practice_log enable row level security/i);
  assert.match(schema, /drop policy if exists\s+"own practice log"\s+on public\.practice_log/i);
  assert.match(schema, /create policy\s+"own practice log"\s+on public\.practice_log\s+for all to authenticated\s+using\s*\(\s*user_id\s*=\s*auth\.uid\(\)\s*\)\s+with check\s*\(\s*user_id\s*=\s*auth\.uid\(\)\s*\)/i);
});

test('L6 — README self-hosting instructions say to re-run the schema', () => {
  assert.match(readme, /self-host|own Supabase|own instance/i);
  assert.match(readme, /re-run\s+`?supabase\/schema\.sql`?/i);
});
