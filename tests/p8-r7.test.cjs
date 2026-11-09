// P8 R7 (docs/audit-design/lots/R7.md): the typographic story card. app/card.js lays out and draws a 1080 × 1920
// card (the notebook's colour, the title, the exercises with their doses, « n sets · today », the credits, the
// wordmark and the address; no photo), every text measured and wrapped, never clipped. Session done shows it once a
// week (else « Share your session »), « Share » shares the PNG where the phone can, else full screen with « Save the
// image » and « Share as text »; the session's Share sheet has a « Story image » row.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const RS = require('../app/sessions.js');
const C = require('../app/card.js');
const {app, html, ownUrl, ownKey} = require('./harness.cjs');

const ROOT = path.join(__dirname, '..');
const sw = fs.readFileSync(path.join(ROOT, 'app/sw.js'), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const plain = v => JSON.parse(JSON.stringify(v));
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'u1@example.test'}}};
const tables = (items, practice_log = []) => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: ['a', 'b', 'c'].map((slug, i) => ({slug, kind: 'sheet', theme: 'strength', title: 'Exercise ' + (i + 1), html: '<a href="#">Home</a>',
    source: i < 2 ? {author: ['coach.a', '@coach.b'][i], url: 'https://www.instagram.com/reel/' + slug + '/'} : {}})),
  sessions: [{slug: 'legs', theme: 'strength', title: 'Legs', format: '', items}], notes: [{slug: 'session/legs', body: 'SECRET NOTE'}], requests: [], practice_log
});
const ITEMS = [{slug: 'a', dose: '3 × 10', rest_s: 0}, {slug: 'b', dose: '40 s'}, {slug: 'c', dose: 'Light band'}];
const end = page => page.element('view').innerHTML;
const fire = async (page, id, type) => { await page.fire(id, type); await settle(); };
// card.js in the harness: records the cards asked for, answers a small png
const fakeCard = (log, fail = false) => ({
  label: c => `Story card: ${c.title}`,
  render: async card => { log.push(plain(card)); if (fail) throw new Error('no canvas'); return {canvas: {tagName: 'CANVAS'}, blob: new Blob(['png'], {type: 'image/png'})}; }
});
class Anchor {} Anchor.prototype.download = ''; // a browser whose links can download
const open = async ({nav = {}, stored = {}, log = [], fail = false, save = true, hash = '#session/legs/play', items = ITEMS, rb = null} = {}) => {
  const page = await app({...signedIn, tables: tables(items), hash, dom: true, nav, stored, timerCap: 1000,
    win: {RBCard: rb || fakeCard(log, fail)}, globals: {File, Blob, ...(save ? {HTMLAnchorElement: Anchor} : {})}});
  await settle();
  return page;
};
// a session played: a's three sets checked, then Finish
const finish = async page => {
  await fire(page, 'play-done-set'); await fire(page, 'play-done-set'); await fire(page, 'play-done-set');
  await fire(page, 'play-finish');
};
const monday = RS.weekStart((() => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })());

// ---------- layout (app/card.js, pure) ----------
// A measure close to the two families: Barlow Condensed ~0.42 em a character, Source Sans 3 ~0.5 em.
const measure = (f, s) => { const px = Number(f.match(/(\d+)px/)[1]); return s.length * px * (f.includes('Barlow') ? 0.42 : 0.5); };
const texts = L => L.ops.filter(o => o.t === 'text');
const card = (over = {}) => ({title: 'Legs', over: 'Strength', colour: 3, lang: 'en', today: true, sets: 9,
  items: [1, 2, 3].map(i => ({title: 'Exercise ' + i, dose: '3 × 10'})), authors: ['coach.a', '@coach.b'], ...over});
const inside = L => texts(L).every(o => o.x >= 96 && o.x + measure(o.font, o.text) <= C.W - 96 + 0.5 && o.y <= C.H - 96 + 0.5);
// no two texts share a line band (each baseline at least its size below the one above, in drawing order per column)
const noOverlap = L => {
  const t = texts(L).filter(o => o.text !== 'reelbook').sort((a, b) => a.y - b.y);
  return t.every((o, i) => !i || o.y - t[i - 1].y >= o.size * 0.9);
};

