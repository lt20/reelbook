// L42a: cli-login and `rb.py login` against a REAL Supabase Auth with Turnstile on, on the local stack of
// tests/e2e/cli-login-stack.sh (never the hosted project: the script refuses any URL that is not 127.0.0.1). Not run by CI.
//   tests/e2e/cli-login-stack.sh up
//   node tests/e2e/cli-login-real.mjs [captcha|relay|rb|addlink|abuse|all]     # default all
//   tests/e2e/cli-login-stack.sh down
// Prints one line per check (ok / FAIL) and the measured figures; exit 1 on any FAIL.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// The stack's URL and keys: from `cli-login-stack.sh env` (same RB_L42_DIR), unless already in the environment.
if (!process.env.RB_API_URL) {
  const out = execFileSync(fileURLToPath(new URL('./cli-login-stack.sh', import.meta.url)), ['env'], {encoding: 'utf8'});
  for (const m of out.matchAll(/^export (RB_[A-Z_]+)="?([^"\n]*)"?$/gm)) process.env[m[1]] = m[2];
}
const {RB_API_URL: API, RB_ANON_KEY: ANON, RB_SERVICE_ROLE_KEY: SERVICE, RB_PUBLISHABLE_KEY: PUB, RB_SECRET_KEY: SECRET} = process.env;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(API || '')) { console.error('RB_API_URL must be the local stack (tests/e2e/cli-login-stack.sh up)'); process.exit(2); }
const DB = 'supabase_db_rb-l42a';
const FN = `${API}/functions/v1/cli-login`;
const RB = fileURLToPath(new URL('../../tools/rb.py', import.meta.url));
const stamp = Date.now().toString(36), addr = n => `${n}-${stamp}@example.test`;
const PW = 'right-password-1';
const psql = sql => execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-At', '-c', sql], {encoding: 'utf8'}).trim();
const fails = [];
const check = async (name, fn) => {
  try { await fn(); console.log('ok  ', name); } catch (e) { fails.push(name); console.log('FAIL', name, String(e.message).split('\n').slice(0, 4).join(' ').slice(0, 300)); }
};
const post = async (url, headers, body, raw = false) => {
  const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: raw ? body : JSON.stringify(body)});
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return {status: r.status, json, text};
};
const grant = (headers, email, password, extra = {}) => post(`${API}/auth/v1/token?grant_type=password`, headers, {email, password, ...extra});
const codeOf = r => r.json && (r.json.error_code || r.json.error);
const makeUser = async email => {
  const r = await post(`${API}/auth/v1/admin/users`, {apikey: SERVICE, authorization: `Bearer ${SERVICE}`}, {email, password: PW, email_confirm: true});
  assert.equal(r.status, 200, r.text); return r.json.id;
};
const relay = (email, password, headers = {}) => post(FN, {apikey: PUB || ANON, ...headers}, {email, password});
const resetLimits = () => psql('delete from public.cli_login_limits');

