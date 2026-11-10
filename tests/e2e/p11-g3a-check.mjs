// P11 G3a: what the `vm` tests cannot see of the glossary in a sheet. By hand, not in CI, against a preview with the
// fake backend: tools/preview/build.sh <out>; tools/preview/serve.sh <out> 8841; then
//   node tests/e2e/p11-g3a-check.mjs --base http://127.0.0.1:8841/index.html [--browser chromium]
// WebKit iPhone 14, on the synthetic sheets that have words (backroll, jab-cross, the two shadow-boxing sheets):
// - no two word targets overlap and none is taller than its line, at the normal text size and at 135 % (the pieces
//   of a word that runs over an inline tag are targets too: they touch, they do not overlap);
// - the words move nothing: every heading, paragraph and photo of the sheet sits where it does on a backend without
//   the table (?missing=glossary_words), which shows no underline, no block and no error;
// - a tap opens the definition (at most 70 % of the screen), the page scrolls so that the word's line stays above it
//   and does not scroll back, the word keeps its band 800 ms; ✕, Escape, the veil and the browser's Back close it and
//   leave one history entry less; « See also » replaces the content, focuses the title and offers one level back;
// - a chip of « Words in this sheet » opens the same sheet; the photo opens the viewer; the keyboard opens a word;
// - a word in two pieces (« <b>… sous</b> le vent ») is one tab stop, one name, one band, whichever piece is tapped;
// - a word in a plain paragraph (the « Why ») and one in the loop line are underlined.
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path';
const pw = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const BASE = arg('--base') || 'http://127.0.0.1:8841/index.html', engine = pw[arg('--browser') || 'webkit'];
const SHEETS = ['backroll', 'jab-cross', 'session-shadow-garde', 'session-shadow-esquives'];
const b = await engine.launch(); const fails = [], errs = [];
const ok = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok' : 'FAIL'}  ${m}`); };
const open = async (hash, query = '', opts = {}) => {
  const c = await b.newContext({...pw.devices['iPhone 14'], ...opts}); await c.route(/supabase\.co/, r => r.abort());
  const p = await c.newPage(); p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE + (query ? '?' + query : '') + '#' + hash); await p.waitForSelector('#play-start'); await p.waitForTimeout(700);
  return p;
};
const id = n => `[data-gw$="${String(n).padStart(6, '0')}"]`;

// 1. targets: no overlap, none taller than its line, at 100 % and 135 %
for (const size of ['100%', '135%']) for (const slug of SHEETS) {
  const p = await open(slug); await p.evaluate(s => { document.documentElement.style.fontSize = s; }, size); await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const boxes = [...document.querySelectorAll('.gw')].flatMap(g => [...g.getClientRects()].map(x => ({t: g.textContent, x: x.left, y: x.top, r: x.right, b: x.bottom, lh: parseFloat(getComputedStyle(g.parentElement).lineHeight)})));
    const clash = [], tall = boxes.filter(a => a.b - a.y > a.lh + .01).map(a => `${a.t} ${(a.b - a.y).toFixed(2)} > ${a.lh}`);
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach(c => { if (a.x < c.r - .01 && c.x < a.r - .01 && a.y < c.b - .01 && c.y < a.b - .01) clash.push(a.t + ' / ' + c.t); }));
    return {n: document.querySelectorAll('.gw[role]').length, pieces: document.querySelectorAll('.gw').length, clash, tall};
  });
  ok(r.n >= (slug === 'session-shadow-esquives' ? 0 : 1) && r.pieces >= r.n + (slug === 'backroll' ? 1 : 0) && !r.clash.length && !r.tall.length, `${slug} at ${size}: ${r.n} words in ${r.pieces} pieces, no target overlaps (${r.clash.join(', ') || 'none'}), none taller than its line (${r.tall.join(', ') || 'none'})`);
  await p.context().close();
}

