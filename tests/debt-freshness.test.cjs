// Debt D1 (design audit, COORDINATION « Debt »): a session Edit is written only over the version it was opened on
// (#36), and signing out leaves no note draft of the account on the device (#30).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const T1 = '2026-11-04T08:00:00.123456+00:00', T2 = '2026-11-04T09:30:00.654321+00:00';
const tables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: [
    {slug: 'm1', kind: 'sheet', theme: 'strength', group: '', title: 'One', summary: '', html: '<a href="#">Home</a>', exercises: []},
    {slug: 'm2', kind: 'sheet', theme: 'strength', group: '', title: 'Two', summary: '', html: '<a href="#">Home</a>', exercises: []}
  ],
  sessions: [{slug: 'flow', theme: 'strength', title: 'Flow', format: '', origin: 'user', items: [{slug: 'm1', dose: '30 s'}, {slug: 'm2', dose: ''}], updated_at: T1}],
  notes: []
});
const clickIn = (page, selector, dataset = {}) => page.element('view').listeners.click({target: {closest: s => s === selector ? {dataset} : null}});
const typeIn = (page, target) => page.element('view').listeners.input({target: {dataset: {}, ...target}});
const sessionWrites = page => JSON.parse(JSON.stringify(page.clients.at(-1).calls.filter(c => c[1] === 'sessions' && ['update', 'insert', 'delete'].includes(c[0]))));

test('#36: Edit writes only over the version it was opened on (updated_at in the condition)', async () => {
  const page = await app({...signedIn, tables: tables(), hash: '#session/flow', writes: {sessions: {data: [{slug: 'flow', updated_at: T2}], error: null}}});
  await settle();
  clickIn(page, '#ed-open');
  typeIn(page, {id: 'ed-title', value: 'Flow, Monday'});
  clickIn(page, '#ed-save'); await settle();
  assert.deepEqual(sessionWrites(page), [['update', 'sessions',
    {title: 'Flow, Monday', format: '', items: [{slug: 'm1', dose: '30 s'}, {slug: 'm2', dose: ''}]}, [['slug', 'flow'], ['updated_at', T1]]]]);
  assert.match(page.element('view').innerHTML, /Saved\./);
  // the next Edit starts from the version this save gave the row
  clickIn(page, '#ed-open');
  typeIn(page, {id: 'ed-format', value: '3 rounds'});
  clickIn(page, '#ed-save'); await settle();
  assert.deepEqual(sessionWrites(page)[1][3], [['slug', 'flow'], ['updated_at', T2]]);
});

test('#36: a session changed since Edit opened is not overwritten; Reload opens the new version in Edit', async () => {
  const t = tables();
  const page = await app({...signedIn, tables: t, hash: '#session/flow', writes: {sessions: {data: [], error: null}}});
  await settle();
  clickIn(page, '#ed-open');
  typeIn(page, {id: 'ed-title', value: 'My title'});
  clickIn(page, '#ed-save'); await settle();
  const err = page.element('ed-err');
  assert.equal(err.hidden, false);
  assert.match(err.innerHTML, /This session changed since you opened it\. Reload to see the new version\..*id="ed-reload">Reload<\/button>/);
  assert.equal(page.element('ed-save').disabled, true, 'Save waits for Reload');
  assert.match(page.element('view').innerHTML, /Editing the session/, 'the edits stay on screen, to copy');
  // published meanwhile (rb.py): a structured dose and a new title
  t.sessions[0] = {...t.sessions[0], title: 'Flow v2', items: [{slug: 'm1', dose: '45 s', sets: 3}, {slug: 'm2', dose: ''}], updated_at: T2};
  clickIn(page, '#ed-reload'); await settle();
  const html = page.element('view').innerHTML;
  assert.match(html, /Editing the session/);
  assert.match(html, /id="ed-title"[^>]*value="Flow v2"/);
  assert.match(page.element('sheet-top').innerHTML, /This is the new version\. Your changes were not saved\./);
  assert.equal(sessionWrites(page).length, 1, 'the refused write is the only one');
  // saving now goes over the new version
  clickIn(page, '#ed-save'); await settle();
  assert.deepEqual(sessionWrites(page)[1][3], [['slug', 'flow'], ['updated_at', T2]]);
});

