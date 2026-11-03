const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, ownUrl, ownKey} = require('../../harness.cjs');

const uid = 'player-user';
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: uid, email: 'player@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const tables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: [
    {slug: 'first', kind: 'sheet', theme: 'strength', group: 'Back', title: 'First exercise', summary: '', html: '<a href="#">Home</a>'},
    {slug: 'second', kind: 'sheet', theme: 'strength', group: 'Back', title: 'Second exercise', summary: '', html: '<a href="#">Home</a>'},
    {slug: 'third', kind: 'sheet', theme: 'strength', group: 'Back', title: 'Third exercise', summary: '', html: '<a href="#">Home</a>'}
  ],
  sessions: [{slug: 'routine', theme: 'strength', title: 'Routine', origin: 'user', items: [
    {slug: 'first', dose: '3 × 10'}, {slug: 'deleted', dose: '1 min'},
    {slug: 'second', dose: '40 s'}, {slug: 'third', dose: '10 / side'}
  ]}],
  notes: [], requests: []
});
const open = async (hash, options = {}) => {
  const page = await app({...signedIn, tables: tables(), hash, dom: true, ...options});
  await settle();
  return page;
};
const player = page => page.element('player').innerHTML;
const click = async (page, id) => { await page.fire(id); await settle(); };

test('Route and entry: Start under the session title opens #session/<slug>/play at exercise 1', async () => {
  const page = await open('#session/routine');
  const view = page.element('view').innerHTML;
  assert.match(view, /<h1>Routine<\/h1>[\s\S]*?<button[^>]*id="play-start"[^>]*>Start<\/button>/);
  await click(page, 'play-start');
  assert.equal(page.element('player').hidden, false);
  assert.match(player(page), /1\/3/);
  assert.match(player(page), /First exercise/);
  const direct = await open('#session/routine/play');
  assert.equal(direct.element('player').hidden, false);
  assert.match(player(direct), /1\/3/);
});

test('Route and entry: #session/<slug>/play/<n> opens exercise n, skipping a deleted sheet', async () => {
  const page = await open('#session/routine/play/2');
  assert.equal(page.element('player').hidden, false);
  assert.match(player(page), /2\/3/);
  assert.match(player(page), /Second exercise/);
  assert.match(player(page), /40 s/);
  assert.doesNotMatch(player(page), /deleted|1 min/);
});

test('Route and entry: Start on a sheet opens #<slug>/play with one exercise and no previous/next', async () => {
  const page = await open('#second');
  assert.match(page.element('view').innerHTML, /<button[^>]*id="play-start"[^>]*>Start<\/button>/);
  await click(page, 'play-start');
  assert.equal(page.element('player').hidden, false);
  assert.match(player(page), /Second exercise/);
  assert.doesNotMatch(player(page), /← Previous|Next →/);
  const direct = await open('#second/play');
  assert.equal(direct.element('player').hidden, false);
  assert.match(player(direct), /Second exercise/);
  assert.doesNotMatch(player(direct), /← Previous|Next →/);
});

test('Progress: the current exercise is remembered per user and session in rb.play.<uid>', async () => {
  const page = await open('#session/routine/play');
  await click(page, 'play-next');
  await click(page, 'play-next');
  assert.match(player(page), /3\/3/);
  const progress = page.storage.get('rb.play.' + uid);
  assert.ok(progress, 'progress is stored under the signed-in user');
  assert.match(progress, /routine/);
  assert.match(progress, /3/);
  assert.equal(page.storage.has('rb.play.someone-else'), false);
});

test('Progress: reopening #session/<slug>/play offers Resume at 3/5 or Start over', async () => {
  const five = tables();
  five.sheets.push(
    {slug: 'fourth', kind: 'sheet', theme: 'strength', title: 'Fourth exercise', html: '<a href="#">Home</a>'},
    {slug: 'fifth', kind: 'sheet', theme: 'strength', title: 'Fifth exercise', html: '<a href="#">Home</a>'}
  );
  five.sessions[0].items.push({slug: 'fourth', dose: ''}, {slug: 'fifth', dose: ''});
  const page = await open('#session/routine/play/3', {tables: five});
  const stored = Object.fromEntries(page.storage);
  page.go('#session/routine'); await settle();
  page.go('#session/routine/play'); await settle();
  assert.match(player(page), /Resume at 3\/5/);
  assert.match(player(page), /Start over/);
  await click(page, 'play-resume');
  assert.match(player(page), /3\/5/);
  assert.match(player(page), /Third exercise/);
  const again = await open('#session/routine/play', {tables: five, stored});
  assert.match(player(again), /Resume at 3\/5/);
  await click(again, 'play-restart');
  assert.match(player(again), /1\/5/);
  assert.match(player(again), /First exercise/);
});

