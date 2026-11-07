// L41: the auth screens against a REAL Supabase Auth, on a local stack (never the hosted project). Not run by the CI.
//   RB_BASE=http://127.0.0.1:8841/ RB_API=http://127.0.0.1:54721 RB_MAIL=http://127.0.0.1:54724 RB_ANON=<anon key> \
//   RB_DB=supabase_db_<project> [RB_SERVICE=<service key>] node tests/e2e/auth-real.mjs [confirm-on|confirm-off]
// RB_BASE serves a copy of app/ whose config.js points hosted.url and anonKey at the local stack. The hosted address is
// blocked at the browser's door. Codes come from the stack's mail server; subject or body must carry {{ .Token }}.
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const req = createRequire(import.meta.url);
const {webkit} = req(process.env.REELBOOK_PLAYWRIGHT || join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const {RB_BASE: BASE, RB_API: API, RB_MAIL: MAIL, RB_ANON: ANON, RB_DB: DB, RB_SERVICE: SERVICE} = process.env;
const mode = process.argv[2] || 'confirm-on';
const stamp = Date.now().toString(36), addr = n => `${n}-${stamp}@example.test`;
const P1 = 'first-password-1', P2 = 'second-password-2', P3 = 'third-password-3';
const psql = sql => execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-At', '-c', sql], {encoding: 'utf8'}).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mails = async to => (await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + to)}`)).json()).messages || [];
const codeOf = async (to, n = 1) => { for (let i = 0; i < 50; i++) { const m = await mails(to); if (m.length >= n) { const c = /\b(\d{6,10})\b/.exec(m[0].Subject); if (c) return c[1]; } await sleep(200); } throw new Error('no mail for ' + to); };
const canSignIn = async (email, password) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {method: 'POST', headers: {apikey: ANON, 'content-type': 'application/json'}, body: JSON.stringify({email, password})});
  return r.status === 200 ? 'ok' : (await r.json()).error_code || String(r.status);
};
const browser = await webkit.launch();
const results = [];
const scene = async (name, fn) => {
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}, locale: 'en-US'});
  await ctx.route(/supabase\.co/, r => r.abort()); // never the hosted project
  const page = await ctx.newPage();
  // WebKit reports a request cut by a navigation (a reload, here on purpose) as an access control error.
  const errors = []; page.on('pageerror', e => { if (!/access control checks/.test(String(e))) errors.push(String(e)); });
  psql('delete from public.beta_settings'); // a scene that stopped half-way leaves the next ones a normal project
  try { await fn(page, ctx); assert.deepEqual(errors, []); results.push(['ok', name]); console.log('ok  ', name); }
  catch (e) { results.push(['FAIL', name]); console.log('FAIL', name, String(e.message).split('\n').slice(0, 3).join(' ').slice(0, 200), errors.slice(0, 2).join(' | ').slice(0, 300), await page.evaluate(() => JSON.stringify({hash: location.hash, err: (document.getElementById('load-error') || {}).textContent, vis: ['auth', 'home', 'welcome', 'setup'].filter(i => !document.getElementById(i).hidden)})).catch(() => '')); }
  await ctx.close();
};
const title = p => p.locator('#auth-title').textContent();
const open = async p => { await p.goto(BASE + 'index.html'); await p.waitForSelector('#intro-signup, #auth-form'); };
const signUpForm = async p => { await open(p); await p.click('#intro-signup'); await p.waitForSelector('#a-email:visible'); };
const signInForm = async p => { await open(p); await p.click('#intro-signin'); await p.waitForSelector('#a-email:visible'); };
const fill = async (p, email, password) => { await p.fill('#a-email', email); await p.fill('#a-pass', password); await p.click('#a-submit'); };
const waitTitle = (p, text) => p.waitForFunction(t => { const e = document.getElementById('auth-title'); return e && e.textContent === t && !document.getElementById('auth').hidden; }, text, {timeout: 8000});
const inApp = p => p.waitForFunction(() => document.getElementById('auth').hidden && (!document.getElementById('home').hidden || !document.getElementById('welcome').hidden), null, {timeout: 8000});
const errIs = async (p, text) => { await p.waitForSelector('#a-err:not([hidden])'); assert.equal(await p.locator('#a-err').textContent(), text); };

