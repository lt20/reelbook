const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('../../harness.cjs');
const RS = require('../../../app/sessions.js');

const signedIn = {
  remembered: {mode: 'own', url: ownUrl, key: ownKey},
  sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}
};
const tables = (practice_log = []) => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: ['Arms'], builtin: true, position: 0}],
  sheets: [
    {slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Hammer curl', summary: '', html: '', source: {}},
    {slug: 'press', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Press', summary: '', html: '', source: {}}
  ],
  sessions: [{slug: 'routine', theme: 'strength', title: 'Routine', format: '', why: '', key_points: [], source: {}, origin: 'user', thumbnail: '', items: [{slug: 'curl', dose: ''}]}],
  notes: [], requests: [], practice_log
});
const row = (slug, done_on, text, created_at, id) => ({slug, done_on, text, created_at, id});
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const open = async (hash, options = {}) => {
  const page = await app({...signedIn, tables: tables(), dom: true, hash, ...options});
  await settle();
  return page;
};
const click = async (page, id) => {
  if (page.element(id).listeners.click) await page.fire(id);
  else {
    const listener = page.element('view').listeners.click;
    assert.ok(listener, 'the page handles clicks on its practice controls');
    await listener({target: {closest: selector => selector === `#${id}` ? {id} : null}});
  }
  await settle();
};
const writes = page => JSON.parse(JSON.stringify(page.clients.at(-1).calls.filter(call =>
  ['insert', 'update', 'upsert', 'delete'].includes(call[0]) && call[1] === 'practice_log')));

// The same predicate is used for older Supabase projects and for sessions.
test('L6 — tolerates a backend without practice_log via RS.missingTable', () => {
  assert.equal(RS.missingTable({code: 'PGRST205', message: 'Could not find the table'}, 404), true);
  assert.equal(RS.missingTable({code: '42P01', message: 'relation does not exist'}, 400), true);
  assert.equal(RS.missingTable({code: '42501', message: 'permission denied'}, 403), false);
});

test('L6 — without the table, every practice control and count is hidden and no error is shown', async () => {
  const failing = {practice_log: {error: {code: 'PGRST205', message: 'Could not find the table'}, status: 404}};
  const home = await open('', {failing});
  assert.equal(home.element('home').hidden, false);
  assert.doesNotMatch(home.element('count').textContent, /practised|saved|Could not find|Could not load/i);
  assert.doesNotMatch(home.element('portal').innerHTML, /done \d|practice_log|Could not find/i);
  const notebook = await open('#strength', {failing});
  assert.doesNotMatch(notebook.element('groups').innerHTML, /done \d|practice_log|Could not find/i);
  for (const hash of ['#curl', '#session/routine']) {
    const page = await open(hash, {failing});
    assert.equal(page.element('view').hidden, false);
    assert.doesNotMatch(page.element('view').innerHTML, /Done today|Last time:|<h[1-6]>Log<\/h[1-6]>|practice_log|Could not find/i);
  }
});

test('L6 — an empty table is additive: existing sheets and notes remain, with no completed entry', async () => {
  const page = await open('#session/routine');
  assert.equal(page.element('view').hidden, false);
  assert.match(page.element('view').innerHTML, /Routine/);
  assert.match(page.element('view').innerHTML, /My notes/);
  assert.match(page.element('view').innerHTML, /Done today/);
  assert.doesNotMatch(page.element('view').innerHTML, /Done today ✓|Last time:|done \d/);
  const home = await open('');
  assert.match(home.element('count').textContent, /0 practised · 2 saved/);
  assert.match(home.element('count').textContent, /1 session/);
});

test('L6 — catalogue keeps the latest date per sheet and session; cards show done 28 Oct', async () => {
  const log = [
    row('curl', '2026-10-20', 'old', '2026-10-20T08:00:00Z', 'a'),
    row('curl', '2026-10-28', 'new', '2026-10-28T08:00:00Z', 'b'),
    row('session/routine', '2026-10-28', 'session', '2026-10-28T09:00:00Z', 'c')
  ];
  const page = await open('#strength', {tables: tables(log)});
  const cards = page.element('groups').innerHTML;
  assert.match(cards, /href="#curl"[\s\S]*?done 28 Oct[\s\S]*?<\/a>/);
  assert.match(cards, /href="#session\/routine"[\s\S]*?done 28 Oct[\s\S]*?<\/a>/);
  assert.doesNotMatch(cards, /done 20 Oct/);
  assert.doesNotMatch(cards.match(/href="#press"[\s\S]*?<\/a>/)[0], /done \d/);
});

