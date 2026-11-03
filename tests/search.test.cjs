// L14, full-text search beyond the acceptance tests: a backend without sheets.search_text (read once, then
// without it), the cached catalogue (search text and note bodies searched offline), several words over several
// places, metadata hits first, session notes, the empty state in a notebook.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const sheet = (slug, fields = {}) => ({slug, kind: 'sheet', theme: 'strength', group: 'Arms', title: slug, summary: '', source: {}, exercises: [], search_text: '', ...fields});
const tables = (sheets, notes = [], sessions = []) => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets, sessions, notes, requests: []
});
const open = async (opts) => { const page = await app({...signedIn, ...opts}); await settle(); return page; };
const search = async (page, query) => {
  page.element('q').value = query;
  await page.fire('q', 'input');
  await settle();
  return page.element('results').innerHTML;
};
const slugs = markup => [...markup.matchAll(/<a class="card[^"]*" href="#([^"]+)"/g)].map(m => m[1]);
const sheetSelects = page => page.clients[0].selects.filter(([t]) => t === 'sheets').map(([, cols]) => cols);

test('a backend without search_text: one 42703, then the sheets read as before, no error, metadata searchable', async () => {
  const old = sheet('mat', {title: 'Mat practice'}); delete old.search_text;
  const page = await open({tables: tables([old]), missing: ['sheets.search_text']});
  const asked = sheetSelects(page);
  assert.equal(asked.length, 2);
  assert.match(asked[0], /search_text/);
  assert.doesNotMatch(asked[1], /search_text/);
  assert.doesNotMatch(page.element('count').textContent, /Could not load/);
  assert.deepEqual(slugs(await search(page, 'mat')), ['mat']);
  assert.match(await search(page, 'tapis'), /Nothing matches « tapis »/);
});

test('a backend with the column reads search_text in the one sheets read, and the notes with their body', async () => {
  const page = await open({tables: tables([sheet('a')])});
  assert.deepEqual(sheetSelects(page).length, 1);
  assert.match(sheetSelects(page)[0], /search_text/);
  assert.ok(page.clients[0].selects.some(([t, cols]) => t === 'notes' && /\bbody\b/.test(cols)));
});

test('the cached catalogue keeps search_text and note bodies: found while the network read fails', async () => {
  const idb = new Map();
  await open({idb, tables: tables([sheet('mat', {title: 'Floor', search_text: 'Pose le tapis.'})], [{slug: 'mat', body: 'Genoux stables'}])});
  const [snap] = [...idb.values()];
  assert.equal(snap.sheets[0].search_text, 'Pose le tapis.');
  assert.deepEqual(snap.noteBodies, [['mat', 'Genoux stables']]);
  const offline = {error: {message: 'offline'}, status: 0};
  const page = await open({idb, tables: tables([]), failing: {sheets: offline, notes: offline, sessions: offline}});
  assert.match(await search(page, 'tapis'), /in the sheet/);
  assert.match(await search(page, 'genoux'), /in your note/);
});

test('words found in several places name each place; metadata hits come first; a session note is searched', async () => {
  const page = await open({tables: tables([
    sheet('b-body', {title: 'Bridge', search_text: 'Pousse dans les talons, le dos décolle.'}),
    sheet('a-meta', {title: 'Dos rond'}),
    sheet('c-both', {title: 'Cat cow', search_text: 'Le dos ondule.'})
  ], [{slug: 'c-both', body: 'Talons au sol pour moi'}, {slug: 'session/morning', body: 'Dos raide ce matin'}],
  [{slug: 'morning', theme: 'strength', title: 'Morning', format: '', why: '', items: [], source: {}}])});
  assert.deepEqual(slugs(await search(page, 'dos')), ['a-meta', 'b-body', 'c-both', 'session/morning']);
  const both = await search(page, 'talons dos');
  assert.deepEqual(slugs(both), ['b-body', 'c-both']);
  assert.match(both.match(/href="#c-both"[\s\S]*?<\/a>/)[0], /in the sheet · in your note/);
  assert.match(both.match(/href="#b-body"[\s\S]*?<\/a>/)[0], /<p class="where">in the sheet<\/p>/);
  assert.doesNotMatch((await search(page, 'rond')).match(/href="#a-meta"[\s\S]*?<\/a>/)[0], /class="where"/);
});

test('word start only, punctuation and hyphens count as word breaks, regex characters are plain text', async () => {
  const page = await open({tables: tables([
    sheet('pont', {search_text: "Le demi-pont, puis l'épaule (90°)."}),
    sheet('other', {search_text: 'Apontage.'})
  ])});
  assert.deepEqual(slugs(await search(page, 'pont')), ['pont']);
  assert.deepEqual(slugs(await search(page, 'epaule')), ['pont']);
  assert.deepEqual(slugs(await search(page, '(90')), ['pont']);
  assert.deepEqual(slugs(await search(page, '.*')), []);
});

test('in a notebook the empty state names it and still suggests a body part or a piece of kit', async () => {
  const page = await open({tables: tables([sheet('a', {title: 'Floor'})]), hash: '#strength'});
  assert.match(await search(page, 'zzz'), /Nothing matches « zzz » in this notebook\. Try a body part or a piece of kit\./);
});
