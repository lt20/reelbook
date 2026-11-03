const {test} = require('node:test');
const assert = require('node:assert/strict');
const RS = require('../app/sessions.js');

test('the session route never collides with a sheet slug or a notebook id', () => {
  assert.equal(RS.sessionHref('gsp-shoulders'), '#session/gsp-shoulders');
  assert.equal(RS.sessionSlugOf('session/gsp-shoulders'), 'gsp-shoulders');
  for (const tok of ['session', 'session/', 'gsp-shoulders', 'strength', 'settings', '', undefined]) assert.equal(RS.sessionSlugOf(tok), null, String(tok));
});

test('a missing sessions table is recognised, other errors are not', () => {
  assert.equal(RS.missingTable({code: 'PGRST205', message: 'Could not find the table'}, 404), true);
  assert.equal(RS.missingTable({code: '42P01', message: 'relation does not exist'}, 400), true);
  assert.equal(RS.missingTable({message: 'Not Found'}, 404), true);
  assert.equal(RS.missingTable({code: '42501', message: 'permission denied'}, 403), false);
  assert.equal(RS.missingTable(null, 200), false);
});

test('old one-page sessions (kind « session ») are set apart and counted, the order of the sheets is kept', () => {
  const rows = [{slug: 'b', kind: 'sheet'}, {slug: 'old', kind: 'session'}, {slug: 'a'}, null, {slug: 'old2', kind: 'session'}];
  const {sheets, v1} = RS.splitV1(rows);
  assert.deepEqual(sheets.map(s => s.slug), ['b', 'a']);
  assert.equal(v1, 2);
  assert.deepEqual(RS.splitV1(null), {sheets: [], v1: 0});
});

test('items keep their order and dose, a deleted sheet is skipped and takes no number', () => {
  const bySlug = new Map([['a', {slug: 'a'}], ['c', {slug: 'c'}]]);
  const s = {items: [{slug: 'c', dose: '30 s'}, {slug: 'b', dose: '1 min'}, null, {dose: 'x'}, {slug: 'a'}]};
  assert.deepEqual(RS.resolveItems(s, bySlug).map(it => [it.sheet.slug, it.dose, it.n]), [['c', '30 s', 1], ['a', '', 2]]);
  assert.deepEqual(RS.resolveItems({items: 'nope'}, bySlug), []);
  assert.deepEqual(RS.resolveItems(null, bySlug), []);
});

test('« in N sessions » counts each session once per sheet', () => {
  const s1 = {slug: 's1', items: [{slug: 'a'}, {slug: 'b'}, {slug: 'a'}]}, s2 = {slug: 's2', items: [{slug: 'a'}]}, s3 = {slug: 's3'};
  const m = RS.sessionsBySheet([s1, s2, s3]);
  assert.deepEqual(m.get('a'), [s1, s2]);
  assert.deepEqual(m.get('b'), [s1]);
  assert.equal(m.has('c'), false);
});

test('a session note never collides with a sheet note', () => {
  assert.equal(RS.noteKey('gsp-shoulders'), 'session/gsp-shoulders');
  assert.equal(RS.sessionSlugOf(RS.noteKey('gsp-shoulders')), 'gsp-shoulders');
  assert.equal(RS.sessionSlugOf('gsp-shoulders'), null, 'a sheet note is not a session note');
});

test('a new session slug comes from its title and is unique', () => {
  assert.equal(RS.uniqueSlug('Épaules, lundi !', []), 'my-epaules-lundi');
  assert.equal(RS.uniqueSlug('Épaules, lundi !', ['my-epaules-lundi']), 'my-epaules-lundi-2');
  assert.equal(RS.uniqueSlug('Epaules lundi', new Set(['my-epaules-lundi', 'my-epaules-lundi-2'])), 'my-epaules-lundi-3');
  assert.equal(RS.uniqueSlug('  ?!  ', []), 'my-session');
  assert.equal(RS.uniqueSlug('???', ['my-session']), 'my-session-2');
  assert.ok(!RS.uniqueSlug('Session X', []).startsWith('session-'), 'never the « session-… » space of video sessions');
  const long = RS.uniqueSlug('a very long title that goes on and on, well past any sensible slug length', []);
  assert.ok(long.length <= 48 && !long.endsWith('-'), long);
  assert.ok(!RS.uniqueSlug('a/b', []).includes('/'), 'never a « / »: the route and the note key rely on it');
});