test('L6 — sheet and session pages put Done today under the title and open a one-line prefilled field with Save', async () => {
  for (const [hash, slug] of [['#curl', 'curl'], ['#session/routine', 'session/routine']]) {
    const log = [row(slug, '2026-10-28', '12 kg, 3x10', '2026-10-28T08:00:00Z', 'a')];
    const page = await open(hash, {tables: tables(log)});
    const before = page.element('view').innerHTML;
    assert.match(before, /<h1[^>]*>[\s\S]*?<\/h1>[\s\S]*?id="practice-done"[^>]*>Done today/);
    assert.match(before, /Last time: 28 Oct — 12 kg, 3x10/);
    await click(page, 'practice-done');
    const after = page.element('view').innerHTML;
    assert.match(after, /<input[^>]*id="practice-text"[^>]*type="text"/);
    assert.match(after, /<input[^>]*id="practice-text"[^>]*value="12 kg, 3x10"/);
    assert.match(after, /id="practice-save"[^>]*>Save<\/button>/);
  }
});

test('L6 — Save appends a practice row and changes the button to Done today ✓', async () => {
  const page = await open('#curl');
  await click(page, 'practice-done');
  page.element('practice-text').value = '12 kg, 3x10';
  await click(page, 'practice-save');
  const calls = writes(page);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'insert');
  assert.equal(calls[0][2].slug, 'curl');
  assert.equal(calls[0][2].text, '12 kg, 3x10');
  assert.match(page.element('view').innerHTML, /Done today ✓/);
  assert.match(page.element('view').innerHTML, /Last time:/);
  assert.match(page.element('view').innerHTML, /12 kg, 3x10/);
});

test('L6 — a second entry on the same day creates a second row', async () => {
  const page = await open('#curl');
  for (const text of ['first', 'second']) {
    await click(page, 'practice-done');
    page.element('practice-text').value = text;
    await click(page, 'practice-save');
  }
  const calls = writes(page);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call[0]), ['insert', 'insert']);
  assert.deepEqual(calls.map(call => call[2].text), ['first', 'second']);
  assert.deepEqual(calls.map(call => call[2].slug), ['curl', 'curl']);
});

test('L6 — My notes shows a Log of the last five entries, newest first, on sheets and sessions', async () => {
  for (const [hash, slug] of [['#curl', 'curl'], ['#session/routine', 'session/routine']]) {
    const log = Array.from({length: 6}, (_, i) => row(slug, `2026-10-${String(20 + i).padStart(2, '0')}`, `entry-${i}`, `2026-10-${String(20 + i).padStart(2, '0')}T08:00:00Z`, String(i))).reverse();
    const page = await open(hash, {tables: tables(log)});
    const html = page.element('view').innerHTML;
    assert.match(html, /My notes[\s\S]*?<h[1-6][^>]*>Log<\/h[1-6]>/);
    // coordinator decision: the Log includes the latest entry, also shown as « Last time » under the title
    const entries = [...html.slice(html.search(/<h[1-6][^>]*>Log<\/h[1-6]>/)).matchAll(/entry-[0-5]/g)].map(match => match[0]);
    assert.deepEqual(entries, ['entry-5', 'entry-4', 'entry-3', 'entry-2', 'entry-1']);
    assert.match(html, /25 Oct[\s\S]*?entry-5/);
    assert.doesNotMatch(html, /entry-0/);
  }
});

test('L6 — home counter counts distinct existing practised slugs, including sessions, and saved sheets', async () => {
  const log = [
    row('curl', '2026-10-27', 'one', '2026-10-27T08:00:00Z', 'a'),
    row('curl', '2026-10-28', 'two', '2026-10-28T08:00:00Z', 'b'),
    row('press', '2026-10-28', '', '2026-10-28T08:00:00Z', 'c'),
    row('session/routine', '2026-10-28', 'session', '2026-10-28T08:00:00Z', 'd'),
    row('deleted', '2026-10-28', 'orphan', '2026-10-28T08:00:00Z', 'e')
  ];
  const page = await open('', {tables: tables(log)});
  assert.match(page.element('count').textContent, /^3 practised · 2 saved/);
  assert.match(page.element('count').textContent, /1 session · 1 notebook/);
});

test('L6 — a failed or offline practice read leaves existing pages usable without claiming a completion', async () => {
  for (const error of [{code: '42501', message: 'permission denied'}, {message: 'offline'}]) {
    const page = await open('#session/routine', {failing: {practice_log: {error, status: error.code ? 403 : 0}}});
    assert.equal(page.element('view').hidden, false);
    assert.match(page.element('view').innerHTML, /Routine/);
    assert.doesNotMatch(page.element('view').innerHTML, /Done today ✓|Last time:/);
  }
});

test('L6 — a failed Save does not mark a practice as done', async () => {
  const page = await open('#curl', {writes: {practice_log: {data: null, error: {message: 'offline'}}}});
  await click(page, 'practice-done');
  page.element('practice-text').value = '12 kg, 3x10';
  await click(page, 'practice-save');
  assert.equal(writes(page).length, 1);
  assert.doesNotMatch(page.element('view').innerHTML, /Done today ✓|Last time:/);
});
