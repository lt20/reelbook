// L42a: cli-login and `rb.py login` against a REAL Supabase Auth with Turnstile on, on the local stack of
// tests/e2e/cli-login-stack.sh (never the hosted project: the script refuses any URL that is not 127.0.0.1). Not run by CI.
//   tests/e2e/cli-login-stack.sh up
//   node tests/e2e/cli-login-real.mjs [captcha|relay|rb|addlink|abuse|progressive|upgrade|all]     # default all
//   (upgrade needs RB_OLD_SCHEMA, a schema.sql from before L46, and leaves the stack on the current one)
//   tests/e2e/cli-login-stack.sh down
// Prints one line per check (ok / FAIL) and the measured figures; exit 1 on any FAIL.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
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
// The stack's project id and port prefix, as cli-login-stack.sh took them (RB_L42_ID, RB_L42_PORTS).
const STACK = process.env.RB_L42_ID || 'rb-l42a', PORTS = process.env.RB_L42_PORTS || '549';
const DB = `supabase_db_${STACK}`;
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
  return {status: r.status, json, text, headers: r.headers};
};
const grant = (headers, email, password, extra = {}) => post(`${API}/auth/v1/token?grant_type=password`, headers, {email, password, ...extra});
const codeOf = r => r.json && (r.json.error_code || r.json.error);
const makeUser = async email => {
  const r = await post(`${API}/auth/v1/admin/users`, {apikey: SERVICE, authorization: `Bearer ${SERVICE}`}, {email, password: PW, email_confirm: true});
  assert.equal(r.status, 200, r.text); return r.json.id;
};
const relay = (email, password, headers = {}) => post(FN, {apikey: PUB || ANON, ...headers}, {email, password});
const resetLimits = () => psql('delete from public.cli_login_limits');
// Time passes, for the limits: every time of every row moves back by that interval.
const shift = iv => psql(`update public.cli_login_limits set window_start = window_start - interval '${iv}', ` +
  `last_hit = last_hit - interval '${iv}', locked_until = locked_until - interval '${iv}'`);

