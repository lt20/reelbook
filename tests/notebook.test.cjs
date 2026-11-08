// L12 regression tests (the acceptance tests are tests/acceptance/l12): a sheet only counts as a session exercise
// when a *video* session lists it; a session the user made from the notebook's sheets leaves them standalone.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'reader@example.test'}}};
const library = [{id: 'strength', title: 'Strength', groups: ['Shoulders', 'Arms']}];
const sheets = [
  {slug: 'angel', kind: 'sheet', theme: 'strength', group: 'Shoulders', title: 'Floor angel', summary: 'Standalone.'},
  {slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Hammer curl', summary: 'Standalone, in a made session.'},
  {slug: 'rotation', kind: 'sheet', theme: 'strength', group: 'Shoulders', title: 'External rotation', summary: 'Video and made.'}
];
const sessions = [
  {slug: 'video-one', theme: 'strength', title: 'Video one', origin: 'video', why: '', items: [{slug: 'rotation'}]},
  {slug: 'mine', theme: 'strength', title: 'Mine', origin: 'user', why: '', items: [{slug: 'curl'}, {slug: 'rotation'}]}
];
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

test('L12 — a made session leaves its sheets standalone; a sheet shared with a video session is an exercise once', async () => {
  const page = await app({...signedIn, library, hash: '#strength', tables: {
    user_themes: [{id: 'strength', title: 'Strength', groups: library[0].groups, builtin: true, position: 0}], sheets, sessions}});
  await settle();
  assert.equal(page.element('count').textContent, '2 sheets · 2 sessions (1 exercise)');
  const groups = page.element('groups').innerHTML;
  const arms = groups.match(/data-group="Arms"[\s\S]*?<\/section>/)[0];
  assert.match(arms, /href="#curl"/);
  assert.doesNotMatch(arms, /From sessions/, 'a sheet of a made session only is standalone');
  const shoulders = groups.match(/data-group="Shoulders"[\s\S]*?<\/section>/)[0];
  assert.ok(shoulders.indexOf('href="#angel"') < shoulders.indexOf('From sessions'));
  assert.ok(shoulders.indexOf('From sessions') < shoulders.indexOf('href="#rotation"'));
  assert.equal((shoulders.match(/href="#rotation"/g) || []).length, 1, 'listed once');
});

test('L12 — #<notebook>~<group> shows that group as a grid; an unknown group falls back to the rows', async () => {
  const page = await app({...signedIn, library, hash: '#strength~Arms', tables: {
    user_themes: [{id: 'strength', title: 'Strength', groups: library[0].groups, builtin: true, position: 0}], sheets, sessions}});
  await settle();
  assert.match(page.element('groups').innerHTML, /class="grid"/);
  assert.equal(page.element('nav-back').textContent, '‹ Strength'); // L17: a group grid goes back to its notebook
  page.go('#strength~Nope');
  await settle();
  assert.match(page.element('groups').innerHTML, /class="group-row"/);
  assert.doesNotMatch(page.element('groups').innerHTML, /class="grid"/);
});
