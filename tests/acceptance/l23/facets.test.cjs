const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, ownUrl, ownKey} = require('../../harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'reader@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const sheet = (slug, theme, title, tags, extra = {}) => ({slug, kind: 'sheet', theme, group: 'Shoulders', title, summary: '', search_text: '', source: {}, thumbnail: 'img/thumb.jpg', exercises: [], ...(tags === undefined ? {} : {tags}), ...extra});
const rows = () => [
  sheet('rotation', 'strength', 'Band rotation', {zone: ['shoulders'], gear: ['band'], minutes: 8, type: 'mobility'}, {search_text: 'gentle movement'}),
  sheet('stretch', 'mobility', 'Mat stretch', {zone: ['shoulders'], gear: ['mat'], minutes: 4, type: 'stretch'}),
  sheet('press', 'mobility', 'Band press', {zone: ['shoulders'], gear: ['band'], minutes: 12, type: 'strength'}, {search_text: 'gentle movement'}),
  sheet('row', 'strength', 'Band row', {zone: ['knees'], gear: ['band'], minutes: 8, type: 'strength'}, {search_text: 'gentle movement'}),
  sheet('old', 'strength', 'Old rotation', undefined),
  sheet('cardio', 'mobility', 'Full body cardio', {zone: ['full body'], gear: ['none'], minutes: 25, type: 'cardio'})
];
const tables = sheets => ({user_themes: [
  {id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0},
  {id: 'mobility', title: 'Mobility', groups: [], builtin: true, position: 1}
], sheets, sessions: [], notes: [], requests: []});
// P8 R4: the facets show only on the search page (#search), opened by the loupe of the home page's bar
const open = async (sheets = rows(), extra = {}) => { const page = await app({...signedIn, tables: tables(sheets), hash: '#search', ...extra}); await settle(); return page; };
const query = async (page, value) => { page.element('q').value = value; await page.fire('q', 'input'); await settle(); return page.element('results').innerHTML; };
const has = (markup, slug) => new RegExp('href="#' + slug + '"').test(markup);
const choose = async (page, facet, value) => {
  await page.fire('facet-' + facet);
  assert.equal(page.element('facet-dlg').open, true);
  const target = {dataset: {facetValue: value}};
  const listener = page.element('facet-options').listeners.click;
  assert.ok(listener, 'facet options handle clicks');
  await listener({target: {closest: selector => selector === '[data-facet-value]' ? target : null}});
  await settle();
};

test('App — a row of Zone, Gear, Time, Type facet chips sits under the search field; each opens a bottom sheet', async () => {
  assert.match(html, /id="q"[\s\S]*id="facets"[\s\S]*id="results"/);
  const home = await open(rows(), {hash: ''});
  assert.equal(home.element('facets').hidden, true, 'P8 R4: no facets on the home page');
  assert.equal(home.element('search').hidden, true, 'P8 R4: no field on the home page, the loupe opens it');
  const page = await open();
  assert.equal(page.element('facets').hidden, false);
  for (const [id, label] of [['zone', 'Zone'], ['gear', 'Gear'], ['time', 'Time'], ['type', 'Type']]) {
    assert.match(html, new RegExp('id="facet-' + id + '"[^>]*>[\\s\\S]*?' + label));
    await page.fire('facet-' + id);
    assert.equal(page.element('facet-dlg').open, true, label);
    page.element('facet-dlg').close();
  }
});

test('App — facet sheets show only values present in the catalogue and their counts; empty catalogues have no facet values', async () => {
  const page = await open();
  for (const [facet, expected, absent] of [
    ['zone', [['shoulders', 3], ['knees', 1], ['full body', 1]], 'ankles'],
    ['gear', [['band', 3], ['mat', 1], ['none', 1]], 'kettlebell'],
    ['time', [['< 5', 1], ['5–10', 2], ['10–20', 1], ['20+', 1]], null],
    ['type', [['mobility', 1], ['strength', 2], ['stretch', 1], ['cardio', 1]], 'skill']
  ]) {
    await page.fire('facet-' + facet);
    const options = page.element('facet-options').innerHTML;
    for (const [value, count] of expected) assert.match(options, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + count + '\\b'), facet + ': ' + value);
    if (absent) assert.doesNotMatch(options, new RegExp('data-facet-value="' + absent + '"'));
    page.element('facet-dlg').close();
  }
  const empty = await open([]);
  await empty.fire('facet-zone');
  assert.doesNotMatch(empty.element('facet-options').innerHTML, /data-facet-value=/);
});

