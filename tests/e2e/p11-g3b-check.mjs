// P11 G3b: what the `vm` tests cannot see of the « Glossary » page and its link. By hand, not in CI, against a preview
// with the fake backend: tools/preview/build.sh <out>; tools/preview/serve.sh <out> 8842; then
//   node tests/e2e/p11-g3b-check.mjs --base http://127.0.0.1:8842/index.html [--browser chromium] [--out <dir>] [--dark]
// WebKit iPhone 14, on the synthetic notebooks (Kitesurf: 13 entries; Fight: 4; Strength: none):
// - the link sits on the count's line, on the right, with a 44 px target and its accessible name; the count and the
//   group chips are where they are on a backend without the table (nothing jumps when the glossary has been read);
//   when the count leaves it no room (320 px at 135 %) it goes under the count, left-aligned; a notebook without
//   entry has none;
// - a tap opens #<notebook>/glossary; a reload shows the same page; the browser's Back leads to the notebook page;
// - every row is a target of 44 px or more, nothing overflows; a definition takes one line at the normal text size
//   and two at 135 %; the search filters in place and the count says « n of 13 words » in a status;
// - a row opens the definition sheet; the browser's Back closes it and stays on the page; ✕ gives the focus back to
//   the row; the link under « Words in this sheet » opens the page and Back returns to the sheet.
// With --out, the screenshots at 135 % (the long count, the list) and the empty page are written there (shots.mjs
// cannot change the text size).
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path';
const pw = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const BASE = arg('--base') || 'http://127.0.0.1:8842/index.html', engine = pw[arg('--browser') || 'webkit'], OUT = arg('--out'), DARK = process.argv.includes('--dark');
const b = await engine.launch(); const fails = [], errs = [];
const ok = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok' : 'FAIL'}  ${m}`); };
const open = async (hash, query = '', opts = {}, wait = '#count') => {
  const c = await b.newContext({...pw.devices['iPhone 14'], colorScheme: DARK ? 'dark' : 'light', ...opts}); await c.route(/supabase\.co/, r => r.abort());
  const p = await c.newPage(); p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE + (query ? '?' + query : '') + '#' + hash); await p.waitForSelector(wait); await p.waitForTimeout(700);
  return p;
};
const box = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.left, y: r.top + scrollY, w: r.width, h: r.height, r: r.right, b: r.bottom + scrollY}; }, sel);
const near = (a, b, d = 0.6) => Math.abs(a - b) <= d;

// 1. the link on the count's line; nothing moves
{
  const p = await open('kitesurf'), q = await open('kitesurf', 'missing=glossary_words');
  const a = await p.evaluate(() => { const e = document.querySelector('#gl-go a'); return e ? {text: e.textContent, name: e.getAttribute('aria-label'), href: e.getAttribute('href'), weight: getComputedStyle(e).fontWeight, same: getComputedStyle(e).color === getComputedStyle(document.querySelector('#h-acct, .btn.txt') || e).color} : null; });
  ok(a && a.text === 'Glossary 13 ›' && a.name === 'Glossary, 13 words' && a.href === '#kitesurf/glossary' && a.weight === '600', `the link: ${JSON.stringify(a)}`);
  const link = await box(p, '#gl-go a'), cnt = await box(p, '#count'), row = await box(p, '.cnt-row'), chips = await box(p, '#group-chips'), search = await box(p, '#search');
  ok(link.h >= 44 && link.w >= 44, `a target of ${link.w.toFixed(0)} × ${link.h.toFixed(0)} px`);
  ok(near(link.r, row.r) && link.x > cnt.x + 40 && link.y < cnt.b && link.b > cnt.y, 'on the right of the count, on its line');
  ok(await p.evaluate(() => document.querySelector('#gl-go a').getBoundingClientRect().right <= innerWidth - 15), 'inside the page\'s gutter');
  const below = chips && chips.h ? chips : search;
  ok(link.b <= below.y + 0.5, `the target ends above what follows the line (${link.b.toFixed(1)} ≤ ${below.y.toFixed(1)})`);
  const cnt0 = await box(q, '#count'), chips0 = await box(q, '#group-chips'), search0 = await box(q, '#search');
  ok(!(await q.$('#gl-go a')), 'a backend without the table: no link');
  ok(near(cnt.y, cnt0.y, 0.1) && near(cnt.h, cnt0.h, 0.1) && near(search.y, search0.y, 0.1) && (!chips || near(chips.y, chips0.y, 0.1)), `the count, the chips and the search are where they are without the link (search at ${search.y.toFixed(1)} / ${search0.y.toFixed(1)})`);
  await p.context().close(); await q.context().close();
  const s = await open('strength');
  ok(!(await s.$('#gl-go a')) && /sheets/.test(await s.textContent('#count')), 'a notebook without entry: the count alone');
  await s.context().close();
  const f = await open('fight'), f0 = await open('fight', 'missing=glossary_words');
  const fl = await box(f, '#gl-go a'), fc = await box(f, '#count'), fch = await box(f, '#group-chips'), fch0 = await box(f0, '#group-chips'), fs = await box(f, '#search'), fs0 = await box(f0, '#search');
  ok(fl && fl.y < fc.b && fl.b > fc.y && near(fs.y, fs0.y, 0.1) && (!fch || near(fch.y, fch0.y, 0.1)), `Fight (« ${await f.textContent('#count')} »): one line, nothing moved`);
  await f.context().close(); await f0.context().close();
  // a count too long for the line (here a 320 px screen at 135 % text: at the normal size every count of the
  // fixtures fits beside the link, down to 320 px): the link under the count, left-aligned
  const n = await open('fight', '', {viewport: {width: 320, height: 568}});
  await n.evaluate(() => { document.documentElement.style.fontSize = '135%'; }); await n.waitForTimeout(400);
  const nl = await box(n, '#gl-go a'), nc = await box(n, '#count'), ns = await box(n, '#search'), nch = await box(n, '#group-chips');
  const under = nch && nch.h ? nch : ns;
  ok(nl.y + nl.h / 2 > nc.b && near(nl.x, nc.x, 1), `320 px at 135 %: under the count, left-aligned (x ${nl.x.toFixed(1)} / ${nc.x.toFixed(1)})`);
  if (OUT) await n.screenshot({path: join(OUT, 'p11g3b-02-long-count.png')});
  ok(nl.b <= under.y + 0.5 && await n.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `its target ends above what follows (${nl.b.toFixed(1)} ≤ ${under.y.toFixed(1)}), no sideways scroll`);
  await n.context().close();
}

