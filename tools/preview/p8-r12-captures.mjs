// P8 R12: captures of a share link opened with no account (#gate), the sign-up that keeps it, the first home after the
// copy, and « Invites left » (docs/audit-design/captures/p8/R12), WebKit iPhone 14, light and dark, reduced motion.
// Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8802.
// usage: node tools/preview/p8-r12-captures.mjs <shots dir> <port> [name…]
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT, ...ONLY] = process.argv; mkdirSync(OUT, {recursive: true});
const BASE = `http://127.0.0.1:${PORT}/index.html`, H = '#s-PREVIEWshareToken00001';
const gate = async p => { await p.waitForSelector('#gate:not([hidden]) #gate-body :is(h1, .gate-err)'); await p.waitForTimeout(400); };
const signup = async p => { await gate(p); await p.click('#gate-create'); await p.waitForSelector('#auth:not([hidden]) #a-share:not([hidden])'); await p.waitForTimeout(300); };
const S = {
  '01-gate-invite': {q: '?noauth&share&seats=50&invites=2', h: H, run: gate},
  '02-gate-seats-open': {q: '?noauth&share&seats=12', h: H, run: gate},
  '03-gate-full-invites-used': {q: '?noauth&share&seats=50&invites=0', h: H, run: gate},
  '04-gate-waitlist-joined': {q: '?noauth&share&seats=50&invites=0', h: H, run: async p => {
    await gate(p); await p.fill('#g-wl-first', 'Sam'); await p.fill('#g-wl-email', 'sam@example.test'); await p.check('#g-wl-consent');
    await p.click('#g-wl-go'); await p.waitForSelector('#g-wl-done:not([hidden])'); await p.waitForTimeout(300); }},
  '05-gate-link-gone': {q: '?noauth&share=gone', h: H, run: gate},
  '06-signup-with-invite': {q: '?noauth&share&seats=50&invites=2', h: H, run: signup},
  '07-code-keeps-the-session': {q: '?noauth&share&seats=50&invites=2', h: H, run: async p => {
    await signup(p); await p.fill('#a-email', 'sam@example.test'); await p.fill('#a-pass', 'example-password'); await p.click('#a-submit');
    await p.waitForSelector('#a-code-row:not([hidden])'); await p.waitForTimeout(300); }},
  '08-session-opened': {q: '?noauth&share&empty=all&confirm=off', h: H, run: async p => {
    await signup(p); await p.fill('#a-email', 'sam@example.test'); await p.fill('#a-pass', 'example-password'); await p.click('#a-submit');
    await p.waitForFunction(() => /^#session\//.test(location.hash)); await p.waitForSelector('#view h1'); await p.waitForTimeout(500); }},
  '09-first-home-get-started': {q: '?noauth&share&empty=all&confirm=off', h: H, run: async p => {
    await signup(p); await p.fill('#a-email', 'sam@example.test'); await p.fill('#a-pass', 'example-password'); await p.click('#a-submit');
    await p.waitForFunction(() => /^#session\//.test(location.hash)); await p.waitForSelector('#view h1');
    await p.evaluate(() => { location.hash = ''; }); await p.waitForSelector('#first-steps:not([hidden])'); await p.waitForTimeout(500); }},
  '10-settings-invites-left': {q: '?invites=2', h: '#settings', run: async p => {
    await p.waitForSelector('#s-invites:not([hidden])'); await p.evaluate(() => document.getElementById('s-reelbook').scrollIntoView({block: 'start'})); await p.waitForTimeout(300); }},
};
const b = await webkit.launch(); const report = [];
for (const [name, s] of Object.entries(S)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  for (const scheme of ['light', 'dark']) {
    const c = await b.newContext({...devices['iPhone 14'], deviceScaleFactor: 1.5, colorScheme: scheme, reducedMotion: 'reduce'});
    await c.route(/supabase\.co/, r => r.abort());
    const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    let ok = true;
    try { await p.goto(BASE + s.q + (s.h || '')); await s.run(p); } catch (e) { ok = false; errs.push(String(e).slice(0, 200)); }
    const said = await p.evaluate(() => [...document.querySelectorAll('#gate-body h1, #gate-full-h, #a-share:not([hidden]), #a-share-m:not([hidden]), #r11-toast:not([hidden]), #first-h, #s-invites-n')].map(e => e.textContent.trim()));
    await p.screenshot({path: join(OUT, `${name}-${scheme}.png`)});
    report.push({name, scheme, ok, errs, said, hash: await p.evaluate(() => location.hash)});
    await c.close();
  }
}
await b.close(); console.log(JSON.stringify(report, null, 1));