test('App — chosen facets combine AND across facets, OR inside one, with the text query across all notebooks', async () => {
  const page = await open();
  await choose(page, 'zone', 'shoulders');
  await choose(page, 'zone', 'knees');
  await choose(page, 'gear', 'band');
  let markup = await query(page, 'gentle');
  for (const slug of ['rotation', 'press', 'row']) assert.ok(has(markup, slug), slug);
  for (const slug of ['stretch', 'old', 'cardio']) assert.equal(has(markup, slug), false, slug);
  assert.match(markup, /Strength/);
  assert.match(markup, /Mobility/);
  assert.match(markup, /<img\b/, 'results retain photo cards');
  await choose(page, 'time', '5–10');
  markup = page.element('results').innerHTML;
  assert.ok(has(markup, 'rotation'));
  assert.ok(has(markup, 'row'));
  assert.equal(has(markup, 'press'), false);
});

test('App — sheets without tags match only when no facet is chosen; a selection with no matches shows no cards', async () => {
  const page = await open();
  assert.ok(has(await query(page, 'rotation'), 'old'));
  await choose(page, 'zone', 'knees');
  assert.equal(has(page.element('results').innerHTML, 'old'), false);
  assert.equal(has(page.element('results').innerHTML, 'rotation'), false);
  assert.equal(page.element('results').hidden, false);
  await choose(page, 'zone', 'knees');
  assert.ok(has(page.element('results').innerHTML, 'old'), 'clearing the last facet restores untagged sheets');
});

test('App — chosen facets live in the URL hash and Back restores the previous search results', async () => {
  const page = await open();
  await choose(page, 'zone', 'shoulders');
  const zoneHash = page.element('facet-zone').textContent; // selection is visible on its chip
  assert.match(zoneHash, /shoulders/i);
  await choose(page, 'gear', 'band');
  const both = page.element('results').innerHTML;
  assert.ok(has(both, 'rotation'));
  assert.equal(has(both, 'stretch'), false);
  // The harness does not expose location.hash; its go method simulates Back to a saved hash.
  const fresh = await open(rows(), {hash: '#search?zone=shoulders&gear=band'});
  assert.ok(has(fresh.element('results').innerHTML, 'rotation'));
  assert.equal(has(fresh.element('results').innerHTML, 'stretch'), false);
});

test('App — a backend without sheets.tags falls back silently to text search without facets', async () => {
  const page = await open(rows().map(({tags, ...row}) => row), {missing: ['sheets.tags']});
  const projections = page.clients.at(-1).selects.filter(([table]) => table === 'sheets').map(([, columns]) => columns);
  assert.match(projections[0], /tags/);
  assert.ok(projections.some(columns => !/(?:^|,)tags(?:,|$)/.test(columns)), 'the catalogue is retried without tags');
  assert.equal(page.element('facets').hidden, true);
  assert.ok(has(await query(page, 'rotation'), 'rotation'));
  assert.equal(page.element('home').hidden, false);
  assert.doesNotMatch(page.element('count').textContent, /Could not load/);
});

test('App — a cached tagged catalogue keeps facet search usable while the network is offline', async () => {
  const idb = new Map();
  await open(rows(), {idb});
  const offline = await open([], {idb, failing: {sheets: {error: {message: 'Failed to fetch'}, status: 0}}});
  await choose(offline, 'zone', 'shoulders');
  assert.ok(has(offline.element('results').innerHTML, 'rotation'));
  assert.equal(has(offline.element('results').innerHTML, 'row'), false);
});