test('Screen: the player is full screen without the app top bar, and ✕ returns to the session page', async () => {
  const page = await open('#session/routine/play/2');
  assert.equal(page.element('player').hidden, false);
  assert.equal(page.element('view').hidden, true);
  assert.match(player(page), /id="play-close"[^>]*>✕<\/button>/);
  assert.match(player(page), /2\/3/);
  assert.match(player(page), /Second exercise/);
  await click(page, 'play-close');
  assert.equal(page.element('player').hidden, true);
  assert.equal(page.element('view').hidden, false);
  assert.match(page.element('view').innerHTML, /<h1>Routine<\/h1>/);
});

test('Screen: the dose shows structured text, then free text, then nothing', async () => {
  const structured = await open('#session/routine/play/1');
  assert.match(player(structured), /3 × 10/);
  const free = tables();
  free.sessions[0].items[0].dose = 'Light band';
  const freePage = await open('#session/routine/play/1', {tables: free});
  assert.match(player(freePage), /Light band/);
  const blank = tables();
  blank.sessions[0].items[0].dose = '';
  const blankPage = await open('#session/routine/play/1', {tables: blank});
  assert.doesNotMatch(player(blankPage), /3 × 10|Light band/);
  assert.match(player(blankPage), /First exercise/);
});

test('Screen: Previous and Next move one exercise; Finish on the last returns to the session page', async () => {
  const page = await open('#session/routine/play/2');
  assert.match(player(page), /← Previous/);
  assert.match(player(page), /Next →/);
  await click(page, 'play-prev');
  assert.match(player(page), /1\/3/);
  assert.match(player(page), /First exercise/);
  await click(page, 'play-next');
  await click(page, 'play-next');
  assert.match(player(page), /3\/3/);
  assert.match(player(page), /Finish/);
  await click(page, 'play-finish');
  assert.equal(page.element('player').hidden, true);
  assert.match(page.element('view').innerHTML, /<h1>Routine<\/h1>/);
});

test('Screen: keep screen on is on while playing despite the toggle and released on leaving', async () => {
  const calls = [];
  const nav = {wakeLock: {async request(type) {
    calls.push('request:' + type);
    return {addEventListener() {}, async release() { calls.push('release'); }};
  }}};
  const page = await open('#session/routine/play/1', {nav});
  assert.deepEqual(calls, ['request:screen']);
  assert.equal(page.storage.has('rb.wake'), false);
  await click(page, 'play-close');
  assert.deepEqual(calls, ['request:screen', 'release']);
  page.go('#session/routine/play/1'); await settle();
  assert.deepEqual(calls, ['request:screen', 'release', 'request:screen']);
});

test('Screen: a refused wake lock leaves the player usable', async () => {
  const nav = {wakeLock: {async request() { throw new Error('NotAllowedError'); }}};
  const page = await open('#session/routine/play/1', {nav});
  assert.equal(page.element('player').hidden, false);
  assert.match(player(page), /First exercise/);
  await click(page, 'play-next');
  assert.match(player(page), /Second exercise/);
});

test('Screen: an empty session has no exercise to start', async () => {
  const empty = tables();
  empty.sessions[0].items = [];
  const page = await open('#session/routine', {tables: empty});
  assert.match(page.element('view').innerHTML, /<h1>Routine<\/h1>/);
  assert.doesNotMatch(page.element('view').innerHTML, /id="play-start"/);
  page.go('#session/routine/play'); await settle();
  assert.equal(page.element('player').hidden, true);
});

test('Screen: a backend without the sessions table still permits single-sheet play', async () => {
  const page = await open('#second/play', {failing: {sessions: {error: {code: 'PGRST205', message: 'Could not find the table'}, status: 404}}});
  assert.equal(page.element('player').hidden, false);
  assert.match(player(page), /Second exercise/);
});

test('Screen: a backend read error or offline response does not strand the player', async () => {
  const failing = {sessions: {error: {message: 'Failed to fetch'}, status: 0}};
  const page = await open('#second/play', {failing});
  assert.equal(page.element('player').hidden, false);
  assert.match(player(page), /Second exercise/);
  await click(page, 'play-close');
  assert.equal(page.element('player').hidden, true);
  assert.equal(page.element('view').hidden, false);
});

test('Screen styles: carousel, large dose, thumb controls, dark player and reduced motion', () => {
  assert.match(html, /scroll-snap-type\s*:\s*x\s+mandatory/);
  assert.match(html, /aspect-ratio\s*:\s*4\s*\/\s*5/);
  assert.match(html, /scroll-snap-align\s*:/);
  assert.match(html, /font-size\s*:\s*(?:56|5[7-9]|[6-9][0-9])px/);
  assert.match(html, /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/);
  assert.match(html, /\.player[^{]*\{[^}]*background\s*:/);
});
