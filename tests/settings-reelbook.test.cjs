// P8 R9: Settings › Reelbook (What's new, Share Reelbook, Star on GitHub, Report a problem; R17: Contact us, Ask for a
// feature, and Report a problem by email or as a GitHub issue) and the one-time card
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

const MAIL = 'contact@reelbook.si';
const withMail = {cfg: {contact: MAIL}};
// a mailto: split into its address, subject and body (decoded), and the raw query to check its encoding
const mail = href => {
  const m = /^mailto:([^?]+)\?(.*)$/.exec(href || ''); assert.ok(m, `a mailto: with a query, got ${href}`);
  const q = Object.fromEntries(m[2].split('&').map(kv => { const i = kv.indexOf('='); return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))]; }));
  return {to: m[1], subject: q.subject, body: q.body, raw: m[2]};
};

test('Settings › Reelbook — the rows, in order, at the bottom of Settings (R17: Contact us, Ask for a feature, Report a problem first)', () => {
  const settings = html.match(/<div id="settings"[\s\S]*?\n<\/div>\n/)[0];
  const section = settings.match(/<section class="panel" id="s-reelbook"[\s\S]*?<\/section>/);
  assert.ok(section, 'a Reelbook section in Settings');
  assert.ok(settings.lastIndexOf('<section') === settings.indexOf('<section class="panel" id="s-reelbook"'), 'the last section of Settings');
  const rows = [...section[0].matchAll(/<(a|button) class="rb-row" id="([\w-]+)"[^>]*>[\s\S]*?<span class="rb-t">([^<]+)<small[^>]*>([^<]*)</g)].map(m => [m[2], m[3], m[4]]);
  assert.deepEqual(rows, [['s-contact', 'Contact us', MAIL], ['s-idea', 'Ask for a feature', 'Tell us what’s missing'], ['s-report', 'Report a problem', 'By email or as a GitHub issue'],
    ['s-news', 'What’s new', 'Latest changes to the app'], ['s-share', 'Share Reelbook', 'Sends a link to Reelbook, not your notebooks'], ['s-star', 'Star on GitHub', 'Reelbook is open source']]);
  for (const id of ['s-news', 's-star']) assert.match(section[0], new RegExp(`id="${id}"[^>]*target="_blank" rel="noopener"`), `${id} opens a new tab`);
  assert.match(section[0], /<button class="rb-row" id="s-report" type="button" aria-haspopup="dialog">/, 'Report a problem is a button that opens a sheet');
  for (const id of ['s-contact', 's-idea', 's-report']) assert.match(section[0], new RegExp(`id="${id}"[^>]*><span class="rb-ic"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"`), `${id}: the same stroke icon`);
  assert.doesNotMatch(section[0], /\bfree\b/i, 'no « free »: a paid hosted plan is planned');
});

