// L11 (player: sets, rest timer, end of session): the pure helpers of app/sessions.js and what the acceptance tests
// (tests/acceptance/l11) do not pin: the rb.play.<uid> format, the rest carried to the next exercise, a rest
// taken to zero, the « Done today » write shared with « Save to log ».
const {test} = require('node:test');
const assert = require('node:assert/strict');
const RS = require('../app/sessions.js');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'u1@example.test'}}};
const tables = items => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: items.map((it, i) => ({slug: it.slug, kind: 'sheet', theme: 'strength', title: 'Exercise ' + (i + 1), html: ''})),
  sessions: [{slug: 'legs', theme: 'strength', title: 'Legs', format: '', items}], notes: [], requests: [], practice_log: []
});
const player = page => page.element('player').innerHTML;
const stored = page => JSON.parse(page.storage.get('rb.play.u1') || 'null');

test('set count: the sets of the dose, else one box', () => {
  assert.equal(RS.setCount({sets: 4}), 4);
  for (const it of [{sets: null}, {sets: 0}, {sets: 2.5}, {}, null]) assert.equal(RS.setCount(it), 1);
  assert.equal(RS.setCount({sets: 21}), 21); // every set of the dose gets its box
});

test('rest timer: rounded up, from the timestamps only, never below zero', () => {
  let now = 0;
  const clock = () => now;
  assert.equal(RS.restRemaining(0, 45, clock), 45);
  now = 1; assert.equal(RS.restRemaining(0, 45, clock), 45);
  now = 999; assert.equal(RS.restRemaining(0, 45, clock), 45);
  now = 1000; assert.equal(RS.restRemaining(0, 45, clock), 44);
  now = 15000; assert.equal(RS.restRemaining(0, 45, clock), 30);
  now = 45000; assert.equal(RS.restRemaining(0, 45, clock), 0);
  now = -5000; assert.equal(RS.restRemaining(0, 45, clock), 50); // a clock set back: still a number of seconds
  assert.equal(RS.restClock(45), '0:45');
  assert.equal(RS.restClock(60), '1:00');
  assert.equal(RS.restClock(125), '2:05');
  assert.equal(RS.restClock(-3), '0:00');
});

test('checked sets: cleaned, then counted per exercise', () => {
  assert.deepEqual(RS.cleanChecks({1: [3, 1, 1], 2: [], 3: ['2', 0, 21, 2], x: [1], 9: [1]}, 3), {1: [1, 3], 3: [2, 21]});
  assert.deepEqual(RS.cleanChecks(null), {});
  assert.deepEqual(RS.cleanChecks([1, 2]), {});
  assert.deepEqual(RS.playTally({1: [1, 2], 2: [1]}), {exercises: 2, sets: 3});
  assert.deepEqual(RS.playTally({}), {exercises: 0, sets: 0});
});

test('rb.play.<uid>: a place without checks stays a number, with checks it carries them; an old number still resumes', async () => {
  const items = [{slug: 'a', dose: '3 × 10'}, {slug: 'b', dose: '40 s'}, {slug: 'c', dose: '40 s'}];
  const page = await app({...signedIn, tables: tables(items), hash: '#session/legs/play', dom: true, stored: {'rb.play.u1': JSON.stringify({arms: 3})}});
  await settle();
  assert.deepEqual(stored(page), {arms: 3, legs: 1});
  await page.fire('play-set-2', 'change'); await settle();
  assert.deepEqual(stored(page), {arms: 3, legs: {n: 1, sets: {1: [2]}, of: {1: 'a'}}});
  await page.fire('play-set-2', 'change'); await settle(); // unchecked again
  assert.deepEqual(stored(page), {arms: 3, legs: 1});
  const old = await app({...signedIn, tables: tables(items), hash: '#session/legs/play', dom: true, stored: {'rb.play.u1': JSON.stringify({legs: 2})}});
  await settle();
  assert.match(player(old), /Resume at 2\/3/);
});