async function captcha() {
  const a = addr('captcha'); await makeUser(a);
  const env = execFileSync('docker', ['exec', 'supabase_auth_rb-l42a', 'printenv', 'GOTRUE_SECURITY_CAPTCHA_ENABLED', 'GOTRUE_SECURITY_CAPTCHA_PROVIDER'], {encoding: 'utf8'}).split('\n');
  await check(`stack: captcha on, provider ${env[1]}`, () => assert.deepEqual(env.slice(0, 2), ['true', 'turnstile']));
  const cases = [
    ['anon key, no token', {apikey: ANON}, {}],
    ['anon key, Cloudflare dummy token (secret that always fails)', {apikey: ANON}, {gotrue_meta_security: {captcha_token: 'XXXX.DUMMY.TOKEN.XXXX'}}],
    ['publishable key, no token', {apikey: PUB}, {}],
    ['anon key + Bearer anon JWT', {apikey: ANON, authorization: `Bearer ${ANON}`}, {}],
  ];
  for (const [name, h, extra] of cases) {
    const r = await grant(h, a, PW, extra);
    console.log(`     direct grant, ${name}: ${r.status} ${codeOf(r)}`);
    await check(`direct password grant refused: ${name}`, () => { assert.equal(r.status, 400); assert.equal(codeOf(r), 'captcha_failed'); });
  }
  const admin = [
    ['apikey + Bearer service_role JWT', {apikey: SERVICE, authorization: `Bearer ${SERVICE}`}],
    ['anon apikey + Bearer service_role JWT', {apikey: ANON, authorization: `Bearer ${SERVICE}`}],
  ];
  for (const [name, h] of admin) {
    const r = await grant(h, a, PW);
    console.log(`     admin grant, ${name}: ${r.status} ${codeOf(r) || 'session'}`);
    await check(`admin role skips the captcha: ${name}`, () => { assert.equal(r.status, 200, r.text); assert.ok(r.json.access_token && r.json.refresh_token); });
  }
  for (const [name, h] of [['sb_secret apikey only', {apikey: SECRET}], ['sb_secret apikey + Bearer sb_secret', {apikey: SECRET, authorization: `Bearer ${SECRET}`}]]) {
    const r = await grant(h, a, PW);
    console.log(`     measured (no assertion), ${name}: ${r.status} ${codeOf(r) || 'session'}`);
  }
  const r = await grant({apikey: SERVICE, authorization: `Bearer ${SERVICE}`}, a, 'wrong-password');
  await check('admin grant, wrong password: still checked (400 invalid_credentials)', () => assert.equal(codeOf(r), 'invalid_credentials'));
  const u = await grant({apikey: SERVICE, authorization: `Bearer ${SERVICE}`}, addr('nobody'), 'wrong-password');
  await check('admin grant, unknown address: the same answer', () => { assert.equal(u.status, r.status); assert.equal(u.text, r.text); });
  const s = await grant({apikey: SERVICE, authorization: `Bearer ${SERVICE}`}, a, PW);
  const ref = await post(`${API}/auth/v1/token?grant_type=refresh_token`, {apikey: ANON}, {refresh_token: s.json.refresh_token});
  await check('refresh with the anon key and no token (rb.py session()): 200, Turnstile skips refresh_token', () => assert.equal(ref.status, 200, ref.text));
}

