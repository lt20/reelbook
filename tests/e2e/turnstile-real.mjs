// L42b: Turnstile in the app against a REAL Supabase Auth (tests/e2e/turnstile-stack.sh) and Cloudflare's real script,
// with its public TEST site keys. Not run by the CI. Never the hosted project.
//   tests/e2e/turnstile-stack.sh up && eval "$(tests/e2e/turnstile-stack.sh env)" && node tests/e2e/turnstile-real.mjs on
//   tests/e2e/turnstile-stack.sh captcha off && node tests/e2e/turnstile-real.mjs off
// on: Auth asks for a token (secret that passes any test token); off: it does not. app/ is served here; its config.js is
// rewritten at the browser's door (hosted.url and anonKey on the stack, mailReady true, turnstileSiteKey per scene).
// WebKit, iPhone 14 (390 px). Service workers blocked, so every scene reads the files of this checkout.
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join, extname, normalize} from 'node:path';
import {readFileSync, existsSync, statSync} from 'node:fs'; import {createServer} from 'node:http'; import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const req = createRequire(import.meta.url);
const {webkit, devices} = req(process.env.REELBOOK_PLAYWRIGHT || join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const {RB_API_URL: API, RB_ANON_KEY: ANON, RB_SERVICE_ROLE_KEY: SERVICE, RB_INBUCKET_URL: MAIL} = process.env;
assert.ok(API && /^http:\/\/127\.0\.0\.1:/.test(API) && ANON && SERVICE && MAIL, 'eval "$(tests/e2e/turnstile-stack.sh env)" first (a local stack only)');
const mode = process.argv[2] || 'on';
const PASS = '1x00000000000000000000AA', CHALLENGE = '3x00000000000000000000FF'; // Cloudflare's public test site keys
const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const DB = process.env.RB_DB || 'supabase_db_rb-l42b';
execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-c', 'delete from public.beta_settings']); // a normal project

const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json'};
const server = createServer((rq, rs) => {
  const p = normalize(decodeURIComponent(new URL(rq.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  const f = join(APP, p);
  if (!f.startsWith(APP) || !existsSync(f) || statSync(f).isDirectory()) { rs.writeHead(404); rs.end(); return; }
  rs.writeHead(200, {'content-type': TYPES[extname(f)] || 'application/octet-stream'}); rs.end(readFileSync(f));
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const config = key => readFileSync(join(APP, 'config.js'), 'utf8')
  .replace(/url: 'https:\/\/[^']+'/, `url: '${API}'`).replace(/anonKey: '[^']+'/, `anonKey: '${ANON}'`)
  .replace('mailReady: false', 'mailReady: true').replace("turnstileSiteKey: ''", `turnstileSiteKey: '${key}'`);

const stamp = Date.now().toString(36), addr = n => `${n}-${mode}-${stamp}@example.test`;
const PW = 'first-password-1', PW2 = 'second-password-2';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mails = async to => (await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + to)}`)).json()).messages || [];
const codeOf = async (to, n = 1) => { for (let i = 0; i < 75; i++) { const m = await mails(to); if (m.length >= n) { const c = /\b(\d{6})\b/.exec(m[0].Subject); if (c) return c[1]; } await sleep(200); } throw new Error(`no mail #${n} for ${to}`); };
const confirmed = async a => {
  const r = await fetch(`${API}/auth/v1/admin/users`, {method: 'POST', headers: {apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json'}, body: JSON.stringify({email: a, password: PW, email_confirm: true})});
  assert.equal(r.status, 200); return a;
};

const browser = await webkit.launch();
const results = [];
const scene = async (name, key, fn, {blocked = false, width = 390} = {}) => {
  const ctx = await browser.newContext({...devices['iPhone 14'], viewport: {width, height: 844}, locale: 'en-US', serviceWorkers: 'block'});
  if (blocked) await ctx.route(/challenges\.cloudflare\.com/, r => r.abort()); // a content blocker
  await ctx.route(/supabase\.co/, r => r.abort()); // never the hosted project
  await ctx.route(/\/config\.js/, r => r.fulfill({contentType: 'text/javascript', body: config(key)}));
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  // what Auth received: did each guarded call carry a token?
  const sent = []; page.on('request', r => { const m = /\/auth\/v1\/(signup|token|resend|recover)/.exec(r.url()); if (m && r.method() === 'POST') sent.push([m[1], !!(JSON.parse(r.postData() || '{}').gotrue_meta_security || {}).captcha_token]); });
  try { await fn(page, sent); assert.deepEqual(errors, []); results.push(['ok', name]); console.log('ok  ', name, JSON.stringify(sent)); }
  catch (e) { results.push(['FAIL', name]); console.log('FAIL', name, String(e.message).split('\n').slice(0, 4).join(' ').slice(0, 300), JSON.stringify(sent), errors.slice(0, 2).join(' | ').slice(0, 300)); }
  await ctx.close();
};
const open = async p => { await p.goto(BASE + 'index.html'); await p.waitForSelector('#intro-signup, #auth-form'); };
const signUpForm = async p => { await open(p); await p.click('#intro-signup'); await p.waitForSelector('#a-email:visible'); };
const signInForm = async p => { await open(p); await p.click('#intro-signin'); await p.waitForSelector('#a-email:visible'); };
const fill = async (p, email, password) => { await p.fill('#a-email', email); await p.fill('#a-pass', password); await p.click('#a-submit'); };
const waitTitle = (p, text) => p.waitForFunction(t => { const e = document.getElementById('auth-title'); return e && e.textContent === t && !document.getElementById('auth').hidden; }, text, {timeout: 20000});
const inApp = p => p.waitForFunction(() => document.getElementById('auth').hidden && (!document.getElementById('home').hidden || !document.getElementById('welcome').hidden), null, {timeout: 20000});
const typeCode = async (p, code) => { await p.fill('#a-code', code); };
const widthOf = p => p.evaluate(() => ({iw: innerWidth, sw: document.documentElement.scrollWidth}));
const tokens = (sent, want) => assert.deepEqual(sent.map(s => s[1]), sent.map(() => want), 'captcha_token on every guarded call: ' + want);

// Every guarded call of the flow passes, with the token (key set) whatever the server does.
await scene('sign-up, code, in the app', PASS, async (p, sent) => {
  const a = addr('up'); await signUpForm(p); await fill(p, a, PW);
  await waitTitle(p, 'Enter your code'); await typeCode(p, await codeOf(a)); await inApp(p);
  assert.deepEqual(sent.map(s => s[0]), ['signup']); tokens(sent, true);
});
await scene('sign-in of an unconfirmed address: a new code (resend), then in', PASS, async (p, sent) => {
  const a = addr('un');
  const r = await fetch(`${API}/auth/v1/admin/users`, {method: 'POST', headers: {apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json'}, body: JSON.stringify({email: a, password: PW})});
  assert.equal(r.status, 200);
  await signInForm(p); await fill(p, a, PW);
  await waitTitle(p, 'Enter your code'); assert.match(await p.locator('#a-note').textContent(), /we just sent you a new code/);
  await typeCode(p, await codeOf(a)); await inApp(p);
  assert.deepEqual(sent.map(s => s[0]), ['token', 'resend']); tokens(sent, true);
});
await scene('sign-in of a confirmed account, a wrong password first (a fresh token each try)', PASS, async (p, sent) => {
  const a = await confirmed(addr('in')); await signInForm(p); await fill(p, a, 'wrong-password-9');
  await p.waitForSelector('#a-err:not([hidden])'); assert.equal(await p.locator('#a-err').textContent(), 'Wrong email or password.');
  await p.fill('#a-pass', PW); await p.click('#a-submit'); await inApp(p);
  assert.deepEqual(sent.map(s => s[0]), ['token', 'token']); tokens(sent, true);
});
await scene('forgot, code, new password, in the app', PASS, async (p, sent) => {
  const a = await confirmed(addr('fg')); await signInForm(p); await p.fill('#a-email', a);
  await p.click('#a-forgot'); await waitTitle(p, 'Forgot your password'); await p.click('#a-submit');
  await waitTitle(p, 'New password');
  await typeCode(p, await codeOf(a)); await p.fill('#a-pass', PW2); await p.click('#a-submit'); await inApp(p);
  assert.deepEqual(sent.map(s => s[0]), ['recover']); tokens(sent, true);
});
// Cloudflare's script blocked: the call goes without a token. Server off: in the app; server on: the Cloudflare message.
await scene(`Cloudflare blocked, server ${mode}: ${mode === 'off' ? 'sign-in still works' : 'the Cloudflare message, the button live'}`, PASS, async (p, sent) => {
  const a = await confirmed(addr('blk')); await signInForm(p); await fill(p, a, PW);
  if (mode === 'off') await inApp(p);
  else { await p.waitForSelector('#a-err:not([hidden])'); assert.match(await p.locator('#a-err').textContent(), /^The Cloudflare check didn’t go through\./); assert.equal(await p.locator('#a-submit').isDisabled(), false); }
  assert.deepEqual(sent, [['token', false]]);
}, {blocked: true});
if (mode === 'on') {
  // Control: the old client (no key) against a server that asks: refused, with the Cloudflare message, nothing lost.
  await scene('control: no site key, server on: refused with the Cloudflare message', '', async (p, sent) => {
    const a = await confirmed(addr('ctl')); await signInForm(p); await fill(p, a, PW);
    await p.waitForSelector('#a-err:not([hidden])');
    assert.match(await p.locator('#a-err').textContent(), /^The Cloudflare check didn’t go through\./);
    assert.equal(await p.locator('#a-submit').isDisabled(), false);
    assert.deepEqual(sent, [['token', false]]);
  });
  // Cloudflare's widget, visible (the key that forces an interaction), at 390 px: no horizontal scroll.
  for (const [screen, go, width] of [['signup', async p => { await signUpForm(p); await fill(p, addr('w1'), PW); }, 390],
    ['forgot', async p => { await signInForm(p); await p.fill('#a-email', addr('w2')); await p.click('#a-forgot'); await waitTitle(p, 'Forgot your password'); await p.click('#a-submit'); }, 390],
    ['signup', async p => { await signUpForm(p); await fill(p, addr('w3'), PW); }, 320]]) {
    await scene(`widget shown on ${screen} (interaction asked), ${width} px`, CHALLENGE, async p => {
      await go(p);
      await p.waitForFunction(() => document.getElementById('a-cf').classList.contains('on'), null, {timeout: 20000});
      // Cloudflare's iframe lives in a closed shadow root: its host, the slot's child, carries its size
      await p.waitForFunction(() => document.getElementById('a-cf').getBoundingClientRect().height > 40, null, {timeout: 20000});
      await sleep(1500);
      const box = await p.evaluate(() => { const f = document.querySelector('#a-cf > div').getBoundingClientRect(); return {left: f.left, right: f.right, w: f.width, h: f.height}; });
      const w = await widthOf(p); console.log('     ', screen, JSON.stringify({...w, widget: box}));
      assert.equal(w.iw, width); assert.equal(w.sw, width); assert.ok(box.right <= width && box.left >= 0);
      await p.screenshot({path: join(process.env.RB_SHOTS || '.', `l42b-${screen}-${width}-widget.png`)}).catch(() => {});
      // Ticking Cloudflare's box is not automated: WebKit's input protocol refuses a tap or click over its iframe here.
    }, {width});
  }
}
await browser.close(); server.close();
const bad = results.filter(r => r[0] !== 'ok');
console.log(`${results.length - bad.length}/${results.length} scenes (captcha ${mode})`);
process.exit(bad.length ? 1 : 0);
