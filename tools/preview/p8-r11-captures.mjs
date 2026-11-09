// P8 R11: captures of « Send to a training partner » and « <sender> sent you a session » on the fake backend
// (docs/audit-design/captures/p8/R11), WebKit iPhone 14, light and dark, reduced motion. navigator.share is removed, so
// the link is copied (the phone's own share menu is not drawn by the page).
// Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8801.
// usage: node tools/preview/p8-r11-captures.mjs <shots dir> <port> [name…]
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT, ...ONLY] = process.argv; mkdirSync(OUT, {recursive: true});
const BASE = `http://127.0.0.1:${PORT}/index.html`, TOKEN = 'PREVIEWshareToken00001';
const home = async p => { await p.waitForSelector('#portal .tcard'); await p.waitForTimeout(400); };
const session = async p => { await home(p); await p.click('#sess-sec .scard-o'); await p.waitForSelector('#view h1'); await p.waitForTimeout(300); };
const share = async p => { await session(p); await p.click('#nav-more'); await p.click('#nav-share'); await p.waitForSelector('#share-partner'); await p.waitForTimeout(400); };
const partner = async p => { await share(p); await p.click('#share-partner'); await p.waitForTimeout(500); };
const received = async p => { await p.waitForSelector('#recv-dlg[open] #recv-h'); await p.waitForFunction(() => !/Opening/.test(document.querySelector('#recv-h').textContent)); await p.waitForTimeout(400); };
const S = {
  '01-share-sheet': {q: '?name', run: share},
  '02-share-first-name': {q: '', run: partner},
  '03-share-link-copied': {q: '?name', run: partner},
  '04-share-coming-soon': {q: '?missing=session_shares', run: share},
  '05-menu-stop-sharing': {q: '?name', run: async p => { await partner(p); await p.click('#share-close'); await p.click('#nav-more'); await p.waitForSelector('#ses-unshare'); await p.waitForTimeout(300); }},
  '06-received': {q: '?share', h: `#s-${TOKEN}`, run: received},
  '07-received-added': {q: '?share', h: `#s-${TOKEN}`, run: async p => { await received(p); await p.click('#recv-add'); await p.waitForSelector('#view h1'); await p.waitForTimeout(500); }},
  '08-received-quota': {q: '?share=quota', h: `#s-${TOKEN}`, run: async p => { await received(p); await p.click('#recv-add'); await p.waitForSelector('#recv-err:not([hidden])'); await p.waitForTimeout(300); }},
  '09-link-cant-open-yet': {q: '?missing=session_shares', h: `#s-${TOKEN}`, run: received},
  '10-link-revoked': {q: '?share=gone', h: `#s-${TOKEN}`, run: received},
  '11-received-already-added': {q: '?share=done', h: `#s-${TOKEN}`, run: received},
};
const b = await webkit.launch(); const report = [];
for (const [name, s] of Object.entries(S)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  for (const scheme of ['light', 'dark']) {
    const c = await b.newContext({...devices['iPhone 14'], deviceScaleFactor: 1.5, colorScheme: scheme, reducedMotion: 'reduce'});
    await c.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'share', {value: undefined, configurable: true}); } catch {} });
    await c.route(/supabase\.co/, r => r.abort());
    const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + s.q + (s.h || '')); await s.run(p);
    const said = await p.evaluate(() => [...document.querySelectorAll('#share-toast:not([hidden]), #otw-said:not([hidden]), #r11-toast:not([hidden]), #recv-err:not([hidden]), #share-link, #recv-h')].map(e => e.textContent.trim()));
    await p.screenshot({path: join(OUT, `${name}-${scheme}.png`)});
    report.push({name, scheme, errs, said, hash: await p.evaluate(() => location.hash)});
    await c.close();
  }
}
await b.close(); console.log(JSON.stringify(report, null, 1));
