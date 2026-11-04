// L23, facets beyond the acceptance tests: notebook pages, a backend without either optional column, sessions and
// untagged sheets under a facet, values from an old link, the time bucket in the hash, Clear.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'reader@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const sheet = (slug, tags, extra = {}) => ({slug, kind: 'sheet', theme: 'strength', group: 'Shoulders', title: slug, summary: '', search_text: '', source: {}, thumbnail: 'img/thumb.jpg', exercises: [], ...(tags ? {tags} : {}), ...extra});
const rows = () => [
  sheet('band-row', {zone: ['back'], gear: ['band'], minutes: 4, type: 'strength'}),
  sheet('mat-flow', {zone: ['hips'], gear: ['mat'], minutes: 12, type: 'mobility'}),
  sheet('plain')
];
const tables = (sheets, sessions = []) => ({user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}], sheets, sessions, notes: [], requests: []});
const open = async (extra = {}, sheets = rows(), sessions = []) => { const page = await app({...signedIn, tables: tables(sheets, sessions), ...extra}); await settle(); return page; };
const pick = async (page, facet, value) => {
  await page.fire('facet-' + facet);
  await page.element('facet-options').listeners.click({target: {closest: () => ({dataset: {facetValue: value}})}});
  await settle();
};
const has = (page, slug) => page.element('results').innerHTML.includes(`href="#${slug}"`);

test('the chips stay off a notebook page and off an account whose sheets have no tags yet', async () => {
  const nb = await open({hash: '#strength'});
  assert.equal(nb.element('facets').hidden, true);
  const untagged = await open({}, [sheet('a'), sheet('b', {})]);
  assert.equal(untagged.element('facets').hidden, true);
});

test('a backend without search_text nor tags: one 42703 each, then the sheets as before', async () => {
  const page = await open({missing: ['sheets.search_text', 'sheets.tags']}, rows().map(({tags, search_text, ...r}) => r));
  const asked = page.clients.at(-1).selects.filter(([t]) => t === 'sheets').map(([, c]) => c);
  assert.equal(asked.length, 3);
  assert.doesNotMatch(asked[2], /search_text|tags/);
  assert.equal(page.element('facets').hidden, true);
  assert.doesNotMatch(page.element('count').textContent, /Could not load/);
});

test('under a facet, sessions and untagged sheets leave the results; the empty text names the tags', async () => {
  const ses = [{slug: 'ses', theme: 'strength', title: 'band session', format: '', why: '', items: [], source: {}}];
  const page = await open({}, rows(), ses);
  page.element('q').value = 'band'; await page.fire('q', 'input'); await settle();
  assert.ok(page.element('results').innerHTML.includes('#session/ses'));
  await pick(page, 'gear', 'band');
  assert.ok(has(page, 'band-row'));
  assert.equal(page.element('results').innerHTML.includes('#session/ses'), false);
  await pick(page, 'type', 'mobility');
  assert.match(page.element('results').innerHTML, /with these tags/);
});

test('a hash with unknown or inherited keys is ignored (Codex pass 1): the home page and its results still show', async () => {
  const page = await open({hash: '#search?constructor=x&__proto__=y&toString=z&gear=band'});
  assert.equal(page.element('home').hidden, false);
  assert.ok(has(page, 'band-row'));
  assert.equal(has(page, 'mat-flow'), false);
});

test('each choice writes the hash; going back through those hashes restores each earlier selection (Codex pass 2)', async () => {
  const hashes = [];
  const page = await open();
  await pick(page, 'type', 'strength'); hashes.push(page.element('facet-type').textContent);
  await pick(page, 'gear', 'mat');
  assert.equal(page.element('results').innerHTML.includes('href="#'), false, 'strength AND mat: nothing');
  page.go('#search?type=strength'); await settle(); // Back to the entry the first choice made
  assert.ok(has(page, 'band-row'));
  assert.equal(page.element('facet-gear').textContent, 'Gear');
  assert.match(hashes[0], /strength/);
  page.go(''); await settle(); // Back to the start: no facet, no text, no results
  assert.equal(page.element('results').hidden, true);
  assert.equal(page.element('facet-type').textContent, 'Type');
});

test('the time bucket goes through the hash; a value from an old link stays listed to untick; Clear empties one facet', async () => {
  const page = await open({hash: '#search?time=' + encodeURIComponent('10–20') + '&zone=elbow'});
  assert.equal(page.element('facets').hidden, false);
  await page.fire('facet-zone');
  assert.match(page.element('facet-options').innerHTML, /data-facet-value="elbow" aria-pressed="true"><span>elbow<\/span><b>0<\/b>/);
  await page.fire('facet-clear'); await settle();
  assert.equal(page.element('facet-zone').textContent, 'Zone');
  assert.ok(has(page, 'mat-flow'), 'time 10–20 still chosen');
  assert.equal(has(page, 'band-row'), false);
  assert.match(page.element('facet-time').textContent, /10–20 min/);
  await page.fire('facet-time');
  assert.match(page.element('facet-options').innerHTML, /data-facet-value="< 5"[^>]*><span>&lt; 5 min<\/span><b>1<\/b>/);
});