// 2. nothing moves; a backend without the table shows nothing
const spots = p => p.evaluate(() => [...document.querySelectorAll('#view h1, #view h2, #view h3, #view p, #view li, #view img, #view .acts2, #view footer')].filter(e => !e.closest('.gl-end')).map(e => { const r = e.getBoundingClientRect(); return [Math.round((r.top + scrollY) * 10), Math.round(r.height * 10), Math.round(r.left * 10)]; }));
for (const slug of SHEETS) {
  const p = await open(slug), q = await open(slug, 'missing=glossary_words');
  const a = await spots(p), c = await spots(q), end = await p.evaluate(() => { const e = document.querySelector('.gl-end'); return e ? e.getBoundingClientRect().height + parseFloat(getComputedStyle(e).marginTop) : 0; });
  const foot = await p.evaluate(() => { const f = document.querySelector('#view footer'); return f ? Math.round((f.getBoundingClientRect().top + scrollY) * 10) : null; });
  const moved = a.filter((x, i) => !c[i] || x[1] !== c[i][1] || x[2] !== c[i][2] || (x[0] !== c[i][0] && (foot === null || x[0] < foot) )).length;
  const shift = [...new Set(a.map((x, i) => c[i] ? x[0] - c[i][0] : NaN).filter(d => d !== 0))];
  ok(a.length === c.length && !moved && shift.length <= 1 && Math.abs((shift[0] || 0) - Math.round(end * 10)) <= 1, `${slug}: ${a.length} blocks at the same place with and without the words; what follows « Words in this sheet » is ${(shift[0] || 0) / 10}px lower (the block: ${end}px)`);
  const none = await q.evaluate(() => ({gw: document.querySelectorAll('.gw').length, end: !!document.querySelector('.gl-end'), text: document.getElementById('view').textContent.includes('Words in this sheet')}));
  ok(!none.gw && !none.end && !none.text, `${slug} without the table: no underline, no block`);
  await p.context().close(); await q.context().close();
}

