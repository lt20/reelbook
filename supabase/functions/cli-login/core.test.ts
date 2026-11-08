// Unit tests of cli-login's logic with stubs (no network, no Supabase):
//   deno test --no-remote supabase/functions/cli-login/core.test.ts
// (also run by tests/cli-login.test.cjs when Deno is installed). The real Auth with Turnstile on:
// tests/e2e/cli-login-real.mjs.
import { callerOf, grantHeaders, handle, sha256, waitText, type Deps } from './core.ts';

const eq = (a: unknown, b: unknown, msg = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const ok = (v: unknown, msg: string) => { if (!v) throw new Error(msg); };

const EMAIL = 'Someone@Example.test', PASSWORD = 'pw-secret-1', W0 = '2026-11-08T10:00:00.123456Z';
const SESSION = { access_token: 'at-secret', refresh_token: 'rt-secret', expires_in: 3600, expires_at: 1, token_type: 'bearer', user: { id: 'u1', email: 'someone@example.test', user_metadata: {} } };

type Rpc = [string, Record<string, string>];
function deps(opts: { gate?: string; gateError?: boolean; status?: number; body?: Record<string, unknown> | null; throws?: boolean } = {}) {
  const rpcs: Rpc[] = [], grants: [string, string][] = [];
  const d: Deps = {
    rpc: (fn, args) => {
      rpcs.push([fn, args]);
      if (fn === 'cli_login_gate') return Promise.resolve(opts.gateError ? { data: null, error: { code: '42501' } } : { data: opts.gate ?? `ok:${W0}`, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    grant: (email, password) => {
      grants.push([email, password]);
      if (opts.throws) return Promise.reject(new Error('down'));
      return Promise.resolve({ status: opts.status ?? 200, body: opts.body === undefined ? SESSION : opts.body });
    },
  };
  return { d, rpcs, grants };
}
const req = (body: unknown, init: { method?: string; type?: string; headers?: Record<string, string> } = {}) =>
  new Request('http://x/functions/v1/cli-login', {
    method: init.method ?? 'POST',
    headers: { 'content-type': init.type ?? 'application/json', ...(init.headers || {}) },
    body: (init.method ?? 'POST') === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
const call = async (r: Request, d: Deps) => { const res = await handle(r, d); return { status: res.status, json: await res.json(), headers: res.headers }; };

Deno.test('right password: the session, the user id and nothing else of the user', async () => {
  const { d, rpcs, grants } = deps();
  const r = await call(req({ email: ` ${EMAIL} `, password: PASSWORD }, { headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } }), d);
  eq(r.status, 200);
  eq(r.json, { access_token: 'at-secret', refresh_token: 'rt-secret', expires_in: 3600, expires_at: 1, token_type: 'bearer', user: { id: 'u1' } });
  eq(r.headers.get('cache-control'), 'no-store');
  eq(grants, [[EMAIL, PASSWORD]], 'the address trimmed, the password as typed');
  const address = await sha256(EMAIL.toLowerCase());
  eq(rpcs, [['cli_login_gate', { p_caller: await sha256('203.0.113.5'), p_address: address }], ['cli_login_succeeded', { p_address: address, p_window: W0 }]],
    'hashes only, the success recorded in the series the attempt was reserved in');
});

Deno.test('right password on an older schema.sql (no cli_login_succeeded): the attempt is still given back', async () => {
  const rpcs: string[] = [];
  const d: Deps = {
    rpc: fn => {
      rpcs.push(fn);
      if (fn === 'cli_login_gate') return Promise.resolve({ data: `ok:${W0}`, error: null });
      return Promise.resolve({ data: null, error: fn === 'cli_login_succeeded' ? { code: 'PGRST202' } : null });
    },
    grant: () => Promise.resolve({ status: 200, body: SESSION }),
  };
  eq((await call(req({ email: EMAIL, password: PASSWORD }), d)).status, 200);
  eq(rpcs, ['cli_login_gate', 'cli_login_succeeded', 'cli_login_release']);
});

Deno.test('wrong password and unknown address: one answer, and the failure counted for the address', async () => {
  const wrong = deps({ status: 400, body: { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' } });
  const a = await call(req({ email: EMAIL, password: 'nope' }), wrong.d);
  eq(a.status, 401); eq(a.json, { error: 'invalid_credentials', message: 'Wrong email or password.' });
  eq(wrong.rpcs.map(x => x[0]), ['cli_login_gate'], 'the attempt reserved by the gate stays counted');
  const other = deps({ status: 400, body: { error_code: 'validation_failed' } });
  eq((await call(req({ email: 'not-an-email', password: 'x' }), other.d)).json, a.json);
});

Deno.test('limited by the gate: 429 before Auth is asked, retry-after = what the gate says is left', async () => {
  // Bare refusals (an older schema.sql) and anything unexpected: 15 minutes.
  for (const gate of ['caller', 'address', 'ok', 'ok:', 'address:', 'address:x', 'address:1234567']) {
    const { d, grants } = deps({ gate });
    const r = await call(req({ email: EMAIL, password: PASSWORD }), d);
    eq(r.status, 429); eq(r.json.error, 'too_many_attempts'); eq(r.headers.get('retry-after'), '900', gate); eq(grants, []);
    eq(r.json.message, 'Too many sign-in attempts. Try again in 15 minutes.');
  }
  for (const [gate, after, text] of [['address:900', '900', '15 minutes'], ['address:3600', '3600', '1 hour'], ['address:86400', '86400', '24 hours'],
    ['address:50399', '50399', '14 hours'], ['caller:42', '42', '1 minute'], ['caller:0', '1', '1 minute'], ['address:3599', '3599', '1 hour']]) {
    const { d, grants } = deps({ gate });
    const r = await call(req({ email: EMAIL, password: PASSWORD }), d);
    eq([r.status, r.headers.get('retry-after'), r.json.message], [429, after, `Too many sign-in attempts. Try again in ${text}.`], gate); eq(grants, []);
  }
  eq([waitText(61), waitText(899), waitText(3540), waitText(3601), waitText(86399)], ['2 minutes', '15 minutes', '59 minutes', '2 hours', '24 hours']);
});

Deno.test('gate unavailable (schema.sql not run): 502, Auth never asked', async () => {
  const { d, grants } = deps({ gateError: true });
  eq((await call(req({ email: EMAIL, password: PASSWORD }), d)).status, 502); eq(grants, []);
});

Deno.test('Auth answers: not confirmed 403, its own 429, captcha still asked 502 not counted, down 502', async () => {
  eq((await call(req({ email: EMAIL, password: PASSWORD }), deps({ status: 400, body: { error_code: 'email_not_confirmed' } }).d)).status, 403);
  eq((await call(req({ email: EMAIL, password: PASSWORD }), deps({ status: 429, body: { error_code: 'over_request_rate_limit' } }).d)).status, 429);
  const cap = deps({ status: 400, body: { error_code: 'captcha_failed' } });
  eq((await call(req({ email: EMAIL, password: PASSWORD }), cap.d)).status, 502);
  eq(cap.rpcs.map(x => x[0]), ['cli_login_gate', 'cli_login_release'], 'a captcha refusal is not the person\'s failure');
  for (const [o, status] of [[{ status: 400, body: { error_code: 'email_not_confirmed' } }, 403], [{ status: 429, body: null }, 429],
    [{ throws: true }, 502], [{ status: 200, body: { access_token: 'x' } }, 502], [{ status: 500, body: null }, 502]] as const) {
    const x = deps(o);
    eq((await call(req({ email: EMAIL, password: PASSWORD }), x.d)).status, status);
    eq(x.rpcs.map(r => r[0]), ['cli_login_gate', 'cli_login_release'], `released after ${status}`);
  }
});

Deno.test('simultaneous wrong passwords for one address: 5 reach Auth, not 20 (Codex pass 1)', async () => {
  // A stub of cli_login_gate as schema.sql makes it: the address's counter read and incremented in one step.
  const hits = new Map<string, number>();
  const bump = (k: string) => { const n = (hits.get(k) || 0) + 1; hits.set(k, n); return n; };
  let asked = 0;
  const d: Deps = {
    rpc: (fn, args) => {
      if (fn === 'cli_login_gate') return Promise.resolve({ data: bump('a:' + args.p_address) > 5 ? 'address' : `ok:${W0}`, error: null });
      if (fn === 'cli_login_release') hits.set('a:' + args.p_address, Math.max((hits.get('a:' + args.p_address) || 0) - 1, 0));
      return Promise.resolve({ data: null, error: null });
    },
    grant: async () => { asked++; await new Promise(r => setTimeout(r, 5)); return { status: 400, body: { error_code: 'invalid_credentials' } }; },
  };
  const all = await Promise.all(Array.from({ length: 20 }, (_, i) => call(req({ email: EMAIL, password: `wrong-${i}` }, { headers: { 'x-forwarded-for': `192.0.2.${i}` } }), d)));
  eq(asked, 5, 'Auth asked');
  eq(all.filter(r => r.status === 401).length, 5); eq(all.filter(r => r.status === 429).length, 15);
});

// A model of the per-address part of schema.sql's cli_login_gate / cli_login_release / cli_login_succeeded, on a clock
// (every call moves it 1 ms, so that two series never start at the same instant). The real SQL is measured on a local
// stack (tests/e2e/cli-login-real.mjs progressive).
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
function model(start = Date.parse('2026-11-08T10:00:00Z')) {
  const clock = { now: start };
  type Row = { ws: number; h: number; lv: number; lu: number | null; lh: number | null };
  const rows = new Map<string, Row>();
  const iso = (t: number) => new Date(t).toISOString();
  const rpc: Deps['rpc'] = (fn, a) => {
    const now = (clock.now += 1);
    const k = 'a:' + a.p_address;
    if (fn === 'cli_login_gate') {
      for (const [key, r] of rows) if (Math.max(r.ws, r.lh ?? r.ws, r.lu ?? r.ws) < now - DAY) rows.delete(key);
      let r = rows.get(k);
      if (!r) rows.set(k, r = { ws: now, h: 0, lv: 0, lu: null, lh: null });
      if (r.lu !== null && r.lu > now) return Promise.resolve({ data: `address:${Math.max(1, Math.ceil((r.lu - now) / 1000))}`, error: null });
      if (r.lu !== null) Object.assign(r, { ws: now, h: 0, lv: Math.min(r.lv + 1, 2), lu: null });
      r.h++;
      if (r.h >= 5) r.lu = now + [15 * MIN, HOUR, DAY][r.lv];
      r.lh = now;
      return Promise.resolve({ data: `ok:${iso(r.ws)}`, error: null });
    }
    const r = rows.get(k);
    if (r && iso(r.ws) === a.p_window) {
      if (fn === 'cli_login_release') { r.h = Math.max(r.h - 1, 0); if (r.h < 5) r.lu = null; }
      if (fn === 'cli_login_succeeded') Object.assign(r, { ws: now, h: 0, lv: 0, lu: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
  return { clock, rows, rpc };
}

Deno.test('a release after the series turned leaves the newer series alone: no 6th try reaches Auth (Codex pass 2)', async () => {
  const m = model();
  let asked = 0, letFirstAnswer = () => {};
  const firstAnswer = new Promise<void>(r => { letFirstAnswer = r; });
  const d: Deps = {
    rpc: m.rpc,
    grant: async (_e, password) => {
      asked++;
      if (password === 'slow-but-not-wrong') { await firstAnswer; return { status: 503, body: null }; }
      return { status: 400, body: { error_code: 'invalid_credentials' } };
    },
  };
  for (let i = 0; i < 4; i++) eq((await call(req({ email: EMAIL, password: `wrong-${i}` }), d)).status, 401);
  const slow = call(req({ email: EMAIL, password: 'slow-but-not-wrong' }), d); // the 5th, of series N: Auth slow to answer
  await new Promise(r => setTimeout(r, 0));
  const row = [...m.rows.values()][0];
  eq([row.h, row.lu !== null], [5, true], 'the 5th reservation locks series N at once');
  m.clock.now += 15 * MIN + 1; // the lock is over: series N+1
  for (let i = 0; i < 5; i++) eq((await call(req({ email: EMAIL, password: `wrong-n1-${i}` }), d)).status, 401);
  eq([row.h, row.lv], [5, 1], 'five failures kept in series N+1, one level up');
  letFirstAnswer();
  eq((await slow).status, 502);
  eq([row.h, row.lu !== null], [5, true], 'the late release did not lower series N+1 nor lift its lock');
  const before = asked;
  const sixth = await call(req({ email: EMAIL, password: 'wrong-6' }), d);
  eq([sixth.status, sixth.headers.get('retry-after')], [429, '3600']);
  eq(asked, before, 'the 6th wrong password never reached Auth');
});

Deno.test('progressive lock per address: 15 minutes, then 1 hour, then 24 hours; reset by a success or 24 quiet hours', async () => {
  const m = model();
  let asked = 0;
  const d: Deps = {
    rpc: m.rpc,
    grant: (_e, password) => { asked++; return Promise.resolve(password === PASSWORD ? { status: 200, body: SESSION } : { status: 400, body: { error_code: 'invalid_credentials' } }); },
  };
  const attempt = async (password: string) => { const r = await call(req({ email: EMAIL, password }), d); return r.status === 429 ? `429 ${r.headers.get('retry-after')}` : String(r.status); };
  const series = async () => { const out: string[] = []; for (let i = 0; i < 6; i++) out.push(await attempt(`wrong-${i}`)); return out; };
  const fiveThen = (after: string) => ['401', '401', '401', '401', '401', `429 ${after}`];

  eq(await series(), fiveThen('900'), 'level 0: 5 failures, then 15 minutes');
  const before = asked;
  eq(await attempt(PASSWORD), '429 900', 'the right password during a lock: refused');
  eq(asked, before, 'and Auth not asked');
  m.clock.now += 10 * MIN;
  eq(await attempt('wrong'), '429 300', 'retry-after is what is left');
  m.clock.now += 5 * MIN + 1e3;
  eq(await series(), fiveThen('3600'), 'level 1: 5 more failures, then 1 hour');
  m.clock.now += HOUR + 1e3;
  eq(await series(), fiveThen('86400'), 'level 2: 5 more, then 24 hours');
  m.clock.now += 10 * HOUR;
  eq(await attempt('wrong'), '429 50400', '14 hours left');
  m.clock.now += 14 * HOUR + 1e3;
  eq(await series(), fiveThen('86400'), 'level 2 stays 24 hours');

  m.clock.now += DAY + 1e3;
  eq(await attempt(PASSWORD), '200', 'once the lock is over, the right password passes');
  eq(await series(), fiveThen('900'), 'a success puts the address back to level 0');

  m.clock.now += 15 * MIN + 1e3;
  eq(await series(), fiveThen('3600'), 'level 1 again');
  m.clock.now += HOUR + DAY - 1e3;
  eq((await series())[5], '429 86400', '23:59:59 after the 1-hour lock ended: still counted, level 2');
  m.clock.now += DAY + DAY + 2e3;
  eq(await series(), fiveThen('900'), '24 hours with no attempt and no lock: level 0');

  // A success while the address is not locked also clears the failures counted so far.
  m.clock.now += 15 * MIN + 1e3;
  for (let i = 0; i < 4; i++) eq(await attempt(`wrong-${i}`), '401');
  eq(await attempt(PASSWORD), '200');
  eq(await series(), fiveThen('900'));
});

Deno.test('grant headers: a service_role JWT in apikey and Authorization, a secret key in apikey alone', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLV8';
  eq(grantHeaders(jwt), { apikey: jwt, authorization: `Bearer ${jwt}` });
  eq(grantHeaders('sb_secret_AbC-123_xyz'), { apikey: 'sb_secret_AbC-123_xyz' });
});

Deno.test('only POST JSON with an email and a password', async () => {
  const { d, rpcs } = deps();
  const get = await handle(req(null, { method: 'GET' }), d);
  eq(get.status, 405); eq(get.headers.get('allow'), 'POST');
  eq((await call(req(`email=a&password=b`, { type: 'application/x-www-form-urlencoded' }), d)).status, 415);
  eq((await call(req('{not json'), d)).status, 400);
  eq((await call(req({ email: EMAIL }), d)).status, 400);
  eq((await call(req({ email: 1, password: 2 }), d)).status, 400);
  eq((await call(req({ email: 'a'.repeat(321), password: 'x' }), d)).status, 400);
  eq((await call(req({ email: EMAIL, password: 'x'.repeat(1025) }), d)).status, 400);
  eq((await call(req('x'.repeat(5000)), d)).status, 413);
  eq(rpcs, [], 'nothing counted, nothing asked');
});

Deno.test('caller: cf-connecting-ip, else the first of x-forwarded-for, else x-real-ip', () => {
  eq(callerOf(new Headers({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' })), '1.1.1.1');
  eq(callerOf(new Headers({ 'x-forwarded-for': ' 2.2.2.2 , 3.3.3.3' })), '2.2.2.2');
  eq(callerOf(new Headers({ 'x-real-ip': '4.4.4.4' })), '4.4.4.4');
  eq(callerOf(new Headers()), 'unknown');
});

Deno.test('nothing secret is logged, whatever happens', async () => {
  const seen: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  console.log = console.error = console.warn = console.info = (...a: unknown[]) => { seen.push(a.map(String).join(' ')); };
  try {
    for (const o of [{}, { status: 400, body: { error_code: 'invalid_credentials' } }, { status: 500, body: { msg: EMAIL } }, { throws: true }, { gateError: true }, { status: 400, body: { error_code: 'captcha_failed' } }]) {
      await handle(req({ email: EMAIL, password: PASSWORD }), deps(o).d);
    }
  } finally { Object.assign(console, orig); }
  ok(seen.length > 0, 'errors are logged');
  for (const s of seen) for (const secret of [EMAIL, EMAIL.toLowerCase(), PASSWORD, 'at-secret', 'rt-secret']) ok(!s.includes(secret), `logged: ${s}`);
});
