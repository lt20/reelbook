// cli-login, the logic (L42a): no import, so that it runs as is under Deno and is tested with stubs (core.test.ts).
// index.ts only wires it to Deno.serve, the service-role client and fetch.
//
// Why it exists: once Turnstile is on for the hosted project, Supabase Auth asks a captcha token on
// /token?grant_type=password too, and `rb.py login` has no browser to get one. Auth skips the captcha for a request that
// carries an admin role (`verifyCaptcha` in supabase/auth), which only a server may hold: this function makes the
// password grant for rb.py with the service role, and hands back the session. rb.py calls it only after the direct
// grant was refused with `captcha_failed`, so a backend without Turnstile never depends on it.
//
// POST {"email", "password"} as JSON → 200 {access_token, refresh_token, expires_in, expires_at, token_type, user: {id}}.
// Anything else: one JSON error, the same for a wrong password and an unknown address. Neither the address, nor the
// password, nor a token is ever logged or echoed back.
//
// Abuse (the route skips Turnstile on purpose): before Auth is asked, cli_login_gate() in supabase/schema.sql counts
// every attempt per caller (20 per 15 minutes) and reserves one of the address's attempts, atomically, so that
// simultaneous calls cannot get more than 5 through. Per address the lock grows (L46): 5 wrong passwords lock it for
// 15 minutes, the next 5 for 1 hour, every further 5 for 24 hours; a sign-in that succeeds here (cli_login_succeeded())
// or 24 hours with no attempt and no lock put it back to the first level. Every other outcome that is not a wrong
// password gives the attempt back (cli_login_release()), in the series the gate reserved it in and only there: only
// failures stay counted, and a late release cannot lower a newer series' count. A refusal says how long is left
// (retry-after, in seconds). Both keys are SHA-256 hashes: no address or IP is stored.

export const BODY_MAX = 4096;
export const EMAIL_MAX = 320;
export const PASSWORD_MAX = 1024;

// The few calls made (stubs in the tests): the service-role client's rpc, and Auth's password grant.
export type DbError = { code?: string; message?: string } | null;
export type Rpc = (fn: string, args: Record<string, string>) => Promise<{ data: unknown; error: DbError }>;
export type Grant = (email: string, password: string) => Promise<{ status: number; body: Record<string, unknown> | null }>;
export type Deps = { rpc: Rpc; grant: Grant };

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

// Who calls, as the platform's proxies say it. Supabase's docs give the first of x-forwarded-for as the client's address,
// but the hosted gateway keeps a value sent by the client and appends the real one after it (github.com/orgs/supabase/
// discussions/34647), while cf-connecting-ip, set by Cloudflare at its edge, carried the real address there. So
// cf-connecting-ip first; the x-forwarded-for fallback (the local stack, where Kong appends) is forgeable. The caller
// limit is thus best effort: the per-address limit does not depend on it, and the deploy check in the PR tries forged headers.
export function callerOf(headers: Headers): string {
  const cf = (headers.get('cf-connecting-ip') || '').trim();
  if (cf) return cf;
  const first = (headers.get('x-forwarded-for') || '').split(',')[0].trim();
  return first || (headers.get('x-real-ip') || '').trim() || 'unknown';
}

// The headers of the password grant, for either shape of SUPABASE_SERVICE_ROLE_KEY. A service_role JWT goes in both
// apikey and Authorization: Auth reads the admin role from the latter. A secret key (`sb_secret_…`) is not a JWT: it
// goes in apikey alone, and the gateway puts the service_role JWT it stands for in Authorization (Supabase refuses a
// non-JWT key in Authorization unless it equals apikey; we do not lean on that exception).
export function grantHeaders(key: string): Record<string, string> {
  const jwt = /^[\w-]+\.[\w-]+\.[\w-]+$/.test(key);
  return jwt ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key };
}

const json = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

const WRONG = { error: 'invalid_credentials', message: 'Wrong email or password.' };
// What is left to wait, as a person reads it: whole minutes under an hour, whole hours above, rounded up.
export function waitText(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}
const limited = (seconds: number): Response =>
  json(429, { error: 'too_many_attempts', message: `Too many sign-in attempts. Try again in ${waitText(seconds)}.` },
    { 'retry-after': String(seconds) });
