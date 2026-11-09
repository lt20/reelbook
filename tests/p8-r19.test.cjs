// P8 R19: the story card becomes a « proud » image, offered when the person has just done something: « Share my
// progress » (outlined) on Session done and on New move, nowhere else (not in the Share sheet, which sends a session to
// a training partner since P8 R18). app/card.js draws it (1080 × 1920, the notebook's flat colour, no photo):
// « Legs — done ✓ / 3rd session this week / 11 sessions in November · 4 weeks in a row » for a session, « New move:
// Jab-cross / 5 of 9 / learned in Fight techniques » for a move, in the content's language; only the numbers of at
// least 2 (RBCard.MIN). The tap copies https://lt20.github.io/reelbook/?r=story and says « Link copied: add
// Instagram's Link sticker to your story », then shares the image (navigator.share with the file), else downloads it.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SH = require('../app/sheet.js');
const C = require('../app/card.js');
const {parse} = require('./mini-dom.cjs');
const {app, html, ownUrl, ownKey} = require('./harness.cjs');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sw = read('app/sw.js');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const plain = v => JSON.parse(JSON.stringify(v));
const nb = s => s.replace(/ /g, ' ');
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'u1@example.test'}}};
const REF = 'https://lt20.github.io/reelbook/?r=story';
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = iso(new Date());
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

// ---------- the numbers and the lines (app/card.js, pure) ----------
// A measure close to the two families: Barlow Condensed ~0.42 em a character, Source Sans 3 ~0.5 em.
const measure = (f, s) => { const px = Number(f.match(/(\d+)px/)[1]); return s.length * px * (f.includes('Barlow') ? 0.42 : 0.5); };
const texts = L => L.ops.filter(o => o.t === 'text');
const said = L => texts(L).map(o => nb(o.text));
const inside = L => texts(L).every(o => o.x >= 96 && o.x + measure(o.font, o.text) <= C.W - 96 + 0.5 && o.y <= C.H - 96 + 0.5);
const noOverlap = L => { const t = texts(L).filter(o => o.role !== 'brand').sort((a, b) => a.y - b.y); return t.every((o, i) => !i || o.y - t[i - 1].y >= o.size * 0.9); };
const rep = (over = {}) => ({kind: 'repetition', title: 'Neck routine', lang: 'en', colour: 3, stats: {week: 3, month: 11, monthIndex: 10, weeks: 4}, ...over});
const move = (over = {}) => ({kind: 'technique', title: 'Jab-cross', lang: 'en', colour: 2, notebook: 'Fight techniques', learned: 5, total: 9, ...over});

test('R19 the numbers: rank in the ISO week, sessions of the calendar month, ISO weeks in a row; later days out', () => {
  // Thursday 12 Nov 2026; this session is one of today's days
  const days = ['2026-11-09', '2026-11-10', '2026-11-12', '2026-11-02', '2026-11-03', '2026-10-28', '2026-10-19', '2026-10-05', '2026-11-13'];
  assert.deepEqual(C.progress(days, '2026-11-12'), {week: 3, month: 5, monthIndex: 10, weeks: 4}, 'the week of 12 Oct has no session: 4 weeks');
  // a new month on a Tuesday: the week counts Monday 30 Nov, the month only today
  assert.deepEqual(C.progress(['2026-11-30', '2026-12-01'], '2026-12-01'), {week: 2, month: 1, monthIndex: 11, weeks: 1});
  assert.deepEqual(C.progress([], 'nope'), {week: 0, month: 0, monthIndex: -1, weeks: 0});
  assert.deepEqual(C.progress(['bad', null, '2026-11-12'], '2026-11-12'), {week: 1, month: 1, monthIndex: 10, weeks: 1});
});

