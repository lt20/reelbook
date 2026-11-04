// Edge Function add-link (L28): the iPhone shortcut's one route.
//
// POST {url, note?} with `Authorization: Bearer <key>` (the key made in Reelbook › Settings › iPhone shortcut).
// The key is looked up by its SHA-256 in public.capture_tokens with the service role (SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are set by Supabase in every Edge Function); a known, unrevoked key within its rate limit
// queues the link as a public.requests row of its account. The logic, tested without a network, is in core.ts.
//
// Deployed without the gateway's JWT check (the key is not a Supabase JWT), BEFORE the capture_tokens section of
// supabase/schema.sql is run (the table is what shows Settings › iPhone shortcut in the app):
//   supabase functions deploy add-link --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './core.ts';

const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

Deno.serve(req => handle(req, client));
