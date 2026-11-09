// share (P8 R11): the Store of core.ts over supabase-js, with the service role. No import either: it takes the client
// made in index.ts. Every call checks its error and throws {code, message} for core.ts to answer.
import type { Recipient, Row, Share, Store, Theme } from './core.ts';

// deno-lint-ignore no-explicit-any
type Client = any;
// deno-lint-ignore no-explicit-any
// PostgREST answers at most db-max-rows rows (1 000 on Supabase), to a table read or a function returning a set: a list
// that may be longer is read page by page, in a stable order (share_files: by name, unique in the bucket).
export const PAGE = 1000;
const COPY_COLS = 'id,slug,theme,source,created_at';
const check = <T>(r: { data: T; error: any }): T => {
  if (r.error) throw { code: String(r.error.code || r.error.statusCode || 'error'), message: String(r.error.message || '') };
  return r.data;
};

export function supabaseStore(client: Client): Store {
  const db = (t: string) => client.from(t);
  const bucket = () => client.storage.from('sheets');
  return {
    async user(jwt) {
      const { data, error } = await client.auth.getUser(jwt);
      return error || !data || !data.user ? null : String(data.user.id);
    },
    async share(token) {
      return check(await db('session_shares').select('token,owner,session_id,sender_name,revoked_at').eq('token', token).maybeSingle()) as Share | null;
    },
    async session(owner, id) {
      return check(await db('sessions').select('*').eq('user_id', owner).eq('id', id).maybeSingle()) as Row | null;
    },
    async sheets(owner, slugs) {
      return (check(await db('sheets').select('*').eq('user_id', owner).in('slug', slugs)) || []) as Row[];
    },
    async theme(owner, id) {
      return check(await db('user_themes').select('id,title,description,groups,builtin,position').eq('user_id', owner).eq('id', id).maybeSingle()) as Theme | null;
    },
    async themes(uid) {
      return (check(await db('user_themes').select('id,title,position').eq('user_id', uid)) || []) as Theme[];
    },
    async copyOf(uid, token) {
      const rows = check(await db('sessions').select(COPY_COLS).eq('user_id', uid).eq('source->>share', token).limit(1)) as Row[] | null;
      return rows && rows.length ? rows[0] : null;
    },
    async copying(uid) {
      const rows = check(await db('sessions').select(COPY_COLS).eq('user_id', uid).eq('source->>share_state', 'copying').limit(1)) as Row[] | null;
      return rows && rows.length ? rows[0] : null;
    },
    async recipient(uid, urls, stems, sesStem) {
      const r = check(await client.rpc('share_recipient', { p_uid: uid, p_urls: urls, p_stems: stems, p_ses_stem: sesStem })) as Recipient;
      return { ...r, have: r.have || [], taken: r.taken || [], ses_taken: r.ses_taken || [] };
    },
    async files(owner, slugs) {
      // every page: the copy and the quota both need all of them (a session may hold more than 1 000 photos). Up to an
      // empty page, so that a server capping lower than PAGE is read whole too.
      const out: { name: string; size: number }[] = [];
      for (;;) {
        const rows = (check(await client.rpc('share_files', { p_owner: owner, p_slugs: slugs }).order('name').range(out.length, out.length + PAGE - 1)) || []) as { name: string; size: number }[];
        if (!rows.length) return out;
        for (const r of rows) out.push({ name: String(r.name), size: Number(r.size) || 0 });
      }
    },
    async insertTheme(row) { check(await db('user_themes').insert(row)); },
    async insertSession(row) { check(await db('sessions').insert(row)); },
    async finishSession(uid, id, patch) {
      const rows = check(await db('sessions').update(patch).eq('user_id', uid).eq('id', id).eq('source->>share_state', 'copying').select('id')) as Row[] | null;
      return !!(rows && rows.length);
    },
    async insertSheet(row) { check(await db('sheets').insert(row)); },
    // One statement: « delete … where id = <observed> and share_state = 'copying' » — a copy finished meanwhile stays.
    async dropReservation(uid, id) { check(await db('sessions').delete().eq('user_id', uid).eq('id', id).eq('source->>share_state', 'copying')); },
    async deleteSheets(uid, slugs) { check(await db('sheets').delete().eq('user_id', uid).in('slug', slugs)); },
    async copyFile(from, to) { check(await bucket().copy(from, to)); },
    async removeFiles(paths) { check(await bucket().remove(paths)); },
  };
}
