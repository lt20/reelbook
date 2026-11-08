const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('../../harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const tables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: [{slug: 'move', kind: 'sheet', theme: 'strength', group: 'Back', title: 'Move', html: '<a href="#">Home</a>', exercises: []}],
  sessions: [{slug: 'routine', theme: 'strength', title: 'Routine', items: [{slug: 'move', dose: ''}]}],
  notes: []
});
const open = async (hash, options = {}) => { const page = await app({...signedIn, tables: tables(), hash, dom: true, ...options}); await settle(); return page; };
const noteWrites = page => page.clients.at(-1).calls.filter(call => call[1] === 'notes' && ['upsert', 'insert', 'update'].includes(call[0]));

test('Q2: My notes on both a sheet and a session save after typing, show Saving… then Saved, and have no Save button', async () => {
  for (const [hash, key] of [['#move', 'move'], ['#session/routine', 'session/routine']]) {
    const page = await open(hash);
    assert.match(page.element('view').innerHTML, /My notes/);
    assert.doesNotMatch(page.element('view').innerHTML, /id="n-save"|>Save<\/button>/);
    page.element('n-text').value = 'Felt good';
    await page.fire('n-text', 'input');
    assert.equal(page.element('n-status').textContent, 'Saving…');
    await settle();
    assert.equal(page.element('n-status').textContent, 'Saved');
    assert.equal(noteWrites(page).length, 1);
    assert.equal(noteWrites(page)[0][2].slug, key);
    assert.equal(noteWrites(page)[0][2].body, 'Felt good');
  }
});

test('Q2: unchanged or empty My notes make no backend write', async () => {
  const existing = tables();
  existing.notes = [{slug: 'move', body: 'Already here', updated_at: '2026-11-01T10:00:00Z'}];
  const page = await open('#move', {tables: existing});
  assert.equal(page.element('n-text').value, 'Already here');
  await settle();
  assert.equal(noteWrites(page).length, 0);
  await page.fire('n-text', 'input');
  await settle();
  assert.equal(noteWrites(page).length, 0);
  const empty = await open('#session/routine');
  await settle();
  assert.equal(noteWrites(empty).length, 0);
});

test('Q2: a failed note save shows Not saved and Retry; Retry writes the note', async () => {
  const page = await open('#move', {writes: {notes: {data: null, error: {message: 'offline'}}}});
  page.element('n-text').value = 'Keep this';
  await page.fire('n-text', 'input');
  await settle();
  assert.equal(page.element('n-status').textContent, 'Not saved');
  assert.match(page.element('view').innerHTML, />Retry<\/button>/);
  assert.equal(noteWrites(page).length, 1);
  await page.fire('n-retry');
  await settle();
  assert.equal(noteWrites(page).length, 2);
  assert.equal(noteWrites(page)[1][2].body, 'Keep this');
});
