// share, the logic (P8 R11): no remote import, so that it runs as is under Deno (`deno test --no-remote`) and is tested
// with an in-memory store (core.test.ts). index.ts wires it to Deno.serve; store.ts is the store over supabase-js
// (service role); clean.ts cuts a copied sheet's html down to what templates/ write.
//
// GET  ?token=<22 chars>                       → 200 {sender_name, title, notebook_title, count}, or 404. Works with
//      the anon key too (the page for people without an account, R12): no photo, no exercise list.
// POST {token, dry_run: true}  (signed in)     → 200 what the recipient's sheet shows: the title, the exercises
//      (title, dose, credit, whether the recipient already has that sheet), the sender's notebook, the finished copy.
// POST {token, notebook?}      (signed in)     → 201 {slug, notebook, existing: false}, the copy made in the caller's
//      account, or 200 {…, existing: true} when this caller already copied this token, or 409 {error: 'copying'}
//      while another request of this caller is still making a copy (this one, or another token's: one at a time).
// Answers are JSON; an error is {error: <code>, message: <a sentence the app can show>}.
//
// Never read, never copied: notes, practice_log, account quotas. Photos are copied only into the caller's own
// folder (<caller>/<slug>/…). The copy is reserved (one at a time per caller), then planned (dedup by video URL and
// title or anchor, free slugs, the photos' size against the caller's quotas) before any sheet or photo is written:
// a copy over quota leaves nothing.
// Once the copy is done, the glossary words of the copied sheets follow (P11 G5, words.ts): that step never fails
// the copy, and a backend without the glossary tables shares without it.
import { cleanHtml } from './clean.ts';
import { type Copied, copyWords } from './words.ts';
export { cleanHtml };

export const TOKEN = /^[A-Za-z0-9_-]{22}$/;
export const NOTEBOOK = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const SLUG_MAX = 80;
export const BODY_MAX = 4096;
const MB = 1048576;
// A reservation (a copy started, sessions.source.share_state 'copying') older than this was left by a run that died
// (an Edge Function runs 400 s at most): it is deleted and the copy made again.
export const STALE_MS = 10 * 60 * 1000;

export type Row = Record<string, unknown>;
// session_id: the sender's session (sessions.id, immutable); the share row goes with the session (on delete cascade).
export type Share = { token: string; owner: string; session_id: string | null; sender_name: string; revoked_at: string | null };
export type Theme = { id: string; title: string; description?: string; groups?: unknown; builtin?: boolean; position?: number };
export type Room = { storage_bytes: number; max_storage_mb: number; sheets: number; max_sheets: number };
export type Recipient = {
  have: { url: string; slug: string; title: string }[]; // every sheet of the caller with one of these video URLs
  taken: string[];     // sheet slugs in use (sheets, storage folders, notes) starting with one of the stems
  ses_taken: string[]; // session slugs in use (sessions, and notes kept by deleted sessions) starting with the stem
  room: Room | null;
  photo_lock: { message: string; hint: string | null } | null;
};
export type StoreError = { code?: string; message?: string };

// What the function reads and writes, with the service role. Each method throws a StoreError on failure.
export interface Store {
  user(jwt: string): Promise<string | null>; // the caller's id, or null (anon key, expired or bad token)
  share(token: string): Promise<Share | null>;
  session(owner: string, id: string): Promise<Row | null>; // by sessions.id
  sheets(owner: string, slugs: string[]): Promise<Row[]>; // every column (select *)
  theme(owner: string, id: string): Promise<Theme | null>;
  themes(uid: string): Promise<Theme[]>;
  copyOf(uid: string, token: string): Promise<Row | null>; // id, slug, theme, source, created_at of the caller's session with source->>'share' = token
  copying(uid: string): Promise<Row | null>; // the same columns of the caller's reservation (share_state 'copying'), any token
  recipient(uid: string, urls: string[], stems: string[], sesStem: string): Promise<Recipient>; // rpc share_recipient
  files(owner: string, slugs: string[]): Promise<{ name: string; size: number }[]>; // rpc share_files, every page
  insertTheme(row: Row): Promise<void>;
  insertSession(row: Row): Promise<void>; // the reservation, with its id
  // The reservation becomes the copy (source with share_state 'done', items, thumbnail): by id, only while it is still
  // a reservation. False when no row was changed (it was deleted meanwhile).
  finishSession(uid: string, id: string, patch: Row): Promise<boolean>;
  insertSheet(row: Row): Promise<void>;
  dropReservation(uid: string, id: string): Promise<void>; // delete by id, only while share_state is 'copying'
  deleteSheets(uid: string, slugs: string[]): Promise<void>;
  copyFile(from: string, to: string): Promise<void>; // within the sheets bucket
  removeFiles(paths: string[]): Promise<void>;
  // The glossary (P11 G5, words.ts), after the copy is done: the entries only, never the marks of the glossary pass.
  // Any of these may throw on a backend without the table.
  words(uid: string, themes: string[]): Promise<Row[]>; // every entry (select *) of these notebooks of an account, every page
  insertWord(row: Row): Promise<void>; // with its user_id; 23505 when the notebook already has the term and sense
  // forms and sheets of one entry, by id, only while its updated_at is still the one read. False when no row changed.
  updateWord(uid: string, id: string, seen: string, patch: Row): Promise<boolean>;
}

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
  });
