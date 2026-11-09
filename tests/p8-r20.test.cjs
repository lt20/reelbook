// P8 R20: a « Something wrong? » request (note « Redo: <instruction> », slug = the page reported) is a fix of a sheet
// the account has, never a new video: « Fix requested · <title> » and its instruction, in « Fixes requested » (in
// « Needs you » when it failed), counted apart on the band, no ghost card in its notebook (the sheet's card says
// « Fix requested »). And one reel is one video whatever its suffixes: RS.linkKey for the duplicate check of Add,
// RS.cleanLink for the address written.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {app, ownUrl, ownKey} = require('./harness.cjs');
const RS = require('../app/sessions.js');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const now = () => new Date().toISOString();
const req = (id, status, extra = {}) => ({id, status, url: `https://www.instagram.com/reel/${id}/`, theme: null, slug: null, note: null, created_at: now(), processed_at: null, ...extra});
const fix = (id, slug, text, extra = {}) => req(id, 'queued', {url: 'https://www.instagram.com/reel/EXAMPLE0001/', theme: 'strength', slug, note: `Redo: ${text}`, ...extra});
const themes = [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}, {id: 'mma', title: 'MMA', groups: [], builtin: true, position: 1}];
const sheet = (slug, extra = {}) => ({slug, kind: 'sheet', theme: 'strength', group: 'Arms', title: `Title ${slug}`, summary: '', exercises: [], source: {}, added_at: '2026-10-01T00:00:00Z', ...extra});
const session = {slug: 'routine', theme: 'strength', title: 'Morning routine', origin: 'user', items: [{slug: 'curl', dose: '3 × 10'}], source: {url: 'https://www.tiktok.com/@coach/video/7312'}};
const tables = (requests = [], sheets = [sheet('curl', {source: {url: 'https://www.instagram.com/reel/EXAMPLE0001/'}})], sessions = []) => ({user_themes: themes, sheets, sessions, notes: [], requests});
const open = async (opts = {}) => { const page = await app({...signedIn, stored: {'rb.welcome.u1': '1'}, ...opts}); await settle(); return page; };
const tap = (page, id, sel, dataset = {}) => page.element(id).listeners.click({target: {closest: s => s === sel ? {dataset, disabled: false} : null}});
const rowOf = (page, id) => (page.element('queue').innerHTML.split('<button type="button" class="q qrow"').find(r => r.startsWith(` data-row="${id}"`)) || '');
const sectionOf = (page, id) => { const q = page.element('queue').innerHTML, at = q.indexOf(`data-row="${id}"`); return (/<h3 class="otw-sec[^"]*">([^<]+?) <span/g.exec(q.slice(0, at).split('<h3').slice(-1).map(h => '<h3' + h)[0]) || [])[1]; };
const bandText = page => page.element('otw-band').innerHTML.replace(/<svg[^]*?<\/svg>/g, '').replace(/<span class="tiles"[^]*?<\/span><\/span>/, '').replace(/<[^>]+>/g, '').trim();

// ---------- a fix shown as a fix ----------

test('R20: a fix reads « Fix requested · <the sheet\'s title> » with its instruction, in « Fixes requested », after the videos', async () => {
  const page = await open({tables: tables([req('v', 'queued', {theme: 'strength'}), fix('f', 'curl', 'the hands are reversed'), fix('s', 'session/routine', 'add a warm-up', {theme: 'strength'})], undefined, [session])});
  await page.fire('otw-band');
  assert.match(rowOf(page, 'f'), /<span class="t1">Fix requested · Title curl<\/span><small class="fixnote">the hands are reversed<\/small>/);
  assert.match(rowOf(page, 's'), /<span class="t1">Fix requested · Morning routine<\/span><small class="fixnote">add a warm-up<\/small>/, 'a session reported: its title');
  assert.equal(sectionOf(page, 'v'), 'Not started');
  assert.equal(sectionOf(page, 'f'), 'Fixes requested');
  assert.equal(sectionOf(page, 's'), 'Fixes requested');
  assert.match(page.element('queue').innerHTML, /<h3 class="otw-sec">Fixes requested <span class="n">2<\/span><\/h3>/);
  assert.doesNotMatch(rowOf(page, 'f'), /Instagram reel|added today/, 'not named as a new video');
  // its detail: the fix, Open the video and Remove; no Move (the fix stays with its sheet)
  await tap(page, 'queue', '[data-row]', {row: 'f'});
  const pane = page.element('otw-row').innerHTML;
  assert.match(pane, /<h2 id="otw-rh">Fix requested · Title curl<\/h2><p>the hands are reversed<\/p>/);
  assert.match(pane, /Nobody has started on this fix yet\./);
  assert.match(pane, /Open the video[^]*class="mi red" data-rdel/);
  assert.doesNotMatch(pane, /data-move/);
  // Remove, with its Undo
  await tap(page, 'otw-row', '[data-rdel]');
  assert.equal(rowOf(page, 'f'), '');
  assert.match(page.element('queue-toast').innerHTML, /Removed · Undo/);
  await page.fire('queue-undo'); await settle();
  assert.match(rowOf(page, 'f'), /Fix requested · Title curl/, 'Undo puts it back');
  assert.equal(page.clients.at(-1).calls.filter(c => c[0] === 'delete').length, 0);
});

test('R20: a failed fix needs you: in « Needs you », its R3 screen keeps its instruction', async () => {
  const page = await open({tables: tables([fix('f', 'curl', 'the hands are reversed', {status: 'error', reason: 'signin_required', note: 'Redo: the hands are reversed\nLogin wall'})])});
  assert.equal(bandText(page), '1 fix·1 needs you');
  await page.fire('otw-band');
  assert.equal(sectionOf(page, 'f'), 'Needs you');
  assert.doesNotMatch(page.element('queue').innerHTML, /Fixes requested/);
  await tap(page, 'queue', '[data-row]', {row: 'f'});
  const pane = page.element('otw-row').innerHTML;
  assert.match(pane, /Sign in to Instagram again<\/h2>[^]*<p class="fx-fix"><b>Fix requested · Title curl<\/b><span>the hands are reversed<\/span><\/p>[^]*data-fixdone[^]*data-rdel/);
});

// ---------- the band ----------

test('R20: the band never counts a fix as a video on the way', async () => {
  const both = await open({tables: tables([req('v', 'queued'), fix('f', 'curl', 'one'), fix('g', 'curl', 'two')])});
  assert.equal(bandText(both), '1 on the way·2 fixes');
  const one = await open({tables: tables([fix('f', 'curl', 'one')])});
  assert.equal(bandText(one), '1 fix requested');
  assert.equal(one.element('otw-band').hidden, false, 'a fix alone still shows the band');
  // « needs you » is never cut: with a video and a failure, the fixes are heard (aria-label) and listed, not shown
  const all = await open({tables: tables([req('v', 'queued'), req('e', 'error', {note: 'Video unavailable'}), fix('f', 'curl', 'one'), fix('g', 'curl', 'two')])});
  assert.equal(bandText(all), '2 on the way·1 needs you');
  const vids = await open({tables: tables([req('v', 'queued'), req('w', 'processing')])});
  assert.equal(bandText(vids), '2 on the way', 'without a fix, R1 as it was');
});

// ---------- no ghost card ----------

test('R20: a notebook page shows no ghost card for a fix; the sheet\'s card says « Fix requested »; the home card does not count it', async () => {
  const page = await open({tables: tables([fix('f', 'curl', 'the hands are reversed'), req('v', 'queued', {theme: 'strength'})], [sheet('curl'), sheet('row')]), hash: '#strength'});
  const ghosts = page.element('otw-ghosts').innerHTML;
  assert.match(ghosts, /<\/svg>1 on the way<\/p>/); // P9 Q: the micro-legend
  assert.match(ghosts, /data-ghost="v"/);
  assert.doesNotMatch(ghosts, /data-ghost="f"/);
  const groups = page.element('groups').innerHTML, card = slug => (groups.split('<a class="card').find(c => c.includes(`href="#${slug}"`)) || '');
  assert.match(card('curl'), /<span class="fixq">Fix requested<\/span>/);
  assert.doesNotMatch(card('row'), /Fix requested/);
  const alone = await open({tables: tables([fix('f', 'curl', 'x')], [sheet('curl')]), hash: '#strength'});
  assert.equal(alone.element('otw-ghosts').hidden, true, 'no ghost section for a fix alone');
  const home = await open({tables: tables([fix('f', 'curl', 'x')], [sheet('curl')])});
  assert.doesNotMatch(home.element('portal').innerHTML, /on the way/, 'the notebook card counts no fix');
});

test('R20 (Codex pass 1): a card of the home page\'s New says « Fix requested » once the list is read, and stops when the fix is removed', async () => {
  const page = await open({tables: tables([fix('f', 'curl', 'x')], [sheet('curl', {added_at: now()})])});
  const card = () => (page.element('new-cards').innerHTML.split('<a class="card').find(c => c.includes('href="#curl"')) || '');
  assert.match(card(), /<span class="fixq">Fix requested<\/span>/);
  await page.fire('otw-band');
  await tap(page, 'queue', '[data-row]', {row: 'f'});
  await tap(page, 'otw-row', '[data-rdel]');
  assert.match(card(), /href="#curl"/);
  assert.doesNotMatch(card(), /Fix requested/, 'removed: the card no longer says it');
});

// ---------- one reel, whatever its suffixes ----------

const BASE = 'https://www.instagram.com/reel/EXAMPLE0001/';
const SAME = {
  igsh: 'https://www.instagram.com/reel/EXAMPLE0001/?igsh=MWx0eW9xZ3Bh',
  dlrf: 'https://www.instagram.com/reel/EXAMPLE0001/?dlrf=1&utm_source=ig_web_copy_link',
  reels: 'https://www.instagram.com/reels/EXAMPLE0001/',
  www: 'https://instagram.com/reel/EXAMPLE0001/',
  slash: 'https://www.instagram.com/reel/EXAMPLE0001',
  http: 'http://www.instagram.com/reel/EXAMPLE0001/#comments'
};
const YT = 'https://www.youtube.com/watch?v=PREVIEW0103';
const SAME_YT = {youtube: 'https://youtu.be/PREVIEW0103?si=AbCdEf', shorts: 'https://www.youtube.com/shorts/PREVIEW0103?feature=share', mobile: 'https://m.youtube.com/watch?v=PREVIEW0103&pp=ygU&t=42'};

test('R20 linkKey: every variant of one reel is one key', () => {
  for (const [k, v] of Object.entries(SAME)) assert.equal(RS.linkKey(v), RS.linkKey(BASE), k);
  assert.equal(RS.linkKey(BASE), 'instagram.com/reel/EXAMPLE0001');
  for (const [k, v] of Object.entries(SAME_YT)) assert.equal(RS.linkKey(v), RS.linkKey(YT), k);
  assert.equal(RS.linkKey(YT), 'youtube.com/watch?v=PREVIEW0103');
  assert.equal(RS.linkKey('https://www.tiktok.com/@coach/video/7312?is_from_webapp=1&sender_device=pc'), RS.linkKey('https://tiktok.com/@coach/video/7312/'));
  assert.equal(RS.linkKey('https://www.facebook.com/watch/?v=123&mibextid=abc&fbclid=x'), RS.linkKey('https://m.facebook.com/watch?v=123'));
  assert.equal(RS.linkKey('not a link'), '');
  assert.equal(RS.linkKey('mailto:a@example.test'), '');
});

test('R20 linkKey: different videos stay different', () => {
  const keys = ['https://www.instagram.com/reel/EXAMPLE0001/', 'https://www.instagram.com/reel/EXAMPLE0002/', 'https://www.instagram.com/p/EXAMPLE0001/',
    'https://www.youtube.com/watch?v=PREVIEW0103', 'https://www.youtube.com/watch?v=PREVIEW0104', 'https://youtu.be/PREVIEW0104x',
    'https://www.tiktok.com/@coach/video/7312', 'https://www.tiktok.com/@coach/video/7313', 'https://vm.tiktok.com/ZMabc/',
    'https://www.facebook.com/watch/?v=123', 'https://www.facebook.com/watch/?v=124', 'https://www.facebook.com/story.php?story_fbid=9&id=1',
    // Codex pass 1: a path that does not name the video keeps the query that does
    'https://www.tiktok.com/foryou?item_id=7312000000000000001', 'https://www.tiktok.com/foryou?item_id=7312000000000000002&is_from_webapp=1'].map(RS.linkKey);
  assert.equal(new Set(keys).size, keys.length, keys.join('\n'));
});

test('R20 cleanLink: the tracking parameters go, the host, the path and v= stay', () => {
  assert.equal(RS.cleanLink(SAME.igsh), 'https://www.instagram.com/reel/EXAMPLE0001/');
  assert.equal(RS.cleanLink(SAME.dlrf), 'https://www.instagram.com/reel/EXAMPLE0001/');
  assert.equal(RS.cleanLink(SAME.reels + '?igsh=x'), 'https://www.instagram.com/reels/EXAMPLE0001/', 'the path as written');
  assert.equal(RS.cleanLink(SAME_YT.youtube), 'https://youtu.be/PREVIEW0103', 'the host as written');
  assert.equal(RS.cleanLink(SAME_YT.mobile), 'https://m.youtube.com/watch?v=PREVIEW0103&t=42', 'v= and the start time stay');
  assert.equal(RS.cleanLink('https://www.facebook.com/watch/?v=123&mibextid=abc'), 'https://www.facebook.com/watch/?v=123');
  assert.equal(RS.cleanLink(BASE), BASE, 'a clean address is unchanged');
});

test('R20 Add: each variant of a video on the way, or of a sheet, is refused; the address written is cleaned', async () => {
  const page = await open({tables: tables([req('q', 'queued', {url: YT})])});
  await page.fire('add-video-fab');
  const tryUrl = async v => { page.element('f-url').value = v; await page.fire('sheet-new', 'submit'); await settle(); return page.element('f-err').hidden ? '' : page.element('f-err').textContent; };
  for (const [k, v] of Object.entries(SAME)) assert.equal(await tryUrl(v), 'You already have this video: “Title curl”.', k);
  for (const [k, v] of Object.entries(SAME_YT)) assert.equal(await tryUrl(v), 'This video is already in your list. Find it under On the way.', k);
  assert.equal(page.clients.at(-1).calls.filter(c => c[0] === 'insert').length, 0);
  // another reel goes through, written without its tracking parameters
  assert.equal(await tryUrl('https://www.instagram.com/reel/EXAMPLE0002/?igsh=MWx0&utm_source=ig_web_copy_link'), '');
  const ins = page.clients.at(-1).calls.filter(c => c[0] === 'insert');
  assert.equal(ins.length, 1);
  assert.equal(ins[0][2].url, 'https://www.instagram.com/reel/EXAMPLE0002/');
});

test('R20 Add (Codex pass 2): a video only a session holds is refused by the session\'s title', async () => {
  const page = await open({tables: tables([], [sheet('curl')], [session])});
  await page.fire('add-video-fab');
  page.element('f-url').value = 'https://tiktok.com/@coach/video/7312/?is_from_webapp=1'; await page.fire('sheet-new', 'submit'); await settle();
  assert.equal(page.element('f-err').textContent, 'You already have this video: “Morning routine”.');
  assert.equal(page.clients.at(-1).calls.filter(c => c[0] === 'insert').length, 0);
});

test('R20 versions: sessions.js has a new ?v= in index.html and the worker\'s shell; the cache VERSION moved', () => {
  const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8'), sw = fs.readFileSync(path.join(__dirname, '../app/sw.js'), 'utf8');
  const v = Number(/sessions\.js\?v=(\d+)/.exec(html)[1]);
  assert.ok(v >= 18);
  assert.match(sw, new RegExp(`'\\./sessions\\.js\\?v=${v}'`));
  assert.ok(Number(sw.match(/const VERSION = 'rb-shell-(\d+)'/)[1]) >= 73);
});