async function captcha() {
  const a = addr('captcha'); await makeUser(a);
  const env = execFileSync('docker', ['exec', `supabase_auth_${STACK}`, 'printenv', 'GOTRUE_SECURITY_CAPTCHA_ENABLED', 'GOTRUE_SECURITY_CAPTCHA_PROVIDER'], {encoding: 'utf8'}).split('\n');
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
  const logs = execFileSync('docker', ['logs', `supabase_edge_runtime_${STACK}`], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
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
    const f = psql(`select string_agg(f, ',') from (values ('cli_login_gate(text,text)'), ('cli_login_release(text,timestamptz)'), ('cli_login_succeeded(text,timestamptz)'), ('cli_login_hit(text)')) v(f) where has_function_privilege('${role}', 'public.' || f, 'execute')`);
    console.log(`     ${role}: cli_login_limits [${t}] functions [${f}]`);
    await check(`${role}: no right on cli_login_limits${role === 'service_role' ? ', executes gate, release and succeeded only' : ', no cli_login function'}`, () => {
      assert.equal(t, '');
      assert.equal(f, role === 'service_role' ? 'cli_login_gate(text,text),cli_login_release(text,timestamptz),cli_login_succeeded(text,timestamptz)' : '');
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
  const L = `http://127.0.0.1:${PORTS}30`;
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
  shift('16 minutes');
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
  // A release that lands after the series turned (Codex pass 2), on the real SQL: the 5th attempt of series N (which
  // locks it) is released only after the lock is over and 5 failures were kept in series N+1: N+1 keeps its 5 and its
  // lock, the 6th is refused. A release in its own series gives the attempt back and lifts the lock it started.
  resetLimits();
  const K = `e2e-window-${stamp}`, gate = () => psql(`select public.cli_login_gate('c-window', '${K}')`);
  const stateOf = () => psql(`select hits || ' ' || level || ' ' || (locked_until is not null) from public.cli_login_limits where key = 'a:${K}'`);
  const firsts = Array.from({length: 5}, gate), first = firsts[4];
  const lockedN = stateOf();
  // The lock is over; window_start is left as it is, so that only the series' turn can make the late release miss.
  psql(`update public.cli_login_limits set locked_until = now() - interval '1 second' where key = 'a:${K}'`);
  const next = Array.from({length: 5}, gate);
  psql(`select public.cli_login_release('${K}', '${first.slice(3)}')`);
  const afterLate = stateOf(), sixth = gate(), afterSixth = stateOf();
  psql(`select public.cli_login_release('${K}', '${next[4].slice(3)}')`);
  const afterOwn = stateOf();
  console.log(`     release after the series turned: series N ${first} (hits level locked: ${lockedN}); series N+1 ${next[0]} ×${next.length}; after the late release ${afterLate}; 6th: ${sixth}, after it ${afterSixth}; a release in its own series: ${afterOwn}`);
  await check('cli-login: a release after the series turned leaves the newer series alone (6th refused)', () => {
    assert.match(first, /^ok:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/); assert.ok(firsts.every(g => g === first), firsts.join(' '));
    assert.ok(next.every(g => g === next[0] && g !== first), next.join(' '));
    assert.equal(lockedN, '5 0 true'); assert.equal(afterLate, '5 1 true');
    assert.match(sixth, /^address:(3[56]\d\d)$/); assert.equal(afterSixth, '5 1 true'); assert.equal(afterOwn, '4 1 false');
  });

  resetLimits();
  const spray = [];
  for (let i = 0; i < 25; i++) spray.push((await relay(addr(`spray${i}`), 'wrong-password', {'x-forwarded-for': '198.51.100.1'})).status);
  const sameCaller = await relay(a, PW, {'x-forwarded-for': '198.51.100.1'}), otherCaller = await relay(a, PW, {'x-forwarded-for': '198.51.100.2'});
  const callerWait = Number(sameCaller.headers.get('retry-after'));
  console.log(`     cli-login, 25 addresses from one caller: ${tally(spray)}; then the right password from that caller ${sameCaller.status} (retry-after ${callerWait}), from another ${otherCaller.status}`);
  const sprayAddresses = psql(`select count(*) from public.cli_login_limits where key like 'a:%'`);
  await check('cli-login: 20 attempts per caller, others unaffected; a caller refusal leaves no address counted', () => {
    assert.deepEqual(spray, [...Array(20).fill(401), ...Array(5).fill(429)]); assert.equal(sameCaller.status, 429); assert.equal(otherCaller.status, 200);
    assert.ok(callerWait > 800 && callerWait <= 900, `caller retry-after ${callerWait}`);
    assert.equal(sprayAddresses, '21');
  });
  const rows = psql('select count(*) from public.cli_login_limits');
  console.log(`     cli_login_limits rows after it: ${rows} (one per caller and per address tried)`);
}

// L46: the progressive lock per address through the real function, Auth and SQL. Time is simulated by moving the rows'
// times back (shift). Each attempt comes from its own caller, so that the caller limit never interferes.
async function progressive() {
  const a = addr('progressive'); await makeUser(a);
  resetLimits();
  let ip = 0;
  const once = async password => {
    const r = await relay(a, password, {'x-forwarded-for': `203.0.113.${(ip++ % 250) + 1}`});
    return r.status === 429 ? {s: 429, wait: Number(r.headers.get('retry-after')), msg: r.json.message} : {s: r.status};
  };
  const series = async () => { const out = []; for (let i = 0; i < 6; i++) out.push(await once(`wrong-${i}`)); return out; };
  const state = () => psql(`select level || ' ' || hits || ' ' || (locked_until is not null) from public.cli_login_limits where key like 'a:%'`);
  const fiveThen = (out, lo, hi) => out.slice(0, 5).every(o => o.s === 401) && out[5].s === 429 && out[5].wait >= lo && out[5].wait <= hi;
  const show = out => out.map(o => o.s === 429 ? `429(${o.wait})` : o.s).join(' ');
  const table = [];
  const step = async (name, out, lo, hi) => {
    const st = state(); table.push(`| ${name} | ${show(out)} | ${st} |`);
    await check(`progressive: ${name}`, () => assert.ok(fiveThen(out, lo, hi), `${show(out)} ${out[5] && out[5].msg}`));
  };

  const s1 = await series(); const during = await once(PW);
  await step('level 0: 5 wrong passwords, then ~15 min', s1, 895, 900);
  await check('progressive: the right password during a lock is refused, with the time left', () => {
    assert.equal(during.s, 429); assert.ok(during.wait <= s1[5].wait, String(during.wait));
  });
  table.push(`| right password during the lock | 429(${during.wait}) « ${during.msg} » | ${state()} |`);
  shift('10 minutes');
  const left = await once('wrong-x');
  table.push(`| 10 min later, one more try | 429(${left.wait}) | ${state()} |`);
  await check('progressive: retry-after is what is left of the lock (~5 min)', () => assert.ok(left.s === 429 && left.wait > 280 && left.wait <= 300, JSON.stringify(left)));
  shift('6 minutes');
  await step('lock over: 5 more, then ~1 h', await series(), 3590, 3600);
  shift('61 minutes');
  const s3 = await series();
  await step('lock over: 5 more, then ~24 h', s3, 86390, 86400);
  table.push(`| message of that refusal | « ${s3[5].msg} » | |`);
  shift('1441 minutes');
  await step('lock over: 5 more, still ~24 h', await series(), 86390, 86400);
  shift('1441 minutes');
  const ok = await once(PW), afterOk = state();
  table.push(`| lock over: right password | ${ok.s} | ${afterOk} |`);
  await check('progressive: a success after a lock puts the address back to level 0', () => { assert.equal(ok.s, 200); assert.equal(afterOk, '0 0 false'); });
  await step('after that success: 5 wrong, then ~15 min again', await series(), 895, 900);
  shift('16 minutes');
  await step('lock over: 5 more, then ~1 h (level 1)', await series(), 3590, 3600);
  shift('1 hour 1441 minutes');
  const purged = psql(`select count(*) from public.cli_login_limits where key like 'a:%'`);
  await step('24 h after the 1 h lock ended, no attempt: back to ~15 min', await series(), 895, 900);
  table.push(`| (address rows before that series, after 24 quiet hours: ${purged}, dropped by the next call) | | |`);

  // 20 simultaneous wrong passwords: 5 reach Auth (401), 15 are refused by the gate.
  resetLimits();
  const burst = await Promise.all(Array.from({length: 20}, (_, i) => relay(a, `wrong-${i}`, {'x-forwarded-for': `198.51.100.${i + 10}`})));
  const waits = burst.filter(r => r.status === 429).map(r => Number(r.headers.get('retry-after')));
  table.push(`| 20 wrong passwords at once | ${tally(burst.map(r => r.status))}, retry-after ${Math.min(...waits)}–${Math.max(...waits)} | ${state()} |`);
  await check('progressive: 20 simultaneous wrong passwords, 5 reach Auth', () => {
    assert.equal(burst.filter(r => r.status === 401).length, 5); assert.equal(waits.length, 15); assert.ok(waits.every(w => w >= 895 && w <= 900), waits.join(' '));
  });
  console.log(['     | step | answers (retry-after s) | level hits locked |', '     |---|---|---|', ...table.map(r => `     ${r}`)].join('\n'));
}

// L46: schema.sql replayed over a database that holds the L42a section with rows in it. RB_OLD_SCHEMA: a copy of
// schema.sql from before L46 (e.g. `git show <rev>:supabase/schema.sql`). Leaves the stack on the current schema.sql.
async function upgrade() {
  const old = process.env.RB_OLD_SCHEMA;
  if (!old) { console.log('     RB_OLD_SCHEMA not set: skipped'); return; }
  const replay = file => spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], {input: readFileSync(file, 'utf8'), encoding: 'utf8'});
  psql('drop function if exists public.cli_login_succeeded(text, timestamptz); drop table if exists public.cli_login_limits');
  const r0 = replay(old);
  await check('upgrade: the pre-L46 schema.sql replays (the L42a table back)', () => {
    assert.equal(r0.status, 0, r0.stderr); assert.equal(psql(`select count(*) from information_schema.columns where table_name = 'cli_login_limits'`), '3');
  });
  // A real address whose L42a window ended while one of its attempts, reserved just before the end, still waits for
  // Auth: the row holds that window_start, which the release will name once Auth answers, after the upgrade.
  const late = addr('late-release'), lateKey = 'a:' + createHash('sha256').update(late.toLowerCase()).digest('hex');
  await makeUser(late);
  psql(`insert into public.cli_login_limits (key, window_start, hits) values
    ('c:caller', now() - interval '5 minutes', 3),
    ('a:open-full', now() - interval '5 minutes', 5),
    ('a:open-two', now() - interval '1 minute', 2),
    ('a:ended', now() - interval '20 minutes', 4),
    ('${lateKey}', now() - interval '15 minutes 1 second', 3)`);
  const lateWindow = psql(`select to_char(window_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.cli_login_limits where key = '${lateKey}'`);
  const oldGate = psql(`select public.cli_login_gate('c-up', 'open-full')`);
  // After that call, whose purge would drop it.
  psql(`insert into public.cli_login_limits (key, window_start, hits) values ('a:old', now() - interval '2 days', 5)`);
  const r1 = replay(fileURLToPath(new URL('../../supabase/schema.sql', import.meta.url)));
  const rows = () => psql(`select string_agg(case when key = '${lateKey}' then 'a:late' else key end || ' ' || hits || ' ' || level || ' ' || coalesce(round(extract(epoch from locked_until - window_start))::text, '-') || ' ' || coalesce((last_hit = window_start)::text, '-'), ', ' order by key) from public.cli_login_limits`);
  const after1 = rows();
  const r2 = replay(fileURLToPath(new URL('../../supabase/schema.sql', import.meta.url)));
  const after2 = rows();
  const gates = {
    'open-full': psql(`select public.cli_login_gate('c-up', 'open-full')`),
    'open-two': Array.from({length: 4}, () => psql(`select public.cli_login_gate('c-up', 'open-two')`)).map(g => g.replace(/^ok:.*/, 'ok')).join(' '),
    ended: psql(`select public.cli_login_gate('c-up', 'ended')`).replace(/^ok:.*/, 'ok'),
  };
  const oldGone = psql(`select count(*) from public.cli_login_limits where key = 'a:old'`);
  const sigs = psql(`select string_agg(p.oid::regprocedure::text, ' ' order by 1) from pg_proc p where proname like 'cli_login_%'`);
  const rights = psql(`select string_agg(r || '=' || has_function_privilege(r, 'public.cli_login_succeeded(text, timestamptz)', 'execute'), ' ') from unnest(array['anon', 'authenticated', 'service_role']) r`);
  console.log(`     before: old gate on a full open window: ${oldGate}`);
  console.log(`     replay 1: exit ${r1.status}; rows (key hits level lock-length last_hit=window_start): ${after1}`);
  console.log(`     replay 2: exit ${r2.status}; rows: ${after2 === after1 ? 'unchanged' : after2}`);
  console.log(`     then the gate: ${JSON.stringify(gates)}; the 2-day-old row after a call: ${oldGone}; functions: ${sigs}; succeeded executable by: ${rights}`);
  await check('upgrade: schema.sql replays twice over the L42a table with rows, nothing lost or broken', () => {
    assert.equal(r1.status, 0, r1.stderr); assert.equal(r2.status, 0, r2.stderr); assert.equal(after2, after1);
    assert.equal(oldGate, 'address');
    // Open full window → a lock that ends with it; ended window → its row goes (the next series gets a new
    // window_start); caller rows untouched.
    assert.match(after1, /a:open-full 5 0 900 true/); assert.match(after1, /a:open-two 2 0 - true/);
    assert.doesNotMatch(after1, /a:ended|a:old|a:late/); assert.match(after1, /c:caller 3 0 - -/);
    assert.match(gates['open-full'], /^address:(5\d\d|600)$/); assert.equal(gates['open-two'], 'ok ok ok address:900');
    assert.equal(gates.ended, 'ok'); assert.equal(oldGone, '0');
    assert.equal(sigs, 'cli_login_gate(text,text) cli_login_hit(text) cli_login_release(text,timestamp with time zone) cli_login_succeeded(text,timestamp with time zone)');
    assert.equal(rights, 'anon=false authenticated=false service_role=true');
  });

  // The late release (Codex, L46 pass 1): after the upgrade, 5 wrong passwords through the function lock the address;
  // then the attempt reserved in the ended L42a window is given back, naming that window. It must change nothing.
  const wrong = [];
  for (let i = 0; i < 5; i++) wrong.push((await relay(late, `wrong-${i}`, {'x-forwarded-for': `198.51.100.${i + 1}`})).status);
  const lockedBefore = psql(`select hits || ' ' || (locked_until is not null) from public.cli_login_limits where key = '${lateKey}'`);
  psql(`select public.cli_login_release('${lateKey.slice(2)}', '${lateWindow}')`);
  const lockedAfter = psql(`select hits || ' ' || (locked_until is not null) from public.cli_login_limits where key = '${lateKey}'`);
  const sixth = await relay(late, 'wrong-5', {'x-forwarded-for': '198.51.100.6'});
  const wait = Number(sixth.headers.get('retry-after'));
  console.log(`     late release: 5 wrong ${wrong.join(' ')}; hits locked ${lockedBefore} → after the old window's release ${lockedAfter}; 6th ${sixth.status}(${wait})`);
  await check('upgrade: a release for an ended L42a window, after the upgrade, does not lift the lock of 5 newer failures', () => {
    assert.deepEqual(wrong, [401, 401, 401, 401, 401]); assert.equal(lockedBefore, '5 true'); assert.equal(lockedAfter, '5 true');
    assert.equal(sixth.status, 429, sixth.text); assert.ok(wait >= 895 && wait <= 900, String(wait));
  });
}

const sections = {captcha, relay: relaySection, rb: rbSection, addlink, abuse, progressive, upgrade};
const pick = process.argv[2] || 'all';
for (const [name, fn] of Object.entries(sections)) if (pick === 'all' || pick === name) { console.log(`== ${name}`); await fn(); }
console.log(fails.length ? `${fails.length} FAIL: ${fails.join(' | ')}` : 'all ok');
process.exit(fails.length ? 1 : 0);