test('rest timer: it carries on over the next exercise, and −15 s down to zero ends it', async () => {
  const items = [{slug: 'a', dose: '2 × 10', rest_s: 20}, {slug: 'b', dose: '40 s'}];
  const page = await app({...signedIn, tables: tables(items), hash: '#session/legs/play', dom: true});
  await settle();
  await page.fire('play-set-2', 'change'); await settle();
  assert.match(player(page), /id="play-rest"[^>]*>0:20</);
  await page.fire('play-next'); await settle();
  assert.match(player(page), /2\/2/);
  assert.match(player(page), /id="play-rest"[^>]*>0:20</);
  await page.fire('play-rest-minus'); await settle();
  assert.match(player(page), /id="play-rest"[^>]*>0:05</);
  await page.fire('play-rest-minus'); await settle();
  assert.doesNotMatch(player(page), /id="play-rest"/);
  assert.match(player(page), /<p class="pl-dose">40 s<\/p>/);
});

test('end of session: Save to log keeps the session page’s « Done today » in step, and Back to another page drops it', async () => {
  const items = [{slug: 'a', dose: '40 s'}];
  const page = await app({...signedIn, tables: tables(items), hash: '#session/legs/play', dom: true});
  await settle();
  await page.fire('play-set-1', 'change'); await settle();
  await page.fire('play-finish'); await settle();
  assert.match(page.element('view').innerHTML, /Session done[\s\S]*<h1>Legs<\/h1>[\s\S]*1 exercise · 1 set/);
  await page.fire('end-save'); await settle();
  const writes = page.clients.at(-1).calls.filter(c => c[0] === 'insert' && c[1] === 'practice_log');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][2].done_on.length, 10);
  assert.doesNotMatch(page.element('view').innerHTML, /Session done/);
  assert.match(page.element('view').innerHTML, /<h1>Legs<\/h1>/);
  // a second play, then another page: the end screen is not shown again on the way back
  page.go('#session/legs/play'); await settle();
  await page.fire('play-finish'); await settle();
  assert.match(page.element('view').innerHTML, /Session done/);
  page.go('#strength'); await settle();
  page.go('#session/legs'); await settle();
  assert.doesNotMatch(page.element('view').innerHTML, /Session done/);
});

test('checked sets follow their sheet: a session edited meanwhile drops the checks it moved, and the sets it removed', () => {
  const items = [{sheet: {slug: 'a'}, sets: 3}, {sheet: {slug: 'b'}, sets: 2}];
  const checks = {1: [1, 3], 2: [2]};
  const of = RS.checksOf(checks, items);
  assert.deepEqual(of, {1: 'a', 2: 'b'});
  assert.deepEqual(RS.fitChecks(checks, of, items), checks);
  assert.deepEqual(RS.fitChecks(checks, of, [items[1], items[0]]), {}); // swapped: both lose theirs
  assert.deepEqual(RS.fitChecks(checks, of, [{sheet: {slug: 'a'}, sets: 2}, items[1]]), {1: [1], 2: [2]}); // 3 sets down to 2
  assert.deepEqual(RS.fitChecks(checks, undefined, items), {}); // no sheet stored: nothing is trusted
});

test('rest timer: « no rest » in the format or an item rest_s of 0 starts no countdown', async () => {
  for (const [first, format] of [[{slug: 'a', dose: '2 × 10'}, 'no rest'], [{slug: 'a', dose: '2 × 10', rest_s: 0}, '30 s rest']]) {
    const t = tables([first, {slug: 'b', dose: '40 s'}]); t.sessions[0].format = format;
    const page = await app({...signedIn, tables: t, hash: '#session/legs/play', dom: true});
    await settle();
    await page.fire('play-set-1', 'change'); await settle();
    assert.doesNotMatch(player(page), /id="play-rest"/, format);
    assert.match(player(page), /id="play-set-1"[^>]*checked/);
  }
});

test('sets: a session reordered after a set was checked does not show it on the other exercise', async () => {
  const t = tables([{slug: 'a', dose: '3 × 10'}, {slug: 'b', dose: '3 × 10'}]);
  const page = await app({...signedIn, tables: t, hash: '#session/legs/play', dom: true});
  await settle();
  await page.fire('play-set-1', 'change'); await settle();
  const swapped = tables([{slug: 'b', dose: '3 × 10'}, {slug: 'a', dose: '3 × 10'}]);
  const again = await app({...signedIn, tables: swapped, hash: '#session/legs/play/1', dom: true, stored: Object.fromEntries(page.storage)});
  await settle();
  assert.doesNotMatch(player(again), /id="play-set-1"[^>]*checked/);
  again.go('#session/legs/play/2'); await settle();
  assert.doesNotMatch(player(again), /id="play-set-1"[^>]*checked/); // its place changed: the check is dropped
});
