// L41 (P7-signup.md, « Order of deployment »): an installed PWA, its service worker holding the previous version, moves
// to the new client when the new one is published. Nothing here touches the hosted project: both copies must have their
// config.js pointed at a local stack, and the hosted address is blocked at the browser's door. Not run by the CI.
//   node tests/e2e/pwa-update.mjs <folder of the old app/> <folder of the new app/> <port>
import {createServer} from 'node:http'; import {readFile} from 'node:fs/promises'; import {join, extname} from 'node:path';
import {createRequire} from 'node:module'; import {homedir} from 'node:os';
const {chromium} = createRequire(import.meta.url)(process.env.REELBOOK_PLAYWRIGHT || join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [, , OLD, NEW, PORT] = process.argv;
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.jpg': 'image/jpeg', '.webp': 'image/webp'};
let root = OLD;
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try { const body = await readFile(join(root, path === '/' ? 'index.html' : path)); res.writeHead(200, {'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'max-age=600'}); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(Number(PORT), '127.0.0.1');
const browser = await chromium.launch();
const ctx = await browser.newContext({viewport: {width: 390, height: 844}});
await ctx.route(/supabase\.co/, r => r.abort());
const page = await ctx.newPage();
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const state = async () => ({
  newClient: await page.evaluate(() => !!document.getElementById('a-code')),
  controller: await page.evaluate(() => { const c = navigator.serviceWorker.controller; return c ? c.state : 'none'; }),
  caches: await page.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('rb-shell'))),
  configV: await page.evaluate(() => [...document.scripts].map(s => s.getAttribute('src') || '').filter(s => /config\.js|landing\.js/.test(s)))
});
const start = async n => { await page.goto(BASE); await page.waitForSelector('#intro-signup, #auth-form', {state: 'attached'}); await page.waitForTimeout(1500); const s = await state(); console.log(`start ${n}:`, JSON.stringify(s)); return s; };
// the versions the new index.html asks for (config.js and landing.js), not numbers written here
const want = (await readFile(join(NEW, 'index.html'), 'utf8')).match(/(?:config|landing)\.js\?v=\d+/g);
let exit = 0;
await start('1 (old published)');
const installed = await start('2 (old, worker in control)');
if (installed.newClient || installed.controller === 'none') { console.log('FAIL: the old version is not installed'); exit = 1; }
root = NEW; console.log('--- the new version is published');
let n = 3, done = false;
for (; n <= 6 && !done; n++) { const s = await start(n); done = s.newClient; if (done) { const v = s.configV.join(' '); if (!want.every(w => v.includes(w))) { console.log('FAIL: new page with old modules', v); exit = 1; } } }
console.log(done ? `the new client shows at start ${n - 1}, ${n - 3} start(s) after the publication` : 'FAIL: never moved to the new client');
if (!done) exit = 1;
const after = await state();
if (after.caches.length !== 1) { console.log('FAIL: caches left', after.caches); exit = 1; }
await browser.close(); server.close();
process.exit(exit);
