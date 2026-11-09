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

test('rb.seen.<user id> keeps the last 500 keys and a broken value is ignored', async () => {
  const many = JSON.stringify(Array.from({length: 600}, (_, i) => `old-${i}`));
  for (const stored of [{'rb.seen.u1': many}, {'rb.seen.u1': '{not json'}]) {
    const page = await app({...signedIn, stored, tables: tables([sheet('fresh', 1)]), dom: true}); await settle();
    assert.deepEqual(links(page.element('new-cards').innerHTML), ['fresh']);
    page.go('#fresh'); await settle();
    const seen = JSON.parse(page.storage.get('rb.seen.u1'));
    assert.ok(seen.length <= 500);
    assert.equal(seen.at(-1), 'fresh');
  }
});

test('a page opened by account A stays « New » for account B on the same device (Codex pass 4)', async () => {
  // A opened its own « curl » (rb.seen.uA), and the old shared key rb.seen is ignored; B (u1) signs in.
  const stored = {'rb.seen.uA': JSON.stringify(['curl']), 'rb.seen': JSON.stringify(['curl'])};
  const page = await app({...signedIn, stored, tables: tables([sheet('curl', 1)]), dom: true}); await settle();
  assert.deepEqual(links(page.element('new-cards').innerHTML), ['curl']);
  page.go('#curl'); await settle();
  assert.deepEqual(JSON.parse(page.storage.get('rb.seen.u1')), ['curl']);
  assert.deepEqual(JSON.parse(page.storage.get('rb.seen.uA')), ['curl'], 'A\'s list is left alone');
});

test('a new card shows the name of its notebook on the photo, a session card too', async () => {
  const t = {user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0},
                           {id: 'custom-a', title: 'Tom & <Jerry>', description: 'x', groups: [], builtin: false, position: 1}],
    sheets: [{...sheet('solo', 1), theme: 'custom-a'}, sheet('gsp-angel', 2)],
    sessions: [{slug: 'gsp', theme: 'strength', title: 'GSP', created_at: hoursAgo(2), origin: 'video', source: {}, items: [{slug: 'gsp-angel', dose: ''}]}]};
  const page = await app({...signedIn, tables: t}); await settle();
  const cards = page.element('new-cards').innerHTML.split('<a class="card').slice(1);
  assert.equal(cards.length, 2);
  assert.match(cards[0], /href="#solo"[^]*<span class="nbtag"[^>]*>Tom &amp; &lt;Jerry&gt;<\/span>/);
  assert.match(cards[1], /href="#session\/gsp"[^]*<span class="nbtag"[^>]*>Strength<\/span>/);
});

test('the notebook tag: a notebook no longer on the account has the name the home page gives it; no tag on a notebook page', async () => {
  const gone = await app({...signedIn, tables: tables([{...sheet('lost', 1), theme: 'cook'}])}); await settle();
  const name = gone.element('new-cards').innerHTML.match(/<span class="nbtag"[^>]*>([^<]*)<\/span>/)[1];
  assert.ok(gone.element('portal').innerHTML.includes(`<span class="nbt-nm">${name}</span>`)); // P9 H: its home tile
  const page = await app({...signedIn, tables: tables([sheet('fresh', 1)])}); await settle();
  page.go('#strength'); await settle();
  assert.ok(page.element('groups').innerHTML.includes('href="#fresh"'));
  assert.ok(!page.element('groups').innerHTML.includes('nbtag'));
});

test('no « New » row on a notebook page', async () => {
  const page = await app({...signedIn, tables: tables([sheet('fresh', 1)])}); await settle();
  assert.equal(page.element('new-sec').hidden, false);
  page.go('#strength'); await settle();
  assert.equal(page.element('new-sec').hidden, true);
});
