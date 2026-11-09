// P8 R9: Settings › Reelbook (What's new, Share Reelbook, Star on GitHub, Report a problem) and the one-time card
// under Session done (docs/audit-design/lots/R9.md).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, ownUrl, ownKey} = require('./harness.cjs');

const REPO = 'https://github.com/lt20/reelbook';
const LANDING = 'https://lt20.github.io/reelbook/?r=app'; // P8 R13
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const user = id => ({remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id, email: id + '@example.test'}}});
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const VIDEO = 'https://www.instagram.com/reel/DEMO123/';
const tables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: [{slug: 'first', kind: 'sheet', theme: 'strength', title: 'Exercise 1', html: '<a href="#">Home</a>', source: {url: VIDEO, author: '@coach'}}],
  sessions: [{slug: 'routine', theme: 'strength', title: 'Routine', format: '30 s rest', items: [{slug: 'first', dose: '3 × 10'}]}],
  notes: [], practice_log: [],
  requests: [{id: 1, url: 'https://www.tiktok.com/@coach/video/7312', status: 'error', note: 'login required'}, {id: 2, url: VIDEO, status: 'pending'}]
});
const open = async (hash, options = {}) => {
  const page = await app({...user('alice'), tables: tables(), hash, dom: true, ...options});
  await settle();
  return page;
};
const click = async (page, id) => { await page.fire(id); await settle(); };
const body = href => decodeURIComponent(new URL(href).searchParams.get('body') || '');

test('Settings › Reelbook — the four rows, in order, at the bottom of Settings', () => {
  const settings = html.match(/<div id="settings"[\s\S]*?\n<\/div>\n/)[0];
  const section = settings.match(/<section class="panel" id="s-reelbook"[\s\S]*?<\/section>/);
  assert.ok(section, 'a Reelbook section in Settings');
  assert.ok(settings.lastIndexOf('<section') === settings.indexOf('<section class="panel" id="s-reelbook"'), 'the last section of Settings');
  const rows = [...section[0].matchAll(/<(a|button) class="rb-row" id="([\w-]+)"[^>]*>[\s\S]*?<span class="rb-t">([^<]+)<small>/g)].map(m => [m[2], m[3]]);
  assert.deepEqual(rows, [['s-news', 'What’s new'], ['s-share', 'Share Reelbook'], ['s-star', 'Star on GitHub'], ['s-report', 'Report a problem']]);
  for (const id of ['s-news', 's-star', 's-report']) assert.match(section[0], new RegExp(`id="${id}"[^>]*target="_blank" rel="noopener"`), `${id} opens a new tab`);
  assert.doesNotMatch(section[0], /\bfree\b/i, 'no « free »: a paid hosted plan is planned');
});

test('Settings › Reelbook — What’s new and Star on GitHub open the public repo, Report a problem a new issue', async () => {
  const page = await open('#settings');
  assert.equal(page.element('settings').hidden, false);
  assert.equal(page.element('s-news').href, REPO);
  assert.equal(page.element('s-star').href, REPO);
  assert.match(page.element('s-report').href, /^https:\/\/github\.com\/lt20\/reelbook\/issues\/new\?body=/);
});

test('Share Reelbook — the share sheet with the landing and R8’s line; else the clipboard; else the link to copy', async () => {
  const shared = [];
  let page = await open('#settings', {nav: {share: async d => { shared.push({...d}); }}});
  await click(page, 's-share');
  assert.deepEqual(shared, [{title: 'Reelbook', text: 'Your saved workout videos, turned into a training notebook.', url: LANDING}]);
  assert.equal(page.element('s-share-out').hidden, true, 'nothing to say after a share');

  page = await open('#settings', {nav: {share: async () => { const e = new Error('closed'); e.name = 'AbortError'; throw e; }, clipboard: {writeText: async () => { throw new Error('must not copy'); }}}});
  await click(page, 's-share');
  assert.equal(page.element('s-share-out').hidden, true, 'a share closed by the person does nothing more');

  const copied = [];
  page = await open('#settings', {nav: {clipboard: {writeText: async t => { copied.push(t); }}}});
  await click(page, 's-share');
  assert.deepEqual(copied, ['Your saved workout videos, turned into a training notebook. ' + LANDING]);
  assert.equal(page.element('s-share-out').hidden, false);
  assert.equal(page.element('s-share-out').textContent, 'Link copied. Paste it in a message.');

  page = await open('#settings');
  await click(page, 's-share');
  assert.equal(page.element('s-share-out').textContent, 'Copy this link: ' + LANDING);
});