// 2. the route: a tap, a reload, the browser's Back
{
  const p = await open('kitesurf');
  await p.click('#gl-go a'); await p.waitForSelector('#glossary:not([hidden]) .glp-row'); await p.waitForTimeout(300);
  const state = () => p.evaluate(() => ({hash: location.hash, h1: document.querySelector('#glossary h1').textContent, n: document.querySelector('#glp-n').textContent, role: document.querySelector('#glp-n').getAttribute('role'),
    by: document.querySelector('#glp-by').textContent, back: document.querySelector('#nav-back').textContent, more: document.querySelector('#nav-more').hidden, rows: document.querySelectorAll('.glp-row').length,
    first: document.querySelector('.glp-row b').textContent, title: document.title, tint: document.querySelector('#nav-bar').classList.contains('tint') && document.querySelector('#nav-bar').classList.contains('upc')}));
  const want = {hash: '#kitesurf/glossary', h1: 'Glossary', n: '13 words', role: 'status', by: 'Definitions written by Reelbook.', back: '‹ Kitesurf', more: true, rows: 13, first: '11 h', title: 'Glossary · Kitesurf · Reelbook', tint: true};
  ok(JSON.stringify(await state()) === JSON.stringify(want), `the page: ${JSON.stringify(await state())}`);
  await p.reload(); await p.waitForSelector('#glossary:not([hidden]) .glp-row'); await p.waitForTimeout(300);
  ok(JSON.stringify(await state()) === JSON.stringify(want), 'the same page after a reload');
  // 3. rows
  const rows = await p.evaluate(() => [...document.querySelectorAll('.glp-row')].map(r => { const d = r.querySelector('.glp-def'), s = getComputedStyle(d); return {h: r.getBoundingClientRect().height, lines: Math.round(d.getBoundingClientRect().height / parseFloat(s.lineHeight)), cut: d.scrollHeight > d.clientHeight + 1, w: r.getBoundingClientRect().right}; }));
  ok(rows.every(r => r.h >= 44), `13 rows, each a target of 44 px or more (${Math.min(...rows.map(r => r.h)).toFixed(0)} to ${Math.max(...rows.map(r => r.h)).toFixed(0)})`);
  ok(rows.every(r => r.lines === 1) && rows.some(r => r.cut), 'one line of definition per row, cut when it is longer');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
  const labels = await p.evaluate(() => [...document.querySelectorAll('.glp-w')].map(w => w.textContent));
  ok(labels.join('|') === '11 h|aile|bord · la direction|bord · le rivage|carre|cranter|gilet d\'impact|leash|pop|remontée au vent|sous le vent|twin-tip|vent de terreNot sure', `the order: ${labels.join(' | ')}`);
  ok(await p.evaluate(() => { const s = getComputedStyle(document.querySelector('.gl-sense')), m = getComputedStyle(document.querySelector('.glp-def')); return s.color === m.color && s.fontWeight === '400'; }), 'the sense label in --muted, regular');
  // 4. the search
  await p.fill('#glp-q', 'VÉNT'); await p.waitForTimeout(200);
  ok(await p.textContent('#glp-n') === '3 of 13 words' && (await p.$$('.glp-row')).length === 3, `« VÉNT »: ${await p.textContent('#glp-n')}`);
  await p.fill('#glp-q', 'voile'); await p.waitForTimeout(200);
  ok(await p.textContent('.glp-row b') === 'aile', 'a form (« voile ») finds its entry (« aile »)');
  await p.fill('#glp-q', 'kitelop'); await p.waitForTimeout(200);
  ok(await p.textContent('#glp-msg') === 'No word for “kitelop”.' && await p.textContent('#glp-n') === '0 of 13 words' && (await p.$$('.glp-row')).length === 0, 'no result: « No word for “kitelop”. »');
  await p.fill('#glp-q', ''); await p.waitForTimeout(200);
  // 5. a row opens the definition; Back closes it and stays; ✕ gives the focus back
  const len = () => p.evaluate(() => history.length);
  const l0 = await len();
  await p.click('.glp-row[data-gw$="000007"]'); await p.waitForSelector('#gl-dlg[open] .note'); await p.waitForTimeout(500);
  ok(await p.textContent('#gl-h') === 'vent de terre' && !(await p.$('#gl-dlg .gw.on')), 'a row opens the definition sheet (no band: no word was tapped)');
  await p.goBack(); await p.waitForTimeout(500);
  ok(!(await p.$('#gl-dlg[open]')) && await p.evaluate(() => location.hash === '#kitesurf/glossary' && !document.querySelector('#glossary').hidden), 'the browser\'s Back closes it and stays on the page');
  await p.click('.glp-row[data-gw$="000005"]'); await p.waitForSelector('#gl-dlg[open] .gl-of'); await p.waitForTimeout(400);
  await p.click('#gl-close'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => document.activeElement && document.activeElement.matches('.glp-row[data-gw$="000005"]')) && await len() === l0 + 1, '✕ closes it and the focus is back on the row');
  // 6. large text: two lines of definition
  await p.evaluate(() => { document.documentElement.style.fontSize = '135%'; }); await p.waitForTimeout(400);
  const big = await p.evaluate(() => [...document.querySelectorAll('.glp-def')].map(d => Math.round(d.getBoundingClientRect().height / parseFloat(getComputedStyle(d).lineHeight))));
  ok(big.every(n => n <= 2) && big.some(n => n === 2) && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `135 %: two lines of definition at most (${big.join(' ')}), no sideways scroll`);
  if (OUT) { await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(300); await p.screenshot({path: join(OUT, 'p11g3b-09-large-text.png')}); } // from the top: the title, the count, the search
  await p.evaluate(() => { document.documentElement.style.fontSize = ''; });
  // 7. Back leads to the notebook page
  await p.goto(BASE + '#kitesurf'); await p.waitForSelector('#gl-go a'); await p.click('#gl-go a'); await p.waitForSelector('#glossary:not([hidden]) .glp-row');
  await p.goBack(); await p.waitForSelector('#home:not([hidden]) #gl-go a');
  ok(await p.evaluate(() => location.hash === '#kitesurf' && document.querySelector('#glossary').hidden), 'the browser\'s Back leads to the notebook page');
  await p.goForward(); await p.waitForSelector('#glossary:not([hidden]) .glp-row'); await p.click('#nav-back'); await p.waitForSelector('#home:not([hidden]) #gl-go a');
  ok(await p.evaluate(() => location.hash === '#kitesurf'), '« ‹ Kitesurf » too');
  await p.context().close();
}

