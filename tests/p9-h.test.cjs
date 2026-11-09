// P9 H: the home page denser. YOUR SESSIONS folds at 3 cards behind « Show n more » (decision 4); the notebooks are
// tiles 2 per row, whose badges are covered with the queue in otw-rows.test.cjs (decision 5).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, ownUrl, ownKey} = require('./harness.cjs');

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'demo@example.test'}}};
const old = '2026-10-01T08:00:00Z';
const sheet = (slug, theme = 'strength') => ({slug, kind: 'sheet', theme, group: 'Arms', title: 'Title ' + slug, summary: 'A move.', source: {}, exercises: [], added_at: old, tags: {}});
const session = (slug, day) => ({slug, theme: 'strength', title: 'Session ' + slug, format: '', why: '', key_points: [], source: {}, origin: 'user', thumbnail: '', items: [{slug: 'curl', dose: ''}], created_at: `2026-10-0${day}T08:00:00Z`});
const tables = n => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: [sheet('curl')], sessions: Array.from({length: n}, (_, i) => session('s' + (i + 1), i + 1)), practice_log: [], requests: []
});
const open = async n => { const page = await app({...signedIn, tables: tables(n)}); await settle(); return page; };
const cards = page => [...page.element('sess-sec').innerHTML.matchAll(/class="scard-o"(?: id="sess-next")? href="#session\/(s\d)"/g)].map(m => m[1]);
const more = page => (page.element('sess-sec').innerHTML.match(/<button type="button" class="morebtn"[^>]*>[\s\S]*?<\/button>/) || [''])[0];
const tapMore = page => page.element('sess-sec').listeners.click({target: {closest: s => s === '[data-sess-more]' ? {} : null}});

test('P9 H: 5 sessions show 3 cards, then « Show 2 more » with a chevron down, folded', async () => {
  const page = await open(5);
  assert.deepEqual(cards(page), ['s5', 's4', 's3'], 'the newest first, as in R4');
  assert.match(page.element('sess-sec').innerHTML, /Your sessions<span class="n">5<\/span>/, 'the count is all of them');
  const b = more(page);
  assert.match(b, /data-sess-more aria-expanded="false" aria-controls="sess-list">Show 2 more<svg[^>]*aria-hidden="true"[^>]*><path d="M6 9l6 6 6-6"\/><\/svg><\/button>/);
  assert.match(page.element('sess-sec').innerHTML, /<div class="scards" id="sess-list">[\s\S]*<\/div><button type="button" class="morebtn"/, 'under the cards');
});

test('P9 H: « Show n more » unfolds all the cards and becomes « Show less » at the end; it folds back', async () => {
  const page = await open(5);
  await tapMore(page);
  assert.deepEqual(cards(page), ['s5', 's4', 's3', 's2', 's1']);
  assert.match(more(page), /aria-expanded="true" aria-controls="sess-list">Show less<svg[^>]*><path d="M6 15l6-6 6 6"\/><\/svg><\/button>/);
  assert.match(page.element('sess-sec').innerHTML, /href="#session\/s1"[\s\S]*<\/div><button type="button" class="morebtn"[^>]*>Show less/, '« Show less » after the last card');
  await tapMore(page);
  assert.deepEqual(cards(page), ['s5', 's4', 's3']);
  assert.match(more(page), /aria-expanded="false"[^>]*>Show 2 more/);
});

test('P9 H: unfolded, the focus goes to the first card revealed (no scroll); folded, back to the button', async () => {
  const page = await open(5);
  assert.doesNotMatch(page.element('sess-sec').innerHTML, /sess-next/, 'folded: no card marked');
  await tapMore(page);
  assert.match(page.element('sess-sec').innerHTML, /<a class="scard-o" id="sess-next" href="#session\/s2">/, 'the 4th card, the first revealed');
  assert.equal(page.focused.at(-1), 'sess-next');
  await tapMore(page);
  assert.equal(page.focused.at(-1), 'sess-more');
  assert.match(html, /f\.focus\(\{preventScroll: true\}\)/, 'the focus does not scroll the page');
});

test('P9 H: a tap elsewhere in the section does not fold or unfold', async () => {
  const page = await open(5);
  await page.element('sess-sec').listeners.click({target: {closest: () => null}});
  assert.deepEqual(cards(page), ['s5', 's4', 's3']);
});

test('P9 H: 3 sessions or fewer, no button; the unfolded state is not kept by a reload', async () => {
  for (const n of [1, 3]) assert.equal(more(await open(n)), '', `${n} session(s)`);
  const four = await open(4);
  assert.match(more(four), /Show 1 more/);
  await tapMore(four);
  assert.equal(cards(four).length, 4);
  assert.equal(cards(await open(4)).length, 3, 'a new launch starts folded');
  assert.doesNotMatch(html, /localStorage[^\n]*sessOpen|sessOpen[^\n]*localStorage/, 'not stored');
});

test('P9 H: the button is 48 px high, full width, in the accent colour; the tiles are 2 per row with a 10 px gap', () => {
  const rule = sel => (html.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`)) || [, ''])[1];
  assert.match(rule('.morebtn'), /width:100%/);
  assert.match(rule('.morebtn'), /min-height:48px/);
  assert.match(rule('.morebtn'), /color:var\(--accent\)/);
  assert.match(rule('.nbg'), /grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:10px/);
  assert.match(rule('.nbt'), /min-height:84px/);
  assert.match(rule('.nbt'), /border-radius:14px/);
  assert.match(rule('.nbt'), /background:color-mix\(in srgb,var\(--t,var\(--accent\)\) 14%,var\(--paper\)\)/);
  assert.match(rule('.nbt-nm'), /white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
  assert.match(rule('.nbt.add'), /border:1\.5px dashed var\(--line-strong\)/);
});
