// P8 R5: captures of the player (a set, a rest) and of Session done on the fake backend
// (docs/audit-design/captures/p8/R5), WebKit iPhone 14, light, dark and High contrast, reduced motion.
// Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8795.
// usage: node tools/preview/p8-r5-captures.mjs <shots dir> <port> [name…]
// Prints, per capture, the filled buttons in view and any page error.
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT, ...ONLY] = process.argv; mkdirSync(OUT, {recursive: true});
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const home = async p => { await p.waitForSelector('#portal .tcard'); await p.waitForTimeout(500); };
const start = async p => { await home(p); await p.click('#sess-sec .scard-o'); await p.waitForSelector('#view #play-start'); await p.click('#play-start'); await p.waitForSelector('#play-done-set'); await p.waitForTimeout(700); };
const S = {
  '01-player-set': {run: start},
  '02-player-rest': {run: async p => { await start(p); await p.click('#play-done-set'); await p.waitForSelector('#play-rest-next'); await p.waitForTimeout(400); }},
  '03-session-done': {run: async p => {
    await start(p);
    // every set of every exercise: Done set, Next after each rest, then Finish once it is the filled action
    for (let i = 0; i < 60; i++) {
      const next = await p.evaluate(() => ['play-rest-next', 'play-done-set', 'play-finish', 'play-next'].find(id => { const e = document.getElementById(id); return e && e.offsetParent && !e.classList.contains('ghost'); }));
      if (!next) break;
      await p.click('#' + next); await p.waitForTimeout(150);
      if (next === 'play-finish') break;
    }
    await p.waitForSelector('#end-undo'); await p.waitForTimeout(600);
  }}
};
const b = await webkit.launch(); const report = [];
for (const [name, s] of Object.entries(S)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  for (const scheme of ['light', 'dark', 'contrast']) {
    if (scheme === 'contrast' && name === '03-session-done') continue; // High contrast is the player's
    const c = await b.newContext({...devices['iPhone 14'], deviceScaleFactor: 1.5, colorScheme: scheme === 'dark' ? 'dark' : 'light', reducedMotion: 'reduce'});
    await c.route(/supabase\.co/, r => r.abort());
    if (scheme === 'contrast') await c.addInitScript(() => { try { localStorage.setItem('rb.contrast', '1'); } catch {} });
    const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE); await s.run(p);
    const filled = await p.evaluate(() => [...document.querySelectorAll('.btn:not(.ghost)')].filter(e => e.offsetParent).map(e => e.textContent.trim()));
    await p.screenshot({path: join(OUT, `${name}-${scheme}.png`)});
    report.push({name, scheme, filled, errs, hash: await p.evaluate(() => location.hash)});
    await c.close();
  }
}
await b.close(); console.log(JSON.stringify(report, null, 1));
