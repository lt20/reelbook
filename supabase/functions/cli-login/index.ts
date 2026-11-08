// Edge Function cli-login (L42a): the password grant of `rb.py login` once Turnstile is on. The logic, tested without a
// network, is in core.ts; this file wires it to Deno.serve, the service-role client (cli_login_gate / cli_login_release)
// and Auth's /token, called with the service role so that Auth skips the captcha.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set by Supabase in every Edge Function. The key may be the
// service_role JWT or a secret key (`sb_secret_…`): grantHeaders() in core.ts sends either so that Auth sees the
// service_role in Authorization, which exempts the request from the captcha.
//
// Deployed without the gateway's JWT check (rb.py sends no user JWT, it has none yet), AFTER the cli_login section of
// supabase/schema.sql is run (the function refuses every call while cli_login_gate() is missing):
//   supabase functions deploy cli-login --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2';
import { grantHeaders, handle } from './core.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function grant(email: string, password: string) {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { ...grantHeaders(key), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  let body: Record<string, unknown> | null = null;
  try { body = await r.json(); } catch { /* not JSON: handled as an error by core.ts */ }
  return { status: r.status, body };
}

Deno.serve(req => handle(req, { rpc: (fn, args) => client.rpc(fn, args), grant }));
