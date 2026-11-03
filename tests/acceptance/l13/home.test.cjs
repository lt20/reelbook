const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, ownUrl, ownKey} = require('../../harness.cjs');

const signedIn = {
  remembered: {mode: 'own', url: ownUrl, key: ownKey},
  sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}
};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const ago = days => new Date(Date.now() - days * 86400000).toISOString();
const theme = (id, position) => ({id, title: id[0].toUpperCase() + id.slice(1), groups: [], builtin: true, position});
const sheet = (slug, added_at = ago(5), themeId = 'strength') => ({
  slug, kind: 'sheet', theme: themeId, group: 'General', title: `Title ${slug}`,
  summary: '', thumbnail: `${slug}.jpg`, added_at, source: {}
});
const tables = (sheets = [], extra = {}) => ({
  user_themes: [theme('strength', 0)], sheets, sessions: [], requests: [],
  notes: [], practice_log: [], ...extra
});
const open = async (rows, options = {}) => {
  const page = await app({...signedIn, tables: tables(rows), stored: {'rb.welcome.u1': '1'}, ...options});
  await settle();
  return page;
};
const homeMarkup = html.split('<!-- ===== Home: portal / theme ===== -->')[1].split('<!-- ===== Settings ===== -->')[0];
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const rule = selector => {
  const start = css.indexOf(`${selector}{`);
  assert.notEqual(start, -1, `CSS rule ${selector} exists`);
  return css.slice(start, css.indexOf('}', start) + 1);
};

// L13: compact brand bar, counter under it, and the existing add action.
test('L13 — Compact brand bar: 28 px mark, about 22 px wordmark, Settings on the same line, no eyebrow above the logo; small counter below; + Add a video remains in the bar', async () => {
  const bar = homeMarkup.match(/<header id="brand-bar"[^>]*>([\s\S]*?)<\/header>/);
  assert.ok(bar, 'the home brand bar is a header');
  assert.match(bar[1], /<img[^>]*width="28"[^>]*height="28"/);
  assert.match(bar[1], /id="h-title"[^>]*>Reelbook<\/h1>/);
  assert.match(bar[1], /<a[^>]*href="#settings"[^>]*>Settings<\/a>/);
  assert.doesNotMatch(bar[1], /id="btn-new"/); // L17: « + Add a video » is the floating #add-video-fab
  assert.doesNotMatch(bar[1], /eyebrow|h-eyebrow/);
  assert.match(rule('#brand-bar'), /display:flex/);
  assert.match(rule('#brand-bar'), /align-items:center/);
  assert.match(rule('#brand-wordmark'), /font-size:(?:20|21|22|23|24)px/);
  assert.ok(homeMarkup.indexOf('id="count"') > homeMarkup.indexOf('</header>'), 'the counter follows the bar');
  assert.match(rule('#count'), /font-size:(?:12|13|14)px/);

  const rows = Array.from({length: 107}, (_, i) => sheet(`s${i}`));
  const page = await open(rows, {tables: tables(rows, {
    user_themes: ['strength', 'mobility', 'cooking', 'golf'].map(theme),
    practice_log: Array.from({length: 23}, (_, i) => ({slug: `s${i}`, done_on: '2026-10-01'}))
  })});
  assert.equal(page.element('home').hidden, false);
  assert.equal(page.element('count').textContent, '23 practised · 107 saved · 4 notebooks');
  await page.fire('add-video-fab');
  assert.equal(page.element('sheet-new').hidden, false);
});

// L13: the six home blocks must keep this visual order when all are populated.
test('L13 — Top order: brand bar → search → New → To try → collapsed queue summary → notebooks', async () => {
  const ids = ['brand-bar', 'search', 'new-sec', 'to-try', 'queue-sec', 'portal'];
  const positions = ids.map(id => homeMarkup.indexOf(`id="${id}"`));
  assert.ok(positions.every(position => position >= 0), `home blocks exist: ${ids.join(', ')}`);
  assert.ok(positions.every((position, i) => i === 0 || positions[i - 1] < position), 'home blocks appear in the specified order');
  const rows = [sheet('fresh', ago(1)), sheet('old', ago(5))];
  const page = await open(rows, {tables: tables(rows, {
    requests: [{id: 1, url: 'https://www.instagram.com/reel/example/', status: 'queued', created_at: new Date().toISOString()}]
  })});
  for (const id of ['search', 'new-sec', 'to-try', 'queue-sec', 'portal']) {
    assert.equal(page.element(id).hidden, false, `${id} is visible`);
  }
  assert.match(page.element('new-sec').innerHTML, /New/);
  assert.match(page.element('to-try').innerHTML, /To try/);
  assert.match(page.element('queue-summary').innerHTML, /aria-expanded="false"/);
  assert.equal(page.element('queue').hidden, true);
});