async function relaySection() {
  resetLimits();
  const a = addr('relay'), id = await makeUser(a);
  const ok = await relay(a, PW);
  await check('cli-login, right password: 200, the session and the user id only', () => {
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(Object.keys(ok.json).sort(), ['access_token', 'expires_at', 'expires_in', 'refresh_token', 'token_type', 'user']);
    assert.deepEqual(ok.json.user, {id});
  });
  const me = await fetch(`${API}/auth/v1/user`, {headers: {apikey: ANON, authorization: `Bearer ${ok.json.access_token}`}});
  await check('its access token is a session of that account', async () => assert.equal((await me.json()).id, id));
  const ref = await post(`${API}/auth/v1/token?grant_type=refresh_token`, {apikey: ANON}, {refresh_token: ok.json.refresh_token});
  await check('its refresh token works with the anon key, without Turnstile', () => assert.equal(ref.status, 200, ref.text));
  const wrong = await relay(a, 'wrong-password'), unknown = await relay(addr('nobody'), 'wrong-password');
  await check('wrong password: 401 invalid_credentials', () => { assert.equal(wrong.status, 401); assert.equal(wrong.json.error, 'invalid_credentials'); });
  await check('unknown address: the very same answer', () => { assert.equal(unknown.status, wrong.status); assert.equal(unknown.text, wrong.text); });
  const get = await fetch(FN, {headers: {apikey: ANON}});
  await check('GET: 405', () => assert.equal(get.status, 405));
  const form = await post(FN, {apikey: ANON, 'content-type': 'application/x-www-form-urlencoded'}, `email=${a}&password=${PW}`, true);
  await check('not JSON: 415', () => assert.equal(form.status, 415));
  const bad = await post(FN, {apikey: ANON}, '{"email": 1}', true);
  await check('JSON without email and password: 400', () => assert.equal(bad.status, 400));
  const un = addr('unconfirmed');
  await post(`${API}/auth/v1/admin/users`, {apikey: SERVICE, authorization: `Bearer ${SERVICE}`}, {email: un, password: PW});
  const unc = await relay(un, PW);
  console.log(`     unconfirmed address, right password: ${unc.status} ${unc.json && unc.json.error}`);
  const logs = execFileSync('docker', ['logs', 'supabase_edge_runtime_rb-l42a'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  await check('the function logged no address, password or token', () => {
    for (const s of [a, PW, 'wrong-password', ok.json.access_token, ok.json.refresh_token]) assert.ok(!logs.includes(s), 'found in logs');
  });
  const stored = psql('select string_agg(key, \' \') from public.cli_login_limits');
  await check('the limits table holds hashes only', () => { assert.ok(!stored.includes('@')); assert.match(stored, /^([ac]:[0-9a-f]{64} ?)+$/); });
}

async function rbSection() {
  resetLimits();
  const a = addr('rb'); const id = await makeUser(a);
  const dir = mkdtempSync(join(tmpdir(), 'rb-l42a-'));
  try {
    const env = {...process.env, REELBOOK_CONFIG: join(dir, 'config.json'), REELBOOK_EMAIL: a, REELBOOK_PASSWORD: PW};
    const r = spawnSync('python3', ['-I', RB, 'login', '--url', API, '--key', PUB || ANON], {encoding: 'utf8', env, input: ''});
    console.log(`     rb.py login: exit ${r.status}; ${(r.stdout + r.stderr).trim().replace(/\n/g, ' / ')}`);
    await check('rb.py login under Turnstile: exit 0 through cli-login', () => assert.equal(r.status, 0, r.stderr));
    const w = spawnSync('python3', ['-I', RB, 'whoami'], {encoding: 'utf8', env});
    await check('rb.py whoami after it: the account', () => { assert.equal(w.status, 0, w.stderr); assert.ok(w.stdout.includes(id) || w.stdout.includes(a), w.stdout); });
    const bad = spawnSync('python3', ['-I', RB, 'login', '--url', API, '--key', PUB || ANON], {encoding: 'utf8', env: {...env, REELBOOK_PASSWORD: 'wrong-password'}, input: ''});
    console.log(`     rb.py login, wrong password: exit ${bad.status}; ${bad.stderr.trim()}`);
    await check('rb.py login, wrong password: exit 1 and one plain line', () => { assert.equal(bad.status, 1); assert.match(bad.stderr, /Wrong email or password/); });
  } finally { rmSync(dir, {recursive: true, force: true}); }
}

async function addlink() {
  const a = addr('link'); const id = await makeUser(a);
  const key = 'rb_' + randomBytes(32).toString('hex');
  psql(`insert into public.capture_tokens (user_id, label, token_hash) values ('${id}', 'l42a', '${createHash('sha256').update(key).digest('hex')}')`);
  const privs = psql("select string_agg(t || ':' || p, ' ' order by t, p) from (values ('capture_tokens'), ('requests')) v(t), (values ('select'), ('insert'), ('update'), ('delete')) w(p) where has_table_privilege('service_role', 'public.' || t, p)");
  console.log(`     service_role on a fresh project: ${privs}`);
  await check('service_role: capture_tokens select+update, requests insert, nothing more there', () =>
    assert.equal(privs, 'capture_tokens:select capture_tokens:update requests:insert'));
  const link = () => fetch(`${API}/functions/v1/add-link`, {method: 'POST', headers: {authorization: `Bearer ${key}`, 'content-type': 'application/json'}, body: JSON.stringify({url: 'https://www.instagram.com/reel/L42aTest/'})});
  // Control: without the two grants (a new project before this file), add-link cannot work.
  psql('revoke select, update on public.capture_tokens from service_role; revoke insert on public.requests from service_role');
  const before = await link(); const beforeText = (await before.text()).trim();
  psql('grant select, update on public.capture_tokens to service_role; grant insert on public.requests to service_role');
  console.log(`     add-link without the service_role grants: ${before.status} ${beforeText}`);
  await check('control: without the grants add-link fails (500)', () => assert.equal(before.status, 500));
  const r = await link();
  const text = await r.text();
  console.log(`     add-link: ${r.status} ${text.trim()}`);
  await check('add-link on the fresh stack: 201 and one requests row for the account', () => {
    assert.equal(r.status, 201, text);
    assert.equal(psql(`select count(*) from public.requests where user_id = '${id}' and url = 'https://www.instagram.com/reel/L42aTest/'`), '1');
    assert.equal(psql(`select window_count from public.capture_tokens where user_id = '${id}'`), '1');
  });
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const t = psql(`select string_agg(p, ',') from (values ('select'), ('insert'), ('update'), ('delete')) w(p) where has_table_privilege('${role}', 'public.cli_login_limits', p)`);
    const f = psql(`select string_agg(f, ',') from (values ('cli_login_gate(text,text)'), ('cli_login_release(text,timestamptz)'), ('cli_login_hit(text)')) v(f) where has_function_privilege('${role}', 'public.' || f, 'execute')`);
    console.log(`     ${role}: cli_login_limits [${t}] functions [${f}]`);
    await check(`${role}: no right on cli_login_limits${role === 'service_role' ? ', executes gate and release only' : ', no cli_login function'}`, () => {
      assert.equal(t, '');
      assert.equal(f, role === 'service_role' ? 'cli_login_gate(text,text),cli_login_release(text,timestamptz)' : '');
    });
  }
}

const tally = list => Object.entries(list.reduce((m, s) => ({...m, [s]: (m[s] || 0) + 1}), {})).map(([s, n]) => `${n}×${s}`).join(' ');
const ADMIN = () => ({apikey: SERVICE, authorization: `Bearer ${SERVICE}`});

async function abuse() {
  const a = addr('abuse'); await makeUser(a);
  // 1. Auth as the CLI runs it (no GOTRUE_RATE_LIMIT_HEADER): /token limits nothing.
  const flat = [];
  for (let i = 0; i < 40; i++) flat.push((await grant(ADMIN(), a, 'wrong-password')).status);
  console.log(`     CLI Auth, 40 wrong admin grants, same address: ${tally(flat)}`);

  // 2. Auth with a per-IP key (second container of `cli-login-stack.sh limited`), as the hosted platform runs it.
  const L = 'http://127.0.0.1:54930';
  if ((await fetch(`${L}/health`).catch(() => null))?.ok) {
    const lg = (ip, email, password) => post(`${L}/token?grant_type=password`, {...ADMIN(), 'x-forwarded-for': ip}, {email, password});
    const until429 = async (ip, emailOf) => { for (let i = 1; i <= 300; i++) if ((await lg(ip, emailOf(i), 'wrong-password')).status === 429) return i; return null; };
    const n1 = await until429('10.0.0.1', () => a);
    const legitSame = await lg('10.0.0.1', a, PW), legitOther = await lg('10.0.0.2', a, PW);
    const n2 = await until429('10.0.0.3', i => addr(`spray${i}`));
    const other = await lg('10.0.0.4', a, PW);
    console.log(`     per-IP Auth: same address, first 429 at attempt ${n1}; then the right password from that IP ${legitSame.status} ${codeOf(legitSame) || ''}, from another IP ${legitOther.status}`);
    console.log(`     per-IP Auth: different addresses, first 429 at attempt ${n2}; the right password from a fresh IP ${other.status}`);
    await check('per-IP Auth limits per IP (a shared IP is a shared quota: the right password is refused there)', () => {
      assert.ok(n1 && n2); assert.equal(legitSame.status, 429); assert.equal(legitOther.status, 200);
    });
  } else console.log('     per-IP Auth not running (tests/e2e/cli-login-stack.sh limited): skipped');

  // 3. The function's own limits.
  resetLimits();
  const same = [];
  for (let i = 0; i < 8; i++) same.push((await relay(a, 'wrong-password', {'x-forwarded-for': `192.0.2.${i + 1}`})).status);
  const locked = await relay(a, PW, {'x-forwarded-for': '192.0.2.99'});
  console.log(`     cli-login, 8 wrong passwords for one address from 8 callers: ${same.join(' ')}; then the right password: ${locked.status}`);
  await check('cli-login: 5 failures per address, whatever the caller; the 6th try, right or wrong, is 429', () => {
    assert.deepEqual(same, [401, 401, 401, 401, 401, 429, 429, 429]); assert.equal(locked.status, 429);
  });
  psql("update public.cli_login_limits set window_start = now() - interval '16 minutes'");
  const after = await relay(a, PW, {'x-forwarded-for': '192.0.2.99'});
  await check('cli-login: 15 minutes later, the right password passes', () => assert.equal(after.status, 200, after.text));

  // Simultaneous calls (Codex pass 1): the gate reserves the address's attempts, so 20 at once get 5 through, no more.
  resetLimits();
  const burst = (await Promise.all(Array.from({length: 20}, (_, i) => relay(a, `wrong-${i}`, {'x-forwarded-for': `192.0.2.${i + 100}`})))).map(r => r.status);
  console.log(`     cli-login, 20 wrong passwords at once for one address from 20 callers: ${tally(burst)}`);
  await check('cli-login: 20 simultaneous attempts for one address, 5 reach Auth', () => {
    assert.equal(burst.filter(s => s === 401).length, 5); assert.equal(burst.filter(s => s === 429).length, 15);
  });
  // A refused reservation keeps no increment (Codex pass 3): 11 right passwords at once, then one more right password.
  resetLimits();
  const rightBurst = (await Promise.all(Array.from({length: 11}, (_, i) => relay(a, PW, {'x-forwarded-for': `192.0.2.${i + 130}`})))).map(r => r.status);
  const keptBurst = psql(`select coalesce(max(hits), 0) from public.cli_login_limits where key like 'a:%'`);
  const twelfth = await relay(a, PW, {'x-forwarded-for': '192.0.2.150'});
  console.log(`     cli-login, 11 right passwords at once for one address: ${tally(rightBurst)}; attempts kept for the address: ${keptBurst}; then the right password: ${twelfth.status}`);
  await check('cli-login: after a burst of right passwords, the address keeps nothing and the next right password passes', () => {
    assert.ok(rightBurst.every(s => s === 200 || s === 429), rightBurst.join(' '));
    assert.ok(rightBurst.filter(s => s === 200).length >= 5 && rightBurst.includes(429), rightBurst.join(' '));
    assert.equal(keptBurst, '0'); assert.equal(twelfth.status, 200, twelfth.text);
  });
  // A right password gives its attempt back: an honest user signing in again and again is never locked out.
  resetLimits();
  const rights = [];
  for (let i = 0; i < 8; i++) rights.push((await relay(a, PW, {'x-forwarded-for': `192.0.2.${i + 1}`})).status);
  const kept = psql(`select coalesce(max(hits), 0) from public.cli_login_limits where key like 'a:%'`);
  console.log(`     cli-login, 8 right passwords in a row: ${rights.join(' ')}; attempts kept for the address: ${kept}`);
  await check('cli-login: right passwords are not counted against the address', () => {
    assert.deepEqual(rights, Array(8).fill(200)); assert.equal(kept, '0');
  });
  // A release that lands after the window turned (Codex pass 2), on the real SQL: an attempt reserved 1 s before its
  // window ends, 5 failures in the next window, then the late release: the newer window keeps its 5, the 6th is refused.
  resetLimits();
  const K = `e2e-window-${stamp}`, gate = () => psql(`select public.cli_login_gate('c-window', '${K}')`);
  const hitsOf = () => psql(`select hits from public.cli_login_limits where key = 'a:${K}'`);
  psql(`insert into public.cli_login_limits (key, window_start, hits) values ('a:${K}', now() - interval '15 minutes' + interval '1 second', 0)`);
  const first = gate();
  await new Promise(r => setTimeout(r, 1500));
  const next = Array.from({length: 5}, gate);
  psql(`select public.cli_login_release('${K}', '${first.slice(3)}')`);
  const afterLate = hitsOf(), sixth = gate(), afterSixth = hitsOf();
  psql(`select public.cli_login_release('${K}', '${next[4].slice(3)}')`);
  const afterOwn = hitsOf();
  console.log(`     release after the window turned: reserved ${first}; next window ${next[0]} ×${next.length}; count after the late release ${afterLate}; 6th: ${sixth}, count after it ${afterSixth}; a release in its own window: ${afterOwn}`);
  await check('cli-login: a release after the window turned leaves the newer window\'s count alone (6th refused)', () => {
    assert.match(first, /^ok:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/); assert.ok(next.every(g => g === next[0] && g !== first), next.join(' '));
    // The refused 6th keeps no increment (Codex pass 3), so a release in its own window takes the count to 4.
    assert.equal(afterLate, '5'); assert.equal(sixth, 'address'); assert.equal(afterSixth, '5'); assert.equal(afterOwn, '4');
  });

  resetLimits();
  const spray = [];
  for (let i = 0; i < 25; i++) spray.push((await relay(addr(`spray${i}`), 'wrong-password', {'x-forwarded-for': '198.51.100.1'})).status);
  const sameCaller = await relay(a, PW, {'x-forwarded-for': '198.51.100.1'}), otherCaller = await relay(a, PW, {'x-forwarded-for': '198.51.100.2'});
  console.log(`     cli-login, 25 addresses from one caller: ${tally(spray)}; then the right password from that caller ${sameCaller.status}, from another ${otherCaller.status}`);
  const sprayAddresses = psql(`select count(*) from public.cli_login_limits where key like 'a:%'`);
  await check('cli-login: 20 attempts per caller, others unaffected; a caller refusal leaves no address counted', () => {
    assert.deepEqual(spray, [...Array(20).fill(401), ...Array(5).fill(429)]); assert.equal(sameCaller.status, 429); assert.equal(otherCaller.status, 200);
    assert.equal(sprayAddresses, '21');
  });
  const rows = psql('select count(*) from public.cli_login_limits');
  console.log(`     cli_login_limits rows after it: ${rows} (one per caller and per address tried)`);
}

const sections = {captcha, relay: relaySection, rb: rbSection, addlink, abuse};
const pick = process.argv[2] || 'all';
for (const [name, fn] of Object.entries(sections)) if (pick === 'all' || pick === name) { console.log(`== ${name}`); await fn(); }
console.log(fails.length ? `${fails.length} FAIL: ${fails.join(' | ')}` : 'all ok');
process.exit(fails.length ? 1 : 0);
