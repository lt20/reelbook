// P11 G1: static checks of the glossary section of supabase/schema.sql (no database in CI). The section was run three
// times on a throwaway Postgres, with the checks listed in progress/2026-11-10-P11-G1.md.
// Contract: docs/audit-design/P11-glossary.md › Data contract.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');
const flat = sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n').replace(/\s+/g, ' ');
const at = s => { const i = flat.indexOf(s); assert.ok(i >= 0, s); return i; };
const start = at('create table if not exists public.glossary_words (');
// the section ends with its grant: what a later lot appends to the file is not part of it
const GRANT = 'grant select, insert, update, delete on public.glossary_words to authenticated;';
const section = flat.slice(start, at(GRANT) + GRANT.length);
const table = section.slice(0, section.indexOf(');') + 2);

test('the table: one row per entry, the columns of the data contract and no other', () => {
  const columns = table.slice(table.indexOf('(') + 1, table.lastIndexOf(')')).split(/,\s(?=[a-z_]+ (?:uuid|text|jsonb|timestamptz))/).map(c => c.trim());
  assert.deepEqual(columns, [
    'id uuid primary key default gen_random_uuid()',
    'user_id uuid not null default auth.uid() references auth.users (id) on delete cascade',
    'theme text not null',
    'term text not null',
    'sense text',
    "forms jsonb not null default '[]'::jsonb",
    'kind text',
    'definition text not null',
    "confidence text not null check (confidence in ('sure', 'unsure'))",
    'doubt text',
    'spelling text',
    'photo jsonb',
    "related jsonb not null default '[]'::jsonb",
    "sheets jsonb not null default '[]'::jsonb",
    'created_at timestamptz not null default now()',
    'updated_at timestamptz not null default now()',
  ]);
});

test('one entry per word and sense in a notebook of an account, the term and the sense whatever their case, as rb.py', () => {
  // Codex pass 2 on #138: the index compared the sense as written, rb.py's _glossary_key ignores its case
  const NEW = "create unique index if not exists glossary_words_one_entry_ci on public.glossary_words (user_id, theme, lower(term), lower(coalesce(sense, '')));";
  const DROP = 'drop index if exists public.glossary_words_one_entry;';
  // a backend that has the first index gets the new one, then loses the old: never a moment without the rule
  assert.ok(at(NEW) < at(DROP));
  assert.equal([...section.matchAll(/create unique index/g)].length, 1);
  assert.doesNotMatch(section, /create unique index if not exists glossary_words_one_entry /);
  // the same identity as the command's
  const rb = fs.readFileSync(path.join(__dirname, '../tools/rb.py'), 'utf8');
  assert.ok(rb.includes('return (e["term"].strip().lower(), (e.get("sense") or "").strip().lower())'), '_glossary_key');
});