// 8. the link under « Words in this sheet »
{
  const p = await open('backroll', '', {}, '.gl-end');
  await p.click('.gl-end summary'); await p.waitForTimeout(200);
  const a = await p.evaluate(() => { const e = document.querySelector('.gl-end .gl-all a'), r = e.getBoundingClientRect(), c = [...document.querySelectorAll('.gl-end .gl-chip')].pop().getBoundingClientRect(); return {html: e.outerHTML, h: r.height, after: r.top >= c.bottom}; });
  ok(a.html === '<a class="gl-go" href="#kitesurf/glossary" aria-label="Glossary, 13 words">Glossary 13 ›</a>' && a.h >= 44 && a.after, `after the chips, the same link: ${a.html}`);
  await p.click('.gl-end .gl-all a'); await p.waitForSelector('#glossary:not([hidden]) .glp-row');
  ok(await p.textContent('#nav-back') === '‹ Kitesurf', 'it opens the page');
  await p.goBack(); await p.waitForSelector('#view:not([hidden]) .gw');
  ok(await p.evaluate(() => location.hash === '#backroll' && document.querySelectorAll('.gl-end').length === 1), 'Back returns to the sheet, its words laid once');
  await p.context().close();
}

// 9. a few entries: no search; no table reached by its address: the empty page, no error
{
  const p = await open('fight/glossary', '', {}, '.glp-row');
  ok(await p.textContent('#glp-n') === '4 words' && await p.evaluate(() => document.querySelector('#glp-search').hidden), 'Fight: « 4 words », no search field');
  await p.context().close();
  const q = await open('kitesurf/glossary', 'missing=glossary_words', {}, '.glp-none');
  ok(await q.textContent('#glp-msg') === 'No word yet. They come from your sheets.' && await q.evaluate(() => document.querySelector('#glp-n').hidden && getComputedStyle(document.querySelector('.glp-none')).borderTopStyle === 'none'), 'no table: « No word yet. They come from your sheets. », no dashed box');
  if (OUT) await q.screenshot({path: join(OUT, 'p11g3b-10-empty.png')});
  await q.context().close();
}

await b.close();
ok(!errs.length, `no page or console error${errs.length ? ': ' + errs.join(' | ') : ''}`);
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
process.exit(fails.length ? 1 : 0);
