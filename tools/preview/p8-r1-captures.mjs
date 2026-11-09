// P8 R1: captures of « On the way » on the fake backend (docs/audit-design/captures/p8/R1), WebKit iPhone 14, light
// and dark, reduced motion. Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8791.
// usage: node tools/preview/p8-r1-captures.mjs <shots dir> <port>   (prints the band's y and height on each page)
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT] = process.argv; mkdirSync(OUT, {recursive: true});
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const home = async p => { await p.waitForSelector('#otw-band:not([hidden])'); await p.waitForTimeout(400); };
const S = {
  '01-home-band': {q: '', run: home},
  '02-on-the-way': {q: '', run: async p => { await home(p); await p.click('#otw-band'); await p.waitForTimeout(500); }},
  '03-add-sheet': {q: '', run: async p => { await home(p); await p.click('#add-video-fab'); await p.waitForTimeout(500); await p.fill('#f-url', 'https://www.tiktok.com/@coach/video/7312'); await p.locator('#f-url').blur(); }},
  '04-new-account-2-links': {q: '?empty=sheets,sessions&links=2', run: async p => { await p.waitForSelector('#first-steps:not([hidden])'); await p.waitForTimeout(400); }},
  '05-after-add': {q: '', run: async p => { await home(p); await p.click('#add-video-fab'); await p.fill('#f-url', 'https://www.tiktok.com/@coach/video/999'); await p.click('#f-submit'); await p.waitForTimeout(600); }},
  '06-read-failed': {q: '?missing=requests', run: async p => { await p.waitForSelector('#otw-band:not([hidden])'); await p.waitForTimeout(400); }},
};
const b = await webkit.launch(); const report = [];
for (const [name, s] of Object.entries(S)) for (const scheme of ['light', 'dark']) {
  const c = await b.newContext({...devices['iPhone 14'], deviceScaleFactor: 1.5, colorScheme: scheme, reducedMotion: 'reduce'});
  await c.route(/supabase\.co/, r => r.abort());
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(BASE + s.q); await s.run(p);
  const box = await p.evaluate(() => { const e = document.getElementById('otw-band'); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return {y: Math.round(r.top), h: Math.round(r.height), text: e.innerText.replace(/\s+/g, ' ').trim()}; });
  await p.screenshot({path: join(OUT, `${name}-${scheme}.png`)});
  report.push({name, scheme, box, errs, hash: await p.evaluate(() => location.hash)});
  await c.close();
}
await b.close(); console.log(JSON.stringify(report, null, 1));