test('RLS: own rows only, as user_themes; one policy, for authenticated', () => {
  at('alter table public.glossary_words enable row level security;');
  at('create policy "own glossary words" on public.glossary_words for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());');
  // the same shape as the notebooks' policy
  at('create policy "own themes" on public.user_themes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());');
  assert.equal([...flat.matchAll(/create policy "[^"]+" on public\.glossary_words /g)].length, 1);
});

// P11 G5: the Edge Function share copies the words of the sheets it copies (supabase/functions/share/words.ts), with
// the service role: it reads, inserts and updates, it never deletes.
test('grants: select, insert, update, delete to authenticated; select, insert, update to service_role (share, P11 G5); nothing to anon', () => {
  const grants = [...flat.matchAll(/ grant ([^;]+?) on (?:table )?public\.glossary_words to ([^;]+);/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(grants, [['select, insert, update, delete', 'authenticated'], ['select, insert, update', 'service_role']]);
});

test('updated_at follows a change, with the trigger function of the other tables', () => {
  at('create trigger glossary_words_touch before update on public.glossary_words for each row execute function public.touch_updated_at();');
});

test('idempotent and additive: every statement of the section can run again, and none touches another table', () => {
  const statements = section.split(';').map(s => s.trim()).filter(Boolean);
  assert.equal(statements.length, 9);
  const OLD_INDEX = 'drop index if exists public.glossary_words_one_entry';   // the first version of this table's unique index
  assert.equal(statements.filter(s => s === OLD_INDEX).length, 1);
  for (const s of statements.filter(s => s !== OLD_INDEX)) {
    assert.match(s, /^(create table if not exists|create unique index if not exists|drop trigger if exists|create trigger|alter table|drop policy if exists|create policy|grant) /, s);
    assert.match(s, /public\.glossary_words\b/, s);
    assert.deepEqual((s.match(/public\.[a-z_]+/g) || []).filter(n => !['public.glossary_words', 'public.touch_updated_at'].includes(n)), [], s);
    assert.doesNotMatch(s, /\b(drop table|drop column|truncate|delete from|update public|insert into)\b/, s);
  }
  // what is created without « if not exists » is dropped first
  assert.ok(at('drop trigger if exists glossary_words_touch on public.glossary_words;') < at('create trigger glossary_words_touch'));
  assert.ok(at('drop policy if exists "own glossary words" on public.glossary_words;') < at('create policy "own glossary words"'));
  assert.equal([...flat.matchAll(/create table if not exists public\.glossary_words/g)].length, 1);
});

test('no foreign key on the notebook or the sheets: a slug that no longer exists is ignored by the readers, nothing cascades', () => {
  assert.deepEqual(table.match(/references [a-z_.]+/g), ['references auth.users']);
});

test('the section comes after the function its trigger calls, and says who writes and who reads', () => {
  assert.ok(start > at('create or replace function public.touch_updated_at()'));
  // appended after the attribution, as every lot appended its own section; it defines no function (attribution-schema.test.cjs)
  assert.ok(sql.indexOf('-- Glossary (P11 G1)') > sql.indexOf('-- Attribution (P8 R13)'));
  assert.doesNotMatch(section, /function public\.(?!touch_updated_at\(\))/);
  const head = sql.slice(sql.indexOf('-- Glossary (P11 G1)'), sql.indexOf('create table if not exists public.glossary_words'));
  for (const s of ['Written by tools/rb.py signed in as the account', 'Read only by the app', 're-run this whole file to create it (idempotent, additive: nothing else changes)',
    'Current accounts: nothing changes', 'A backend without it keeps working'])
    assert.ok(head.includes(s), s);
});

// P11 G2a: which sheets the glossary pass has read (table glossary_passes), in the block of the glossary, after the
// words. The statements were run twice on a throwaway Postgres: progress/2026-11-10-P11-G2a.md.
const P_START = at('create table if not exists public.glossary_passes (');
const P_GRANT = 'grant select, insert, update, delete on public.glossary_passes to authenticated;';
const passes = flat.slice(P_START, at(P_GRANT) + P_GRANT.length);
const passesTable = passes.slice(0, passes.indexOf(');') + 2);

test('glossary_passes: one row per sheet the pass read, the columns of the data contract and no other', () => {
  const body = passesTable.slice(passesTable.indexOf('(') + 1, passesTable.lastIndexOf(')'));
  const columns = body.split(/,\s(?=[a-z_]+ (?:uuid|text|timestamptz)|primary key)/).map(c => c.trim());
  assert.deepEqual(columns, [
    'user_id uuid not null default auth.uid() references auth.users (id) on delete cascade',
    'theme text not null',
    'slug text not null',
    'sheet_updated_at timestamptz not null',
    'passed_at timestamptz not null default now()',
    'primary key (user_id, theme, slug)',   // what `rb.py glossary put` upserts on: two commands at once leave one row
  ]);
  // the insert of rb.py names the same key and leaves an existing row alone; that row is then updated only where its
  // date is not later than the one sent: it never moves back
  const rb = fs.readFileSync(path.join(__dirname, '../tools/rb.py'), 'utf8');
  assert.ok(rb.includes('params={"on_conflict": "user_id,theme,slug", "select": "slug"}'), 'the insert of _glossary_record');
  assert.ok(rb.includes('prefer="resolution=ignore-duplicates,return=representation"'), 'the insert of _glossary_record');
  assert.ok(rb.includes(`"sheet_updated_at": f"lte.{row['sheet_updated_at']}"`), 'the conditional update of _glossary_record');
});

// P11 G5 (Codex pass 1 on #145): the share writes no row here and reads none, so service_role has no grant on this table.
test('glossary_passes: RLS own rows, one policy for authenticated; select, insert, update, delete; nothing to service_role (the share leaves this table alone, P11 G5); nothing to anon', () => {
  at('alter table public.glossary_passes enable row level security;');
  at('create policy "own glossary passes" on public.glossary_passes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());');
  assert.equal([...flat.matchAll(/create policy "[^"]+" on public\.glossary_passes /g)].length, 1);
  const grants = [...flat.matchAll(/ grant ([^;]+?) on (?:table )?public\.glossary_passes to ([^;]+);/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(grants, [['select, insert, update, delete', 'authenticated']]);
});

test('glossary_passes: idempotent and additive, every statement can run again and none touches another table', () => {
  const statements = passes.split(';').map(s => s.trim()).filter(Boolean);
  assert.equal(statements.length, 5);
  for (const s of statements) {
    assert.match(s, /^(create table if not exists|alter table|drop policy if exists|create policy|grant) /, s);
    assert.deepEqual([...new Set(s.match(/public\.[a-z_]+/g))], ['public.glossary_passes'], s);
    assert.doesNotMatch(s, /\b(drop table|drop column|add column|truncate|delete from|update public|insert into|function|trigger)\b/, s);
  }
  assert.ok(at('drop policy if exists "own glossary passes" on public.glossary_passes;') < at('create policy "own glossary passes"'));
  assert.equal([...flat.matchAll(/create table if not exists public\.glossary_passes/g)].length, 1);
  // nothing in sheets changes (the contract): no statement of the glossary's block names that table
  assert.doesNotMatch(flat.slice(start), /public\.sheets\b/);
});

test('glossary_passes: in the block of the glossary, after the words; no foreign key but the account; says what happens to current accounts', () => {
  assert.ok(P_START > at(GRANT));
  assert.deepEqual(passesTable.match(/references [a-z_.]+/g), ['references auth.users']);
  const head = sql.slice(sql.indexOf('-- Which sheets the glossary pass has read (P11 G2a'), sql.indexOf('create table if not exists public.glossary_passes'));
  for (const s of ['Written by tools/rb.py signed in as the account', 'the app does not use this table', 'Re-run this whole file to create it (idempotent, additive: nothing else changes)',
    'Current accounts: nothing changes', 'A backend without it keeps working', 'nothing in sheets or in `rb.py publish` changes'])
    assert.ok(head.includes(s), s);
});
