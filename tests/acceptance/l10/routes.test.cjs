const {test} = require('node:test');
const assert = require('node:assert/strict');
const RS = require('../../../app/sessions.js');

test('Route and entry: session exercise numbers follow the existing sheets, including when one was deleted', () => {
  const bySlug = new Map([['first', {slug: 'first'}], ['second', {slug: 'second'}], ['third', {slug: 'third'}]]);
  const session = {items: [
    {slug: 'first', dose: '3 × 10'}, {slug: 'deleted', dose: '1 min'},
    {slug: 'second', dose: '40 s'}, {slug: 'third', dose: '10 / side'}
  ]};
  assert.deepEqual(RS.resolveItems(session, bySlug).map(item => [item.n, item.sheet.slug, item.dose]), [
    [1, 'first', '3 × 10'], [2, 'second', '40 s'], [3, 'third', '10 / side']
  ]);
  assert.deepEqual(RS.resolveItems({items: []}, bySlug), []);
});
