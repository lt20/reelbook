// L44: static checks of the table rights in supabase/schema.sql (no database in CI). A new Supabase project grants nothing on
// the tables of `public`, so these lines are what makes the app work there. The SQL was run on a fresh stack: progress/2026-11-07-L44.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');
const flat = sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n').replace(/\s+/g, ' ');

// What the app and tools/rb.py use, table by table.
const AUTHENTICATED = {
  requests: 'select, insert, update, delete',
  sheets: 'select, insert, update, delete',
  notes: 'select, insert, update, delete',
  sessions: 'select, insert, update, delete',
  user_themes: 'select, insert, delete',
  practice_log: 'select, insert',
  account_quotas: 'select',
};
// No client role reaches these; their triggers and definer functions do (cli_login_limits: L42a, the cli-login function).
const NO_CLIENT = ['beta_settings', 'beta_waitlist', 'beta_daily', 'cli_login_limits'];
// L42a: what the Edge Functions do with the service role (add-link: supabase/functions/add-link/core.ts).
const SERVICE_ROLE = {capture_tokens: 'select, update', requests: 'insert'};
const OWN_RIGHTS = ['capture_tokens'];

const tableGrants = [...flat.matchAll(/ grant ([a-z, ()_]+?) on (?:table )?public\.([a-z_]+) to ([a-z_, ]+?);/g)]
  .map(m => ({privs: m[1], table: m[2], roles: m[3]}));

for (const [table, privs] of Object.entries(AUTHENTICATED)) {
  test(`${table}: authenticated gets exactly ${privs}`, () => {
    const lines = tableGrants.filter(g => g.table === table && g.roles !== 'service_role');
    assert.deepEqual(lines, [{privs, table, roles: 'authenticated'}]);
    assert.ok(flat.includes(`alter table public.${table} enable row level security;`), 'RLS is what limits the rows');
  });
}

test('every table of the file is classified: a new one has to say who reaches it', () => {
  const tables = [...flat.matchAll(/create table if not exists public\.([a-z_]+)/g)].map(m => m[1]).sort();
  assert.deepEqual(tables, [...Object.keys(AUTHENTICATED), ...NO_CLIENT, ...OWN_RIGHTS].sort());
});

test('the tables no client reaches get no grant, and their revokes stay', () => {
  for (const table of NO_CLIENT) {
    assert.deepEqual(tableGrants.filter(g => g.table === table), [], table);
    assert.ok(flat.includes(`revoke all on public.${table} from anon, authenticated;`), table);
  }
  assert.ok(flat.includes('revoke all on sequence public.beta_waitlist_id_seq from anon, authenticated;'));
  assert.ok(!/ grant [^;]* on sequence /.test(flat), 'no sequence grant: only beta_waitlist has one');
});

test('capture_tokens keeps its own rights', () => {
  assert.ok(flat.includes('revoke all on public.capture_tokens from anon;'));
  assert.ok(flat.includes('revoke insert, update on public.capture_tokens from authenticated;'));
  assert.ok(flat.includes('grant select, delete on public.capture_tokens to authenticated;'));
  assert.ok(flat.includes('grant insert (label, token_hash), update (label, revoked_at) on public.capture_tokens to authenticated;'));
});

test('anon gets no table', () => {
  assert.deepEqual(tableGrants.filter(g => /\banon\b/.test(g.roles)), []);
});

test('no wide grant: rights are given table by table', () => {
  assert.ok(!/ grant [^;]* in schema /.test(flat), 'no grant on all tables in schema');
  assert.ok(!/alter default privileges/.test(flat), 'no change of the project defaults');
  assert.ok(!/ grant all /.test(flat), 'no grant all');
});

test('the functions the clients call stay executable, by the right role', () => {
  for (const sig of ['beta_seats()', 'join_waitlist(text, text, text, boolean)'])
    assert.ok(flat.includes(`grant execute on function public.${sig} to anon, authenticated;`), sig);
  for (const sig of ['my_quota()', 'photo_quota_ok(text)']) {
    assert.ok(flat.includes(`grant execute on function public.${sig} to authenticated;`), sig);
    assert.ok(flat.includes(`revoke execute on function public.${sig} from public, anon;`), sig);
  }
});

test('service_role gets exactly what the Edge Functions use, and nothing for anon or authenticated on cli_login', () => {
  assert.deepEqual(tableGrants.filter(g => g.roles === 'service_role'),
    Object.entries(SERVICE_ROLE).map(([table, privs]) => ({privs, table, roles: 'service_role'})));
  assert.ok(flat.includes('grant execute on function public.cli_login_gate(text, text) to service_role;'));
  assert.ok(flat.includes('grant execute on function public.cli_login_release(text, timestamptz) to service_role;'));
  assert.ok(flat.includes('revoke execute on function public.cli_login_gate(text, text) from public, anon, authenticated;'));
  assert.ok(flat.includes('revoke execute on function public.cli_login_release(text, timestamptz) from public, anon, authenticated;'));
  assert.ok(flat.includes('revoke execute on function public.cli_login_hit(text) from public, anon, authenticated, service_role;'));
  assert.ok(!/ grant execute on function public\.cli_login_hit/.test(flat), 'the counter itself is only called by the two');
});
