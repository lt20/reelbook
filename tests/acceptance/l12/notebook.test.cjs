const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, ownUrl, ownKey} = require('../../harness.cjs');

const signedIn = {
  remembered: {mode: 'own', url: ownUrl, key: ownKey},
  sessions: {[ownUrl]: {id: 'u1', email: 'reader@example.test'}}
};
const library = [{id: 'strength', title: 'Strength', groups: ['Shoulders', 'Arms', 'Legs']}];
const sheets = [
  {slug: 'angel', kind: 'sheet', theme: 'strength', group: 'Shoulders', title: 'Floor angel', summary: 'Standalone shoulder sheet.', duration: '5 min', source: {author: 'Author A'}},
  {slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Hammer curl', summary: 'Standalone arm sheet.'},
  {slug: 'rotation', kind: 'sheet', theme: 'strength', group: 'Shoulders', title: 'External rotation', summary: 'Exercise one.'},
  {slug: 'raise', kind: 'sheet', theme: 'strength', group: 'Shoulders', title: 'Lateral raise', summary: 'Exercise two.'}
];
const videoSessions = [{slug: 'shoulder-work', theme: 'strength', title: 'Shoulder work', origin: 'video', why: 'Session summary.', items: [{slug: 'rotation'}, {slug: 'raise'}]}];
const tables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: library[0].groups, builtin: true, position: 0}],
  sheets,
  sessions: videoSessions
});
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const open = async (options = {}) => {
  const page = await app({...signedIn, library, tables: tables(), hash: '#strength', ...options});
  await settle();
  return page;
};
const section = (markup, group) => {
  const escaped = group.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = markup.match(new RegExp(`<section\\b[^>]*data-group="${escaped}"[^>]*>([\\s\\S]*?)<\\/section>`));
  assert.ok(match, `a section identifies ${group}`);
  return match[1];
};
const cssRule = selector => {
  const start = html.indexOf(selector + '{');
  assert.notEqual(start, -1, `${selector} has a CSS rule`);
  return html.slice(start + selector.length + 1, html.indexOf('}', start));
};

test('L12 — group chips under the title show counts in library order; empty groups are hidden', async () => {
  const page = await open();
  assert.equal(page.element('h-title').textContent, 'Strength');
  const chips = page.element('group-chips').innerHTML;
  assert.match(chips, /Shoulders 3/);
  assert.match(chips, /Arms 1/);
  assert.ok(chips.indexOf('Shoulders 3') < chips.indexOf('Arms 1'));
  assert.doesNotMatch(chips, /Legs/);
  assert.match(chips, /href="#strength~Shoulders"/);
  assert.match(cssRule('.group-chips'), /position:\s*sticky/);
  assert.match(cssRule('.group-chips'), /overflow-x:\s*auto/);
});

test('L12 — each nonempty group is one horizontal snap row, with standalone sheets before « From sessions »', async () => {
  const page = await open();
  const markup = page.element('groups').innerHTML;
  const shoulders = section(markup, 'Shoulders');
  const arms = section(markup, 'Arms');
  assert.match(shoulders, /class="[^"]*group-row/);
  assert.match(arms, /class="[^"]*group-row/);
  assert.ok(shoulders.indexOf('href="#angel"') < shoulders.indexOf('From sessions'));
  assert.ok(shoulders.indexOf('From sessions') < shoulders.indexOf('href="#rotation"'));
  assert.ok(shoulders.indexOf('From sessions') < shoulders.indexOf('href="#raise"'));
  assert.doesNotMatch(arms, /From sessions/);
  assert.doesNotMatch(markup, /data-group="Legs"/);
  assert.match(cssRule('.group-row'), /overflow-x:\s*auto/);
  assert.match(cssRule('.group-row'), /scroll-snap-type:\s*x/);
  assert.match(html, /\.group-row\s+\.card\s*\{[^}]*scroll-snap-align:\s*start/);
  assert.match(html, /(?:grid-auto-columns|flex-basis|width):\s*(?:min\()?4[0-8]%/);
});

