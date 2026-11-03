// L5 (design audit Q5 Q2): moving through a session and notes that save themselves, beyond the acceptance
// tests in tests/acceptance/l5 (written by Codex). The harness runs timers as microtasks: the 800 ms delay,
// visibilitychange and pagehide are checked in a browser (screenshots of the PR).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const tables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: ['One', 'Two', 'Three'].map((title, i) => ({slug: `m${i + 1}`, kind: 'sheet', theme: 'strength', group: i ? 'Legs' : '', title, summary: '', html: '<a href="#">Home</a>', exercises: []})),
  sessions: [{slug: 'flow', theme: 'strength', title: 'Flow <3', format: '', origin: 'video', items: [{slug: 'm1', dose: '30 s'}, {slug: 'm2', dose: ''}, {slug: 'm3', dose: '3×10'}]}],
  notes: []
});
const open = async (hash, options = {}) => { const page = await app({...signedIn, tables: tables(), hash, dom: true, ...options}); await settle(); return page; };
const view = page => page.element('view').innerHTML;
const noteWrites = page => page.clients.at(-1).calls.filter(call => call[1] === 'notes' && call[0] === 'upsert');

test('L5: Next and Previous move through the session; titles are escaped; a sheet without group has no group label', async () => {
  const page = await open('#session/flow/1');
  assert.match(view(page), /href="#session\/flow"[^>]*>← Flow &lt;3<\/a>/);
  assert.match(view(page), /<p class="seat">1\/3 · 30 s<\/p>/);
  assert.doesNotMatch(page.element('sheet-top').innerHTML, /Group ·/, 'no group, no label');
  assert.match(view(page), /<a class="next" href="#session\/flow\/2">Next: Two →<\/a>/);
  page.go('#session/flow/2'); await settle();
  assert.match(view(page), /<p class="seat">2\/3<\/p>/);
  assert.match(page.element('sheet-top').innerHTML, /<span class="grp">Group · Legs<\/span>/);
  assert.match(view(page), /<a class="prev" href="#session\/flow\/1">← Previous<\/a><a class="next" href="#session\/flow\/3">Next: Three →<\/a>/);
  page.go('#m2'); await settle();
  assert.doesNotMatch(view(page), /class="seat"|class="seq"/, 'the same sheet opened on its own is plain');
  assert.match(view(page), /href="#strength">← Strength<\/a>/);
});

test('L5: « From the session » leaves out the session the sheet is opened from', async () => {
  const page = await open('#session/flow/3');
  assert.doesNotMatch(page.element('sheet-top').innerHTML, /From the session/);
  page.go('#m3'); await settle();
  assert.match(page.element('sheet-top').innerHTML, /From the session <a href="#session\/flow">Flow &lt;3<\/a>/);
});

test('L5: Keep screen on stays on from one exercise to the next', async () => {
  const log = [];
  const nav = {wakeLock: {async request(type) { log.push('request:' + type); return {addEventListener() {}, async release() { log.push('release'); }}; }}};
  const page = await open('#session/flow/1', {nav, stored: {'rb.wake': '1'}});
  assert.match(page.element('sheet-top').innerHTML, /id="wake" aria-pressed="true"/);
  page.go('#session/flow/2'); await settle();
  page.go('#session/flow/1'); await settle();
  assert.match(page.element('sheet-top').innerHTML, /id="wake" aria-pressed="true"/);
  assert.deepEqual(log, ['request:screen'], 'one lock, never released between exercises');
});

test('L5: a failed note save keeps the text; the next keystroke saves it again', async () => {
  const writes = {notes: {data: null, error: {message: 'offline'}}};
  const page = await open('#m1', {writes});
  page.element('n-text').value = 'Heavy today ';
  await page.fire('n-text', 'input'); await settle();
  assert.equal(page.element('n-status').textContent, 'Not saved');
  assert.equal(page.element('n-retry').hidden, false);
  assert.equal(page.element('n-text').value, 'Heavy today ', 'the text stays in the field');
  delete writes.notes; // back online
  page.element('n-text').value = 'Heavy today, 20 kg';
  await page.fire('n-text', 'input'); await settle();
  assert.equal(page.element('n-status').textContent, 'Saved');
  assert.equal(page.element('n-retry').hidden, true);
  assert.deepEqual(JSON.parse(JSON.stringify(noteWrites(page).map(c => c[2]))), [{slug: 'm1', body: 'Heavy today'}, {slug: 'm1', body: 'Heavy today, 20 kg'}]);
});