test('R19 repetition, every number: « done ✓ », the rank big, « 11 sessions in November · 4 weeks in a row »; the address under the wordmark', () => {
  const L = C.layout(rep(), measure);
  assert.equal(L.fit, true); assert.equal(L.w, 1080); assert.equal(L.h, 1920);
  assert.deepEqual(nb(L.lines.head + L.lines.suffix), 'Neck routine — done ✓');
  assert.equal(L.lines.hero, '3rd session this week');
  assert.equal(L.lines.line, '11 sessions in November · 4 weeks in a row');
  const t = said(L);
  assert.ok(t.join(' ').includes('Neck routine — done ✓'), t.join(' | '));
  assert.ok(t.at(-2) === 'reelbook' && t.at(-1) === 'lt20.github.io/reelbook', 'the wordmark, then the address in small');
  const hero = texts(L).filter(o => o.role === 'hero'), head = texts(L).filter(o => o.role === 'head'), line = texts(L).filter(o => o.role === 'line');
  assert.equal(hero.map(o => o.text).join(' '), '3rd session this week');
  assert.ok(hero[0].size > head[0].size && head[0].size > line[0].size && texts(L).find(o => o.role === 'url').size < line[0].size, 'the flattering number is the big line');
  assert.ok(inside(L) && noOverlap(L));
  assert.ok(L.ops.some(o => o.t === 'mark'));
});

test('R19 low numbers disappear: below RBCard.MIN (2) a line is not shown; at the least, the title and « done ✓ »', () => {
  assert.deepEqual({...C.MIN}, {week: 2, month: 2, weeks: 2, learned: 2});
  assert.ok(Object.isFrozen(C.MIN));
  const none = C.layout(rep({stats: {week: 1, month: 1, monthIndex: 10, weeks: 1}}), measure);
  assert.deepEqual([none.lines.hero, none.lines.line], ['', '']);
  assert.equal(said(none).slice(0, -2).join(' '), 'Neck routine — done ✓');
  assert.ok(said(none).slice(0, -2).every(l => l.split(' ').length > 1 || l === 'Neck routine'), 'never one word left with « done ✓ »');
  assert.deepEqual(said(none).slice(-2), ['reelbook', 'lt20.github.io/reelbook']);
  assert.ok(texts(none).every(o => ['head', 'brand', 'url'].includes(o.role)));
  assert.ok(none.fit && inside(none));
  // only the month: no rank, no « 1 week in a row »
  const month = C.lines(rep({stats: {week: 1, month: 5, monthIndex: 10, weeks: 1}}));
  assert.deepEqual([month.hero, month.line], ['', '5 sessions in November']);
  const weeks = C.lines(rep({stats: {week: 2, month: 1, monthIndex: 11, weeks: 3}}));
  assert.deepEqual([weeks.hero, weeks.line], ['2nd session this week', '3 weeks in a row']);
  // no numbers read at all
  assert.equal(said(C.layout(rep({stats: null}), measure)).slice(0, -2).join(' '), 'Neck routine — done ✓');
  // a move: 1 learned is not shown
  const one = C.layout(move({learned: 1}), measure);
  assert.deepEqual(said(one), ['New move:', 'Jab-cross', 'reelbook', 'lt20.github.io/reelbook']);
});

test('R19 technique: « New move: », the title, « 5 of 9 » big, « learned in <notebook> »', () => {
  const L = C.layout(move(), measure);
  assert.equal(L.fit, true);
  assert.deepEqual(said(L), ['New move:', 'Jab-cross', '5 of 9', 'learned in Fight techniques', 'reelbook', 'lt20.github.io/reelbook']);
  const by = r => texts(L).find(o => o.role === r);
  assert.ok(by('hero').size >= by('head').size && by('head').size > by('line').size);
  assert.match(C.label(move()), /^Story card: New move: Jab-cross 5 of 9 learned in Fight techniques\. Text and colour only, no photo\.$/);
});