test('ticking keeps the order of the ticks, unticking removes', () => {
  let p = [];
  for (const s of ['b', 'a', 'c']) p = RS.toggle(p, s);
  assert.deepEqual(p, ['b', 'a', 'c']);
  p = RS.toggle(p, 'a');
  assert.deepEqual(p, ['b', 'c']);
  assert.deepEqual(RS.toggle(p, 'a'), ['b', 'c', 'a']);
});

test('« Add to session » appends once, never twice', () => {
  const items = [{slug: 'a', dose: '30 s'}];
  const r = RS.addItem(items, 'b');
  assert.equal(r.added, true);
  assert.deepEqual(r.items, [{slug: 'a', dose: '30 s'}, {slug: 'b', dose: ''}]);
  assert.deepEqual(items, [{slug: 'a', dose: '30 s'}], 'the input is left alone');
  const again = RS.addItem(r.items, 'a');
  assert.equal(again.added, false);
  assert.equal(again.items.length, 2);
  assert.deepEqual(RS.addItem(undefined, 'x').items, [{slug: 'x', dose: ''}]);
});

test('↑ ↓ swap with the neighbour, out of range changes nothing, remove drops one item', () => {
  const it = ['a', 'b', 'c'].map(slug => ({slug, dose: ''}));
  const slugs = l => l.map(x => x.slug).join('');
  assert.equal(slugs(RS.moveItem(it, 1, -1)), 'bac');
  assert.equal(slugs(RS.moveItem(it, 1, 1)), 'acb');
  assert.equal(slugs(RS.moveItem(it, 0, -1)), 'abc');
  assert.equal(slugs(RS.moveItem(it, 2, 1)), 'abc');
  assert.equal(slugs(RS.moveItem(it, 7, 1)), 'abc');
  assert.equal(slugs(it), 'abc', 'the input is left alone');
  assert.equal(slugs(RS.removeItem(it, 1)), 'ac');
});

test('what Edit saves: slug and a trimmed dose within its limit', () => {
  const out = RS.cleanItems([{slug: 'a', dose: '  3×10  ', extra: 1}, {slug: 'b'}, {dose: 'x'}, {slug: 'c', dose: 'x'.repeat(90)}]);
  assert.deepEqual(out.slice(0, 2), [{slug: 'a', dose: '3×10'}, {slug: 'b', dose: ''}]);
  assert.equal(out[2].slug, 'c');
  assert.equal(out[2].dose.length, RS.MAX.dose);
  assert.equal(RS.clip('  ' + 'y'.repeat(100), RS.MAX.title).length, 80);
});

test('C1: the limits leave room for video sessions (formats up to 240, doses up to 60, titles 80)', () => {
  assert.deepEqual({...RS.MAX}, {title: 80, format: 240, dose: 60});
  const format = 'f'.repeat(206), dose = 'd'.repeat(55);
  assert.equal(RS.clip(format, RS.MAX.format), format);
  assert.deepEqual(RS.cleanItems([{slug: 'a', dose}]), [{slug: 'a', dose}]);
});

test('C1: only an edited text is clipped; an untouched one is kept as it is, even past its limit', () => {
  const long = 'x'.repeat(250);
  assert.equal(RS.keepOrClip(long, long, RS.MAX.format), long);
  assert.equal(RS.keepOrClip(long + 'y', long, RS.MAX.format), long.slice(0, 240));
  assert.equal(RS.keepOrClip('  a  ', undefined, 10), 'a');
  assert.equal(RS.keepOrClip('', null, 10), '');
  const dose = 'd'.repeat(70);
  assert.deepEqual(RS.cleanItems([{slug: 'a', dose, was: dose}, {slug: 'b', dose: dose + '!', was: dose}]),
    [{slug: 'a', dose}, {slug: 'b', dose: dose.slice(0, 60)}]);
});