test('#36: Reload of a session deleted meanwhile goes back to its notebook', async () => {
  const t = tables();
  const page = await app({...signedIn, tables: t, hash: '#session/flow', writes: {sessions: {data: [], error: null}}});
  await settle();
  clickIn(page, '#ed-open');
  clickIn(page, '#ed-save'); await settle();
  t.sessions = [];
  clickIn(page, '#ed-reload'); await settle();
  assert.match(page.element('flash').textContent, /This session was deleted meanwhile\./);
  assert.doesNotMatch(page.element('groups').innerHTML, /Flow/);
});

test('#36: a session without a known version (catalogue cached before) is written as before', async () => {
  const t = tables(); delete t.sessions[0].updated_at;
  const page = await app({...signedIn, tables: t, hash: '#session/flow'});
  await settle();
  clickIn(page, '#ed-open');
  clickIn(page, '#ed-save'); await settle();
  assert.deepEqual(sessionWrites(page)[0][3], [['slug', 'flow']]);
});

const openNote = async (options = {}) => { const page = await app({...signedIn, tables: tables(), hash: '#m1', dom: true, timerCap: 5000, ...options}); await settle(); return page; };
const signOuts = page => { const c = page.clients.at(-1), log = []; c.auth.signOut = async () => { log.push('out'); return {error: null}; }; return log; };

test('#30: Sign out saves the note being typed, then leaves no draft of the account; another account keeps its own', async () => {
  const asked = [];
  const page = await openNote({stored: {'rb.draft.u2.m1': 'not mine'}, confirm: q => { asked.push(q); return false; }});
  const out = signOuts(page);
  page.element('n-text').value = 'Heavy today';
  await page.fire('n-text', 'input');
  assert.equal(page.storage.get('rb.draft.u1.m1'), 'Heavy today');
  await page.fire('s-signout'); await settle();
  const notes = page.clients.at(-1).calls.filter(c => c[1] === 'notes' && c[0] === 'upsert');
  assert.deepEqual(JSON.parse(JSON.stringify(notes.map(c => c[2]))), [{slug: 'm1', body: 'Heavy today'}]);
  assert.equal(page.storage.has('rb.draft.u1.m1'), false);
  assert.equal(page.storage.get('rb.draft.u2.m1'), 'not mine');
  assert.deepEqual(asked, [], 'saved: nothing to ask');
  assert.deepEqual(out, ['out']);
});

test('#30: a draft still not saved is deleted at sign-out only once the user agrees', async () => {
  const asked = [];
  let answer = false;
  const page = await openNote({stored: {'rb.draft.u1.m2': 'typed offline'}, confirm: q => { asked.push(q); return answer; }});
  const out = signOuts(page);
  await page.fire('s-signout'); await settle();
  assert.deepEqual(asked, ['A note is not saved yet. Sign out and delete it from this device?']);
  assert.equal(page.storage.get('rb.draft.u1.m2'), 'typed offline', 'kept: the user said no');
  assert.deepEqual(out, [], 'still signed in');
  answer = true;
  await page.fire('s-signout'); await settle();
  assert.equal(page.storage.has('rb.draft.u1.m2'), false);
  assert.deepEqual(out, ['out']);
});

test('#30: a failed save at sign-out asks too, and « another backend » clears the drafts the same way', async () => {
  const asked = [];
  const page = await openNote({writes: {notes: {data: null, error: {message: 'offline'}}}, confirm: q => { asked.push(q); return true; }});
  const out = signOuts(page);
  page.element('n-text').value = 'Lost?';
  await page.fire('n-text', 'input');
  await page.fire('s-reset'); await settle();
  assert.equal(asked.length, 1);
  assert.equal(page.storage.has('rb.draft.u1.m1'), false);
  assert.deepEqual(out, ['out']);
});

test('#30: a note write stuck past 5 s does not hold up sign-out; the draft goes only once the user agrees', async () => {
  const asked = [];
  let release;
  const stuck = new Promise(ok => { release = ok; });
  // timerCap 6000: the 5 s cap fires (at once, in the harness) while the note write waits for release()
  const page = await openNote({timerCap: 6000, confirm: q => { asked.push(q); return true; },
    hold: (table, ops) => table === 'notes' && ops.some(o => o[0] === 'upsert') ? stuck : null});
  const out = signOuts(page);
  page.element('n-text').value = 'Slow network';
  await page.fire('n-text', 'input');
  await page.fire('s-signout'); await settle();
  assert.equal(asked.length, 1, 'still on its way: asked');
  assert.equal(page.storage.has('rb.draft.u1.m1'), false);
  assert.deepEqual(out, ['out']);
  release(); await settle(); // the write lands later: nothing comes back on the device
  assert.equal(page.storage.has('rb.draft.u1.m1'), false);
});
