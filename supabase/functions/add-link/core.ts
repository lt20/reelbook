// add-link, the logic (L28): no import, so that it runs as is under Deno (`deno eval --no-remote`, `deno test`) and
// is tested with a stubbed client (core.test.ts). index.ts only wires it to Deno.serve and the service-role client.
//
// POST {url, note?} with `Authorization: Bearer <key>`: the key is looked up by its SHA-256 in capture_tokens;
// unknown or revoked → 401; more than RATE_MAX links in RATE_WINDOW_MS for that key → 429; a link the app would
// refuse → 400; otherwise one requests row for the key's account (the database's quota trigger applies: its
// « quota: … » message is sent back as is, 429). Answers are one line of plain text, for the iOS shortcut to show.
// The key is never logged, nor echoed back.

export const RATE_MAX = 10;
export const RATE_WINDOW_MS = 60_000;
export const URL_MAX = 2048;
export const NOTE_MAX = 500;
export const BODY_MAX = 8192;

// The key as the app creates it (Settings › iPhone shortcut): « rb_ » and 32 random bytes in hex.
const KEY = /^Bearer\s+(rb_[0-9a-f]{64})\s*$/;

// The same hosts as the app (okHost in app/index.html).
const okHost = (h: string): boolean =>
  /(^|\.)(instagram|tiktok|youtube|facebook)\.com$/.test(h) || h === 'youtu.be' || h === 'fb.watch';

// The link as stored (URL.toString(), as the app does), or null when the app would refuse it.
export function validateLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > URL_MAX) return null;
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return okHost(u.hostname) ? u.toString() : null;
}

// SHA-256 of the key, lowercase hex: what capture_tokens.token_hash holds (the app hashes the same way).
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

// The few supabase-js calls used here (a stub in the tests).
export type DbError = { code?: string; message?: string } | null;
// deno-lint-ignore no-explicit-any
export type Client = { from(table: string): any };

type TokenRow = { id: string; user_id: string; revoked_at: string | null; window_start: string; window_count: number };
export type Claim = { kind: 'ok'; userId: string } | { kind: 'refused' } | { kind: 'limited' } | { kind: 'error'; code: string };

// Takes one slot of the key's rate-limit window (a fixed window opened by its first link). Compare-and-set on the
// counters read, so two links at once cannot both take the last slot; a lost race reads again (3 tries).
export async function claimSlot(client: Client, hash: string, now: () => Date = () => new Date()): Promise<Claim> {
  for (let i = 0; i < 3; i++) {
    const read = await client.from('capture_tokens')
      .select('id,user_id,revoked_at,window_start,window_count').eq('token_hash', hash).maybeSingle();
    if (read.error) return { kind: 'error', code: String(read.error.code || 'read') };
    const row = read.data as TokenRow | null;
    if (!row || row.revoked_at) return { kind: 'refused' };
    const t = now(), started = Date.parse(row.window_start);
    const fresh = !(t.getTime() - started < RATE_WINDOW_MS);
    if (!fresh && row.window_count >= RATE_MAX) return { kind: 'limited' };
    const next = fresh ? { window_start: t.toISOString(), window_count: 1 } : { window_count: row.window_count + 1 };
    const write = await client.from('capture_tokens').update({ ...next, last_used_at: t.toISOString() })
      .eq('id', row.id).eq('window_start', row.window_start).eq('window_count', row.window_count).is('revoked_at', null)
      .select('id');
    if (write.error) return { kind: 'error', code: String(write.error.code || 'write') };
    if (Array.isArray(write.data) && write.data.length) return { kind: 'ok', userId: row.user_id };
  }
  return { kind: 'limited' };
}

const reply = (status: number, message: string, extra: Record<string, string> = {}): Response =>
  new Response(message + '\n', {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

export async function handle(req: Request, client: Client, now: () => Date = () => new Date()): Promise<Response> {
  if (req.method !== 'POST') return reply(405, 'Only POST.', { allow: 'POST' });
  const key = KEY.exec(req.headers.get('authorization') || '');
  if (!key) return reply(401, 'No Reelbook key. Create one in Reelbook › Settings › iPhone shortcut.');
  const claim = await claimSlot(client, await hashToken(key[1]), now);
  if (claim.kind === 'refused') return reply(401, 'This Reelbook key is unknown or revoked. Create a new one in Settings.');
  if (claim.kind === 'limited') return reply(429, `Too many links: ${RATE_MAX} a minute at most. Try again in a minute.`);
  if (claim.kind === 'error') {
    console.error('add-link: key lookup failed', claim.code);
    return reply(500, 'Reelbook could not check the key right now. Try again in a moment.');
  }

  const text = await req.text();
  if (text.length > BODY_MAX) return reply(413, 'Too long.');
  let body: { url?: unknown; note?: unknown } | null = null;
  try { body = JSON.parse(text); } catch { /* answered below */ }
  if (!body || typeof body !== 'object') return reply(400, 'Send JSON: {"url": "<video link>"}.');
  // Shortcuts may send the URLs of a share as a list, or as one text with a link per line: the first supported one
  // counts (as Paste link in the app).
  const parts = (Array.isArray(body.url) ? body.url : [body.url])
    .flatMap(v => (typeof v === 'string' ? v.trim().split(/\s+/) : [v])).slice(0, 20);
  const url = parts.map(validateLink).find(Boolean) || null;
  if (!url) return reply(400, 'Send an Instagram, TikTok, YouTube or Facebook link.');
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, NOTE_MAX) : '';

  // The normal insert of the app, for that account: the quota trigger of requests applies.
  const row: Record<string, string> = { user_id: claim.userId, url };
  if (note) row.note = note;
  const { error } = await client.from('requests').insert(row);
  if (error) {
    const message = String(error.message || '').trim();
    if (/^quota: /.test(message)) return reply(429, message);
    console.error('add-link: insert failed', error.code || 'unknown');
    return reply(500, 'Reelbook could not queue it right now. Try again in a moment.');
  }
  return reply(201, 'Queued in Reelbook.');
}