const fail = (status: number, error: string, message: string) => json(status, { error, message });

// A backend without the session_shares section: PostgREST's « table not in the schema cache », Postgres' « relation
// does not exist », or an rpc not found.
const notReady = (e: unknown): boolean => {
  const c = String((e as StoreError | null)?.code || '');
  return c === 'PGRST205' || c === '42P01' || c === 'PGRST202' || c === '42883';
};
const isUnique = (e: unknown) => String((e as StoreError | null)?.code || '') === '23505';
const quotaMessage = (e: unknown): string | null => {
  const m = String((e as StoreError | null)?.message || '').trim();
  return /^quota: /.test(m) ? m : null;
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {});
const items = (session: Row): Row[] => (Array.isArray(session.items) ? session.items : []).filter(i => i && typeof i === 'object' && str((i as Row).slug)) as Row[];
const urlOf = (sheet: Row): string => str(obj(sheet.source).url).trim();

// The first free slug: base, then base-2, base-3… (cut so that it stays within SLUG_MAX).
export function freeSlug(base: string, taken: Set<string>): string {
  const b = base.slice(0, SLUG_MAX);
  if (!taken.has(b)) return b;
  for (let i = 2; ; i++) {
    const tail = `-${i}`, s = b.slice(0, SLUG_MAX - tail.length) + tail;
    if (!taken.has(s)) return s;
  }
}

// The stem under which freeSlug's candidates for base are all found: base cut as freeSlug cuts it for a suffix of up
// to 9 digits (« -999999999 »). Collisions are gathered by this stem, so that « <base cut to 78>-2 » counts.
export const slugStem = (base: string): string => base.slice(0, SLUG_MAX - 10);

// One exercise, across accounts: the same video URL and the same title (case and spaces aside) or the same anchor
// (the slug's end: rb.py names the sheets of a video session « <session slug>-<anchor> »). Never the URL alone: the
// sheets of one video session share it.
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export function sameExercise(a: { url: string; slug: string; title: string }, b: { url: string; slug: string; title: string }): boolean {
  if (!a.url || a.url !== b.url) return false;
  if (norm(a.title) && norm(a.title) === norm(b.title)) return true;
  return a.slug === b.slug;
}
const stateOf = (row: Row | null): string => str(obj(row && row.source).share_state);
const stale = (row: Row): boolean => Date.now() - Date.parse(str(row.created_at)) > STALE_MS;

// Storage paths written inside a copied sheet (its html, thumbnail, exercises): « <owner>/<slug>/ » becomes
// « <caller>/<new slug>/ ». Paths relative to the sheet's folder (img/01.jpg, as the templates write them) stay.
export const rewritePaths = (text: string, from: string, to: string): string => text.split(from).join(to);

// The sender's session and the sheets it lists (those that still exist, in order, one entry per sheet).
async function load(store: Store, token: string) {
  const share = await store.share(token);
  if (!share || share.revoked_at) return null;
  if (!share.session_id) return null;
  const session = await store.session(share.owner, share.session_id);
  if (!session) return null;
  const list = items(session), slugs = [...new Set(list.map(i => str(i.slug)))];
  const rows = slugs.length ? await store.sheets(share.owner, slugs) : [];
  const bySlug = new Map(rows.map(r => [str(r.slug), r]));
  const used = list.filter(i => bySlug.has(str(i.slug)));
  return { share, session, used, sheets: slugs.filter(s => bySlug.has(s)).map(s => bySlug.get(s) as Row) };
}

async function notebookOf(store: Store, owner: string, id: string): Promise<{ id: string; title: string; row: Theme | null }> {
  const row = id ? await store.theme(owner, id) : null;
  return { id, title: (row && str(row.title)) || id, row };
}

