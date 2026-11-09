// P8 R4b: captures of the sheet, the session, the notebook page and the player's rest on the fake backend
// (docs/audit-design/captures/p8/R4b), WebKit iPhone 14, light and dark, reduced motion.
// Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8795.
// usage: node tools/preview/p8-r4b-captures.mjs <shots dir> <port> [name…]
// Prints, per capture, the boxes of the action row (Start, Log) and the band, and any page error.
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT, ...ONLY] = process.argv; mkdirSync(OUT, {recursive: true});
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const home = async p => { await p.waitForSelector('#portal .tcard'); await p.waitForTimeout(500); };
const sheet = async p => { await home(p); await p.click('#new-sec .card'); await p.waitForSelector('#view #practice-done'); await p.waitForTimeout(500); };
const session = async p => { await home(p); await p.click('#sess-sec .scard-o'); await p.waitForSelector('#view #play-start'); await p.waitForTimeout(500); };
const S = {
  '01-notebook': {h: '#strength', run: async p => { await p.waitForSelector('#groups .card'); await p.waitForTimeout(400); }},
  '02-sheet': {run: sheet},
  '03-sheet-dose-keys': {run: async p => { await sheet(p); await p.evaluate(() => { const e = document.querySelector('#view .dose, #view ol.keys, #view .steps'); if (e) window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 80); }); await p.waitForTimeout(300); }},
  '04-session': {run: session},
  '05-player-rest': {run: async p => { await session(p); await p.click('#play-start'); await p.waitForSelector('#play-set-1'); await p.click('#play-set-1'); await p.waitForSelector('#play-rest-skip'); await p.waitForTimeout(400); }},
};
const b = await webkit.launch(); const report = [];
for (const [name, s] of Object.entries(S)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  for (const scheme of ['light', 'dark']) {
    const c = await b.newContext({...devices['iPhone 14'], deviceScaleFactor: 1.5, colorScheme: scheme, reducedMotion: 'reduce'});
    await c.route(/supabase\.co/, r => r.abort());
    const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + (s.h || '')); await s.run(p);
    const box = await p.evaluate(() => {
      const r = sel => { const e = document.querySelector(sel); if (!e || !e.offsetParent) return null; const b = e.getBoundingClientRect(); return {x: Math.round(b.left), y: Math.round(b.top), h: Math.round(b.height), w: Math.round(b.width)}; };
      const bar = document.getElementById('nav-bar');
      return {start: r('#play-start'), log: r('#practice-done'), back: bar && getComputedStyle(document.getElementById('nav-back')).color, band: bar && getComputedStyle(bar).boxShadow, skip: r('#play-rest-skip')};
    });
    await p.screenshot({path: join(OUT, `${name}-${scheme}.png`)});
    report.push({name, scheme, box, errs, hash: await p.evaluate(() => location.hash)});
    await c.close();
  }
}
await b.close(); console.log(JSON.stringify(report, null, 1));
