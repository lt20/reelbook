// P8 R18: captures of a session's « Share » (next to « Log ») and its one sheet, « Send “<title>” to a training
// partner », on the fake backend (docs/audit-design/captures/p8/R18), WebKit iPhone 14, light and dark, reduced motion.
// Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8818.
// usage: node tools/preview/p8-r18-captures.mjs <shots dir> <port> [name…]
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT, ...ONLY] = process.argv; mkdirSync(OUT, {recursive: true});
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const home = async p => { await p.waitForSelector('#portal .tcard'); await p.waitForTimeout(400); };
const session = async p => { await home(p); await p.click('#sess-sec .scard-o'); await p.waitForSelector('#view #ses-share'); await p.waitForTimeout(400); };
const share = async p => {
  await session(p); await p.click('#ses-share');
  await p.waitForFunction(() => { const w = document.querySelector('#share-dlg[open] #share-why'); return w && !/Checking/.test(w.textContent); });
  await p.waitForTimeout(400);
};
const S = {
  '01-session-page': {q: '?name', run: session},
  '02-share-first-send': {q: '', run: share},
  '03-share-name-filled': {q: '?name', run: share},
};
const b = await webkit.launch(); const report = [];
for (const [name, s] of Object.entries(S)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  for (const scheme of ['light', 'dark']) {
    const c = await b.newContext({...devices['iPhone 14'], deviceScaleFactor: 1.5, colorScheme: scheme, reducedMotion: 'reduce'});
    await c.route(/supabase\.co/, r => r.abort());
    const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + s.q); await s.run(p);
    const said = await p.evaluate(() => [...document.querySelectorAll('#share-h, #share-why, #share-name')].map(e => e.value || e.textContent.trim()));
    await p.screenshot({path: join(OUT, `${name}-${scheme}.png`)});
    report.push({name, scheme, errs, said});
    await c.close();
  }
}
await b.close(); console.log(JSON.stringify(report, null, 1));
