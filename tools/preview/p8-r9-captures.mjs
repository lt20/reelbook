// P8 R9: captures of Settings › Reelbook and of the star card under Session done, on the fake backend
// (docs/audit-design/captures/p8/R9), WebKit iPhone 14, light and dark, reduced motion.
// Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8799. The hosted variant needs a second
// build whose index.html says OTW_MODE = 'hosted' (served on <port + 100>, optional).
// usage: node tools/preview/p8-r9-captures.mjs <shots dir> <port> [hosted port]
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT, HOSTED] = process.argv; mkdirSync(OUT, {recursive: true});
const base = port => `http://127.0.0.1:${port}/index.html`;
// The 2nd session done: the device already counts one (rb.star.u1), then a session is played to Finish.
const done = async p => {
  await p.evaluate(() => localStorage.setItem('rb.star.u1', '1'));
  await p.evaluate(() => { location.hash = '#session/session-gainage-10-min/play'; });
  await p.waitForSelector('#player:not([hidden])');
  for (let i = 0; i < 12 && !(await p.$('#play-finish')); i++) { await p.click('#play-next'); await p.waitForTimeout(150); }
  await p.click('#play-finish');
  await p.waitForSelector('#end-promo .end-promo');
  await p.evaluate(() => document.getElementById('end-promo').scrollIntoView({block: 'end'}));
  await p.waitForTimeout(300);
};
const S = {
  '01-settings-reelbook': {port: PORT, run: async p => {
    await p.evaluate(() => { location.hash = '#settings'; });
    await p.waitForSelector('#settings:not([hidden])');
    await p.evaluate(() => document.getElementById('s-reelbook').scrollIntoView({block: 'end'}));
    await p.waitForTimeout(300);
  }},
  '02-session-done-star': {port: PORT, run: done},
  ...(HOSTED ? {'03-session-done-hosted': {port: HOSTED, run: done}} : {})
};
const b = await webkit.launch(); const report = [];
for (const [name, s] of Object.entries(S)) for (const scheme of ['light', 'dark']) {
  const c = await b.newContext({...devices['iPhone 14'], deviceScaleFactor: 1.5, colorScheme: scheme, reducedMotion: 'reduce'});
  await c.route(/supabase\.co/, r => r.abort());
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(base(s.port)); await p.waitForTimeout(600); await s.run(p);
  const promo = await p.evaluate(() => { const e = document.querySelector('#end-promo .end-promo'); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; });
  const report1 = await p.evaluate(() => { const a = document.getElementById('s-report'); return a ? decodeURIComponent(a.href.split('body=')[1] || '') : null; });
  await p.screenshot({path: join(OUT, `${name}-${scheme}.png`)});
  report.push({name, scheme, promo, report: name.startsWith('01') ? report1 : undefined, errs});
  await c.close();
}
await b.close(); console.log(JSON.stringify(report, null, 1));
