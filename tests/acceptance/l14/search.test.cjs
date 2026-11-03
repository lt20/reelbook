const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('../../harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const sheet = (slug, fields = {}) => ({slug, kind: 'sheet', theme: 'strength', group: 'Arms', title: slug, summary: '', source: {}, exercises: [], search_text: '', ...fields});
const tables = (sheets, notes = []) => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets, sessions: [], notes, requests: []
});
const open = async (sheets, notes = [], extra = {}) => {
  const page = await app({...signedIn, tables: tables(sheets, notes), ...extra});
  await settle();
  return page;
};
const search = async (page, query) => {
  page.element('q').value = query;
  await page.fire('q', 'input');
  await settle();
  return page.element('results').innerHTML;
};
const card = (markup, slug) => markup.match(new RegExp('<a[^>]*href="#' + slug + '"[\\s\\S]*?<\\/a>'))?.[0] || '';

test('App — catalogue search finds search_text and marks « in the sheet » under the title', async () => {
  const page = await open([
    sheet('mat', {title: 'Floor exercise', search_text: 'Lie on a tapis and breathe.'}),
    sheet('other', {title: 'Standing exercise', search_text: 'Stand tall.'})
  ]);
  const markup = await search(page, 'tapis');
  assert.match(card(markup, 'mat'), /<h3>Floor exercise<\/h3>[\s\S]*in the sheet/);
  assert.equal(card(markup, 'other'), '');
});

test('App — titles, summaries, groups, notebooks and authors remain searchable while search_text is empty', async () => {
  const page = await open([
    sheet('title-hit', {title: 'Balance drill'}),
    sheet('summary-hit', {summary: 'Gentle rotation'}),
    sheet('group-hit', {group: 'Shoulders'}),
    sheet('author-hit', {source: {author: 'Georges'}})
  ]);
  for (const [query, slug] of [['balance', 'title-hit'], ['rotation', 'summary-hit'], ['shoulders', 'group-hit'], ['georges', 'author-hit']]) {
    assert.ok(card(await search(page, query), slug), `${query} finds ${slug}`);
  }
  assert.ok(card(await search(page, 'strength'), 'title-hit'), 'the notebook remains indexed');
});

test('App — search reads the user’s note body and marks « in your note » under the title', async () => {
  const page = await open([
    sheet('noted', {title: 'Floor exercise'}),
    sheet('other', {title: 'Standing exercise'})
  ], [{slug: 'noted', body: 'My knees felt steady on the tapis.'}]);
  const markup = await search(page, 'knees');
  assert.match(card(markup, 'noted'), /<h3>Floor exercise<\/h3>[\s\S]*in your note/);
  assert.equal(card(markup, 'other'), '');
});

test('App — matching ignores accents and case and starts at a word boundary', async () => {
  const page = await open([
    sheet('back', {search_text: 'Étire le dos doucement.'}),
    sheet('abs', {search_text: 'Travail des abdos.'}),
    sheet('mat', {search_text: 'Pose le Tapis.'})
  ]);
  const dos = await search(page, 'DOS');
  assert.ok(card(dos, 'back'));
  assert.equal(card(dos, 'abs'), '', 'dos does not match inside abdos');
  assert.ok(card(await search(page, 'etire'), 'back'));
  assert.ok(card(await search(page, 'tapis'), 'mat'));
});

test('App — empty search results show « Nothing matches « x ». Try a body part or a piece of kit. »', async () => {
  const page = await open([sheet('floor', {title: 'Floor exercise', search_text: 'tapis'})]);
  const markup = await search(page, 'unknown');
  assert.equal(page.element('results').hidden, false);
  assert.match(markup, /Nothing matches « unknown »\. Try a body part or a piece of kit\./);
  assert.equal(card(markup, 'floor'), '');
  await search(page, '');
  assert.equal(page.element('results').hidden, true);
});

test('App — a sheet row without search_text still matches its metadata without a search error', async () => {
  const old = sheet('old', {title: 'Mat practice'});
  delete old.search_text;
  const page = await open([old]);
  assert.ok(card(await search(page, 'mat'), 'old'));
  assert.equal(page.element('home').hidden, false);
});

test('App — a failed notes read leaves metadata search usable', async () => {
  const page = await open([sheet('floor', {title: 'Floor exercise'})], [], {
    failing: {notes: {error: {message: 'offline'}, status: 0}}
  });
  assert.ok(card(await search(page, 'floor'), 'floor'));
  assert.equal(page.element('home').hidden, false);
});
