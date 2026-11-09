// P8 R4a: the home page clarified (track A): the 56 px top bar (loupe « Search », round account button « Settings »),
// the search page (#search) with the facets, YOUR SESSIONS with an outlined Start, TRY ONE TODAY, no counter, the
// install invitation off the first screen (and in Settings).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, ownUrl, ownKey} = require('./harness.cjs');

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'laurent.thevin@example.test'}}};
const old = '2026-10-01T08:00:00Z';
const sheet = (slug, theme = 'strength', fields = {}) => ({slug, kind: 'sheet', theme, group: 'Arms', title: 'Title ' + slug, summary: 'A move.', source: {}, exercises: [], added_at: old, tags: {zone: ['shoulders']}, ...fields});
const session = (slug, items, fields = {}) => ({slug, theme: 'strength', title: 'Session ' + slug, format: '', why: '', key_points: [], source: {}, origin: 'user', thumbnail: '', items: items.map(s => ({slug: s, dose: ''})), created_at: old, ...fields});
const tables = (extra = {}) => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}, {id: 'yoga', title: 'Yoga', groups: [], builtin: true, position: 1}],
  sheets: [sheet('curl'), sheet('press'), sheet('plank', 'yoga', {title: 'Plank shoulders'})],
  sessions: [session('a', ['curl', 'press']), session('b', ['curl']), session('c', ['press'], {created_at: '2026-10-05T08:00:00Z'}), session('d', ['curl'])],
  practice_log: [{slug: 'session/b', done_on: '2026-10-20'}],
  requests: [], ...extra
});
const open = async (opts = {}) => { const page = await app({...signedIn, tables: tables(), ...opts}); await settle(); return page; };

test('R4 top bar: the loupe and the round account button with the initials; none on a notebook page', async () => {
  const page = await open();
  assert.equal(page.element('h-search').hidden, false);
  assert.equal(page.element('h-acct').hidden, false);
  assert.equal(page.element('h-acct').textContent, 'LT');
  assert.equal(page.element('search').hidden, true, 'no field on the home page');
  assert.equal(page.element('facets').hidden, true, 'no facets on the home page');
  assert.equal(page.element('count').textContent, '', 'no counter');
  page.go('#strength'); await settle();
  assert.equal(page.element('h-search').hidden, true);
  assert.equal(page.element('h-acct').hidden, true);
  assert.equal(page.element('search').hidden, false, 'a notebook page keeps its own field');
  assert.doesNotMatch(html.match(/<header id="brand-bar"[\s\S]*?<\/header>/)[0], />Settings</, 'no Settings text link');
});

test('R4 search page: the loupe opens it focused, hides the home blocks, shows the facets; results grouped by notebook; Cancel goes back', async () => {
  const page = await open();
  await page.fire('h-search'); await settle();
  assert.equal(page.location.hash, '#search');
  assert.equal(page.element('search').hidden, false);
  assert.ok(page.focused.includes('q') || page.focused.some(e => e && e.id === 'q'), 'the field takes the focus in the tap');
  assert.equal(page.element('q-cancel').hidden, false);
  assert.equal(page.element('facets').hidden, false);
  for (const id of ['portal', 'nb-h', 'new-sec', 'sess-sec', 'to-try', 'install-card']) assert.equal(page.element(id).hidden, true, id);
  page.element('q').value = 'move'; await page.fire('q', 'input');
  const res = page.element('results').innerHTML;
  assert.match(res, /<section class="sgrp"><h2 class="sec">Strength<span class="n">2<\/span>[\s\S]*<section class="sgrp"><h2 class="sec">Yoga<span class="n">1<\/span>/);
  page.element('q').value = 'kettlebell'; await page.fire('q', 'input');
  assert.match(page.element('results').innerHTML, /No sheet for “kettlebell”\.<\/p><button[^>]*data-add-video[^>]*>Add a video</);
  await page.fire('q-cancel'); await settle();
  assert.equal(page.element('q').value, '');
  assert.equal(page.element('search').hidden, true);
  assert.equal(page.element('portal').hidden, false);
});