// The wait when the gate names none (an older schema.sql's bare 'caller' or 'address'), and when Auth itself limits.
const DEFAULT_WAIT = 900;
const DOWN = { error: 'unavailable', message: 'Reelbook could not sign you in right now. Try again in a moment.' };

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed', message: 'Only POST.' }, { allow: 'POST' });
  if (!/^application\/json\b/i.test(req.headers.get('content-type') || '')) {
    return json(415, { error: 'json_only', message: 'Send JSON: {"email": …, "password": …}.' });
  }
  const text = await req.text();
  if (text.length > BODY_MAX) return json(413, { error: 'too_long', message: 'Too long.' });
  let body: { email?: unknown; password?: unknown } | null = null;
  try { body = JSON.parse(text); } catch { /* answered below */ }
  const email = body && typeof body === 'object' && typeof body.email === 'string' ? body.email.trim() : '';
  const password = body && typeof body === 'object' && typeof body.password === 'string' ? body.password : '';
  if (!email || !password || email.length > EMAIL_MAX || password.length > PASSWORD_MAX) {
    return json(400, { error: 'bad_request', message: 'Send JSON: {"email": …, "password": …}.' });
  }

  const address = await sha256(email.toLowerCase());
  const gate = await deps.rpc('cli_login_gate', { p_caller: await sha256(callerOf(req.headers)), p_address: address });
  if (gate.error) {
    console.error('cli-login: gate failed', String(gate.error.code || 'unknown'));
    return json(502, DOWN);
  }
  // 'ok:<series>': the gate reserved an attempt for the address in that series. 'caller:<seconds>' or
  // 'address:<seconds>': refused, for that long (bare, from an older schema.sql: 15 minutes). Anything else (an older
  // schema.sql's bare 'ok' included) is refused too, before Auth is asked.
  const passed = typeof gate.data === 'string' && /^ok:\S+$/.test(gate.data);
  if (!passed) {
    const wait = typeof gate.data === 'string' ? /^(?:caller|address):(\d{1,6})$/.exec(gate.data) : null;
    return limited(wait ? Math.max(1, Number(wait[1])) : DEFAULT_WAIT);
  }
  const reservedIn = (gate.data as string).slice(3);
  // Anything but a wrong password settles the attempt, in that series only: a success puts the address back to the
  // first level, any other outcome gives the attempt back.
  const settle = async (fn: 'cli_login_release' | 'cli_login_succeeded') => {
    const r = await deps.rpc(fn, { p_address: address, p_window: reservedIn });
    if (r.error) console.error(`cli-login: ${fn} failed`, String(r.error.code || 'unknown'));
    return !r.error;
  };
  const release = () => settle('cli_login_release');
  // An older schema.sql has no cli_login_succeeded(): the attempt is then at least given back.
  const succeeded = async () => { if (!(await settle('cli_login_succeeded'))) await release(); };

  let answer: Awaited<ReturnType<Grant>>;
  try { answer = await deps.grant(email, password); } catch {
    console.error('cli-login: auth unreachable');
    await release();
    return json(502, DOWN);
  }
  const b = answer.body || {};
  const user = (b.user && typeof b.user === 'object' ? b.user : {}) as Record<string, unknown>;
  if (answer.status === 200 && typeof b.access_token === 'string' && typeof b.refresh_token === 'string' && typeof user.id === 'string') {
    await succeeded();
    return json(200, {
      access_token: b.access_token, refresh_token: b.refresh_token, expires_in: b.expires_in, expires_at: b.expires_at,
      token_type: b.token_type, user: { id: user.id },
    });
  }
  const code = String(b.error_code || b.error || '');
  // Auth answers email_not_confirmed only once the password matched: it tells nothing to someone without it.
  if (code === 'email_not_confirmed') {
    await release();
    return json(403, { error: 'email_not_confirmed', message: 'Confirm your email first (the code Reelbook sent you).' });
  }
  // The service key did not exempt the call (not an admin role, or Auth changed): the operator's problem, not a wrong
  // password, so nothing is counted against the address.
  if (code === 'captcha_failed') {
    console.error('cli-login: auth still asked a captcha (is SUPABASE_SERVICE_ROLE_KEY the service_role key?)');
    await release();
    return json(502, DOWN);
  }
  if (answer.status === 429) { await release(); return limited(DEFAULT_WAIT); }
  // A wrong password (or an unknown address): the reserved attempt stays counted.
  if (answer.status === 400 || answer.status === 401 || answer.status === 422) return json(401, WRONG);
  console.error('cli-login: auth answered', answer.status, code.slice(0, 40));
  await release();
  return json(502, DOWN);
}