test('R19 French and English: the card follows the content\'s language', () => {
  const fr = C.layout(rep({title: 'Routine du cou', lang: 'fr'}), measure);
  assert.equal(nb(fr.lines.head + fr.lines.suffix), 'Routine du cou — fait ✓');
  assert.equal(fr.lines.hero, '3ᵉ séance cette semaine');
  assert.equal(fr.lines.line, '11 séances en novembre · 4 semaines d’affilée');
  assert.ok(fr.fit && inside(fr) && noOverlap(fr));
  const mv = C.lines(move({lang: 'fr'}));
  assert.deepEqual([nb(mv.kicker), mv.head, mv.hero, mv.line], ['Nouveau mouvement :', 'Jab-cross', '5 sur 9', 'appris en Fight techniques']);
  // English ordinals
  assert.deepEqual([2, 3, 4, 11, 12, 13, 21, 22].map(n => C.lines(rep({stats: {week: n}})).hero.split(' ')[0]), ['2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  assert.equal(C.lines(rep({stats: {month: 3, monthIndex: 0}})).line, '3 sessions in January');
  assert.equal(C.lines(rep({lang: 'fr', stats: {month: 3, monthIndex: 7}})).line, '3 séances en août');
});

test('R19 no photo: only text, the mark and rules; a 1 000-character title is shortened, « — done ✓ » kept; nothing outside the margins', () => {
  for (const c of [rep(), move(), rep({stats: null}), move({learned: 0})]) {
    const L = C.layout(c, measure);
    assert.ok(L.ops.every(o => ['text', 'mark', 'rule'].includes(o.t)), 'no image operation, ever');
  }
  for (const title of ['W'.repeat(1000), Array.from({length: 200}, () => 'Wwww').join(' ')]) {
    const L = C.layout(rep({title}), measure);
    assert.equal(L.fit, true);
    const head = texts(L).filter(o => o.role === 'head');
    assert.ok(head.length <= 4, `${head.length} title lines`);
    assert.match(nb(head.map(o => o.text).join(' ')), /… — done ✓$/);
    assert.equal(nb(head.at(-1).text), '— done ✓', 'the suffix on a line of its own');
    assert.ok(inside(L) && noOverlap(L));
  }
  // Codex #127: a title that holds whole at a smaller size is never shortened at a larger one
  const whole = Array.from({length: 40}, (_, n) => C.layout(rep({stats: null, title: Array.from({length: n + 1}, () => 'Wwww').join(' ')}), measure)).find(L => L.tier > 0);
  assert.ok(whole && whole.fit, 'a title that needs a smaller size');
  assert.ok(texts(whole).filter(o => o.role === 'head').every(o => !o.text.includes('…')), 'kept whole');
  const long = C.layout(move({title: 'Single-leg takedown from the clinch with a switch', notebook: 'Brazilian jiu-jitsu and wrestling for beginners'}), measure);
  assert.ok(long.fit && inside(long) && noOverlap(long));
  assert.deepEqual(C.wrap(measure, '400 40px "Source Sans 3"', 'a b c', 1000), ['a b c']);
});

test('R19 colour: the notebook colour flat, the ink that reads on it (4.5:1 at least), the app\'s light palette', () => {
  for (let i = 0; i < 8; i++) {
    const {bg, ink} = C.colours(i);
    assert.equal(bg, C.PALETTE[i]);
    assert.ok(C.contrast(bg, ink) >= 4.5, `${bg} on ${ink}: ${C.contrast(bg, ink).toFixed(2)}`);
  }
  assert.equal(C.colours('#000000').ink, '#ffffff');
  assert.equal(C.colours(undefined).bg, C.PALETTE[3]);
  const p = html.match(/--p0:(#\w+); --p1:(#\w+); --p2:(#\w+); --p3:(#\w+); --p4:(#\w+); --p5:(#\w+); --p6:(#\w+); --p7:(#\w+);/).slice(1);
  assert.deepEqual(C.PALETTE, p);
});

test('R19 drawing waits for the fonts (document.fonts.load); a layout that cannot fit is never exported', async () => {
  const calls = [];
  const fonts = {load: f => { calls.push(['load', f]); return new Promise(ok => setTimeout(ok, 5)); }};
  const ctx = {set font(f) { this._f = f; }, get font() { return this._f; }, measureText(s) { calls.push(['measure']); return {width: measure(this._f, s)}; },
    fillRect() {}, fillText(s) { calls.push(['text', s]); }, save() {}, restore() {}, translate() {}, scale() {}, fill() {}, drawImage() { calls.push(['image']); }};
  const canvas = {getContext: () => ctx, toBlob: cb => cb({type: 'image/png'})};
  const out = await C.render(rep(), {fonts, createElement: () => canvas});
  const loads = calls.filter(c => c[0] === 'load').map(c => c[1]);
  assert.ok(loads.some(f => f.includes('Barlow Condensed')) && loads.some(f => f.includes('Source Sans 3')));
  const firstOther = calls.findIndex(c => c[0] !== 'load');
  assert.ok(calls.slice(firstOther).every(c => c[0] !== 'load'), 'every load asked before the canvas');
  assert.equal(out.blob.type, 'image/png');
  assert.ok(calls.some(c => c[0] === 'text' && c[1] === 'lt20.github.io/reelbook'));
  assert.ok(!calls.some(c => c[0] === 'image'), 'never an image drawn on the card');
  assert.equal(await C.fontsReady({}), false);
  const wide = (f, s) => s.length * 2000;
  assert.equal(C.layout(rep(), wide).fit, false);
  const wctx = {...ctx, measureText(s) { return {width: wide(this._f, s)}; }};
  let exported = false;
  await assert.rejects(C.render(rep(), {createElement: () => ({getContext: () => wctx, toBlob(cb) { exported = true; cb(new Blob(['png'])); }})}), /does not fit/);
  assert.equal(exported, false);
});

// ---------- Session done ----------
const tables = ({practice_log = [], session = {}} = {}) => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: ['a', 'b'].map((slug, i) => ({slug, kind: 'sheet', theme: 'strength', title: 'Exercise ' + (i + 1), html: '<a href="#">Home</a>',
    thumbnail: 'thumb.jpg', source: {author: 'coach.a', url: 'https://www.instagram.com/reel/' + slug + '/'}})),
  sessions: [{slug: 'legs', theme: 'strength', title: 'Legs', format: '', items: [{slug: 'a', dose: '3 × 10'}, {slug: 'b', dose: '40 s'}], ...session}],
  notes: [{slug: 'session/legs', body: 'SECRET NOTE'}], requests: [], practice_log
});
const end = page => page.element('view').innerHTML;
const fire = async (page, id, type) => { await page.fire(id, type); await settle(); };
// card.js in the harness: the real numbers and label, a small png for the drawing; records the cards asked for
const fakeCard = (log, fail = false) => ({progress: C.progress, label: C.label, MIN: C.MIN,
  render: async card => { log.push(plain(card)); if (fail) throw new Error('no canvas'); return {canvas: {tagName: 'CANVAS'}, blob: new Blob(['png'], {type: 'image/png'})}; }});
class Anchor {} Anchor.prototype.download = ''; // a browser whose links can download
const open = async ({nav = {}, log = [], fail = false, save = true, practice_log = [], session = {}, docEl = null, hash = '#session/legs/play', hold} = {}) => {
  const page = await app({...signedIn, tables: tables({practice_log, session}), hash, dom: true, nav, timerCap: 1000, ...(docEl ? {docEl} : {}), ...(hold ? {hold} : {}),
    win: {RBCard: fakeCard(log, fail)}, globals: {File, Blob, ...(save ? {HTMLAnchorElement: Anchor} : {})}});
  await settle();
  return page;
};
const finish = async page => { await fire(page, 'play-done-set'); await fire(page, 'play-done-set'); await fire(page, 'play-done-set'); await fire(page, 'play-finish'); };
const clip = (copied, ok = true) => ({writeText: async t => { if (!ok) throw new Error('denied'); copied.push(t); }});
// the account's sessions: two today already, one each of the three weeks before (and a sheet's row, not a session)
const HISTORY = [{id: 'h1', slug: 'session/legs', done_on: TODAY}, {id: 'h2', slug: 'session/core', done_on: TODAY},
  {id: 'h3', slug: 'session/legs', done_on: daysAgo(7)}, {id: 'h4', slug: 'session/legs', done_on: daysAgo(14)}, {id: 'h5', slug: 'session/legs', done_on: daysAgo(21)},
  {id: 'h6', slug: 'a', done_on: TODAY}];

test('R19 Session done: « Share my progress » outlined between Share (filled) and Done; the card drawn from practice_log, this session once', async () => {
  const log = [];
  const page = await open({log, practice_log: HISTORY});
  await finish(page);
  const h = end(page);
  assert.match(h, /<p class="actions end-acts"><button type="button" class="btn" id="end-share-s">Share<\/button><button type="button" class="btn ghost" id="proud-go">Share my progress<\/button><span class="end-cl" id="end-cl"><button type="button" class="btn ghost" id="end-close">Done<\/button>/);
  assert.equal((h.match(/class="btn"(?! ghost)/g) || []).length, 1, 'one filled action (Share)');
  assert.match(h, /<p class="proud-said" id="proud-said" role="status" aria-live="polite" hidden><\/p>/);
  assert.doesNotMatch(h, /end-story|end-card|Your story card|Share your session/, 'no preview any more');
  assert.equal(log.length, 1, 'drawn before the tap, once');
  const c = log[0];
  assert.deepEqual([c.kind, c.title, c.lang, c.today], ['repetition', 'Legs', 'en', TODAY]);
  assert.equal(c.stats.week, 3, 'two sessions today already, then this one');
  assert.equal(c.stats.weeks, 4);
  assert.deepEqual(c.stats, C.progress([TODAY, TODAY, daysAgo(7), daysAgo(14), daysAgo(21), TODAY], TODAY));
  assert.equal(C.lines(c).hero, '3rd session this week');
  assert.match(C.lines(c).line, /4 weeks in a row$/);
  assert.doesNotMatch(JSON.stringify(c), /SECRET|instagram\.com|thumb|jpg|coach/i, 'no note, no link, no photo, no video credit');
  // the read is the account's session rows of the last 53 weeks
  const q = page.clients.at(-1).selects.filter(s => s[0] === 'practice_log' && s[1] === 'id,slug,done_on');
  assert.equal(q.length, 1);
  // « Share » still sends the session to a training partner
  await fire(page, 'end-share-s');
  assert.equal(page.element('share-dlg').open, true);
  assert.match(page.element('share-dlg').innerHTML, /Send “Legs” to a training partner/);
});

test('R19 Finish with nothing checked (Codex #127 pass 2): no « Share my progress », no card counting a session that did not happen; « Log it » brings both', async () => {
  const log = [];
  const page = await open({log, practice_log: HISTORY});
  await fire(page, 'play-finish');
  const h = end(page);
  assert.match(h, /Session done/);
  assert.match(h, /<button type="button" class="btn ghost" id="proud-go" hidden>Share my progress<\/button>/, 'not offered');
  assert.equal(page.element('proud-go').hidden, true);
  assert.equal(log.length, 0, 'no card drawn: no « 3rd session this week » without a session');
  // « Log it » logs the session row: now a session happened, the button shows and the card counts it once
  await fire(page, 'end-log');
  assert.match(end(page), /Logged/);
  assert.equal(page.element('proud-go').hidden, false);
  assert.equal(log.length, 1);
  assert.equal(log[0].stats.week, 3, 'two sessions today already, then this one');
  // Undo: hidden again
  await fire(page, 'end-undo');
  assert.equal(page.element('proud-go').hidden, true);
});

test('R19 Codex #127 pass 3: a share on its way when « Log it » is undone (nothing checked) shares, downloads and draws nothing', async () => {
  let release;
  const gate = new Promise(ok => { release = ok; });
  const log = [], shared = [];
  const nav = {canShare: d => !!(d && d.files), share: async d => { shared.push(d); }};
  const page = await open({log, nav, practice_log: HISTORY, hold: (t, ops) => t === 'practice_log' && ops.some(o => o[0] === 'like') ? gate : null});
  await fire(page, 'play-finish');
  await fire(page, 'end-log');
  assert.equal(page.element('proud-go').hidden, false);
  const going = page.element('proud-go').listeners.click({}); await settle();
  await fire(page, 'end-undo');
  assert.equal(page.element('proud-go').hidden, true);
  release(); await going; await settle();
  assert.equal(shared.length, 0, 'not shared');
  assert.equal(log.length, 0, 'not drawn');
  assert.match(end(page), /Not logged/);
});

test('R19 Session done, first session ever: the low numbers are out, the card says « Legs — done ✓ »', async () => {
  const log = [];
  const page = await open({log});
  await finish(page);
  assert.deepEqual(log[0].stats, {week: 1, month: 1, monthIndex: new Date().getMonth(), weeks: 1});
  const L = C.lines(log[0]);
  assert.deepEqual([nb(L.head + L.suffix), L.hero, L.line], ['Legs — done ✓', '', '']);
});

test('R19 a French session gives a French card; the message stays in the app\'s language', async () => {
  const log = [], copied = [];
  const page = await open({log, practice_log: HISTORY, nav: {clipboard: clip(copied)},
    session: {title: 'Routine du cou', why: 'Pour le cou et les épaules, avec douceur dans la journée'}});
  await finish(page);
  assert.equal(log[0].lang, 'fr');
  assert.equal(C.lines(log[0]).hero, '3ᵉ séance cette semaine');
  await fire(page, 'proud-go');
  assert.equal(page.element('proud-said').textContent, 'Link copied: add Instagram\'s Link sticker to your story');
  // the app's screens are English (<html lang="en">); a page in French (<html lang="fr">) would say it in French
  const docEl = {lang: 'en'};
  const fr = await open({nav: {clipboard: clip([])}, docEl});
  await finish(fr);
  assert.equal(docEl.lang, 'en');
  docEl.lang = 'fr';
  await fire(fr, 'proud-go');
  assert.equal(fr.element('proud-said').textContent, 'Lien copié : ajoute l’autocollant Lien dans ta story');
});

test('R19 the tap: the link copied (?r=story) and said, then the image to the phone\'s share menu; closed: nothing else', async () => {
  const copied = [], shared = [];
  const nav = {clipboard: clip(copied), canShare: d => !!(d && d.files && d.files.length), share: async d => { shared.push(d); }};
  const page = await open({nav, practice_log: HISTORY});
  await finish(page);
  await fire(page, 'proud-go');
  assert.deepEqual(copied, [REF]);
  assert.equal(page.element('proud-said').hidden, false);
  assert.equal(page.element('proud-said').textContent, 'Link copied: add Instagram\'s Link sticker to your story');
  assert.equal(shared.length, 1);
  const f = shared[0].files[0];
  assert.deepEqual([shared[0].files.length, f.name, f.type, shared[0].title], [1, 'reelbook-legs.png', 'image/png', 'Legs']);
  assert.ok(!shared[0].text && !shared[0].url, 'the image only');
  assert.notEqual(page.element('share-dlg').open, true, 'not the partner sheet');
  assert.notEqual(page.element('story-dlg').open, true);
  assert.equal(page.clicked.length, 0);
  // closed by the person: nothing else
  nav.share = async () => { const e = new Error('closed'); e.name = 'AbortError'; throw e; };
  await fire(page, 'proud-go');
  assert.equal(page.clicked.length, 0);
  assert.notEqual(page.element('story-dlg').open, true);
  // the clipboard refused: the link is said, to copy by hand
  const other = await open({nav: {clipboard: clip([], false)}});
  await finish(other);
  await fire(other, 'proud-go');
  assert.equal(other.element('proud-said').textContent, `Add Instagram's Link sticker to your story: ${REF}`);
});

test('R19 no file share: the image is downloaded (an object URL); a browser whose links cannot download shows it full screen', async () => {
  const copied = [];
  const page = await open({nav: {clipboard: clip(copied), share: async () => { throw new Error('text only'); }}});
  await finish(page);
  await fire(page, 'proud-go');
  assert.deepEqual(copied, [REF]);
  assert.equal(page.clicked.length, 1);
  assert.match(page.clicked[0].href, /^blob:/);
  assert.deepEqual([page.clicked[0].tagName, page.clicked[0].download], ['A', 'reelbook-legs.png']);
  assert.notEqual(page.element('story-dlg').open, true);
  // refused by the phone (NotAllowedError, the tap too old): downloaded too
  const late = await open({nav: {canShare: () => true, share: async () => { throw new Error('NotAllowedError'); }}});
  await finish(late);
  await fire(late, 'proud-go');
  assert.equal(late.clicked.length, 1);
  const ios = await open({save: false});
  await finish(ios);
  await fire(ios, 'proud-go');
  assert.equal(ios.clicked.length, 0);
  assert.equal(ios.element('story-dlg').open, true);
  const d = ios.element('story-dlg').innerHTML;
  assert.match(d, /<h2 id="story-h">Your progress<\/h2>/);
  assert.match(d, /<img id="story-img" src="blob:[^"]+" alt="Story card: Legs — done ✓\. Text and colour only, no photo\.">/);
  assert.match(d, /Press and hold the image to save it\./);
});

test('R19 the image could not be made: the tap says so (and copies the link); Share still sends the session', async () => {
  const page = await open({fail: true, nav: {clipboard: clip([])}});
  await finish(page);
  await fire(page, 'proud-go');
  assert.equal(page.element('proud-said').textContent, 'The image could not be made. Try again.');
  assert.notEqual(page.element('story-dlg').open, true);
  assert.equal(page.clicked.length, 0);
});

test('R19 Codex #127: a tap before the history is read waits for it — the card has every number, and keeps them', async () => {
  let release;
  const gate = new Promise(ok => { release = ok; });
  const log = [], shared = [];
  const nav = {canShare: d => !!(d && d.files), share: async d => { shared.push(d); }};
  const page = await open({log, nav, practice_log: HISTORY, hold: (t, ops) => t === 'practice_log' && ops.some(o => o[0] === 'like') ? gate : null});
  await finish(page);
  const going = page.element('proud-go').listeners.click({}); await settle();
  assert.equal(log.length, 0, 'not drawn before the history');
  release(); await going; await settle();
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].stats.week, log[0].stats.weeks], [3, 4]);
  assert.equal(shared.length, 1);
  await fire(page, 'proud-go');
  assert.equal(log.length, 1, 'the same card, drawn once');
  assert.equal(shared.length, 2);
});

