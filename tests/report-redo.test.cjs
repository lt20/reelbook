// L7 — « Something wrong? » corrections, beyond the acceptance tests (tests/acceptance/l7): a failed correction
// shows its error and goes back with its instruction on Retry; the text is sent on one line.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const url = 'https://www.instagram.com/reel/example/';
const themes = [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}];
const writes = page => JSON.parse(JSON.stringify(page.clients.at(-1).calls.filter(c => ['insert', 'update'].includes(c[0]))));

test('a failed correction shows the error, and Retry queues it again with its « Redo: » line', async () => {
  const requests = [{id: 'r1', url, status: 'error', theme: 'strength', note: 'Redo: the hands are reversed\nVideo unavailable', created_at: '2026-11-01T12:00:00Z'}];
  const page = await app({...signedIn, tables: {user_themes: themes, sheets: [], sessions: [], requests}}); await settle();
  await page.fire('otw-band');
  const row = page.element('queue').innerHTML;
  assert.match(row, /<span class="t1">Fix requested · Instagram reel<\/span><small class="fixnote">the hands are reversed<\/small>/); // P8 R20
  assert.match(row, /class="why">Video unavailable</);
  // P8 R3: Retry is the failed row's fix, « Try again »
  await page.element('queue').listeners.click({target: {closest: s => s === '[data-row]' ? {dataset: {row: 'r1'}, disabled: false} : null}});
  await page.element('otw-row').listeners.click({target: {closest: s => s === '[data-fixdone]' ? {dataset: {}} : null}});
  await settle();
  assert.deepEqual(writes(page), [['update', 'requests', {status: 'queued', note: 'Redo: the hands are reversed', processed_at: null}, [['id', 'r1']]]]);
});

test('the correction text is sent on one line', async () => {
  const sheet = {slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Curl', summary: '', source: {url}, exercises: []};
  const page = await app({...signedIn, tables: {user_themes: themes, sheets: [sheet], sessions: [], requests: []}, hash: '#curl', dom: true}); await settle();
  page.element('view').listeners.click({target: {closest: s => s === '#report-open' ? {} : null}});
  page.element('report-note').value = '  First line\n\nsecond   line ';
  await page.fire('report-send'); await settle();
  assert.equal(writes(page).at(-1)[2].note, 'Redo: First line second line');
});

test('a sheet that fails to load stays « New »', async () => {
  const fresh = {slug: 'fresh', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Fresh', summary: '', added_at: new Date().toISOString(), source: {}, exercises: []};
  // no `dom`: the harness has no DOMParser, so loadSheet fails (« This sheet could not be loaded. »)
  const page = await app({...signedIn, tables: {user_themes: themes, sheets: [fresh], sessions: []}}); await settle();
  page.go('#fresh'); await settle();
  assert.match(page.element('view').innerHTML, /could not be loaded/);
  assert.equal(page.storage.get('rb.seen.u1'), undefined);
  page.go('#'); await settle();
  assert.equal(page.element('new-sec').hidden, false);
});
