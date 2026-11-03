// L10 (session player): its routes and dose label (app/sessions.js) and the key points it reads from a sheet
// (app/sheet.js). The player screen itself is covered by tests/acceptance/l10.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const RS = require('../app/sessions.js');
const SH = require('../app/sheet.js');
const {parse} = require('./mini-dom.cjs');

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
