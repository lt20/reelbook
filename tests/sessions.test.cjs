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
