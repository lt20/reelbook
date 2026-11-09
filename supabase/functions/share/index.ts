// Edge Function share (P8 R11): « Send to a training partner ». The link `#s-<token>` of a session_shares row:
//   GET  ?token=        the session's title, notebook, sender's first name and number of exercises (anon key or user);
//   POST {token, dry_run: true}   what the recipient's sheet shows (signed in);
//   POST {token, notebook?}       copies the session, its sheets and their photos into the caller's account.
// The logic, tested without a network, is in core.ts; store.ts reads and writes with the service role
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set by Supabase in every Edge Function).
//
// Deployed WITH the gateway's JWT check (the app sends the user's JWT, or the anon key for GET), BEFORE the
// session_shares section of supabase/schema.sql is run (the table is what turns the share row on in the app):
//   supabase functions deploy share
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './core.ts';
import { supabaseStore } from './store.ts';

const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const store = supabaseStore(client);

Deno.serve(req => handle(req, store));
