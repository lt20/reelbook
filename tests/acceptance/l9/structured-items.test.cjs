const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {app, ownUrl, ownKey} = require('../../harness.cjs');
const RS = require('../../../app/sessions.js');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const tables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: [{slug: 'move', kind: 'sheet', theme: 'strength', group: 'Shoulders', title: 'Move', summary: '', exercises: []}],
  sessions: [{slug: 'session-dose', theme: 'strength', title: 'Dose session', format: '60 s rest', origin: 'video', items: [
    {slug: 'move', dose: '3×10', sets: 4, reps: 12, seconds: 30, rest_s: 45, per_side: true}
  ]}]
});
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

test('Skill — session items document optional structured fields while keeping the editable dose', () => {
  const skill = fs.readFileSync(path.join(__dirname, '../../../skill/reelbook/SKILL.md'), 'utf8');
  for (const field of ['sets', 'reps', 'seconds', 'rest_s', 'per_side'])
    assert.match(skill, new RegExp('\\b' + field + '\\b'), field);
  assert.match(skill, /items\[\]\.dose|free-text.*dose|dose.*free-text/i);
  assert.match(skill, /video states|stated in the video|given in the video/i);
});

test('App — structured item values win over parsed dose and the free-text dose stays visible', async () => {
  const source = tables().sessions[0];
  const resolved = RS.resolveItems(source, new Map([['move', tables().sheets[0]]]));
  assert.equal(resolved.length, 1);
  for (const [field, value] of Object.entries({sets: 4, reps: 12, seconds: 30, rest_s: 45, per_side: true}))
    assert.equal(resolved[0][field], value, field);
  assert.equal(resolved[0].dose, '3×10');
  const page = await app({...signedIn, tables: tables(), hash: '#session/session-dose'});
  await settle();
  assert.equal(page.element('view').hidden, false);
  assert.match(page.element('view').innerHTML, /3×10/);
});

test('App — an item without structured fields can use its parsed free-text dose', () => {
  const resolved = RS.resolveItems({items: [{slug: 'move', dose: '3×10'}]}, new Map([['move', {slug: 'move'}]]));
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].dose, '3×10');
  assert.equal(resolved[0].sets, 3);
  assert.equal(resolved[0].reps, 10);
});

test('App — a backend without the sessions table still loads its sheets', async () => {
  const page = await app({...signedIn, tables: tables(), hash: '#strength', failing: {sessions: {error: {code: 'PGRST205', message: 'Could not find the table'}, status: 404}}});
  await settle();
  assert.equal(page.element('home').hidden, false); // the notebook page is drawn inside #home
  assert.match(page.element('groups').innerHTML, /href="#move"/);
  assert.doesNotMatch(page.element('groups').innerHTML, /#session\/session-dose/);
});

test('DoD — the app and service worker use one bumped sessions.js URL and a bumped shell cache', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../../app/index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '../../../app/sw.js'), 'utf8');
  const appVersion = Number(html.match(/<script src="sessions\.js\?v=(\d+)"/)[1]);
  const shellVersion = Number(sw.match(/['"]\.\/sessions\.js\?v=(\d+)['"]/)[1]);
  const cacheVersion = Number(sw.match(/const VERSION\s*=\s*['"]rb-shell-(\d+)['"]/)[1]);
  assert.ok(appVersion > 4, 'sessions.js URL is newer than the pre-L9 version');
  assert.equal(shellVersion, appVersion, 'SHELL caches the version loaded by index.html');
  assert.ok(cacheVersion > 24, 'the shell cache is newer than the pre-L9 cache');
});
