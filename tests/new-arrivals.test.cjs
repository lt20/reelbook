// L7 — what the « New » row leaves out, beyond the acceptance tests (tests/acceptance/l7).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const hoursAgo = n => new Date(Date.now() - n * 3600_000).toISOString();
const sheet = (slug, hours) => ({slug, kind: 'sheet', theme: 'strength', group: 'Arms', title: slug, summary: '', added_at: hoursAgo(hours), source: {}, exercises: []});
const tables = (sheets, sessions = []) => ({user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}], sheets, sessions});
const links = markup => [...markup.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);

test('a new video session stands for its exercise sheets; a user session is not « New »', async () => {
  const t = tables([sheet('gsp-angel', 1), sheet('gsp-press', 1), sheet('solo', 3)], [
    {slug: 'gsp', theme: 'strength', title: 'GSP', created_at: hoursAgo(1), origin: 'video', source: {}, items: [{slug: 'gsp-angel', dose: ''}, {slug: 'gsp-press', dose: ''}]},
    {slug: 'mine', theme: 'strength', title: 'Mine', created_at: hoursAgo(1), origin: 'user', source: {}, items: []}
  ]);
  const page = await app({...signedIn, tables: t}); await settle();
  assert.deepEqual(links(page.element('new-cards').innerHTML), ['session/gsp', 'solo']);
});

test('rb.seen keeps the last 500 keys and a broken value is ignored', async () => {
  const many = JSON.stringify(Array.from({length: 600}, (_, i) => `old-${i}`));
  for (const stored of [{'rb.seen': many}, {'rb.seen': '{not json'}]) {
    const page = await app({...signedIn, stored, tables: tables([sheet('fresh', 1)]), dom: true}); await settle();
    assert.deepEqual(links(page.element('new-cards').innerHTML), ['fresh']);
    page.go('#fresh'); await settle();
    const seen = JSON.parse(page.storage.get('rb.seen'));
    assert.ok(seen.length <= 500);
    assert.equal(seen.at(-1), 'fresh');
  }
});

test('no « New » row on a notebook page', async () => {
  const page = await app({...signedIn, tables: tables([sheet('fresh', 1)])}); await settle();
  assert.equal(page.element('new-sec').hidden, false);
  page.go('#strength'); await settle();
  assert.equal(page.element('new-sec').hidden, true);
});