test('R19 Codex #127: the image fails, then the copy answers — « could not be made » stays said', async () => {
  let answer;
  const nav = {clipboard: {writeText: () => new Promise(ok => { answer = ok; })}};
  const page = await open({fail: true, nav});
  await finish(page);
  await fire(page, 'proud-go');
  assert.equal(page.element('proud-said').textContent, 'The image could not be made. Try again.');
  answer(); await settle();
  assert.equal(page.element('proud-said').textContent, 'The image could not be made. Try again.');
});

test('R19 Codex #116 pass 3: the share menu open, signed out, then the share fails — the old account\'s card is not shown', async () => {
  let fail;
  const nav = {canShare: d => !!(d && d.files), share: () => new Promise((ok, ko) => { fail = () => ko(new Error('NotAllowedError')); })};
  const page = await open({nav});
  await finish(page);
  const going = page.element('proud-go').listeners.click({}); await settle();
  assert.equal(typeof fail, 'function', 'the share menu is open');
  page.clients[0].authListener('SIGNED_OUT', null); await settle();
  fail(); await going; await settle();
  assert.notEqual(page.element('story-dlg').open, true);
  assert.equal(page.clicked.length, 0, 'nothing downloaded after the sign-out');
});

test('R19 only on Session done and New move: not on a sheet\'s Done, not in the Share sheet, not in the app\'s markup elsewhere', async () => {
  const page = await open({hash: '#a/play'});
  await fire(page, 'play-set-1', 'change');
  await fire(page, 'play-finish');
  assert.doesNotMatch(end(page), /proud-go|Share my progress/);
  // the session's Share sheet: sending to a partner only
  const s = await open({hash: '#session/legs'});
  await fire(s, 'ses-share');
  assert.equal(s.element('share-dlg').open, true);
  assert.doesNotMatch(s.element('share-dlg').innerHTML, /proud-go|Share my progress|Story image|share-story/);
  assert.equal((html.match(/proudButton\(!?[\w.()]*\)/g) || []).length, 2, 'Session done and New move');
  assert.doesNotMatch(html, /storyWeek|share-story|storyRow|wireStoryRow|end-story/, 'the R7 preview, weekly fold and Story image row are gone');
});