test('R7 layout: 3 exercises all shown, « 9 sets · today », the credits, the wordmark and the address; nothing outside the margins', () => {
  const L = C.layout(card(), measure);
  assert.equal(L.w, 1080); assert.equal(L.h, 1920);
  assert.deepEqual([L.shown, L.more, L.fit], [3, 0, true]);
  const t = texts(L).map(o => o.text);
  assert.deepEqual(t.slice(0, 4), ['reelbook', 'STRENGTH', 'Legs', '9 sets · today']);
  for (const s of ['Exercise 1', '3 × 10', 'Exercise 3', 'Videos: @coach.a, @coach.b', 'lt20.github.io/reelbook/?r=story']) assert.ok(t.includes(s), s);
  assert.ok(!t.some(s => /more/.test(s)));
  assert.ok(inside(L)); assert.ok(noOverlap(L));
  assert.ok(L.ops.some(o => o.t === 'mark'), 'the mark');
  assert.ok(!L.ops.some(o => o.t === 'image'), 'no photo, ever');
});

test('R7 layout: 12 exercises show 8, then « + 4 more »; the list never runs into the credits', () => {
  const L = C.layout(card({items: Array.from({length: 12}, (_, i) => ({title: 'Bulgarian split squat ' + (i + 1), dose: '3 × 8–10 per side'}))}), measure);
  assert.deepEqual([L.shown, L.more, L.fit], [8, 4, true]);
  assert.ok(texts(L).some(o => o.text === '+ 4 more'));
  assert.ok(inside(L)); assert.ok(noOverlap(L));
  // 8 exactly: no « more »; 9: 8 and « + 1 more »
  assert.deepEqual([8, 9].map(n => C.layout(card({items: Array.from({length: n}, (_, i) => ({title: 'Squat ' + i, dose: '3 × 10'}))}), measure)).map(x => [x.shown, x.more]), [[8, 0], [8, 1]]);
  // long names that wrap: fewer fit, the rest counted, still nothing clipped
  const long = C.layout(card({items: Array.from({length: 8}, (_, i) => ({title: 'Single-leg Romanian deadlift with a long pause at the bottom and a slow tempo ' + i, dose: '3 sets of 8 to 10 slow reps per side, 90 seconds of rest between sets'}))}), measure);
  assert.ok(long.shown < 8 && long.shown + long.more === 8 && long.fit, `${long.shown} + ${long.more}`);
  assert.ok(inside(long)); assert.ok(noOverlap(long));
});

test('R7 layout: a long title steps down and wraps (3 lines at most), a word wider than the card breaks, every word kept', () => {
  const title = 'Full body mobility and strength routine for the morning before work, with a longer cool-down';
  const L = C.layout(card({title}), measure);
  const lines = L.title.lines;
  assert.ok(lines.length >= 2 && lines.length <= 3, `${lines.length} lines`);
  assert.ok(L.title.size < 168, 'a smaller size than a short title');
  assert.equal(C.layout(card(), measure).title.size, 168);
  assert.equal(lines.join(' '), title, 'wrapped, not clipped');
  for (const l of lines) assert.ok(texts(L).some(o => o.text === l && o.size === L.title.size), 'each line drawn');
  assert.ok(inside(L) && L.fit);
  const huge = 'Supercalifragilisticexpialidociousbutevenlongerthanthecardcanholdonasingleline';
  const H = C.layout(card({title: huge}), measure);
  const hl = H.title.lines;
  assert.equal(hl.join(''), huge);
  assert.ok(hl.length > 1 && inside(H) && H.fit);
  assert.deepEqual(C.wrap(measure, '400 40px "Source Sans 3"', 'a b c', 1000), ['a b c']);
});

