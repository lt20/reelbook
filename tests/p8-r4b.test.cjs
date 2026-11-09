// P8 R4b: tokens, sheet, session and notebook (track A): the sunlight tokens (item 16), --accent only on what can be
// touched (item 11), no grey under 15 px, one filled action per screen (item 10: Start + the outlined Log), the
// notebook colour that follows the user (item 17: band and « ‹ MMA »), no eyebrow on a notebook page (item 13).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, ownUrl, ownKey} = require('./harness.cjs');

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const tables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: ['Arms'], builtin: true, position: 0, color: 2}],
  sheets: [{slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Hammer curl', summary: '', html: '', source: {}}],
  sessions: [{slug: 'arms', theme: 'strength', title: 'Arms day', format: '', why: '', key_points: [], source: {}, origin: 'user', thumbnail: '', items: [{slug: 'curl', dose: '3 × 10'}]}],
  notes: [], requests: [], practice_log: []
});
const open = async (hash = '') => { const page = await app({...signedIn, tables: tables(), dom: true, hash}); await settle(); return page; };
const css = html.slice(0, html.indexOf('</style>'));
const rule = sel => { const i = css.indexOf('\n' + sel + '{'); assert.ok(i >= 0, sel); return css.slice(i + 1, css.indexOf('}', i) + 1); };
// The nav bar's classes and style, recorded (the harness's elements have no classList of their own).
const watchBar = page => {
  const bar = page.element('nav-bar'), cls = new Set(), attrs = {};
  bar.classList = {toggle(c, on) { if (on) cls.add(c); else cls.delete(c); }, contains: c => cls.has(c)};
  bar.setAttribute = (k, v) => { attrs[k] = v; };
  return {cls, attrs};
};

test('R4b tokens: separators #a8a296, dark paper #262a31 and line #5a5f68, control outlines line-strong', () => {
  assert.match(rule(':root'), /--line:#a8a296;/);
  assert.equal((css.match(/--paper:#262a31;/g) || []).length, 2, 'dark paper, system and forced');
  assert.equal((css.match(/--line:#5a5f68;/g) || []).length, 2, 'dark line, system and forced');
  assert.match(rule('.btn.ghost'), /border:1\.5px solid var\(--line-strong\)/);
  for (const sel of ['.facets button', '.group-chips a', '.pl-x', '.notes .nretry']) assert.match(rule(sel), /border:1\.5px solid var\(--line-strong\)/, sel);
  assert.doesNotMatch(rule('.q'), /dashed/, 'no dashed line in the queue rows');
});

test('R4b: no grey text under 15 px (muted only at --fs-meta or larger)', () => {
  const small = css.split('\n').filter(l => /color:var\(--muted\)/.test(l) && /var\(--fs-(xs|sm)\)|[^0-9.](1[0-4]|[0-9])px[ ;}]/.test(l.replace(/(margin|padding|gap|border|top|left|right|bottom|width|height|radius|offset|inset)[^;]*/g, '')));
  assert.deepEqual(small, []);
});

test('R4b: --accent only on what can be touched — dose, step and key-point numbers in ink', () => {
  for (const sel of ['.dose b', 'ol.keys li::before', '.step .k', '.card>.k', '.pl-keys li::before', '.pl-restk', '.pl-dose.pl-rest', '.picklist .o', '.edit .row .k']) {
    assert.doesNotMatch(rule(sel), /var\(--accent\)/, sel);
    assert.match(rule(sel), /var\(--ink\)/, sel);
  }
});

test('R4b sheet: one row, Start filled then the outlined Log (no « Done today »)', async () => {
  const page = await open('#curl');
  const view = page.element('view').innerHTML;
  assert.match(view, /<div class="acts2"><p class="pl-start"><button type="button" class="btn" id="play-start">Start<\/button><\/p><div class="practice" id="practice"><p class="actions"><button type="button" class="btn ghost" id="practice-done"[^>]*>Log<\/button>/);
  assert.doesNotMatch(view, /Done today/);
  assert.match(rule('.acts2>.pl-start'), /flex:2 1 0/);
  assert.match(rule('.acts2 .practice>.actions'), /flex:1 1 0/);
  assert.match(rule('.acts2 .pl-start .btn'), /min-height:56px/);
});

test('R4b session: Start filled, full width, Log under it (P8 R18: Share next to Log)', async () => {
  const page = await open('#session/arms');
  const view = page.element('view').innerHTML;
  assert.match(view, /<div class="acts2 stack duo"><p class="pl-start"><button[^>]*id="play-start">Start<\/button><\/p><div class="practice" id="practice">[\s\S]*?id="practice-done"[^>]*>Log</);
  assert.match(rule('.acts2.stack>.pl-start'), /flex-basis:100%/);
});

test('R4b: the notebook colour follows the user — band under the bar and « ‹ Strength » in its colour on sheet and session', async () => {
  const page = await open();
  const bar = watchBar(page);
  page.go('#curl'); await settle();
  assert.equal(page.element('nav-back').textContent, '‹ Strength');
  assert.ok(bar.cls.has('tint') && bar.cls.has('upc'), 'sheet: band and coloured back');
  assert.match(bar.attrs.style, /^--t:var\(--p(\d)\);--up:var\(--p\1\)$/);
  page.go('#session/arms'); await settle();
  assert.ok(bar.cls.has('tint') && bar.cls.has('upc'), 'session: band and coloured back');
  page.go('#strength'); await settle();
  assert.ok(!bar.cls.has('tint') && !bar.cls.has('upc'), 'a notebook page: its cover carries the colour; back goes home');
  assert.match(rule('#nav-bar.tint'), /box-shadow:0 6px 0 var\(--t\)/);
  assert.match(rule('#nav-bar.upc #nav-back'), /color:color-mix\(in srgb,var\(--up\) 70%,var\(--ink\)\)/);
});

test('R4b player: a 6 px band in the notebook colour; during the rest Skip is a ghost (Next stays filled)', async () => {
  const page = await open('#session/arms');
  await page.fire('play-start'); await settle();
  assert.match(page.element('player').innerHTML, /^<div class="pl tint" style="--t:var\(--p\d\)">/);
  assert.match(rule('.player .pl.tint'), /border-top:6px solid var\(--t\)/);
  assert.match(html, /<button type="button" class="btn ghost" id="play-rest-skip"[^>]*>Skip<\/button>[\s\S]*<button type="button" class="btn" id="play-rest-next">Next<\/button>/);
});

test('R4b notebook page: no eyebrow « Find it fast, when you need it »; the band is on the cover', async () => {
  assert.doesNotMatch(html, /Find it fast|id="h-eyebrow"/);
  assert.match(css, /\n#home\.nb #brand-wordmark\{[^}]*box-shadow:inset 0 6px 0 var\(--t,var\(--accent\)\)/);
  const page = await open('#strength');
  assert.equal(page.element('home').hidden, false);
  assert.equal(page.element('h-title').textContent, 'Strength');
});