test('L5: leaving the page saves nothing more when the note is saved; a note typed back to the saved text is not written', async () => {
  const t = tables();
  t.notes = [{slug: 'session/flow', body: 'Done twice', updated_at: '2026-11-01T10:00:00Z'}];
  const page = await open('#session/flow', {tables: t});
  page.element('n-text').value = 'Done twice ';
  await page.fire('n-text', 'input'); await settle();
  assert.equal(noteWrites(page).length, 0, 'only spaces added: same text');
  assert.equal(page.element('n-status').textContent, 'Saved');
  page.element('n-text').value = 'Done three times';
  await page.fire('n-text', 'input'); await settle();
  page.go('#session/flow/1'); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(noteWrites(page).map(c => c[2]))), [{slug: 'session/flow', body: 'Done three times'}]);
});

test('L5: a note that cannot be read is never overwritten by typing', async () => {
  const page = await open('#m1', {failing: {notes: {error: {message: 'offline'}, status: 0}}});
  assert.equal(page.element('n-status').textContent, 'Could not read the note.');
  page.element('n-text').value = 'typed over';
  await page.fire('n-text', 'input'); await settle();
  page.go('#m2'); await settle();
  assert.equal(noteWrites(page).length, 0);
});

test('L5: a typed note not saved yet is kept on the device and shown again, Not saved, until Retry saves it', async () => {
  const failed = await open('#m1', {writes: {notes: {data: null, error: {message: 'offline'}}}});
  failed.element('n-text').value = 'Heavy today';
  await failed.fire('n-text', 'input'); await settle();
  assert.equal(failed.storage.get('rb.draft.u1.m1'), 'Heavy today');
  const t = tables();
  t.notes = [{slug: 'm1', body: 'Older', updated_at: '2026-11-01T10:00:00Z'}];
  const page = await open('#m1', {tables: t, stored: {'rb.draft.u1.m1': 'Heavy today'}});
  assert.equal(page.element('n-text').value, 'Heavy today');
  assert.equal(page.element('n-status').textContent, 'Not saved');
  assert.equal(page.element('n-retry').hidden, false);
  await page.fire('n-retry'); await settle();
  assert.equal(page.element('n-status').textContent, 'Saved');
  assert.deepEqual(JSON.parse(JSON.stringify(noteWrites(page).map(c => c[2]))), [{slug: 'm1', body: 'Heavy today'}]);
  assert.equal(page.storage.has('rb.draft.u1.m1'), false, 'saved: the device copy goes');
});

test('L5: opened offline, the device copy of a note is shown, Not saved; Retry back online reads then saves it', async () => {
  const failing = {notes: {error: {message: 'offline'}, status: 0}};
  const page = await open('#m1', {failing, stored: {'rb.draft.u1.m1': 'Heavy today'}});
  assert.equal(page.element('n-text').value, 'Heavy today');
  assert.equal(page.element('n-status').textContent, 'Not saved');
  assert.equal(page.element('n-retry').hidden, false);
  delete failing.notes; // back online
  await page.fire('n-retry'); await settle();
  assert.equal(page.element('n-status').textContent, 'Saved');
  assert.deepEqual(JSON.parse(JSON.stringify(noteWrites(page).map(c => c[2]))), [{slug: 'm1', body: 'Heavy today'}]);
});

test('L5: a session exercise whose sheet cannot be loaded still has Previous / Next', async () => {
  const page = await open('#session/flow/2', {dom: false}); // no DOMParser: loadSheet fails
  assert.match(view(page), /This sheet could not be loaded\./);
  assert.match(view(page), /<a class="prev" href="#session\/flow\/1">← Previous<\/a><a class="next" href="#session\/flow\/3">Next: Three →<\/a>/);
});