// GET: what a link shows before anything else, to anybody holding it.
async function preview(store: Store, token: string): Promise<Response> {
  const got = await load(store, token);
  if (!got) return fail(404, 'not_found', 'This link no longer works. Ask for a new one.');
  const nb = await notebookOf(store, got.share.owner, str(got.session.theme));
  return json(200, { sender_name: got.share.sender_name, title: str(got.session.title), notebook_title: nb.title, count: got.used.length });
}

type Body = { token?: unknown; notebook?: unknown; dry_run?: unknown };

export async function handle(req: Request, store: Store): Promise<Response> {
  try {
    return await route(req, store);
  } catch (e) {
    if (notReady(e)) return fail(503, 'not_ready', "This link can't be opened yet.");
    const q = quotaMessage(e);
    if (q) return fail(403, 'quota', quotaText(q));
    console.error('share: failed', String((e as StoreError | null)?.code || 'unknown'));
    return fail(500, 'failed', 'Reelbook could not do it right now. Try again in a moment.');
  }
}

// « quota: 200 MB of photos » → the sentence the app shows.
export function quotaText(m: string): string {
  const what = m.replace(/^quota:\s*/, '');
  return `Not enough room in your Reelbook for this session (${what}). Delete sheets you no longer need, or ask whoever runs this backend for more.`;
}

