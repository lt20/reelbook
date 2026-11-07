// « Move » on a session: the box that takes its exercises along (decision 11 of docs/sessions-v2.md, amended).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const sheet = (slug, theme = 'strength') => ({slug, kind: 'sheet', theme, group: 'Arms', title: slug, summary: '', added_at: '2026-10-01T00:00:00Z', source: {}, exercises: []});
const tables = (origin = 'video', sheets = [sheet('a'), sheet('b')]) => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}, {id: 'mobility', title: 'Mobility', groups: [], builtin: true, position: 1}],
  sheets,
  sessions: [{slug: 'gsp', theme: 'strength', title: 'GSP', origin, created_at: '2026-10-01T00:00:00Z', source: {}, key_points: [], items: sheets.map(s => ({slug: s.slug, dose: ''}))}]
});
const openMove = async (t, opts = {}) => {
  const page = await app({...signedIn, tables: t, hash: '#session/gsp', ...opts}); await settle();
  page.element('view').listeners.click({target: {closest: () => true}});
  assert.equal(page.element('move-dlg').open, true);
  page.element('mv-theme').value = 'mobility';
  return page;
};
// JSON: an array made inside the app's vm has another prototype, which deepEqual refuses.
// A sheets write is shown with its slugs (client.ins, in the same order).
const writes = page => {
  const client = page.clients.at(-1), ins = client.ins.filter(i => i[0] === 'sheets');
  return JSON.parse(JSON.stringify(client.calls.filter(c => c[0] === 'update').map(c => [c[1], c[2].theme, ...(c[1] === 'sheets' ? [ins.shift()[2]] : [])])));
};

test('a video session: the box is ticked, the sheets are written first, then the session', async () => {
  const page = await openMove(tables());
  assert.equal(page.element('mv-all-l').hidden, false);
  assert.equal(page.element('mv-all').checked, true);
  assert.equal(page.element('mv-all-t').textContent, 'Move its 2 exercises too');
  assert.equal(page.element('mv-hint').hidden, true);
  await page.fire('mv-form', 'submit');
  assert.deepEqual(writes(page), [['sheets', 'mobility', ['a', 'b']], ['sessions', 'mobility']]);
  assert.equal(page.element('move-dlg').open, false);
  assert.match(page.element('sheet-top').innerHTML, /Moved to Mobility\. Its 2 exercises moved too\./);
  page.go('#mobility'); await settle();
  assert.match(page.element('groups').innerHTML, /href="#a"[^]*href="#b"/);
  page.go('#strength'); await settle();
  assert.doesNotMatch(page.element('groups').innerHTML, /href="#[ab]"/);
});

test('the sheets moved keep their group', async () => {
  const page = await openMove(tables());
  await page.fire('mv-form', 'submit');
  const [, , payload] = page.clients.at(-1).calls.find(c => c[1] === 'sheets');
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {theme: 'mobility'});
});

test('a session the user composed: the box is shown unticked, and only the session moves', async () => {
  const page = await openMove(tables('user'));
  assert.equal(page.element('mv-all-l').hidden, false);
  assert.equal(page.element('mv-all').checked, false);
  await page.fire('mv-form', 'submit');
  assert.deepEqual(writes(page), [['sessions', 'mobility']]);
  assert.match(page.element('sheet-top').innerHTML, /Moved to Mobility\.<\/p>/);
});

test('the box unticked on a video session: only the session moves', async () => {
  const page = await openMove(tables());
  page.element('mv-all').checked = false;
  await page.fire('mv-form', 'submit');
  assert.deepEqual(writes(page), [['sessions', 'mobility']]);
});

test('an exercise in another notebook stays, and the dialog says so', async () => {
  const page = await openMove(tables('video', [sheet('a'), sheet('b', 'mobility')]));
  assert.equal(page.element('mv-all-t').textContent, 'Move its 1 exercise too');
  assert.equal(page.element('mv-hint').hidden, false);
  assert.equal(page.element('mv-hint').textContent, 'Its exercises in other notebooks stay where they are.');
  await page.fire('mv-form', 'submit');
  assert.deepEqual(writes(page), [['sheets', 'mobility', ['a']], ['sessions', 'mobility']]);
});

test('no exercise in the session\'s notebook: no box, nothing but the session is written', async () => {
  const page = await openMove(tables('video', [sheet('a', 'mobility')]));
  assert.equal(page.element('mv-all-l').hidden, true);
  assert.equal(page.element('mv-hint').textContent, 'Its exercises stay where they are.');
  await page.fire('mv-form', 'submit');
  assert.deepEqual(writes(page), [['sessions', 'mobility']]);
});

test('an exercise listed twice is written once', async () => {
  const t = tables();
  t.sessions[0].items = [{slug: 'a', dose: ''}, {slug: 'b', dose: ''}, {slug: 'a', dose: ''}];
  const page = await openMove(t);
  assert.equal(page.element('mv-all-t').textContent, 'Move its 2 exercises too');
  await page.fire('mv-form', 'submit');
  assert.deepEqual(writes(page)[0], ['sheets', 'mobility', ['a', 'b']]);
});

test('the sheets fail: the session is not written and nothing moved', async () => {
  const w = {sheets: {data: null, error: {message: 'nope'}}};
  const page = await openMove(tables(), {writes: w});
  await page.fire('mv-form', 'submit');
  assert.deepEqual(writes(page), [['sheets', 'mobility', ['a', 'b']]]);
  assert.equal(page.element('move-dlg').open, true);
  assert.equal(page.element('mv-err').textContent, 'Could not move it right now. Try again in a moment.');
  assert.equal(page.element('mv-all-l').hidden, false);
});

test('the session fails after the sheets: the error says it, and trying again writes the session alone', async () => {
  const w = {sessions: {data: null, error: {message: 'nope'}}};
  const page = await openMove(tables(), {writes: w});
  await page.fire('mv-form', 'submit');
  assert.equal(page.element('move-dlg').open, true);
  assert.equal(page.element('mv-err').textContent, 'Its exercises moved, but not the session. Try again in a moment.');
  assert.equal(page.element('mv-all-l').hidden, true);
  delete w.sessions;
  await page.fire('mv-form', 'submit');
  assert.deepEqual(writes(page), [['sheets', 'mobility', ['a', 'b']], ['sessions', 'mobility'], ['sessions', 'mobility']]);
  assert.equal(page.element('move-dlg').open, false);
  assert.match(page.element('sheet-top').innerHTML, /Moved to Mobility\.<\/p>/);
});

test('Move on a sheet shows neither the box nor the hint', async () => {
  const page = await app({...signedIn, tables: tables(), hash: '#a'}); await settle();
  page.element('view').listeners.click({target: {closest: () => true}});
  assert.equal(page.element('move-dlg').open, true);
  assert.equal(page.element('mv-all-l').hidden, true);
  assert.equal(page.element('mv-hint').hidden, true);
});