test('Report a problem — the issue carries the app version and the platform, never a video URL, an address or the backend', async () => {
  const page = await open('#settings', {nav: {userAgent: IPHONE, maxTouchPoints: 5}, win: {caches: {keys: async () => ['rb-photos-1', 'rb-shell-54', 'rb-shell-55', 'rb-demo-2']}}});
  await settle();
  const href = page.element('s-report').href, text = body(href);
  assert.match(text, /^App version: rb-shell-55$/m);
  assert.match(text, /^Platform: iPhone · Safari · in the browser$/m);
  assert.doesNotMatch(text, /https?:|www\.|instagram|tiktok|youtu|facebook|DEMO123|7312/i, 'no link of any kind in the body');
  assert.doesNotMatch(href, /instagram|tiktok|DEMO123|7312|example\.test|personal/i, 'no video, address or backend in the URL');
  assert.equal(new URL(href).searchParams.get('title'), null, 'the title is left to the person');
  // tapping it again reads the platform and the version at that time
  await click(page, 's-report');
  assert.equal(page.element('s-report').href, href);
});

test('Report a problem — without a service worker the version is « unknown »', async () => {
  const page = await open('#settings');
  assert.match(body(page.element('s-report').href), /^App version: unknown$/m);
});

const finish = async page => {
  page.go('#session/routine/play'); await settle();
  assert.equal(page.element('player').hidden, false);
  await click(page, 'play-finish');
  assert.equal(page.element('view').hidden, false);
  return page.element('view').innerHTML;
};
const card = screen => (screen.match(/<div id="end-promo">([\s\S]*?)<\/div><\/div>$/) || [])[1];

test('Star card — after the 2nd session done only, once, and per user', async () => {
  const page = await open('#');
  let screen = await finish(page);
  assert.match(screen, /Session done/);
  assert.equal(card(screen), '', 'no card after the 1st session');
  assert.equal(page.storage.get('rb.star.alice'), '1');

  screen = await finish(page);
  assert.match(card(screen), /Reelbook is open source\. A star on GitHub helps others find it\./);
  assert.match(card(screen), /<a class="btn ghost" id="end-star" href="https:\/\/github\.com\/lt20\/reelbook" target="_blank" rel="noopener">[\s\S]*Star on GitHub<\/a>/, 'outlined, never filled');
  assert.match(card(screen), /<button type="button" class="btn ghost quiet" id="end-not-now">Not now<\/button>/);
  assert.equal([...screen.matchAll(/class="btn"/g)].length <= 1, true, 'one filled action at most on the screen');
  assert.ok(screen.indexOf('id="end-close"') < screen.indexOf('id="end-promo"'), 'below the existing content');
  assert.equal(page.storage.get('rb.star.alice'), 'done');

  // the next sessions: never again, whatever the answer
  assert.equal(card(await finish(page)), '');
  assert.equal(card(await finish(page)), '');

  // another account on the same device counts its own sessions
  const bob = await open('#', {...user('bob'), stored: Object.fromEntries(page.storage)});
  assert.equal(card(await finish(bob)), '');
  assert.match(card(await finish(bob)), /A star on GitHub/);
  assert.equal(bob.storage.get('rb.star.alice'), 'done');
});

test('Star card — « Not now » and « Star on GitHub » both hide it for good', async () => {
  for (const [id, after] of [['end-not-now', ''], ['end-star', 'Thank you. It really helps.']]) {
    const page = await open('#', {stored: {'rb.star.alice': '1'}});
    assert.match(card(await finish(page)), /A star on GitHub/);
    await click(page, id);
    if (after) assert.match(page.element('end-promo').innerHTML, new RegExp(after)); else assert.equal(page.element('end-promo').innerHTML, '');
    assert.equal(page.storage.get('rb.star.alice'), 'done');
    assert.equal(card(await finish(page)), '');
  }
});

test('Star card — never in the player, nor after a single sheet played', async () => {
  const page = await open('#', {stored: {'rb.star.alice': '1'}});
  page.go('#session/routine/play'); await settle();
  assert.doesNotMatch(page.element('player').innerHTML, /end-promo|A star on GitHub/);
  page.go('#first/play'); await settle();
  assert.equal(page.element('player').hidden, false, 'the sheet plays');
  assert.doesNotMatch(page.element('player').innerHTML, /end-promo|A star on GitHub/);
  await click(page, 'play-finish');
  assert.doesNotMatch(page.element('view').innerHTML, /end-promo|A star on GitHub/);
  assert.equal(page.storage.get('rb.star.alice'), '1', 'only a session done counts');
});

test('Star card — hosted processing: « Know someone who saves workout reels? » with « Share Reelbook »', async () => {
  const shared = [];
  const page = await open('#', {stored: {'rb.star.alice': '1'}, nav: {share: async d => { shared.push({...d}); }},
    source: s => { assert.ok(s.includes("const OTW_MODE = 'computer',")); return s.replace("const OTW_MODE = 'computer',", "const OTW_MODE = 'hosted',"); }});
  const c = card(await finish(page));
  assert.match(c, /Know someone who saves workout reels\?/);
  assert.match(c, /<button type="button" class="btn ghost" id="end-share">[\s\S]*Share Reelbook<\/button>/);
  assert.doesNotMatch(c, /GitHub/);
  await click(page, 'end-share');
  assert.deepEqual(shared, [{title: 'Reelbook', text: 'Your saved workout videos, turned into a training notebook.', url: LANDING}]);
  assert.equal(page.element('end-promo').innerHTML, '');
  assert.equal(page.storage.get('rb.star.alice'), 'done');
});
