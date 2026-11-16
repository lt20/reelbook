// P12: captures of one sheet sent to a training partner on the fake backend (docs/audit-design/captures/p12), WebKit
// iPhone 14, light and dark, reduced motion: the sheet's ⋯ (Share first), its Share sheet, the row on a backend before
// P12, « Laurent sent you a sheet » signed in (to add, and already had), the signed-out page of the link.
// Synthetic fixtures only. Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8821.
// usage: node tools/preview/p12-captures.mjs <shots dir> <port> [name…]
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT, ...ONLY] = process.argv; mkdirSync(OUT, {recursive: true});
const BASE = `http://127.0.0.1:${PORT}/index.html`, TOKEN = 'PREVIEWsheetToken00001';
const sheet = async p => { await p.waitForSelector('#view h1'); await p.waitForTimeout(500); };
const menu = async p => { await sheet(p); await p.click('#nav-more'); await p.waitForSelector('#nav-actions #nav-share'); await p.waitForTimeout(500); };
const share = async p => { await menu(p); await p.click('#nav-share'); await p.waitForSelector('#share-dlg[open] #share-form'); await p.waitForFunction(() => !/Checking/.test(document.querySelector('#share-why').textContent)); await p.waitForTimeout(400); };
const received = async p => { await p.waitForSelector('#recv-dlg[open] #recv-h'); await p.waitForFunction(() => !/Opening/.test(document.querySelector('#recv-h').textContent)); await p.waitForTimeout(400); };
const gate = async p => { await p.waitForSelector('#gate-body .gate-card'); await p.waitForTimeout(400); };
const S = {
  '01-sheet-menu-share-first': {q: '?name', h: '#jab-cross', run: menu},
  '02-sheet-share-sheet': {q: '?name', h: '#jab-cross', run: share},
  '03-sheet-share-coming-soon': {q: '?missing=session_shares.sheet_slug', h: '#jab-cross', run: menu},
  '04-received-sheet': {q: '?share', h: `#s-${TOKEN}`, run: received},
  '05-received-sheet-added': {q: '?share', h: `#s-${TOKEN}`, run: async p => { await received(p); await p.click('#recv-add'); await p.waitForSelector('#view h1'); await p.waitForTimeout(500); }},
  '06-received-sheet-already-have': {q: '?share=have', h: `#s-${TOKEN}`, run: received},
  '07-gate-sheet': {q: '?noauth&share&invites=2', h: `#s-${TOKEN}`, run: gate},
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
    const said = await p.evaluate(() => [...document.querySelectorAll('#r11-toast:not([hidden]), #recv-err:not([hidden]), #recv-h, #share-h, #share-why, #nav-share, #gate-body .recv-over')].map(e => e.textContent.trim()));
    await p.screenshot({path: join(OUT, `${name}-${scheme}.png`)});
    report.push({name, scheme, errs, said, hash: await p.evaluate(() => location.hash)});
    await c.close();
  }
}
await b.close(); console.log(JSON.stringify(report, null, 1));
