const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const RS = require('../../../app/sessions.js');

test('Q5: RS parses the session exercise route without confusing it with a session, sheet or note key', () => {
  assert.equal(RS.sessionSlugOf('session/routine'), 'routine');
  assert.equal(RS.sessionSlugOf('session/routine/2'), 'routine');
  assert.equal(RS.sessionSlugOf('routine'), null);
  assert.equal(RS.sessionSlugOf('session/routine/0'), null);
  assert.equal(RS.sessionSlugOf('session/routine/nope'), null);
  assert.equal(RS.sessionSlugOf('session/routine/2/extra'), null);
  assert.equal(RS.noteKey('routine'), 'session/routine');
});

test('Q5: RS keeps the visible item order and doses when a sheet has been deleted', () => {
  const bySlug = new Map([['a', {slug: 'a'}], ['c', {slug: 'c'}], ['d', {slug: 'd'}]]);
  const items = RS.resolveItems({items: [{slug: 'a', dose: '30 s'}, {slug: 'gone', dose: '1 min'}, {slug: 'c', dose: ''}, {slug: 'd', dose: '45 s'}]}, bySlug);
  assert.deepEqual(items.map(item => [item.sheet.slug, item.n, item.dose]), [['a', 1, '30 s'], ['c', 2, ''], ['d', 3, '45 s']]);
});

test('Q5: the publishing skill copies a session-wide dose into every items[].dose and leaves doses editable', () => {
  const skill = fs.readFileSync(path.join(__dirname, '../../../skill/reelbook/SKILL.md'), 'utf8');
  assert.match(skill, /format[\s\S]*one dose for every exercise[\s\S]*items\[\]\.dose/i);
  assert.match(skill, /items\[\]\.dose[\s\S]*edit/i);
});
