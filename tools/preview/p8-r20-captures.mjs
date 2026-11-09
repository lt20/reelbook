// P8 R20: captures of a « Something wrong? » fix shown as a fix (the band, « On the way », a notebook page with no
// ghost card) and of the Add sheet refusing the same reel with suffixes, on the fake backend
// (docs/audit-design/captures/p8/R20), WebKit iPhone 14, light and dark, reduced motion.
// Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8818.
// usage: node tools/preview/p8-r20-captures.mjs <shots dir> <port> [name…]
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT, ...ONLY] = process.argv; mkdirSync(OUT, {recursive: true});
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const home = async p => { await p.waitForSelector('#portal .tcard'); await p.waitForSelector('#otw-band:not([hidden])'); await p.waitForTimeout(400); };
const S = {
  // one video on the way and one fix: « 1 on the way · 1 fix »
  '01-home-fix-and-video': {q: '?links=1&fixes=1', run: home},
  // the list: Needs you, Being made, Not started, then « Fixes requested »
  '02-on-the-way': {q: '?fixes=2', run: async p => { await home(p); await p.click('#otw-band'); await p.waitForTimeout(500); }},
  // a notebook page: the video's ghost card, no ghost for the fix, the sheet's card says « Fix requested »
  '03-notebook-no-ghost': {q: '?links=1&fixes=1#strength', run: async p => { await p.waitForSelector('#otw-ghosts:not([hidden])'); await p.waitForTimeout(400); await p.evaluate(() => document.querySelector('.card .fixq')?.closest('.card')?.scrollIntoView({block: 'center'})); await p.waitForTimeout(300); }},
  // the same reel as a sheet, with /reels/, no www. and ?igsh=: refused by its title
  '04-add-duplicate': {q: '?links=1', run: async p => { await home(p); await p.click('#add-video-fab'); await p.waitForTimeout(400); await p.fill('#f-url', 'https://instagram.com/reels/PREVIEW0001?igsh=MWx0eW9xZ3Bh'); await p.click('#f-submit'); await p.waitForSelector('#f-err:not([hidden])'); await p.waitForTimeout(300); }},
};
const b = await webkit.launch(); const report = [];
for (const [name, s] of Object.entries(S)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  for (const scheme of ['light', 'dark']) {
    const c = await b.newContext({...devices['iPhone 14'], deviceScaleFactor: 1.5, colorScheme: scheme, reducedMotion: 'reduce'});
    await c.route(/supabase\.co/, r => r.abort());
    const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + s.q); await s.run(p);
    const said = await p.evaluate(() => [...document.querySelectorAll('#otw-band:not([hidden]) .bt, #f-err:not([hidden]), dialog[open] .otw-sec, #otw-ghosts:not([hidden]) h2, .card .fixq')].map(e => e.textContent.trim()));
    const clip = await p.evaluate(() => { const e = document.querySelector('#otw-band:not([hidden]) .bt'); return e ? e.scrollWidth > e.clientWidth : null; });
    await p.screenshot({path: join(OUT, `${name}-${scheme}.png`)});
    report.push({name, scheme, errs, said, bandClipped: clip});
    await c.close();
  }
}
await b.close(); console.log(JSON.stringify(report, null, 1));