test('Settings › Reelbook — What’s new and Star on GitHub open the public repo', async () => {
  const page = await open('#settings');
  assert.equal(page.element('settings').hidden, false);
  assert.equal(page.element('s-news').href, REPO);
  assert.equal(page.element('s-star').href, REPO);
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

test('R17: Contact us and Ask for a feature — mailto: the project address, subject and body encoded', async () => {
  const page = await open('#settings', withMail);
  assert.equal(page.element('s-contact').hidden, false);
  assert.equal(page.element('s-idea').hidden, false);
  assert.equal(page.element('s-contact-at').textContent, MAIL);
  assert.equal(page.element('s-contact').href, 'mailto:contact@reelbook.si?subject=Reelbook');
  assert.equal(page.element('s-idea').href, 'mailto:contact@reelbook.si?subject=Reelbook%3A%20a%20feature%20idea&body=What%20I%E2%80%99d%20like%20Reelbook%20to%20do%3A%20');
  const idea = mail(page.element('s-idea').href);
  assert.deepEqual([idea.to, idea.subject, idea.body], [MAIL, 'Reelbook: a feature idea', 'What I’d like Reelbook to do: ']);
  assert.doesNotMatch(idea.raw, /[ +]/, 'spaces as %20, never « + » (mail apps read « + » as a plus)');
});

test('R17: the project address shows with a personal backend too, read from mailto: as well', async () => {
  const page = await open('#settings', {cfg: {contact: 'mailto:contact@reelbook.si'}}); // user() is an own backend
  assert.equal(page.element('s-contact').hidden, false);
  assert.equal(page.element('s-contact').href, 'mailto:contact@reelbook.si?subject=Reelbook');
});

test('R17: Report a problem — a sheet with two rows: an email and a GitHub issue', async () => {
  const page = await open('#settings', withMail);
  assert.equal(page.element('s-report-sub').textContent, 'By email or as a GitHub issue');
  const dlg = html.match(/<dialog class="dlg act prob-dlg" id="prob-dlg" aria-labelledby="prob-h">[\s\S]*?<\/dialog>/);
  assert.ok(dlg, 'a <dialog> sheet like the others');
  assert.match(dlg[0], /<h2 id="prob-h">Report a problem<\/h2>/);
  const rows = [...dlg[0].matchAll(/<a class="rb-row" id="([\w-]+)"[^>]*>[\s\S]*?<span class="rb-t">([^<]+)<small>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(rows, [['prob-mail', 'Send an email'], ['prob-issue', 'Open a GitHub issue']]);
  assert.match(dlg[0], /id="prob-issue"[^>]*target="_blank" rel="noopener"/);
  await click(page, 's-report');
  assert.equal(page.element('prob-dlg').open, true);
  const m = mail(page.element('prob-mail').href);
  assert.deepEqual([m.to, m.subject], [MAIL, 'Reelbook: a problem']);
  assert.match(m.raw, /^subject=Reelbook%3A%20a%20problem&body=/);
  assert.match(page.element('prob-issue').href, /^https:\/\/github\.com\/lt20\/reelbook\/issues\/new\?body=/);
  await click(page, 'prob-mail');
  assert.equal(page.element('prob-dlg').open, false, 'a choice closes the sheet');
  await click(page, 's-report'); await click(page, 'prob-close');
  assert.equal(page.element('prob-dlg').open, false);
});

test('R17: Report a problem by email — version and platform, a blank line to write on, never the account address nor a video link', async () => {
  const opened = [];
  const page = await open('#settings', {...withMail, nav: {userAgent: IPHONE, maxTouchPoints: 5}, win: {open: u => opened.push(u), caches: {keys: async () => ['rb-shell-54', 'rb-shell-55']}}});
  await click(page, 's-report');
  await settle();
  const {body: text} = mail(page.element('prob-mail').href);
  assert.equal(text, 'What happened:\n\n\n---\nApp version: rb-shell-55\nPlatform: iPhone · Safari · in the browser');
  assert.doesNotMatch(page.element('prob-mail').href, /alice|example\.test|https?%3A|instagram|tiktok|DEMO123|7312|personal/i, 'no account, video or backend');
  assert.deepEqual(opened, [], 'the sheet, not a new tab');
});

test('R17: without a project address — no email rows, Report a problem goes straight to the issue', async () => {
  for (const contact of ['', '   ', 'https://example.test/help']) {
    const opened = [];
    const page = await open('#settings', {cfg: {contact}, win: {open: (...a) => opened.push(a)}});
    assert.equal(page.element('s-contact').hidden, true, `no Contact us (${JSON.stringify(contact)})`);
    assert.equal(page.element('s-idea').hidden, true, 'no Ask for a feature');
    assert.equal(page.element('s-report-sub').textContent, 'Opens a GitHub issue, filled in for you');
    await click(page, 's-report');
    assert.notEqual(page.element('prob-dlg').open, true, 'no sheet');
    assert.equal(opened.length, 1);
    assert.match(opened[0][0], /^https:\/\/github\.com\/lt20\/reelbook\/issues\/new\?body=/);
    assert.deepEqual(opened[0].slice(1), ['_blank', 'noopener']);
  }
});

test('Report a problem — the issue carries the app version and the platform, never a video URL, an address or the backend', async () => {
  const page = await open('#settings', {...withMail, nav: {userAgent: IPHONE, maxTouchPoints: 5}, win: {caches: {keys: async () => ['rb-photos-1', 'rb-shell-54', 'rb-shell-55', 'rb-demo-2']}}});
  await click(page, 's-report');
  const href = page.element('prob-issue').href, text = body(href);
  assert.match(text, /^App version: rb-shell-55$/m);
  assert.match(text, /^Platform: iPhone · Safari · in the browser$/m);
  assert.doesNotMatch(text, /https?:|www\.|instagram|tiktok|youtu|facebook|DEMO123|7312/i, 'no link of any kind in the body');
  assert.doesNotMatch(href, /instagram|tiktok|DEMO123|7312|example\.test|personal/i, 'no video, address or backend in the URL');
  assert.equal(new URL(href).searchParams.get('title'), null, 'the title is left to the person');
  // tapping the row reads the platform and the version at that time
  await click(page, 'prob-issue');
  assert.equal(page.element('prob-issue').href, href);
});

test('Report a problem — without a service worker the version is « unknown »', async () => {
  const page = await open('#settings', withMail);
  await click(page, 's-report');
  assert.match(body(page.element('prob-issue').href), /^App version: unknown$/m);
  assert.match(mail(page.element('prob-mail').href).body, /^App version: unknown$/m);
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