test('R7 layout: no author, no credit line; many authors keep 3 lines, then « and n more »; French words in a French session', () => {
  const none = C.layout(card({authors: [null, '', undefined]}), measure);
  assert.ok(!texts(none).some(o => /^Videos?:/.test(o.text)));
  assert.ok(none.fit && texts(none).some(o => o.text === 'lt20.github.io/reelbook/?r=story'));
  assert.ok(texts(C.layout(card({authors: ['solo']}), measure)).some(o => o.text === 'Video: @solo'));
  const many = C.layout(card({authors: Array.from({length: 40}, (_, i) => 'creator.number.' + i)}), measure);
  const cred = texts(many).filter(o => o.font.startsWith('400 40px'));
  assert.ok(cred.length <= 3 && /and \d+ more$/.test(cred.at(-1).text), cred.map(o => o.text).join(' / '));
  assert.ok(inside(many) && many.fit);
  const fr = texts(C.layout(card({lang: 'fr', authors: ['a', 'b'], items: Array.from({length: 10}, (_, i) => ({title: 'Fente ' + i, dose: '3 × 10'}))}), measure)).map(o => o.text);
  for (const s of ['9 séries · aujourd’hui', 'Vidéos : @a, @b', '+ 2 de plus']) assert.ok(fr.includes(s), s);
  // a session from its page (no play): « 4 exercises », no « today »
  assert.equal(C.metaOf({exercises: 4, lang: 'en'}), '4 exercises');
});

