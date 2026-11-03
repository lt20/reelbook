const {test} = require('node:test');
const assert = require('node:assert/strict');
const RS = require('../../../app/sessions.js');

const rows = () => ({
  themes: [{id: 'strength', title: 'Strength', groups: []}],
  sheets: [{slug: 'curl', theme: 'strength', title: 'Hammer curl', thumbnail: 'thumb.jpg'}],
  sessions: [{slug: 'routine', theme: 'strength', title: 'Routine', items: [{slug: 'curl', dose: '3×10'}]}],
  notesIndex: new Set(['curl', 'session/routine']),
  lastDone: new Map([['curl', '2026-10-28'], ['session/routine', '2026-10-29']]),
  sessionsOk: true,
  practiceOk: true
});

test('L19 — the last catalogue includes themes, sheets metadata, sessions, notes index and practice last-done', () => {
  const source = rows();
  const saved = RS.catalogueSnapshot(source);
  const restored = RS.restoreCatalogueSnapshot(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.themes, source.themes);
  assert.deepEqual(restored.sheets, source.sheets);
  assert.deepEqual(restored.sessions, source.sessions);
  assert.deepEqual([...restored.notesIndex], [...source.notesIndex]);
  assert.deepEqual([...restored.lastDone], [...source.lastDone]);
  assert.equal(restored.sessionsOk, true);
  assert.equal(restored.practiceOk, true);
});

test('L19 — an empty catalogue is a valid cached state', () => {
  const restored = RS.restoreCatalogueSnapshot(JSON.parse(JSON.stringify(RS.catalogueSnapshot({
    themes: [], sheets: [], sessions: [], notesIndex: new Set(), lastDone: new Map(),
    sessionsOk: true, practiceOk: true
  }))));
  assert.deepEqual(restored.themes, []);
  assert.deepEqual(restored.sheets, []);
  assert.deepEqual(restored.sessions, []);
  assert.deepEqual([...restored.notesIndex], []);
  assert.deepEqual([...restored.lastDone], []);
});

test('L19 — a backend without sessions or practice_log does not invent cached data for either table', () => {
  const source = {...rows(), sessions: [], lastDone: new Map(), sessionsOk: false, practiceOk: false};
  const restored = RS.restoreCatalogueSnapshot(JSON.parse(JSON.stringify(RS.catalogueSnapshot(source))));
  assert.deepEqual(restored.sheets, source.sheets);
  assert.deepEqual(restored.sessions, []);
  assert.deepEqual([...restored.lastDone], []);
  assert.equal(restored.sessionsOk, false);
  assert.equal(restored.practiceOk, false);
});

test('L19 — cached catalogues are scoped to the backend and user', () => {
  const key = RS.catalogueCacheKey('https://one.example.test', 'user-a');
  assert.equal(typeof key, 'string');
  assert.notEqual(key, RS.catalogueCacheKey('https://one.example.test', 'user-b'));
  assert.notEqual(key, RS.catalogueCacheKey('https://two.example.test', 'user-a'));
});