// 3. the definition sheet from a word
const p = await open('backroll');
const marks = await p.evaluate(() => [...document.querySelectorAll('.gw[role]')].map(g => (g.getAttribute('aria-label') || g.textContent) + '@' + (g.closest('.lead') ? 'lead' : g.closest('.step') ? 'step' : g.closest('li') ? 'li' : '?')));
ok(JSON.stringify(marks) === JSON.stringify(['carre@lead', 'sous le vent@li', 'Vent de terre@li', 'voile@step', 'Pop@step', 'Remontée au vent@li', 'bords@li', 'bord@li']), `underlined, in display order: ${marks.join(', ')} (« à 11 h » follows « voile »: not underlined; « gilet d'impact »: quote not found; twin-tip, leash: chips)`);
const state = () => p.evaluate(() => { const d = document.getElementById('gl-dlg'), g = document.querySelector('.gw.on'), r = g && g.getBoundingClientRect(); return {open: d.open, top: d.offsetTop, h: d.offsetHeight, ih: innerHeight, low: r ? r.bottom : null, y: scrollY, gl: !!(history.state && history.state.gl), len: history.length, active: document.activeElement && (document.activeElement.id || document.activeElement.className), title: (document.getElementById('gl-h') || {}).textContent, back: (document.querySelector('.gl-back') || {}).textContent || '', on: document.querySelectorAll('.gw.on').length, hash: location.hash}; });
const s0 = await state();
await p.tap('.gw' + id(1)); await p.waitForTimeout(900);
let s = await state();
ok(s.open && s.title === 'carre' && s.active === 'gl-close', `a tap on « carre » opens its definition, focus on ✕ (${s.active})`);
ok(s.h <= Math.ceil(s.ih * .7) && s.top + s.h === s.ih, `the sheet is ${s.h}px of ${s.ih}px (70 % at most), at the bottom`);
ok(s.on === 1 && s.low <= s.top && s.y > s0.y, `the page scrolled (${s0.y} → ${s.y}): the word's line ends at ${Math.round(s.low)}px, above the sheet (${s.top}px), with its band`);
ok(s.gl && s.len === s0.len + 1, 'one history entry for the sheet');
const photo = await p.evaluate(() => { const i = document.querySelector('[data-gl-ph]'); return {w: i.naturalWidth, ratio: i.clientWidth / i.clientHeight, cap: document.querySelector('.gl-cap').textContent}; });
ok(photo.w > 0 && Math.abs(photo.ratio - 16 / 9) < .02 && photo.cap === 'This sheet', `its photo is loaded, 16:9, captioned « ${photo.cap} »`);
await p.tap('[data-gl-ph]'); await p.waitForTimeout(400);
ok(await p.evaluate(() => document.getElementById('ph-dlg').open && document.querySelectorAll('#ph-strip img').length === 1), 'a tap on the photo opens the photo viewer');
await p.tap('#ph-close'); await p.waitForTimeout(300);
ok(await p.evaluate(() => !document.getElementById('ph-dlg').open && document.getElementById('gl-dlg').open), 'closing the viewer leaves the definition open');
const sees = await p.evaluate(() => [...document.querySelectorAll('[data-gl-see]')].map(x => x.textContent));
ok(JSON.stringify(sees) === JSON.stringify(['cranter', 'pop']), `See also: ${sees.join(', ')} (« planche » has no entry: not shown)`);
await p.tap('[data-gl-see]' + id(13).replace('data-gw', 'data-gl-see')); await p.waitForTimeout(400);
s = await state();
ok(s.title === 'cranter' && s.back === '‹ carre' && s.active === 'gl-h' && s.len === s0.len + 1 && s.low <= s.top, `See also → « ${s.title} », back « ${s.back} », focus on the title, no new history entry`);
await p.tap('[data-gl-see]' + id(5).replace('data-gw', 'data-gl-see')); await p.waitForTimeout(400);
s = await state();
const of = await p.evaluate(() => (document.querySelector('.gl-of') || {}).textContent);
ok(s.title === 'bord' && of === 'la direction' && s.back === '‹ cranter', `then « ${s.title} » with its sense « ${of} » under it, back « ${s.back} » (one level)`);
await p.tap('.gl-back'); await p.waitForTimeout(400);
s = await state();
ok(s.title === 'cranter' && !s.back && s.active === 'gl-h', 'back: the previous word, no further way back');
await p.goBack(); await p.waitForTimeout(300);
s = await state();
ok(!s.open && !s.gl && s.hash === '#backroll' && s.on === 1, 'the browser\'s Back closes the sheet and stays on the page; the band is still there');
const yClosed = s.y;
await p.waitForTimeout(900);
s = await state();
ok(s.on === 0 && s.y === yClosed && s.y > s0.y, `800 ms later the band is gone; the page did not scroll back (${s.y})`);
for (const [how, act] of [['✕', () => p.tap('#gl-close')], ['Escape', () => p.keyboard.press('Escape')], ['the veil', () => p.touchscreen.tap(195, 40)]]) {
  const n = (await state()).len;
  await p.tap('.gw' + id(2)); await p.waitForTimeout(700);
  const o = await state(); await act(); await p.waitForTimeout(500);
  s = await state();
  ok(o.open && o.title === 'pop' && !s.open && !s.gl && s.hash === '#backroll', `${how} closes the sheet and takes its history entry back`);
  await p.waitForTimeout(900);
}
await p.focus('.gw' + id(7)); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
s = await state();
const note = await p.evaluate(() => (document.querySelector('#gl-dlg .note') || {}).textContent || '');
ok(s.open && s.title === 'vent de terre' && note.startsWith('Not sure'), `Enter on a focused word opens it: « ${s.title} », ${note.slice(0, 30)}…`);
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
ok((await p.evaluate(() => document.activeElement && document.activeElement.textContent)) === 'Vent de terre', 'closed, the focus is back on the word');

// 3b. a word that runs over an inline tag: « Au moins <b>50 m libres sous</b> le vent. »
const split = await p.evaluate(() => {
  const ps = [...document.querySelectorAll('.gw[data-gw$="000003"]')], r = ps.map(x => x.getBoundingClientRect());
  return {text: ps.map(x => x.textContent), cls: ps.map(x => x.className), parents: ps.map(x => x.parentElement.tagName), stops: ps.filter(x => x.tabIndex >= 0).length, roles: ps.filter(x => x.getAttribute('role')).length,
    name: ps[0].getAttribute('aria-label'), hidden: ps.slice(1).every(x => x.getAttribute('aria-hidden') === 'true'), gap: r.length === 2 && Math.abs(r[0].top - r[1].top) < 1 ? r[1].left - r[0].right : null, bold: document.querySelectorAll('.go li b').length};
});
ok(JSON.stringify([split.text, split.cls, split.parents]) === JSON.stringify([['sous', ' le vent'], ['gw gw-a', 'gw gw-z'], ['B', 'LI']]) && split.stops === 1 && split.roles === 1 && split.name === 'sous le vent' && split.hidden && split.bold === 1,
  `« sous le vent » over </b>: pieces ${JSON.stringify(split.text)} in ${split.parents.join(', ')}, ${split.stops} tab stop, ${split.roles} button named « ${split.name} », the <b> of the sheet still one`);