// ---------- New move ----------
const CFG = (() => { const window = {}; vm.runInNewContext(read('app/config.js'), {window}); return JSON.parse(JSON.stringify(window.REELBOOK)); })();
const theme = (id, title, extra = {}) => ({id, title, description: '', groups: [], builtin: true, position: 0, family: null, ...extra});
const sheet = (slug, th, title, extra = {}) => ({slug, kind: 'sheet', theme: th, group: 'Basics', title, summary: '', html: '<a href="#">Home</a>', thumbnail: 'thumb.jpg', ...extra});
const techTables = (levels, extra = []) => ({user_themes: [theme('kitesurf', 'Kitesurf')],
  sheets: [sheet('k1', 'kitesurf', 'Water start'), sheet('k2', 'kitesurf', 'Jibe'), sheet('k3', 'kitesurf', 'Pop'), ...extra],
  notes: Object.entries(levels).map(([slug, level]) => ({slug, body: '', level})), sessions: [], requests: [], practice_log: []});
const techPage = {win: {RBSheet: SH, __page: () => parse(read('templates/technique.html'))},
  source: s => s.replace('const readPage = async slug => {', 'const readPage = async slug => { if (window.__page) return {html: \'\', page: window.__page(slug)};')};
const learn = async (levels, {nav = {}, log = [], slug = 'k1', extra = []} = {}) => {
  const page = await app({...signedIn, tables: techTables(levels, extra), hash: `#${slug}/practice`, dom: true, library: CFG.library, nav, timerCap: 1000,
    ...techPage, win: {...techPage.win, RBCard: fakeCard(log)}, globals: {File, Blob, HTMLAnchorElement: Anchor}});
  await settle();
  for (let i = 0; i < 3; i++) await fire(page, 'tech-next');
  await fire(page, 'tech-lv-got');
  await fire(page, 'tech-save');
  return page;
};

