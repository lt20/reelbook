// L10 (session player): its routes and dose label (app/sessions.js) and the key points it reads from a sheet
// (app/sheet.js). The player screen itself is covered by tests/acceptance/l10.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const RS = require('../app/sessions.js');
const SH = require('../app/sheet.js');
const {parse} = require('./mini-dom.cjs');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const template = name => fs.readFileSync(path.join(__dirname, '../templates', name), 'utf8');

test('play routes: a session from the start or at n, a single sheet, nothing else', () => {
  assert.deepEqual(RS.playRoute('session/legs/play'), {session: 'legs', n: null});
  assert.deepEqual(RS.playRoute('session/legs/play/3'), {session: 'legs', n: 3});
  assert.deepEqual(RS.playRoute('squat/play'), {sheet: 'squat'});
  for (const tok of ['session/legs', 'session/legs/2', 'session/legs/play/0', 'session/legs/play/x', 'session/legs/play/2/1',
    'session//play', 'squat', 'squat/play/2', '/play', 'play', '', null]) assert.equal(RS.playRoute(tok), null, String(tok));
  assert.equal(RS.playHref('legs'), '#session/legs/play');
  assert.equal(RS.playHref('legs', 2), '#session/legs/play/2');
  assert.equal(RS.sheetPlayHref('squat'), '#squat/play');
  // a play route is not an exercise route of L5, nor a session page
  assert.equal(RS.sessionItemOf('session/legs/play/2'), null);
  assert.equal(RS.sessionSlugOf('session/legs/play'), null);
});

test('dose label: the numbers of the item, else nothing (the player falls back to the free text)', () => {
  const bySlug = new Map([['a', {slug: 'a'}]]);
  const label = item => RS.doseLabel(RS.resolveItems({items: [{slug: 'a', ...item}]}, bySlug)[0]);
  assert.equal(label({dose: '3 × 10'}), '3 × 10');
  assert.equal(label({dose: '3 x 8-12'}), '3 × 8-12');
  assert.equal(label({dose: '40 s'}), '40 s');
  assert.equal(label({dose: '4 x 30 s'}), '4 × 30 s');
  assert.equal(label({dose: '1 min'}), '1 min');
  assert.equal(label({dose: '90 s'}), '90 s');
  assert.equal(label({dose: '2 min 30'}), '2:30');
  assert.equal(label({dose: '', reps: 10, per_side: true}), '10 / side');
  assert.equal(label({dose: '3 x 10', reps: 12}), '3 × 12', 'a structured field wins, without the range of the text');
  assert.equal(label({dose: 'Light band'}), '');
  assert.equal(label({dose: ''}), '');
  assert.equal(RS.doseLabel(null), '');
});

test('key points: the first three of the sheet, bold cue and the rest, also once arranged with « +N more »', () => {
  const six = template('sheet.html').replace('<li><b>Third cue.</b> One sentence.</li>',
    '<li><b>Third cue.</b> One sentence.</li><li><b>Fourth cue.</b> Four.</li>');
  const raw = parse(six);
  assert.deepEqual(SH.keyPoints(raw), [
    {cue: 'Short bold cue.', text: 'One sentence that explains it.'}, {cue: 'Second cue.', text: 'One sentence.'},
    {cue: 'Third cue.', text: 'One sentence.'}]);
  const doc = parse(six); SH.arrange(doc);
  assert.deepEqual(SH.keyPoints(doc), SH.keyPoints(raw));
  assert.deepEqual(SH.keyPoints(doc, 5).map(k => k.cue), ['Short bold cue.', 'Second cue.', 'Third cue.', 'Fourth cue.']);
  assert.deepEqual(SH.keyPoints(parse('<div class="wrap"><ol class="keys"><li>Plain cue</li><li> </li></ol><ul class="keys"><li>Not a key</li></ul></div>')),
    [{cue: '', text: 'Plain cue'}]);
  assert.deepEqual(SH.keyPoints(parse('<p>No list</p>')), []);
  assert.deepEqual(SH.keyPoints(null), []);
});

test('player: Finish forgets the session in rb.play.<uid>, other sessions stay', async () => {
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
  const tables = {user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
    sheets: [{slug: 'a', kind: 'sheet', theme: 'strength', title: 'A', html: ''}, {slug: 'b', kind: 'sheet', theme: 'strength', title: 'B', html: ''}],
    sessions: [{slug: 'legs', theme: 'strength', title: 'Legs', items: [{slug: 'a', dose: ''}, {slug: 'b', dose: ''}]}], notes: [], requests: []};
  const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'u1@example.test'}}};
  const page = await app({...signedIn, tables, hash: '#session/legs/play/2', dom: true, stored: {'rb.play.u1': JSON.stringify({arms: 3})}}); await settle();
  assert.deepEqual(JSON.parse(page.storage.get('rb.play.u1')), {arms: 3, legs: 2});
  await page.fire('play-finish'); await settle();
  assert.deepEqual(JSON.parse(page.storage.get('rb.play.u1')), {arms: 3});
  assert.equal(page.element('player').hidden, true);
  assert.match(page.element('view').innerHTML, /<h1>Legs<\/h1>/);
});

test('player: a sheet that fails to load says so in place of its photos and key points', async () => {
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
  const tables = {user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
    sheets: [{slug: 'squat', kind: 'sheet', theme: 'strength', title: 'Squat', html: '<a href="#">Home</a>'}], sessions: [], notes: [], requests: []};
  const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'u1@example.test'}}};
  // without a DOMParser (dom: false) loadSheet throws, as on a network or backend error
  const failed = await app({...signedIn, tables, hash: '#squat/play'}); await settle();
  assert.equal(failed.element('player').hidden, false);
  assert.match(failed.element('player').innerHTML, /Squat[\s\S]*id="play-finish"/);
  assert.match(failed.element('play-media').innerHTML, /This sheet could not be loaded/);
  const loaded = await app({...signedIn, tables, hash: '#squat/play', dom: true}); await settle();
  assert.doesNotMatch(loaded.element('play-media').innerHTML, /could not be loaded/);
});

// The harness has no sheet.js nor a full DOMParser, so the carousel is checked through what playMedia calls.
test('player: the carousel shows the movement only, never a « Common mistakes » photo (L15)', () => {
  const raw = parse(template('exercise.html'));
  assert.deepEqual(SH.photosOf(raw).map(p => p.src), ['img/01-start.jpg', 'img/02-middle.jpg', 'img/03-end.jpg']);
  assert.ok(SH.photosOf(raw).every(p => !p.bad));
  const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
  assert.match(html, /const photos = SH\.photosOf\(page\),/, 'the player asks for the movement photos only');
  assert.match(html, /list \|\| SH\.photosOf\(view, true\)/, 'the sheet page viewer keeps the mistakes');
});