test('L12 — « See all 3 » opens a group grid, and the notebook route restores the rows', async () => {
  const page = await open();
  const row = section(page.element('groups').innerHTML, 'Shoulders');
  assert.match(row, /href="#strength~Shoulders"[^>]*>See all 3<\/a>/);
  page.go('#strength~Shoulders');
  await settle();
  assert.equal(page.element('home').hidden, false);
  assert.match(page.element('groups').innerHTML, /class="[^"]*grid/);
  assert.match(page.element('groups').innerHTML, /href="#angel"/);
  assert.doesNotMatch(page.element('groups').innerHTML, /href="#curl"/);
  page.go('#strength');
  await settle();
  assert.match(section(page.element('groups').innerHTML, 'Shoulders'), /class="[^"]*group-row/);
});

test('L12 — sessions keep their row at the top and the header counts standalone sheets, sessions and exercise sheets', async () => {
  const page = await open();
  assert.equal(page.element('count').textContent, '2 sheets · 1 session (2 exercises)');
  const markup = page.element('groups').innerHTML;
  assert.ok(markup.indexOf('href="#session/shoulder-work"') < markup.indexOf('data-group="Shoulders"'));
  assert.match(markup, /href="#session\/shoulder-work"/);
});

test('L12 — cards use 4:5 cover photos, two summary lines and at most two single-line meta pills', async () => {
  const page = await open();
  const markup = page.element('groups').innerHTML;
  const cards = [...markup.matchAll(/<a\b[^>]*class="[^"]*card[^"]*"[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]);
  assert.ok(cards.length >= 5);
  for (const card of cards) {
    assert.match(card, /<img\b/);
    const pills = card.match(/<div class="m">([\s\S]*?)<\/div>/)?.[1] || '';
    assert.ok((pills.match(/<span\b/g) || []).length <= 2, card);
  }
  assert.match(cssRule('.card img'), /aspect-ratio:\s*4\s*\/\s*5/);
  assert.match(cssRule('.card img'), /object-fit:\s*cover/);
  assert.match(cssRule('.card img'), /object-position:\s*50%\s+30%/);
  assert.doesNotMatch(cssRule('.card.big img'), /aspect-ratio/);
  assert.match(cssRule('.card p'), /-webkit-line-clamp:\s*2/);
  assert.match(cssRule('.card .m'), /flex-wrap:\s*nowrap/);
  assert.match(cssRule('.card .m span'), /text-overflow:\s*ellipsis/);
});

test('L12 — an empty notebook has no group chips or « See all » link', async () => {
  const page = await open({tables: {...tables(), sheets: [], sessions: []}});
  assert.doesNotMatch(page.element('group-chips').innerHTML, /Shoulders|Arms|Legs/);
  assert.doesNotMatch(page.element('groups').innerHTML, /See all|data-group=/);
});

test('L12 — a backend without the sessions table still shows sheets without a session divider', async () => {
  const page = await open({failing: {sessions: {error: {code: 'PGRST205', message: 'Could not find the table'}, status: 404}}});
  const markup = page.element('groups').innerHTML;
  assert.match(markup, /href="#angel"/);
  assert.match(markup, /href="#rotation"/);
  assert.doesNotMatch(markup, /From sessions|href="#session\//);
});

test('L12 — catalogue errors and offline reads do not show stale group rows or « See all » links', async () => {
  for (const error of [{message: 'permission denied', code: '42501'}, {message: 'Failed to fetch'}]) {
    const page = await open({failing: {sheets: {error, status: error.code ? 403 : 0}}});
    assert.doesNotMatch(page.element('groups').innerHTML, /data-group=|See all/);
    assert.doesNotMatch(page.element('group-chips').innerHTML, /Shoulders 3|Arms 1/);
    assert.notEqual(page.element('count').textContent, '2 sheets · 1 session (2 exercises)');
  }
});