if (mode === 'confirm-on') {
  await scene('signup → code (6 digits go alone) → the app; the password is the one typed', async p => {
    const a = addr('a'); await signUpForm(p); await fill(p, a, P1); await waitTitle(p, 'Enter your code');
    const ls = await p.evaluate(() => JSON.stringify(localStorage)); assert.ok(!ls.includes(P1), 'password never stored'); assert.ok(ls.includes('rb.pending'));
    await p.fill('#a-code', await codeOf(a)); await inApp(p);
    assert.equal(await p.evaluate(() => localStorage.getItem('rb.pending')), null);
    assert.equal(await canSignIn(a, P1), 'ok');
  });
  await scene('first arrival after the code lands on #welcome (user.created_at is fresh, the L43 banner reads it)', async p => {
    const a = addr('w'); await signUpForm(p); await fill(p, a, P1); await waitTitle(p, 'Enter your code');
    await p.fill('#a-code', await codeOf(a));
    await p.waitForFunction(() => location.hash === '#welcome' && !document.getElementById('welcome').hidden, null, {timeout: 8000});
  });
  await scene('reload on the code screen: its banner; after the code, set-password; the new password wins', async p => {
    const a = addr('r'); await signUpForm(p); await fill(p, a, P1); await waitTitle(p, 'Enter your code');
    const code = await codeOf(a);
    await p.reload(); await waitTitle(p, 'Enter your code');
    assert.match(await p.locator('#a-note').textContent(), /Picking up where you left off/);
    await p.fill('#a-code', code); await waitTitle(p, 'Choose your password');
    await p.reload(); await waitTitle(p, 'Choose your password'); // a reload here keeps asking
    await p.fill('#a-pass', 'short'); await p.click('#a-submit'); await errIs(p, 'The password needs at least 8 characters.');
    await p.fill('#a-pass', P2); await p.click('#a-submit'); await inApp(p);
    assert.equal(await canSignIn(a, P2), 'ok'); assert.equal(await canSignIn(a, P1), 'invalid_credentials');
  });
  await scene('change address, same address, another password, within the minute: the countdown, and the last password wins', async p => {
    const a = addr('c'); await signUpForm(p); await fill(p, a, P1); await waitTitle(p, 'Enter your code');
    await p.click('#a-change'); await waitTitle(p, 'Create your account'); assert.equal(await p.inputValue('#a-email'), a);
    await fill(p, a, P2); await waitTitle(p, 'Enter your code');
    await errIs(p, 'The last code just left: wait for the countdown before asking for another.');
    assert.match(await p.locator('#a-help').textContent(), /resend the code in \d+ s/);
    await p.fill('#a-code', await codeOf(a)); await inApp(p);
    assert.equal(await canSignIn(a, P2), 'ok'); assert.equal(await canSignIn(a, P1), 'invalid_credentials');
  });
  await scene('a confirmed address: exists; its links carry the address', async p => {
    const a = addr('e'); await signUpForm(p); await fill(p, a, P1); await waitTitle(p, 'Enter your code');
    await p.fill('#a-code', await codeOf(a)); await inApp(p);
    await p.context().clearCookies(); await p.evaluate(() => localStorage.clear()); await signUpForm(p);
    await fill(p, a, P2); await waitTitle(p, 'This address already has an account');
    assert.match(await p.locator('#a-lead').textContent(), new RegExp(a.replace(/[.]/g, '\\.')));
    await p.click('#a-forgot'); await waitTitle(p, 'Forgot your password'); assert.equal(await p.inputValue('#a-email'), a);
    assert.equal(await canSignIn(a, P2), 'invalid_credentials');
  });
  await scene('sign-in on a never-confirmed address: wrong password says so; right one: a new code; « change address » returns to sign-in; the code enters', async p => {
    const a = addr('n'); await signUpForm(p); await fill(p, a, P1); await waitTitle(p, 'Enter your code');
    await p.evaluate(() => localStorage.clear());
    psql(`update auth.users set confirmation_sent_at = now() - interval '2 minutes' where email = '${a}'`);
    await signInForm(p); await fill(p, a, P2); await errIs(p, 'Wrong email or password.');
    await fill(p, a, P1); await waitTitle(p, 'Enter your code');
    assert.match(await p.locator('#a-note').textContent(), /sign-up isn’t finished/);
    await p.click('#a-change'); await waitTitle(p, 'Sign in'); assert.equal(await p.inputValue('#a-email'), a);
    await fill(p, a, P1); await waitTitle(p, 'Enter your code'); // again within the minute: the countdown, no banner
    await errIs(p, 'The last code just left: wait for the countdown before asking for another.');
    await p.fill('#a-code', await codeOf(a, 2)); await inApp(p);
    assert.equal(await canSignIn(a, P1), 'ok');
  });
  await scene('wrong code, then the resend link (after the minute): new code, banner, only the latest works', async p => {
    const a = addr('x'); await signUpForm(p); await fill(p, a, P1); await waitTitle(p, 'Enter your code');
    const first = await codeOf(a);
    const wrong = first === '000000' ? '000001' : '000000';
    await p.fill('#a-code', wrong); await errIs(p, 'That code isn’t right. Check the 6 digits of the latest email.');
    psql(`update auth.users set confirmation_sent_at = now() - interval '2 minutes' where email = '${a}'`);
    await p.evaluate(() => { const v = JSON.parse(localStorage.getItem('rb.pending')); v.at -= 120000; localStorage.setItem('rb.pending', JSON.stringify(v)); });
    await p.reload(); await waitTitle(p, 'Enter your code');
    await p.click('#a-help a[data-au="resend"]');
    await p.waitForFunction(() => /Only the latest one works/.test(document.getElementById('a-note').textContent));
    assert.match(await p.locator('#a-help').textContent(), /Still nothing\?/);
    const second = await codeOf(a, 2); assert.notEqual(first, second);
    await p.fill('#a-code', first); await errIs(p, 'That code isn’t right. Check the 6 digits of the latest email.');
    await p.fill('#a-code', second); await waitTitle(p, 'Choose your password'); // the reload lost the password
  });
  await scene('an expired code: the same answer, told by the date of the last send; its button asks for a new one', async p => {
    const a = addr('o'); await signUpForm(p); await fill(p, a, P1); await waitTitle(p, 'Enter your code');
    const code = await codeOf(a);
    psql(`update auth.users set confirmation_sent_at = now() - interval '2 hours' where email = '${a}'`);
    await p.evaluate(() => { const v = JSON.parse(localStorage.getItem('rb.pending')); v.at = Date.now() - 3599000; localStorage.setItem('rb.pending', JSON.stringify(v)); });
    await p.reload(); await waitTitle(p, 'Enter your code'); await sleep(1100);
    await p.fill('#a-code', code); await errIs(p, 'This code has expired. Ask for a new one: it will reach the same address.');
    assert.equal(await p.locator('#a-submit').textContent(), 'Get a new code');
    await p.click('#a-submit'); await p.waitForFunction(() => document.getElementById('a-submit').textContent === 'Confirm');
    await p.fill('#a-code', await codeOf(a, 2)); await waitTitle(p, 'Choose your password');
  });
  await scene('forgot → reset: a wrong code, then the code and a new one: home with the flash; the old password is dead', async p => {
    const a = addr('f'); await signUpForm(p); await fill(p, a, P1); await waitTitle(p, 'Enter your code');
    await p.fill('#a-code', await codeOf(a)); await inApp(p);
    await p.evaluate(() => localStorage.clear()); await signInForm(p); await p.fill('#a-email', a); await p.click('#a-forgot');
    await waitTitle(p, 'Forgot your password'); await p.click('#a-submit'); await waitTitle(p, 'New password');
    assert.match(await p.locator('#a-sent').textContent(), /if an account uses it/);
    await p.fill('#a-code', '000000'); await p.fill('#a-pass', P3); await p.click('#a-submit'); await errIs(p, 'That code isn’t right. Check the 6 digits of the latest email.');
    await p.fill('#a-code', await codeOf(a, 2)); await p.click('#a-submit');
    await inApp(p); assert.match(await p.locator('#flash').textContent(), /Password changed for/); // this empty account then goes on to #welcome
    assert.equal(await canSignIn(a, P3), 'ok'); assert.equal(await canSignIn(a, P1), 'invalid_credentials');
  });
  await scene('forgot with the same password: no error on the screen', async p => {
    const a = addr('g'); await signUpForm(p); await fill(p, a, P1); await waitTitle(p, 'Enter your code');
    await p.fill('#a-code', await codeOf(a)); await inApp(p);
    await p.evaluate(() => localStorage.clear()); await signInForm(p); await p.fill('#a-email', a); await p.click('#a-forgot');
    await waitTitle(p, 'Forgot your password'); await p.click('#a-submit'); await waitTitle(p, 'New password');
    await p.fill('#a-code', await codeOf(a, 2)); await p.fill('#a-pass', P1); await p.click('#a-submit');
    await inApp(p); assert.equal(await p.evaluate(() => document.getElementById('a-err').hidden), true); assert.equal(await canSignIn(a, P1), 'ok');
  });
  await scene('another tab: the session arriving there leaves the code screen here', async (p, ctx) => {
    const a = addr('t'); await signUpForm(p); await fill(p, a, P1); await waitTitle(p, 'Enter your code');
    const code = await codeOf(a);
    const q = await ctx.newPage(); await q.goto(BASE + 'index.html'); await waitTitle(q, 'Enter your code');
    await q.fill('#a-code', code); await waitTitle(q, 'Choose your password');
    await waitTitle(p, 'Choose your password'); // the first tab keeps its older password to itself
    await q.fill('#a-pass', P2); await q.click('#a-submit'); await inApp(q);
    await inApp(p);
    assert.equal(await canSignIn(a, P2), 'ok'); assert.equal(await canSignIn(a, P1), 'invalid_credentials');
    await q.close();
  });
  if (SERVICE) { // an own backend's default email carries a link: asked from Auth itself (site_url and redirect urls: RB_BASE)
    const linkFor = async (type, email, password) => { const r = await fetch(`${API}/auth/v1/admin/generate_link`, {method: 'POST', headers: {apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json'}, body: JSON.stringify({type, email, password, redirect_to: BASE + 'index.html'})}); const j = await r.json(); assert.ok(j.action_link, JSON.stringify(j).slice(0, 200)); return j.action_link; };
    await scene('the link of an email, opened in another tab: both tabs ask the password, saved once', async (p, ctx) => {
      const a = addr('l'); await signUpForm(p); await fill(p, a, P1); await waitTitle(p, 'Enter your code');
      const link = await linkFor('signup', a, P1);
      const q = await ctx.newPage(); await q.goto(link); await waitTitle(q, 'Choose your password'); await waitTitle(p, 'Choose your password');
      await q.fill('#a-pass', P2); await q.click('#a-submit'); await inApp(q); await inApp(p);
      assert.equal(await p.evaluate(() => localStorage.getItem('rb.pending')), null); assert.equal(await canSignIn(a, P2), 'ok'); await q.close();
    });
    await scene('a recovery link (real PASSWORD_RECOVERY): the new password first, not the app; a reload keeps asking', async p => {
      const a = addr('k'); await signUpForm(p); await fill(p, a, P1); await waitTitle(p, 'Enter your code');
      await p.fill('#a-code', await codeOf(a)); await inApp(p);
      await p.evaluate(() => localStorage.clear());
      await p.goto(await linkFor('recovery', a)); await waitTitle(p, 'New password');
      assert.equal(await p.locator('#a-code-row').isVisible(), false);
      await p.reload(); await waitTitle(p, 'New password');
      await p.fill('#a-pass', P3); await p.click('#a-submit'); await inApp(p);
      assert.equal(await canSignIn(a, P3), 'ok'); assert.equal(await canSignIn(a, P1), 'invalid_credentials');
    });
  }
  await scene('beta full during the sign-up (a real refusal, HTTP 500): the waiting list, its banner, the address', async p => {
    await signUpForm(p);
    const a = addr('b');
    psql(`insert into public.beta_settings (seats_total, seats_offset, signups_per_day) values (100000, 0, 100000) on conflict (id) do update set seats_total = 100000, signups_per_day = 100000, signups_open = true`);
    await p.reload(); await p.waitForSelector('#intro-signup'); await p.click('#intro-signup'); await p.waitForSelector('#a-email:visible');
    psql(`update public.beta_settings set seats_total = 1, seats_offset = 1`);
    let reads = 0; await p.route(/rpc\/beta_seats/, r => (++reads === 1 ? r.fulfill({json: {open: true, taken: 0, total: 50, today_left: 5}}) : r.continue()));
    await fill(p, a, P1);
    await p.waitForSelector('#s-note:not([hidden])');
    assert.match(await p.locator('#s-note').textContent(), /last seat was taken/);
    assert.equal(await p.inputValue('#s-wl-email'), a);
    psql(`delete from public.beta_settings`);
  });
} else {
  await scene('confirmation off: signUp gives a session, the app at once, on #welcome; no code, no pending', async p => {
    const a = addr('z'); await signUpForm(p); await fill(p, a, P1); await inApp(p);
    assert.equal(await p.evaluate(() => localStorage.getItem('rb.pending')), null);
    await p.waitForFunction(() => location.hash === '#welcome' && !document.getElementById('welcome').hidden, null, {timeout: 8000});
    assert.equal(await canSignIn(a, P1), 'ok');
  });
  await scene('confirmation off: an existing address: exists, not an error line', async p => {
    const a = addr('y'); await signUpForm(p); await fill(p, a, P1); await inApp(p);
    await p.evaluate(() => localStorage.clear()); await signUpForm(p); await fill(p, a, P2);
    await waitTitle(p, 'This address already has an account');
  });
  await scene('confirmation off: sign-in, then forgot by code', async p => {
    const a = addr('v'); await signUpForm(p); await fill(p, a, P1); await inApp(p);
    await p.evaluate(() => localStorage.clear()); await signInForm(p); await fill(p, a, P1); await inApp(p);
    await p.evaluate(() => localStorage.clear()); await signInForm(p); await p.fill('#a-email', a); await p.click('#a-forgot');
    await waitTitle(p, 'Forgot your password'); await p.click('#a-submit'); await waitTitle(p, 'New password');
    await p.fill('#a-code', await codeOf(a)); await p.fill('#a-pass', P3); await p.click('#a-submit');
    await inApp(p); assert.equal(await canSignIn(a, P3), 'ok');
  });
}
await browser.close();
const fails = results.filter(r => r[0] !== 'ok').length;
console.log(`${results.length - fails}/${results.length} scenes`);
process.exit(fails ? 1 : 0);