ok(split.gap === null || Math.abs(split.gap) < .05, `its pieces touch without overlapping (${split.gap === null ? 'on two lines' : split.gap.toFixed(2) + 'px apart'})`);
await p.tap('.gw-z' + id(3)); await p.waitForTimeout(900);
s = await state();
let band = await p.evaluate(() => [...document.querySelectorAll('.gw.on')].map(x => x.textContent).join('|'));
ok(s.open && s.title === 'sous le vent' && band === 'sous| le vent' && s.low <= s.top, `a tap on its second piece opens « ${s.title} »; the band is on both pieces (${band})`);
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
ok(await p.evaluate(() => document.activeElement && document.activeElement.className.includes('gw-a')), 'closed, the focus is on its first piece (the button)');
await p.waitForTimeout(900);
await p.keyboard.press('Enter'); await p.waitForTimeout(700);
s = await state(); band = await p.evaluate(() => [...document.querySelectorAll('.gw.on')].map(x => x.textContent).join('|'));
ok(s.open && s.title === 'sous le vent' && band === 'sous| le vent', 'Enter on it opens the same definition, band on both pieces');
await p.keyboard.press('Escape'); await p.waitForTimeout(1300);
ok((await state()).on === 0, 'the band leaves both pieces');

// 3c. running text by exclusion: a plain paragraph (the « Why »), the loop line
const j = await open('jab-cross');
const jm = await j.evaluate(() => [...document.querySelectorAll('.gw[role]')].map(g => g.textContent + '@' + (g.closest('.loop') ? 'loop' : g.closest('.lead') ? 'lead' : g.parentElement.tagName === 'P' && !g.parentElement.className ? 'p' : '?') + (g.getClientRects().length ? '' : ' (folded)')));
ok(JSON.stringify(jm.map(x => x.replace(' (folded)', '')).sort()) === JSON.stringify(['cross@lead', 'distance@p', 'garde@loop', 'jab@lead']), `jab-cross: ${jm.join(', ')}`);
await j.context().close();

// 4. « Words in this sheet »
const end = await p.evaluate(() => { const d = document.querySelector('.gl-end'), next = d.nextElementSibling; return {open: d.open, sum: d.querySelector('summary').textContent, chips: [...d.querySelectorAll('.gl-chip')].map(c => c.textContent), before: next && next.tagName, links: d.querySelectorAll('a').length}; });
ok(!end.open && end.sum === 'Words in this sheet · 12' && end.chips.length === 12 && end.before === 'FOOTER' && end.links === 1, `« ${end.sum} », folded, before the source, one link (lot G3b's « Glossary n › », checked in p11-g3b-check.mjs): ${end.chips.join(', ')}`);
await p.tap('.gl-end summary'); await p.waitForTimeout(200);
const sizes = await p.evaluate(() => [...document.querySelectorAll('.gl-end .gl-chip')].map(c => c.getBoundingClientRect().height));
ok(Math.min(...sizes) >= 40, `chips are ${Math.min(...sizes)}px tall or more`);
await p.tap('.gl-chip' + id(12)); await p.waitForTimeout(700);
s = await state();
const sp = await p.evaluate(() => (document.querySelector('.gl-sp') || {}).textContent);
ok(s.open && s.title === 'leash' && sp === 'Spelled “lish” in 1 sheet' && s.on === 0, `a chip opens the same sheet: « ${s.title} », ${sp}`);
await p.tap('#gl-close'); await p.waitForTimeout(300);
await p.context().close();
const e = await open('session-shadow-esquives');
await e.tap('.gl-end summary'); await e.tap('.gl-chip' + id(20)); await e.waitForSelector('.gl-ph img[src]'); await e.waitForTimeout(500);
const cap = await e.evaluate(() => ({cap: document.querySelector('.gl-cap').textContent, w: document.querySelector('[data-gl-ph]').naturalWidth, gw: document.querySelectorAll('.gw').length}));
ok(cap.cap === 'Garde et déplacements' && cap.w > 0 && cap.gw === 0, `a photo from another sheet is captioned with that sheet's title (« ${cap.cap} »); a word seen in a title only is not underlined`);
await e.context().close();
ok(!errs.length, `no page or console error ${errs.join(' | ')}`);
await b.close(); process.exit(fails.length ? 1 : 0);