test('R7 colour: the notebook colour flat, the ink that reads on it (4.5:1 at least) for the 8 notebook colours', () => {
  for (let i = 0; i < 8; i++) {
    const {bg, ink} = C.colours(i);
    assert.equal(bg, C.PALETTE[i]);
    assert.ok(C.contrast(bg, ink) >= 4.5, `${bg} on ${ink}: ${C.contrast(bg, ink).toFixed(2)}`);
  }
  assert.equal(C.colours('#000000').ink, '#ffffff');
  assert.equal(C.colours(undefined).bg, C.PALETTE[3]);
  // the app's light palette, mirrored
  const p = html.match(/--p0:(#\w+); --p1:(#\w+); --p2:(#\w+); --p3:(#\w+); --p4:(#\w+); --p5:(#\w+); --p6:(#\w+); --p7:(#\w+);/).slice(1);
  assert.deepEqual(C.PALETTE, p);
});

test('R7 drawing waits for the two font families (document.fonts.load) before measuring anything', async () => {
  const calls = [];
  let release;
  const fonts = {load: f => { calls.push(['load', f]); return new Promise(ok => { release = release || ok; setTimeout(ok, 5); }); }};
  const ctx = {set font(f) { this._f = f; }, get font() { return this._f; }, measureText(s) { calls.push(['measure']); return {width: measure(this._f, s)}; },
    fillRect() {}, fillText(s) { calls.push(['text', s]); }, save() {}, restore() {}, translate() {}, scale() {}, fill() {}};
  const canvas = {getContext: () => { calls.push(['ctx']); return ctx; }, toBlob: cb => cb({type: 'image/png'})};
  const out = await C.render(card(), {fonts, createElement: () => canvas});
  const loads = calls.filter(c => c[0] === 'load').map(c => c[1]);
  assert.ok(loads.some(f => f.includes('Barlow Condensed')) && loads.some(f => f.includes('Source Sans 3')));
  const firstOther = calls.findIndex(c => c[0] !== 'load');
  assert.ok(calls.slice(firstOther).every(c => c[0] !== 'load'), 'every load asked before the canvas');
  assert.equal(out.blob.type, 'image/png');
  assert.ok(calls.some(c => c[0] === 'text' && c[1] === 'Legs'));
  // no document.fonts (an old browser): drawn at once in the fallback family
  assert.equal(await C.fontsReady({}), false);
});

// ---------- Session done ----------
test('R7 Session done: the card of today\'s play, loaded lazily (card.js?v=2), previewed scaled down; one filled action', async () => {
  // without card.js yet: the app adds the script once, the place waits
  const bare = await app({...signedIn, tables: tables(ITEMS), hash: '#session/legs/play', dom: true, timerCap: 1000});
  await settle(); await finish(bare);
  assert.deepEqual(bare.appended.map(n => n.src), ['card.js?v=2']);
  assert.doesNotMatch(html, /<script src="card\.js/, 'not loaded with the app');
  const log = [];
  const page = await open({log});
  await finish(page);
  const h = end(page);
  assert.match(h, /<div class="end-story" id="end-story"><p class="end-story-k">Your story card<\/p><div class="end-card" id="end-card" role="img" aria-label="[^"]+"><\/div><p class="end-story-n">Text and colour only\. No photo, no notes\.<\/p>/);
  assert.equal((h.match(/class="btn"(?! ghost)/g) || []).length, 1, 'one filled action (Share)');
  assert.equal(log.length, 1);
  const c = log[0];
  assert.deepEqual([c.title, c.over, c.today, c.sets, c.colour >= 0, c.lang], ['Legs', 'Strength', true, 3, true, 'en']);
  assert.deepEqual(c.items, [{title: 'Exercise 1', dose: '3 × 10'}], 'what was done today');
  assert.deepEqual(c.authors.filter(Boolean), ['coach.a']);
  assert.doesNotMatch(JSON.stringify(c), /SECRET|instagram\.com|thumbnail|jpg/i, 'no note, no link, no photo');
});

test('R7 share path with canShare({files}): « Share » sends the PNG to the phone\'s share menu; closed: nothing; refused: full screen', async () => {
  const shared = [];
  const nav = {canShare: d => !!(d && d.files && d.files.length), share: async d => { shared.push(d); }};
  const page = await open({nav});
  await finish(page);
  await fire(page, 'end-share-s');
  assert.equal(shared.length, 1);
  const f = shared[0].files[0];
  assert.deepEqual([shared[0].files.length, f.name, f.type, shared[0].title], [1, 'reelbook-legs.png', 'image/png', 'Legs']);
  assert.ok(!shared[0].text && !shared[0].url, 'the image only');
  assert.notEqual(page.element('story-dlg').open, true);
  assert.notEqual(page.element('share-dlg').open, true, 'not the text share');
  // closed by the person: nothing else
  nav.share = async () => { const e = new Error('closed'); e.name = 'AbortError'; throw e; };
  await fire(page, 'end-share-s');
  assert.notEqual(page.element('story-dlg').open, true);
  // another failure: the image full screen, « Share… » filled
  nav.share = async () => { throw new Error('NotAllowedError'); };
  await fire(page, 'end-share-s');
  assert.equal(page.element('story-dlg').open, true);
  assert.match(page.element('story-dlg').innerHTML, /<button class="btn" type="button" id="story-go">Share…<\/button><a class="btn ghost" id="story-save" href="blob:[^"]+" download="reelbook-legs\.png">Save the image<\/a><\/div>/);
  assert.doesNotMatch(page.element('story-dlg').innerHTML, /story-text|Share as text/, 'P8 R18: no text share');
});

test('R7 share path without canShare: full screen with « Save the image » (object URL download); no « Share as text » since P8 R18', async () => {
  const page = await open({nav: {share: async () => { throw new Error('text only'); }}}); // navigator.share for text, no canShare
  await finish(page);
  await fire(page, 'end-share-s');
  const d = page.element('story-dlg').innerHTML;
  assert.equal(page.element('story-dlg').open, true);
  assert.match(d, /<h2 id="story-h">Story image<\/h2>/);
  assert.match(d, /<img id="story-img" src="blob:[^"]+" alt="Story card: Legs">/);
  assert.match(d, /<div class="actions"><a class="btn" id="story-save" href="blob:[^"]+" download="reelbook-legs\.png">Save the image<\/a><\/div>/);
  assert.doesNotMatch(d, /story-go|story-text|Share as text/);
  // a browser whose links cannot download: « Press and hold the image », no button
  const ios = await open({save: false});
  await finish(ios);
  await fire(ios, 'end-share-s');
  const i = ios.element('story-dlg').innerHTML;
  assert.match(i, /Press and hold the image to save it\./);
  assert.doesNotMatch(i, /story-save|story-text/);
});

test('R7 the image could not be made: the place says so and « Share » sends the session to a training partner (P8 R18)', async () => {
  const page = await open({fail: true});
  await finish(page);
  assert.match(end(page), /The image could not be made\. « Share » sends the session to a training partner\./);
  await fire(page, 'end-share-s');
  assert.notEqual(page.element('story-dlg').open, true);
  assert.equal(page.element('share-dlg').open, true);
  assert.match(page.element('share-dlg').innerHTML, /Send “Legs” to a training partner/);
});

test('R7 weekly fold: the card shows once a week per account (rb.storyWeek.<user id>), else « Share your session »', async () => {
  const log = [];
  const first = await open({log});
  await finish(first);
  assert.equal(first.storage.get('rb.storyWeek.u1'), monday, 'the Monday of this week');
  assert.match(end(first), /id="end-card"/);
  // the second Session done of the week: folded, « Share » is the text share, no image drawn
  const shared = [];
  const nav = {canShare: () => true, share: async d => { shared.push(d); }};
  const again = await open({log: [], nav, stored: {'rb.storyWeek.u1': monday}});
  await finish(again);
  const h = end(again);
  assert.match(h, /<div class="end-story" id="end-story"><button type="button" class="btn ghost quiet end-story-l" id="end-story-open">Share your session<\/button><!--\/end-story--><\/div>/);
  assert.doesNotMatch(h, /id="end-card"/);
  assert.equal((h.match(/class="btn"(?! ghost)/g) || []).length, 1);
  await fire(again, 'end-share-s');
  assert.equal(again.element('share-dlg').open, true, 'the text share (R6)');
  assert.ok(shared.every(d => !d.files), 'no image sent');
  // the link unfolds the card in place; « Share » then sends the image; the week stays as it was
  again.element('share-dlg').open = false;
  await fire(again, 'end-story-open');
  assert.match(end(again), /id="end-card"/);
  await fire(again, 'end-share-s');
  assert.equal(shared.at(-1).files.length, 1);
  assert.equal(again.storage.get('rb.storyWeek.u1'), monday);
  // last week's mark: shown again, and this week noted; another account on this device has its own week
  const lastWeek = await open({stored: {'rb.storyWeek.u1': RS.weekStart('2026-11-02') === monday ? '2026-10-26' : RS.weekStart('2026-11-02')}});
  await finish(lastWeek);
  assert.match(end(lastWeek), /id="end-card"/);
  assert.equal(lastWeek.storage.get('rb.storyWeek.u1'), monday);
  const other = await open({stored: {'rb.storyWeek.u2': monday}});
  await finish(other);
  assert.match(end(other), /id="end-card"/);
});

test('R7 versions: card.js?v=2 asked by the app and precached by the worker, the cache VERSION moved', () => {
  const ver = (s, f) => Number((s.match(new RegExp(f.replace('.', '\\.') + '\\?v=(\\d+)')) || [])[1]);
  assert.equal(ver(html, 'card.js'), 2); // P8 R13: the card's address carries ?r=story
  assert.equal(ver(sw, 'card.js'), ver(html, 'card.js'));
  assert.ok(Number(sw.match(/const VERSION = 'rb-shell-(\d+)'/)[1]) >= 61);
});

test('R7 Finish with nothing checked: no card and the week stays free; « Share » opens the session\'s Share sheet (P8 R18: to a partner)', async () => {
  const log = [];
  const page = await open({log});
  await fire(page, 'play-finish');
  assert.match(end(page), /<div class="end-story" id="end-story"><!--\/end-story--><\/div>/);
  assert.equal(log.length, 0);
  assert.equal(page.storage.get('rb.storyWeek.u1'), undefined);
  await fire(page, 'end-share-s');
  assert.equal(page.element('share-dlg').open, true);
});

// ---------- Codex #116, pass 1 ----------
const {resolveObjectURL} = require('node:buffer');
const srcOf = page => (page.element('story-dlg').innerHTML.match(/<img id="story-img" src="(blob:[^"]+)"/) || [])[1];

test('R7 Codex #116: a 1 000-character title and 12 exercises keep a vertical budget: title 3 lines ellipsised, « + n more », credits fit, nothing overlaps', () => {
  const items = Array.from({length: 12}, (_, i) => ({title: 'Bulgarian split squat with a pause ' + (i + 1), dose: '3 × 8–10 / side'}));
  for (const title of ['W'.repeat(1000), Array.from({length: 200}, () => 'Wwww').join(' ')]) {
    const L = C.layout(card({title, items, authors: ['coach.a', '@coach.b', 'c'.repeat(300)]}), measure);
    assert.equal(L.fit, true);
    assert.ok(L.title.lines.length <= 3, `${L.title.lines.length} title lines`);
    assert.match(L.title.lines.at(-1), /…$/, 'ellipsised');
    assert.ok(L.shown >= 1 && L.shown + L.more === 12 && texts(L).some(o => o.text === `+ ${L.more} more`), `${L.shown} + ${L.more}`);
    assert.ok(inside(L), 'inside the margins'); assert.ok(noOverlap(L), 'no two texts on top of each other');
    const t = texts(L), cred = t.filter(o => o.font.startsWith('400 40px'));
    assert.ok(cred.length >= 1 && cred.length <= 3, 'credits, 3 lines at most');
    const lastList = t.filter(o => o.y < cred[0].y - 40).at(-1);
    assert.ok(lastList.y < cred[0].y - cred[0].size, 'the list ends above the credits');
    assert.ok(t.find(o => o.text === 'lt20.github.io/reelbook/?r=story'));
  }
  // an exercise name of 1 000 characters is cut too (3 lines, « … »)
  const one = C.layout(card({items: [{title: 'Squat '.repeat(170), dose: '3 × 10'}]}), measure);
  assert.ok(one.fit && inside(one) && noOverlap(one));
  assert.ok(texts(one).some(o => /…$/.test(o.text) && o.font.includes('Barlow')));
});

test('R7 Codex #116: a layout that cannot fit is never exported (render rejects it)', async () => {
  // a measure where a single letter is wider than the card: nothing can fit
  const wide = (f, s) => s.length * 2000;
  assert.equal(C.layout(card(), wide).fit, false);
  const ctx = {set font(f) { this._f = f; }, get font() { return this._f; }, measureText(s) { return {width: wide(this._f, s)}; },
    fillRect() {}, fillText() {}, save() {}, restore() {}, translate() {}, scale() {}, fill() {}};
  let exported = false;
  const doc = {createElement: () => ({getContext: () => ctx, toBlob(cb) { exported = true; cb(new Blob(['png'])); }})};
  await assert.rejects(C.render(card(), doc), /does not fit/);
  assert.equal(exported, false);
});

test('R7 a French card writes « / côté » (the app\'s doses say « / side »)', () => {
  const fr = texts(C.layout(card({lang: 'fr', items: [{title: 'Fente bulgare', dose: '3 × 10 / side'}, {title: 'Gainage', dose: '30 s / side'}]}), measure)).map(o => o.text);
  assert.ok(fr.includes('3 × 10 / côté') && fr.includes('30 s / côté'), fr.join(' | '));
  assert.ok(!fr.some(s => /side/.test(s)));
  const en = texts(C.layout(card({items: [{title: 'Split squat', dose: '3 × 10 / side'}]}), measure)).map(o => o.text);
  assert.ok(en.includes('3 × 10 / side'));
});

// ---------- Codex #116, pass 2 ----------
// P8 R18: the Share sheet's « Story image » row is gone (R19 brings the card to Session done and New move); its tests
// went with it, Session done's card keeps its own.
test('R7 Codex #116 pass 2: signed out — the Story image closes and Session done\'s card URL goes', async () => {
  const page = await open({nav: {share: async () => { throw new Error('text only'); }}});
  await finish(page);
  await fire(page, 'end-share-s');
  const endUrl = srcOf(page);
  assert.equal(page.element('story-dlg').open, true);
  assert.ok(resolveObjectURL(endUrl));
  page.clients[0].authListener('SIGNED_OUT', null); await settle();
  assert.notEqual(page.element('story-dlg').open, true, 'closed over the sign-in screen');
  assert.doesNotMatch(page.element('story-dlg').innerHTML, /blob:/, 'nothing of it left');
  assert.equal(resolveObjectURL(endUrl), undefined, 'Session done\'s card goes');
});

test('R7 Codex #116 pass 3: the phone\'s share menu open, signed out, then the share fails — the old account\'s card is not shown', async () => {
  let fail;
  const nav = {canShare: d => !!(d && d.files), share: () => new Promise((ok, ko) => { fail = () => ko(new Error('NotAllowedError')); })};
  const page = await open({nav});
  await finish(page);
  const going = page.element('end-share-s').listeners.click({}); await settle();
  assert.equal(typeof fail, 'function', 'the share menu is open');
  page.clients[0].authListener('SIGNED_OUT', null); await settle();
  fail(); await going; await settle();
  assert.notEqual(page.element('story-dlg').open, true, 'nothing opens after the sign-out');
  assert.doesNotMatch(page.element('story-dlg').innerHTML, /blob:/);
});