async function route(req: Request, store: Store): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method === 'GET') {
    const token = new URL(req.url).searchParams.get('token') || '';
    if (!TOKEN.test(token)) return fail(404, 'not_found', 'This link no longer works. Ask for a new one.');
    return await preview(store, token);
  }
  if (req.method !== 'POST') return fail(405, 'method', 'Only GET and POST.');

  const text = await req.text();
  if (text.length > BODY_MAX) return fail(413, 'too_long', 'Too long.');
  let body: Body | null = null;
  try { body = JSON.parse(text); } catch { /* answered below */ }
  if (!body || typeof body !== 'object') return fail(400, 'bad_request', 'Send JSON: {"token": "…"}.');
  const token = str(body.token);
  if (!TOKEN.test(token)) return fail(404, 'not_found', 'This link no longer works. Ask for a new one.');

  const jwt = /^Bearer\s+(\S+)\s*$/.exec(req.headers.get('authorization') || '');
  const caller = jwt ? await store.user(jwt[1]) : null;
  if (!caller) return fail(401, 'signin', 'Sign in to Reelbook to add this session.');

  const got = await load(store, token);
  if (!got) return fail(404, 'not_found', 'This link no longer works. Ask for a new one.');
  const { share, session, used, sheets } = got;
  if (share.owner === caller) return fail(409, 'own', 'This session is already yours.');

  const senderNb = await notebookOf(store, share.owner, str(session.theme));
  let existing = await store.copyOf(caller, token);
  const urls = [...new Set(sheets.map(urlOf).filter(Boolean))];
  const ident = (s: Row) => ({ url: urlOf(s), slug: str(s.slug), title: str(s.title) });
  const keptOf = (mine: Recipient, s: Row) => urlOf(s) ? mine.have.find(h => sameExercise(ident(s), { url: str(h.url).trim(), slug: str(h.slug), title: str(h.title) })) : undefined;

  if (body.dry_run === true) {
    const mine = await store.recipient(caller, urls, [], '');
    const bySlug = new Map(sheets.map(s => [str(s.slug), s]));
    return json(200, {
      sender_name: share.sender_name, title: str(session.title), count: used.length,
      notebook: { id: senderNb.id, title: senderNb.title },
      items: used.map(i => {
        const s = bySlug.get(str(i.slug)) as Row, h = keptOf(mine, s);
        return { title: str(s.title), dose: str(i.dose), author: str(obj(s.source).author), have: !!h, mine: h ? h.title : null };
      }),
      copy: existing && stateOf(existing) === 'done' ? { slug: str(existing.slug), notebook: str(existing.theme) } : null,
    });
  }

  // This caller's copy of this token: a finished one comes back; a reservation of another request still running
  // answers « still copying »; one left by a run that died is deleted — by its id, and only while it is still a
  // reservation (never by slug: a copy finished meanwhile under that slug stays) — and the copy is made again.
  if (existing && stateOf(existing) !== 'done' && stale(existing)) {
    await store.dropReservation(caller, str(existing.id));
    existing = null;
  }
  if (existing) return answerExisting(store, caller, existing);

  // The notebook: one of the caller's, or the sender's (created for the caller with its title, so its colour).
  const nbId = body.notebook === undefined || body.notebook === null || body.notebook === '' ? senderNb.id : str(body.notebook);
  if (!NOTEBOOK.test(nbId)) return fail(400, 'notebook', 'Choose a notebook.');
  const themes = await store.themes(caller);
  const own = themes.find(t => t.id === nbId);
  if (!own && nbId !== senderNb.id) return fail(400, 'notebook', 'Choose a notebook.');

  // The reservation first (share_state 'copying', no items yet): it is the claim of this (caller, token) — the unique
  // index on (user_id, share) — and the caller's only copy running — the unique index on user_id where share_state is
  // 'copying'. A copy of the same token at the same time answers « still copying this session », a copy of another
  // token « still copying a session »: copies of one account run one after the other, so the plan below (and its quota
  // check) reads a state no other copy is changing. The app hides a reservation (it cannot be opened or edited), and
  // the items are written when the copy is done. Its slug is free among the caller's sessions and the notes kept by
  // deleted ones (the app's rule, takenSlugs): an old note never lands on it.
  const sesBase = (str(session.slug) || 'shared').slice(0, SLUG_MAX);
  const sesTaken = new Set((await store.recipient(caller, [], [], slugStem(sesBase))).ses_taken);
  const resId = crypto.randomUUID();
  const reservation: Row = {
    id: resId, user_id: caller, theme: nbId, title: str(session.title), format: str(session.format), why: str(session.why),
    key_points: Array.isArray(session.key_points) ? session.key_points : [],
    source: { ...obj(session.source), share: token, shared_by: share.sender_name, share_state: 'copying' },
    origin: 'user', thumbnail: '', items: [],
  };
  let sesSlug = '';
  for (let attempt = 0; attempt < 4 && !sesSlug; attempt++) {
    const slug = freeSlug(sesBase, sesTaken);
    try {
      await store.insertSession({ ...reservation, slug });
      sesSlug = slug;
    } catch (e) {
      if (!isUnique(e)) throw e;
      const won = await store.copyOf(caller, token);
      if (won) return answerExisting(store, caller, won);
      const other = await store.copying(caller);
      if (other && !stale(other)) return fail(409, 'copying', 'Still copying a session. Try again in a moment.');
      if (other) { await store.dropReservation(caller, str(other.id)); continue; } // left by a run that died
      sesTaken.add(slug); // the slug was taken meanwhile
    }
  }
  if (!sesSlug) return fail(500, 'failed', 'Reelbook could not do it right now. Try again in a moment.');

  // From here, anything that fails or refuses undoes what this copy wrote, the reservation included.
  const madeSheets: string[] = [], madeFiles: string[] = [];
  let keptCount = 0;
  let wordsOf: Copied[] = [];
  try {
    // The plan: which sheets the caller keeps (the same exercise), the new slugs of the others, their files.
    const stems = [...new Set(sheets.map(s => slugStem(str(s.slug))))];
    const mine = await store.recipient(caller, urls, stems, '');
    const taken = new Set(mine.taken);
    const slugMap = new Map<string, string>(); // sender slug -> caller slug
    const toCopy: { from: Row; slug: string }[] = [];
    for (const s of sheets) {
      const old = str(s.slug), kept = keptOf(mine, s);
      if (kept) { slugMap.set(old, str(kept.slug)); continue; }
      const slug = freeSlug(old, taken);
      taken.add(slug); slugMap.set(old, slug); toCopy.push({ from: s, slug });
    }
    const files = toCopy.length ? await store.files(share.owner, toCopy.map(c => str(c.from.slug))) : [];
    const bytes = files.reduce((n, f) => n + (Number(f.size) || 0), 0);
    let refused = '';
    if (mine.room) {
      const r = mine.room;
      if (toCopy.length && r.sheets + toCopy.length > r.max_sheets) refused = quotaText(`quota: ${r.max_sheets} sheets`);
      else if (bytes > 0 && r.storage_bytes + bytes > r.max_storage_mb * MB) refused = quotaText(`quota: ${r.max_storage_mb} MB of photos`);
    }
    if (!refused && bytes > 0 && mine.photo_lock) refused = mine.photo_lock.hint || mine.photo_lock.message;
    if (refused) {
      await undo(store, caller, resId, [], []);
      return fail(403, 'quota', refused);
    }

    // The notebook, if the caller does not have it.
    if (!own) {
      const t = senderNb.row;
      const position = themes.reduce((m, x) => Math.max(m, Number(x.position) || 0), -1) + 1;
      try {
        await store.insertTheme({ user_id: caller, id: nbId, title: (t && str(t.title)) || nbId, description: (t && str(t.description)) || '',
          groups: t && Array.isArray(t.groups) ? t.groups : [], builtin: t ? t.builtin !== false : true, position });
      } catch (e) { if (!isUnique(e)) throw e; } // made by a copy at the same time
    }

    // The sheets and their photos.
    for (const c of toCopy) {
      const old = str(c.from.slug), from = `${share.owner}/${old}/`, to = `${caller}/${c.slug}/`;
      for (const f of files.filter(f => f.name.startsWith(from))) {
        const dest = to + f.name.slice(from.length);
        await store.copyFile(f.name, dest);
        madeFiles.push(dest);
      }
      const row: Row = {};
      for (const [k, v] of Object.entries(c.from)) if (!['id', 'user_id', 'added_at', 'updated_at'].includes(k)) row[k] = v;
      row.user_id = caller; row.slug = c.slug; row.theme = nbId;
      row.html = cleanHtml(rewritePaths(str(c.from.html), from, to)); // another account's html: templates/ only
      row.thumbnail = rewritePaths(str(c.from.thumbnail), from, to);
      if (Array.isArray(c.from.exercises)) row.exercises = JSON.parse(rewritePaths(JSON.stringify(c.from.exercises), from, to));
      await store.insertSheet(row);
      madeSheets.push(c.slug);
    }

    // Done: the reservation becomes the copy, with all its items (rewritten to the caller's slugs, extra keys kept)
    // and its thumbnail (moved when it pointed to a copied sheet, else empty: the first item's). Written whole, so an
    // edit of the reservation meanwhile (another tab) cannot have dropped any.
    const thumb = str(session.thumbnail), m = /^[^/]+\/([^/]+)\/(.+)$/.exec(thumb);
    const copied = m && toCopy.find(c => str(c.from.slug) === m[1]);
    const finished = await store.finishSession(caller, resId, {
      source: { ...(reservation.source as Row), share_state: 'done' },
      items: items(session).filter(i => slugMap.has(str(i.slug))).map(i => ({ ...i, slug: slugMap.get(str(i.slug)) })),
      thumbnail: m && copied ? `${caller}/${copied.slug}/${m[2]}` : '',
    });
    if (!finished) throw { code: 'reservation_gone', message: 'the reservation was deleted meanwhile' };
    keptCount = sheets.length - toCopy.length;
    wordsOf = toCopy;
  } catch (e) {
    await undo(store, caller, resId, madeSheets, madeFiles);
    const q = quotaMessage(e);
    if (q) return fail(403, 'quota', quotaText(q));
    throw e;
  }
  // The copy is done (share_state 'done'): nothing below may undo it. The answer's reads (the notebook title) fall back
  // to what is known when they fail. The glossary words of the copied sheets (P11 G5): copyWords never throws.
  await copyWords(store, share.owner, caller, nbId, wordsOf);
  return json(201, { slug: sesSlug, notebook: await titled(store, caller, nbId), existing: false, kept: keptCount, copied: sheets.length - keptCount });
}

