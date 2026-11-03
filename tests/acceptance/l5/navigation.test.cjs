const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('../../harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const tables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: ['First', 'Second', 'Third', 'Fourth'].map((title, i) => ({slug: `move-${i + 1}`, kind: 'sheet', theme: 'strength', group: 'Back', title, summary: '', html: '<a href="#">Home</a>', exercises: []})),
  sessions: [{slug: 'routine', theme: 'strength', title: 'Routine', format: '', origin: 'video', items: [
    {slug: 'move-1', dose: '30 s'}, {slug: 'deleted', dose: '1 min'}, {slug: 'move-2', dose: ''},
    {slug: 'move-3', dose: '3×10'}, {slug: 'move-4', dose: '45 s'}
  ]}]
});
const open = async (hash, options = {}) => { const page = await app({...signedIn, tables: tables(), hash, dom: true, ...options}); await settle(); return page; };
const view = page => page.element('view').innerHTML;

test('Q5: session exercise cards link to #session/<slug>/<n>, numbered over sheets that exist', async () => {
  const page = await open('#session/routine');
  const html = view(page);
  for (let n = 1; n <= 4; n++) assert.match(html, new RegExp(`href="#session/routine/${n}"[\\s\\S]*?<span class="k">${n}</span>`));
  assert.doesNotMatch(html, /deleted|1 min|#move-[1-4]"/);
});

test('Q5: a session exercise has its dose banner, session back link and previous/next navigation', async () => {
  const page = await open('#session/routine/2');
  const html = view(page);
  assert.equal(page.element('view').hidden, false);
  assert.match(html, /2\/4/);
  assert.doesNotMatch(html, /2\/4\s*·/);
  assert.match(html, /href="#session\/routine"[^>]*>← Routine<\/a>/);
  assert.match(html, /href="#session\/routine\/1"[^>]*>← Previous<\/a>|<button[^>]*>← Previous<\/button>/);
  assert.match(html, /Next: Third →/);
  assert.match(html, /#session\/routine\/3/);
});

test('Q5: the first exercise has no previous control; the last has Back to the session and no next control', async () => {
  const first = await open('#session/routine/1');
  assert.match(view(first), /1\/4 · 30 s/);
  assert.doesNotMatch(view(first), /← Previous/);
  assert.match(view(first), /Next: Second →/);
  const last = await open('#session/routine/4');
  assert.match(view(last), /4\/4 · 45 s/);
  assert.doesNotMatch(view(last), /Next:/);
  assert.match(view(last), /Back to the session/);
  assert.match(view(last), /href="#session\/routine"/);
});

test('Q5: reloading a session exercise route retains its banner; out-of-range routes open the session; a plain sheet route stays plain', async () => {
  const reloaded = await open('#session/routine/3');
  assert.match(view(reloaded), /3\/4 · 3×10/);
  const outOfRange = await open('#session/routine/5');
  assert.match(view(outOfRange), /<h1>Routine<\/h1>/);
  assert.doesNotMatch(view(outOfRange), /5\/4/);
  const plain = await open('#move-3');
  assert.match(view(plain), /My notes/);
  assert.doesNotMatch(view(plain), /3\/4 · 3×10|← Routine|← Previous|Next:/);
});

test('Q5: a sheet top bar labels its group Group · Back in normal, muted text', async () => {
  const page = await open('#move-1');
  assert.match(page.element('sheet-top').innerHTML, /Group · Back/);
  assert.doesNotMatch(page.element('sheet-top').innerHTML, />BACK</);
});

test('Q5: an empty session and a backend without the sessions table remain navigable', async () => {
  const emptyTables = tables();
  emptyTables.sessions[0].items = [];
  const empty = await open('#session/routine', {tables: emptyTables});
  assert.match(view(empty), /<h1>Routine<\/h1>/);
  assert.doesNotMatch(view(empty), /#session\/routine\/1/);
  const missing = await open('#move-1', {failing: {sessions: {error: {code: 'PGRST205', message: 'Could not find the table'}, status: 404}}});
  assert.match(view(missing), /My notes/);
});
