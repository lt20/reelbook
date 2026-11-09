// P8 R4: captures of the clarified screens on the fake backend (docs/audit-design/captures/p8/R4), WebKit iPhone 14,
// light and dark, reduced motion. Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8794.
// usage: node tools/preview/p8-r4-captures.mjs <shots dir> <port> [name…]
// Prints, per capture, the y of the first NEW photo and the boxes of the top bar's buttons.
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT, ...ONLY] = process.argv; mkdirSync(OUT, {recursive: true});
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const home = async p => { await p.waitForSelector('#portal .tcard'); await p.waitForTimeout(500); };
const S = {
  '01-home': {q: '', full: true, run: home},
  '02-home-first-screen': {q: '', run: home},
  '03-notebook': {q: '', h: '#strength', run: async p => { await p.waitForSelector('#groups .card'); await p.waitForTimeout(400); }},
  '04-sheet': {q: '', run: async p => { await home(p); await p.click('#new-sec .card'); await p.waitForSelector('#view h1'); await p.waitForTimeout(500); }},
  '05-session': {q: '', run: async p => { await home(p); await p.click('#sess-sec .scard-o'); await p.waitForSelector('#view h1'); await p.waitForTimeout(500); }},
  '06-search-open': {q: '', run: async p => { await home(p); await p.click('#h-search'); await p.waitForTimeout(400); }},
  '07-search-results': {q: '', run: async p => { await home(p); await p.click('#h-search'); await p.fill('#q', 'shoulder'); await p.waitForTimeout(400); }},
  '08-search-nothing': {q: '', run: async p => { await home(p); await p.click('#h-search'); await p.fill('#q', 'kettlebell'); await p.waitForTimeout(400); }},
  '09-empty-account': {q: '?empty=sheets,sessions&links=2', run: async p => { await p.waitForSelector('#first-steps:not([hidden])'); await p.waitForTimeout(400); }},
};
const b = await webkit.launch(); const report = [];
for (const [name, s] of Object.entries(S)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  for (const scheme of ['light', 'dark']) {
    const c = await b.newContext({...devices['iPhone 14'], deviceScaleFactor: 1.5, colorScheme: scheme, reducedMotion: 'reduce'});
    await c.route(/supabase\.co/, r => r.abort());
    const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + s.q + (s.h || '')); await s.run(p);
    const box = await p.evaluate(() => {
      const r = sel => { const e = document.querySelector(sel); if (!e || !e.offsetParent) return null; const b = e.getBoundingClientRect(); return {y: Math.round(b.top), h: Math.round(b.height), w: Math.round(b.width)}; };
      return {newPhoto: r('#new-sec .card img'), bar: r('#brand-bar'), search: r('#h-search'), acct: r('#h-acct'), band: r('#otw-band'), sessions: r('#sess-sec')};
    });
    await p.screenshot({path: join(OUT, `${name}-${scheme}.png`), fullPage: !!s.full});
    report.push({name, scheme, box, errs, hash: await p.evaluate(() => location.hash)});
    await c.close();
  }
}
await b.close(); console.log(JSON.stringify(report, null, 1));
