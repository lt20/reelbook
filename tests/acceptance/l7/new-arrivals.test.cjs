const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, ownUrl, ownKey} = require('../../harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const hoursAgo = n => new Date(Date.now() - n * 3600_000).toISOString();
const sheet = (slug, hours) => ({slug, kind: 'sheet', theme: 'strength', group: 'Arms', title: slug, summary: '', added_at: hoursAgo(hours), source: {}, exercises: []});
const session = (slug, hours) => ({slug, theme: 'strength', title: slug, created_at: hoursAgo(hours), origin: 'video', source: {}, items: []});
const tables = (sheets = [], sessions = []) => ({user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}], sheets, sessions});
const links = markup => [...markup.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);

test('B2 — Home, above the notebooks: a « New » row of cards, with sheets added and video sessions created within 72 h, newest first and at most six', async () => {
  const t = tables([sheet('old-sheet', 73), ...Array.from({length: 7}, (_, i) => sheet(`sheet-${i}`, i + 2))], [session('new-session', 1), session('old-session', 74)]);
  const page = await app({...signedIn, tables: t});
  await settle();
  assert.equal(page.element('home').hidden, false);
  assert.equal(page.element('new-sec').hidden, false);
  assert.match(page.element('new-sec').innerHTML, /New/);
  assert.deepEqual(links(page.element('new-cards').innerHTML), ['session/new-session', 'sheet-0', 'sheet-1', 'sheet-2', 'sheet-3', 'sheet-4']);
  assert.ok(html.indexOf('id="new-sec"') < html.indexOf('id="portal"'), 'the row precedes the notebooks');
});

test('B2 — a sheet or session opened on this device joins localStorage rb.seen and leaves « New »', async () => {
  const t = tables([sheet('fresh-sheet', 1)], [session('fresh-session', 2)]);
  const page = await app({...signedIn, tables: t, dom: true});
  await settle();
  assert.deepEqual(links(page.element('new-cards').innerHTML), ['fresh-sheet', 'session/fresh-session']);
  page.go('#fresh-sheet'); await settle();
  assert.match(page.storage.get('rb.seen') || '', /fresh-sheet/);
  page.go('#'); await settle();
  assert.deepEqual(links(page.element('new-cards').innerHTML), ['session/fresh-session']);
  page.go('#session/fresh-session'); await settle();
  assert.match(page.storage.get('rb.seen') || '', /fresh-session/);
  page.go('#'); await settle();
  assert.equal(page.element('new-sec').hidden, true);
});

test('B2 — No « New » row when empty, including an old catalogue and a backend without the sessions table', async () => {
  for (const options of [
    {tables: tables([], [])},
    {tables: tables([sheet('old', 73)], [session('older', 73)])},
    {tables: tables([sheet('old', 73)], []), failing: {sessions: {error: {code: 'PGRST205', message: 'Could not find the table'}, status: 404}}}
  ]) {
    const page = await app({...signedIn, ...options}); await settle();
    assert.equal(page.element('new-sec').hidden, true);
  }
});

test('B2 — an offline catalogue does not show stale « New » cards', async () => {
  const page = await app({...signedIn, tables: tables([sheet('fresh', 1)]), failing: {sheets: {error: {message: 'Failed to fetch'}, status: 0}}});
  await settle();
  assert.equal(page.element('new-sec').hidden, true);
  assert.match(page.element('count').textContent, /Could not load your sheets/);
});
