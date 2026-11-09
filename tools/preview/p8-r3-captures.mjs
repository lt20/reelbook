// P8 R3: captures of failures by who can act on the fake backend (docs/audit-design/captures/p8/R3), WebKit
// iPhone 14, light and dark, reduced motion. The fixture's failed request (req-3) gets a requests.reason before the
// app reads it (a setter on window.__FAKE); the hosted retry state swaps the app's mode constant (OTW_MODE).
// Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8793.
// usage: node tools/preview/p8-r3-captures.mjs <shots dir> <port>
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT] = process.argv; mkdirSync(OUT, {recursive: true});
const BASE = `http://127.0.0.1:${PORT}/index.html`;
// req-3 of tools/preview/make-fixtures.py, failed with this reason (an Instagram reel in the Strength notebook)
const withReason = (reason, note) => `(() => { let f; Object.defineProperty(window, '__FAKE', {configurable: true, get: () => f, set: v => {
  f = v; const r = (f.requests || []).find(x => x.id === 'req-3');
  if (r) Object.assign(r, {url: 'https://www.instagram.com/reel/PREVIEW0103/', theme: 'strength', status: 'error', reason: ${JSON.stringify(reason)}, note: ${JSON.stringify(note)}});
  (f.requests || []).forEach(x => { if (!('reason' in x)) x.reason = null; }); }}); })();`;
const otw = async p => { await p.waitForSelector('#otw-band:not([hidden])'); await p.waitForTimeout(400); await p.click('#otw-band'); await p.waitForSelector('#otw-dlg[open] #queue .q'); await p.waitForTimeout(400); };
const row = async p => { await otw(p); await p.click('#queue [data-row="req-3"]'); await p.waitForSelector('#otw-row:not([hidden])'); await p.waitForTimeout(300); };
const S = {
  '01-fix-signin': {init: withReason('signin_required', 'Instagram showed a login wall in Chrome.'), run: row},
  '02-private-video': {init: withReason('private', 'The account is private.'), run: row},
  '03-hosted-retrying': {init: withReason('fetch_blocked', 'Instagram refused the fetch.'), hosted: true, run: otw},
  '04-needs-you-list': {init: withReason('signin_required', 'Instagram showed a login wall in Chrome.'), run: otw},
};
const b = await webkit.launch(); const report = [];
for (const [name, s] of Object.entries(S)) for (const scheme of ['light', 'dark']) {
  const c = await b.newContext({...devices['iPhone 14'], deviceScaleFactor: 1.5, colorScheme: scheme, reducedMotion: 'reduce'});
  await c.route(/supabase\.co/, r => r.abort());
  if (s.hosted) await c.route(/\/index\.html$/, async r => {
    const res = await r.fetch(), body = (await res.text()).replace("const OTW_MODE = 'computer'", "const OTW_MODE = 'hosted'");
    await r.fulfill({response: res, body});
  });
  await c.addInitScript(s.init);
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE); await s.run(p);
  await p.screenshot({path: join(OUT, `${name}-${scheme}.png`)});
  report.push({name, scheme, errs});
  await c.close();
}
await b.close(); console.log(JSON.stringify(report));