// The caller's copy of this token: finished (share_state 'done': 200, existing), or a reservation still being filled
// by another request (409). Only a finished copy is « existing ».
async function answerExisting(store: Store, uid: string, row: Row): Promise<Response> {
  if (stateOf(row) !== 'done') return fail(409, 'copying', 'Still copying this session. Try again in a moment.');
  return json(200, { slug: str(row.slug), notebook: await titled(store, uid, str(row.theme)), existing: true });
}

// The notebook's id and title for an answer; its id as the title when it cannot be read (the copy stands anyway).
async function titled(store: Store, uid: string, id: string) {
  let t: Theme | null = null;
  try { t = id ? await store.theme(uid, id) : null; } catch (e) { console.error('share: notebook title unread', String((e as StoreError | null)?.code || 'unknown')); }
  return { id, title: (t && str(t.title)) || id };
}

// Undoes a copy that could not finish: its sheets, its photos, and its reservation (by id, only while it is one).
async function undo(store: Store, uid: string, resId: string, sheets: string[], files: string[]) {
  const quiet = async (f: () => Promise<void>) => { try { await f(); } catch (e) { console.error('share: undo failed', String((e as StoreError | null)?.code || 'unknown')); } };
  if (sheets.length) await quiet(() => store.deleteSheets(uid, sheets));
  if (files.length) await quiet(() => store.removeFiles(files));
  await quiet(() => store.dropReservation(uid, resId));
}