test('R4 search page: a facet keeps #search; with none chosen the hash stays #search', async () => {
  const page = await open({hash: '#search?zone=shoulders'});
  assert.equal(page.element('facets').hidden, false);
  assert.match(page.element('results').innerHTML, /href="#curl"/);
  const target = {dataset: {facetValue: 'shoulders'}};
  await page.fire('facet-zone');
  await page.element('facet-options').listeners.click({target: {closest: sel => sel === '[data-facet-value]' ? target : null}});
  await settle();
  assert.match(page.location.hash, /^#search$/);
  assert.equal(page.element('search').hidden, false, 'still on the search page');
});

test('R4 YOUR SESSIONS: 3 cards, the last practised first, then the newest; outlined Start opens the player', async () => {
  const page = await open();
  const sec = page.element('sess-sec');
  assert.equal(sec.hidden, false);
  assert.match(sec.innerHTML, /Your sessions<span class="n">4<\/span>/);
  const order = [...sec.innerHTML.matchAll(/class="scard-o" href="#session\/([a-z])"/g)].map(m => m[1]);
  assert.deepEqual(order, ['b', 'c', 'a']);
  assert.match(sec.innerHTML, /<a class="btn ghost" href="#session\/b\/play" aria-label="Start Session b">[\s\S]*?Start<\/a>/);
  assert.match(sec.innerHTML, /2 exercises/);
  assert.match(sec.innerHTML, /<span class="nbn">Strength<\/span>/);
  const none = await open({tables: tables({sessions: []})});
  assert.equal(none.element('sess-sec').hidden, true);
});

test('R4 order of the home blocks and the floating + clearance', () => {
  const ids = ['brand-bar', 'otw-band', 'first-steps', 'new-sec', 'sess-sec', 'nb-h', 'portal', 'to-try', 'install-card', 'howto'];
  const at = ids.map(id => html.indexOf(`id="${id}"`));
  assert.ok(at.every((p, i) => p > 0 && (i === 0 || at[i - 1] < p)), ids.join(' → '));
  assert.match(html, /#home:not\(\[hidden\]\)\{padding-bottom:40px\}/, '40 px + the body\'s 56 px = 96 px under the page');
  assert.match(html, /#home\.srch~#add-video-fab\{display:none!important\}/, 'no + on the search page');
});

test('R4 TRY ONE TODAY: one sheet, Try it opens its player, Not for me brings the next', async () => {
  const page = await open({tables: tables({practice_log: [], sessions: []})});
  const tt = page.element('to-try');
  assert.equal(tt.hidden, false);
  const first = tt.innerHTML.match(/data-dismiss="([^"]+)"/)[1];
  assert.equal([...tt.innerHTML.matchAll(/data-dismiss=/g)].length, 1);
  assert.match(tt.innerHTML, new RegExp(`href="#${first}/play"[^>]*>[\\s\\S]*?Try it</a>`));
  await tt.listeners.click({target: {closest: sel => sel === '[data-dismiss]' ? {dataset: {dismiss: first}} : null}});
  assert.doesNotMatch(tt.innerHTML, new RegExp(`data-dismiss="${first}"`));
  assert.match(tt.innerHTML, /data-dismiss="/);
});

test('R4 install: off the first screen until a sheet was opened; in Settings without Not now', async () => {
  const ios = {userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'};
  const page = await open({nav: ios, dom: true});
  assert.equal(page.element('install-card').hidden, true, 'no sheet opened yet');
  page.go('#curl'); await settle();
  page.go(''); await settle();
  assert.equal(page.element('install-card').hidden, false, 'back after a first sheet');
  page.go('#settings'); await settle();
  assert.equal(page.element('s-app').hidden, false);
  assert.match(page.element('s-app-body').innerHTML, /Tap Share, then Add to Home Screen\./);
  assert.doesNotMatch(page.element('s-app-body').innerHTML, /Not now/);
  const desktop = await open({hash: '#settings'});
  assert.equal(desktop.element('s-app').hidden, true, 'nothing to offer without a way to install');
});

test('R4 New: the notebook colour on the card, a 4 px rule over its 4:5 photo', async () => {
  const fresh = new Date().toISOString();
  const page = await open({tables: tables({sheets: [sheet('curl', 'strength', {added_at: fresh})]})});
  assert.match(page.element('new-sec').innerHTML, /<h2 class="sec" id="new-h">New<span class="n">1<\/span>/);
  assert.match(page.element('new-cards').innerHTML, /<a class="card" href="#curl" style="--t:var\(--p\d\)">/);
  assert.match(html, /\.newrow \.card::before\{[^}]*border-top:4px solid var\(--t/);
});

// Codex pass 1 on #111: Cancel went back by a count of the entries search pushed, which a browser Back did not lower
// (home → loupe → facet → Back → Cancel left the app). It now goes back to the entry the loupe was tapped on.
const pickZone = async page => {
  const target = {dataset: {facetValue: 'shoulders'}};
  await page.fire('facet-zone');
  await page.element('facet-options').listeners.click({target: {closest: sel => sel === '[data-facet-value]' ? target : null}});
  await settle();
};
test('R4 search Cancel: straight after the loupe, back to home, one entry', async () => {
  const page = await open({history: 'stack'});
  await page.fire('h-search'); await settle();
  assert.deepEqual(page.history.entries.map(e => e.hash), ['', '#search']);
  await page.fire('q-cancel'); await settle();
  assert.equal(page.history.left, 0, 'still in the app');
  assert.equal(page.history.index, 0);
  assert.equal(page.location.hash, '');
  assert.equal(page.element('search').hidden, true);
  assert.equal(page.element('portal').hidden, false, 'the home page');
});

test('R4 search Cancel: loupe → facet → browser Back → Cancel lands on home, not before it', async () => {
  const page = await open({history: 'stack'});
  await page.fire('h-search'); await settle();
  await pickZone(page);
  assert.deepEqual(page.history.entries.map(e => e.hash), ['', '#search', '#search?zone=shoulders']);
  page.history.go(-1); await settle(); // the browser's Back: the search page without the facet
  assert.equal(page.location.hash, '#search');
  assert.equal(page.element('q-cancel').hidden, false);
  await page.fire('q-cancel'); await settle();
  assert.equal(page.history.left, 0, 'Cancel does not leave the app');
  assert.equal(page.history.index, 0);
  assert.equal(page.element('portal').hidden, false, 'the home page');
  // with the facet still chosen, Cancel goes back over both entries
  page.history.go(1); await settle(); page.history.go(1); await settle(); // Forward twice: #search?zone=shoulders
  assert.equal(page.location.hash, '#search?zone=shoulders');
  await page.fire('q-cancel'); await settle();
  assert.equal(page.history.left, 0);
  assert.equal(page.history.index, 0);
  assert.equal(page.element('portal').hidden, false);
});

test('R4 search Cancel: #search opened by a link goes home in place', async () => {
  const page = await open({history: 'stack', hash: '#search'});
  await page.fire('q-cancel'); await settle();
  assert.equal(page.history.left, 0);
  assert.deepEqual(page.history.entries.map(e => e.hash), ['']);
  assert.equal(page.element('portal').hidden, false);
});

// Codex pass 1 on #111: on #search, a failed load with no cached catalogue showed only the field and Cancel (the
// search branch emptied #count, which is visually hidden there). The page now says it, with Retry.
test('R4 search page: a failed load shows its error and Retry; Retry reads again', async () => {
  const failing = {sheets: {error: {message: 'Failed to fetch'}, status: 0}};
  const page = await open({hash: '#search', failing});
  assert.equal(page.element('search').hidden, false, 'the field and Cancel stay');
  assert.equal(page.element('srch-state').hidden, false);
  assert.match(page.element('srch-msg').textContent, /^Could not load your sheets: Failed to fetch/);
  assert.equal(page.element('srch-retry').hidden, false);
  assert.match(page.element('count').textContent, /^Could not load your sheets/, 'the live region says it too');
  assert.match(html, /<div class="noresult" id="srch-state" hidden><p id="srch-msg"><\/p><button type="button" class="btn ghost" id="srch-retry">Retry<\/button><\/div>/);
  delete failing.sheets; // the backend answers again
  await page.fire('srch-retry'); await settle();
  assert.equal(page.element('srch-state').hidden, true);
  page.element('q').value = 'move'; await page.fire('q', 'input');
  assert.match(page.element('results').innerHTML, /href="#curl"/);
});

// Codex pass 2 on #111: a sheet whose slug is « search » took the route, so the loupe opened that sheet.
test('R4 search route: the loupe opens the search page even with a sheet slugged « search »', async () => {
  const page = await open({tables: tables({sheets: [sheet('curl'), sheet('search', 'strength', {title: 'Search and grab'})]})});
  await page.fire('h-search'); await settle();
  assert.equal(page.location.hash, '#search');
  assert.equal(page.element('home').hidden, false, 'the home view, not the sheet');
  assert.equal(page.element('q-cancel').hidden, false, 'the search page');
  assert.equal(page.element('facets').hidden, false);
  page.element('q').value = 'grab'; await page.fire('q', 'input');
  assert.match(page.element('results').innerHTML, /Search and grab/, 'the sheet is still found');
});

// Codex pass 2 on #111: a video queued from the search page had no visible confirmation (the band is hidden there).
test('R4 search: nothing found → Add a video → Queue it goes back home, where the band says 1 on the way', async () => {
  const t = tables(), url = 'https://www.tiktok.com/@coach/video/42';
  // the backend keeps the row written (the harness answers an insert without storing it)
  const hold = (table, ops) => { if (table === 'requests' && ops.some(o => o[0] === 'insert') && !t.requests.length) t.requests.push({id: 'r1', status: 'queued', url, theme: null, slug: null, note: null, created_at: new Date().toISOString(), processed_at: null}); return null; };
  const page = await open({history: 'stack', tables: t, hold});
  assert.equal(page.element('otw-band').hidden, true, 'nothing on the way yet');
  await page.fire('h-search'); await settle();
  page.element('q').value = 'kettlebell'; await page.fire('q', 'input');
  assert.match(page.element('results').innerHTML, /data-add-video/);
  await page.element('results').listeners.click({target: {closest: sel => sel === '[data-add-video]' ? {} : null}});
  await settle();
  page.element('f-url').value = url;
  await page.fire('sheet-new', 'submit'); await settle();
  assert.equal(page.element('f-err').hidden, true, 'queued');
  assert.equal(page.clients.at(-1).calls.filter(c => c[0] === 'insert').length, 1);
  assert.equal(page.history.left, 0);
  assert.equal(page.history.index, 0, 'back on the entry the loupe was tapped on');
  assert.equal(page.location.hash, '');
  assert.equal(page.element('q-cancel').hidden, true, 'the search page is closed');
  assert.equal(page.element('portal').hidden, false, 'the home page');
  assert.equal(page.element('otw-band').hidden, false);
  assert.match(page.element('otw-band').innerHTML, /1 on the way/);
});

// Codex pass 3 on #111: a jump between two #search entries with the same hash (the browser's history menu) fires no
// hashchange, so the app's index was stale; Cancel reads the entry's own index.
test('R4 search Cancel: after a history-menu jump between two #search entries, Cancel lands on home', async () => {
  const page = await open({history: 'stack'});
  await page.fire('h-search'); await settle();
  await pickZone(page); // #search?zone=shoulders
  await pickZone(page); // a new sheet, the same value unticked: #search again, a new entry
  assert.deepEqual(page.history.entries.map(e => e.hash), ['', '#search', '#search?zone=shoulders', '#search']);
  page.history.go(-2); await settle(); // the history menu: the first #search, same hash, no hashchange
  assert.equal(page.history.index, 1);
  await page.fire('q-cancel'); await settle();
  assert.equal(page.history.left, 0, 'Cancel does not leave the app');
  assert.equal(page.history.index, 0);
  assert.equal(page.element('portal').hidden, false, 'the home page');
});