test('R19 New move: « Share my progress » outlined next to Back (filled); the card « New move: Water start / 2 of 3 / learned in Kitesurf »', async () => {
  const log = [], copied = [], shared = [];
  const nav = {clipboard: clip(copied), canShare: d => !!(d && d.files), share: async d => { shared.push(d); }};
  const page = await learn({k2: 'got'}, {nav, log});
  const h = page.element('player').innerHTML;
  assert.match(h, /<p class="actions end-acts"><button type="button" class="btn" id="tech-back">Back to Kitesurf<\/button><button type="button" class="btn ghost" id="proud-go">Share my progress<\/button><\/p><p class="proud-said" id="proud-said"/);
  assert.equal(log.length, 1, 'drawn before the tap');
  const c = log[0];
  assert.deepEqual([c.kind, c.title, c.notebook, c.learned, c.total, c.lang], ['technique', 'Water start', 'Kitesurf', 2, 3, 'en']);
  assert.doesNotMatch(JSON.stringify(c), /thumb|jpg/i, 'no photo');
  assert.deepEqual(Object.values(C.lines(c)).filter(v => typeof v === 'string' && v), ['New move:', 'Water start', '2 of 3', 'learned in Kitesurf']);
  await fire(page, 'proud-go');
  assert.deepEqual(copied, [REF]);
  assert.equal(page.element('proud-said').textContent, 'Link copied: add Instagram\'s Link sticker to your story');
  assert.deepEqual([shared.length, shared[0].files[0].name, shared[0].title], [1, 'reelbook-k1.png', 'Water start']);
  // the first move of the notebook: « 1 of 3 » is not shown
  const first = [];
  await learn({}, {log: first});
  assert.deepEqual(Object.values(C.lines(first[0])).filter(v => typeof v === 'string' && v), ['New move:', 'Water start']);
});

test('R19 a French sheet gives a French New move card', async () => {
  const log = [];
  await learn({k2: 'got'}, {log, slug: 'k4', extra: [sheet('k4', 'kitesurf', 'Le départ dans l\'eau', {summary: 'Partir avec la planche sur le côté et les pieds dans les straps'})]});
  assert.equal(log[0].lang, 'fr');
  assert.deepEqual([nb(C.lines(log[0]).kicker), C.lines(log[0]).hero], ['Nouveau mouvement :', '2 sur 4']);
});

test('R19 versions: card.js?v=3 asked by the app and precached by the worker; the cache VERSION is rb-shell-72', () => {
  const ver = (s, f) => Number((s.match(new RegExp(f.replace('.', '\\.') + '\\?v=(\\d+)')) || [])[1]);
  assert.equal(ver(html, 'card.js'), 3);
  assert.equal(ver(sw, 'card.js'), 3);
  assert.doesNotMatch(html, /<script src="card\.js/, 'loaded on first use, not with the app');
  assert.equal(sw.match(/const VERSION = '(rb-shell-\d+)'/)[1], 'rb-shell-72');
});