// L13: the home card exposes the three latest sheets as accessible photo thumbnails.
test('L13 — Notebook cards show three photo thumbnails of their latest sheets in 4:5 format', async () => {
  const rows = [
    sheet('oldest', '2026-09-01T00:00:00Z'),
    sheet('third', '2026-10-01T00:00:00Z'),
    sheet('newest', '2026-10-03T00:00:00Z'),
    sheet('second', '2026-10-02T00:00:00Z')
  ];
  const page = await open(rows);
  const card = page.element('portal').innerHTML.match(/<a class="tcard" href="#strength"[\s\S]*?<\/a>/);
  assert.ok(card, 'the Strength notebook card is visible');
  const photos = [...card[0].matchAll(/<img\b[^>]*>/g)].map(match => match[0]);
  assert.equal(photos.length, 3);
  assert.deepEqual(photos.map(photo => photo.match(/alt="([^"]*)"/)[1]),
    ['Title newest', 'Title second', 'Title third']);
  assert.match(rule('.tcard .thumbs img'), /aspect-ratio:\s*4\s*\/\s*5/);
});

// L13: five sheets is the boundary; the Settings guide remains reachable.
test('L13 — How it works is hidden once the account has five sheets or more; its guide link remains in Settings', async () => {
  const four = await open(Array.from({length: 4}, (_, i) => sheet(`four-${i}`)));
  assert.equal(four.element('howto').hidden, false, 'four sheets still show the panel');
  const five = await open(Array.from({length: 5}, (_, i) => sheet(`five-${i}`)));
  assert.equal(five.element('howto').hidden, true, 'five sheets hide the panel');
  five.go('#settings');
  await settle();
  assert.equal(five.element('settings').hidden, false);
  assert.match(html, /<div id="settings"[\s\S]*?<a href="#welcome">Full guide<\/a>/);
});

// L13: a new account has no photo or populated discovery row.
test('L13 — Empty account keeps the home usable without New, To try, queue or photo thumbnails', async () => {
  const page = await open([]);
  assert.equal(page.element('home').hidden, false);
  assert.equal(page.element('new-sec').hidden, true);
  assert.equal(page.element('to-try').hidden, true);
  assert.equal(page.element('queue-sec').hidden, true);
  assert.equal(page.element('portal').hidden, false);
  assert.doesNotMatch(page.element('portal').innerHTML, /<div class="thumbs">/);
  assert.equal(page.element('howto').hidden, false);
  await page.fire('add-video-fab');
  assert.equal(page.element('sheet-new').hidden, false);
});

// L13: older Supabase projects and failed reads still leave a usable home.
test('L13 — A missing sessions or practice table, a failed request, and an offline catalogue leave a usable home', async () => {
  const rows = [sheet('old', ago(5))];
  const missing = {error: {code: 'PGRST205', message: 'Could not find the table'}, status: 404};
  const oldBackend = await open(rows, {failing: {sessions: missing, practice_log: missing}});
  assert.equal(oldBackend.element('home').hidden, false);
  assert.match(oldBackend.element('portal').innerHTML, /Strength/);
  assert.equal(oldBackend.element('to-try').hidden, true);

  const failedRequest = await open(rows, {tables: tables(rows, {
    requests: [{id: 2, url: 'https://www.instagram.com/reel/failure/', status: 'error', note: 'Video unavailable', created_at: new Date().toISOString()}]
  })});
  assert.equal(failedRequest.element('home').hidden, false);
  assert.match(failedRequest.element('queue-summary').innerHTML, /aria-expanded="false"/);
  assert.equal(failedRequest.element('queue').hidden, true);
  assert.match(failedRequest.element('portal').innerHTML, /Strength/);

  const offline = await open(rows, {failing: {sheets: {error: {message: 'Failed to fetch'}, status: 0}}});
  assert.equal(offline.element('home').hidden, false);
  assert.equal(offline.element('new-sec').hidden, true);
  assert.equal(offline.element('to-try').hidden, true);
  assert.equal(offline.element('queue-sec').hidden, true);
  assert.ok(offline.element('count').textContent.length > 0, 'the failed load is reported in the counter area');
});
