const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {app, ownUrl, ownKey} = require('../../harness.cjs');
const RS = require('../../../app/sessions.js');

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'l22-user', email: 'l22@example.test'}}};
const french = {slug: 'fr', theme: 'strength', origin: 'video', title: 'Routine pour les épaules', why: 'Le mouvement est dans la séance.', key_points: ['Avec contrôle'], format: '3 séries avec repos', source: {}, items: [{slug: 'move', dose: '2 × 10', rest_s: 30}, {slug: 'finish', dose: '40 s'}]};
const english = {slug: 'en', theme: 'strength', origin: 'video', title: 'Shoulder routine', why: 'Move slowly.', key_points: ['Keep control'], format: '3 rounds with rest', source: {}, items: [{slug: 'move', dose: '2 × 10', rest_s: 30}, {slug: 'finish', dose: '40 s'}]};
const tables = (session = french) => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: [{slug: 'move', kind: 'sheet', theme: 'strength', title: 'First move', html: ''}, {slug: 'finish', kind: 'sheet', theme: 'strength', title: 'Second move', html: ''}],
  sessions: [session], notes: [], requests: [], practice_log: []
});
const open = async (session, suffix = '', options = {}) => {
  const page = await app({...signedIn, tables: tables(session), hash: '#session/' + session.slug + suffix, dom: true, ...options});
  await settle();
  return page;
};
const contentLang = (html, lang) => assert.match(html, new RegExp('<(?:div|section|article)\\b[^>]*\\blang="' + lang + '"[^>]*>'));

test('L22 — French session page translates headings inside content and marks the block lang="fr"', async () => {
  const page = await open(french);
  assert.equal(page.element('view').hidden, false);
  const html = page.element('view').innerHTML;
  contentLang(html, 'fr');
  assert.match(html, /<h2>Pourquoi<\/h2>/);
  assert.match(html, /<h2>Points clés<\/h2>/);
  assert.match(html, /<h2>Exercices(?:\s|<)/);
  assert.match(html, />Format</);
  assert.match(html, />Dose</);
  assert.doesNotMatch(html, /<h2>Why<\/h2>|<h2>Key points<\/h2>|<h2>Exercises(?:\s|<)/);
});

test('L22 — English session page keeps English headings and language', async () => {
  const page = await open(english);
  const html = page.element('view').innerHTML;
  assert.match(html, /<h2>Why<\/h2>/);
  assert.match(html, /<h2>Key points<\/h2>/);
  assert.match(html, /<h2>Exercises(?:\s|<)/);
  assert.match(html, />Format</);
  assert.match(html, />Dose</);
  assert.doesNotMatch(html, /Pourquoi|Points clés|Exercices|lang="fr"/);
});

test('L22 — session player translates Rest and Sets, marks French content, and keeps interface controls in English', async () => {
  const fr = await open(french, '/play');
  const en = await open(english, '/play');
  assert.equal(fr.element('player').hidden, false);
  contentLang(fr.element('player').innerHTML, 'fr');
  assert.match(fr.element('player').innerHTML, />Dose</);
  assert.match(fr.element('player').innerHTML, /aria-label="Séries"/);
  assert.match(en.element('player').innerHTML, /aria-label="Sets"/);
  assert.equal(fr.element('play-finish').textContent, en.element('play-finish').textContent);
  await fr.fire('play-set-1', 'change'); await settle();
  assert.match(fr.element('player').innerHTML, />Repos</);
  await en.fire('play-set-1', 'change'); await settle();
  assert.match(en.element('player').innerHTML, />Rest</);
});

test('L22 — the player end screen keeps the session language and English interface controls', async () => {
  const fr = await open(french, '/play/2');
  const en = await open(english, '/play/2');
  await fr.fire('play-finish'); await en.fire('play-finish'); await settle();
  assert.equal(fr.element('view').hidden, false);
  assert.equal(en.element('view').hidden, false);
  contentLang(fr.element('view').innerHTML, 'fr');
  assert.doesNotMatch(en.element('view').innerHTML, /lang="fr"/);
  for (const id of ['end-save', 'end-close']) assert.equal(fr.element(id).textContent, en.element(id).textContent);
});

test('L22 — an empty session has no translated exercise content', async () => {
  const empty = {...french, slug: 'empty', items: []};
  const page = await open(empty);
  assert.equal(page.element('view').hidden, false);
  contentLang(page.element('view').innerHTML, 'fr');
  assert.match(page.element('view').innerHTML, /<h2>Exercices(?:\s|<)/);
  assert.doesNotMatch(page.element('view').innerHTML, /<h2>Exercises(?:\s|<)/);
});

test('L22 — a backend without the sessions table and a sessions read error do not show a session page', async () => {
  for (const failure of [
    {error: {code: 'PGRST205', message: 'Could not find the table'}, status: 404},
    {error: {code: '42501', message: 'permission denied'}, status: 403}
  ]) {
    const page = await app({...signedIn, tables: tables(), hash: '#strength', failing: {sessions: failure}});
    await settle();
    assert.doesNotMatch(page.element('groups').innerHTML, /href="#session\/fr"/);
    assert.equal(page.clients[0].selects.some(([table]) => table === 'sessions'), true);
  }
});

test('L22 — an offline cached French session keeps its content language', async () => {
  const idb = new Map();
  idb.set(RS.catalogueCacheKey(ownUrl, 'l22-user'), RS.catalogueSnapshot({
    themes: tables().user_themes, sheets: tables().sheets, sessions: [french], sessionsOk: true,
    notesIndex: new Set(), lastDone: new Map(), practiceOk: true
  }));
  const page = await open(french, '', {idb, failing: {sessions: {error: {message: 'Failed to fetch'}, status: 0}}});
  assert.match(page.element('view').innerHTML, /<h2>Pourquoi<\/h2>/);
  contentLang(page.element('view').innerHTML, 'fr');
});

test('L22 — the session module URL, service-worker shell and cache version advance together', () => {
  const index = fs.readFileSync(path.join(__dirname, '../../../app/index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '../../../app/sw.js'), 'utf8');
  const indexVersion = Number(index.match(/<script src="sessions\.js\?v=(\d+)"/)[1]);
  const shellVersion = Number(sw.match(/'\.\/sessions\.js\?v=(\d+)'/)[1]);
  const cacheVersion = Number(sw.match(/const VERSION = 'rb-shell-(\d+)'/)[1]);
  assert.equal(indexVersion, shellVersion);
  assert.ok(indexVersion > 9);
  assert.ok(cacheVersion > 34);
});
