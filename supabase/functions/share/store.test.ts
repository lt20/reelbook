// store.ts over a fake supabase-js client (no network): what PostgREST's row cap does to the calls that return a list.
//   deno test --no-remote supabase/functions/share/store.test.ts
import { PAGE, supabaseStore } from './store.ts';

const ok = (v: unknown, msg: string) => { if (!v) throw new Error(msg); };
const eq = (a: unknown, b: unknown, msg = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};

// A client whose rpc answers like PostgREST with db-max-rows = cap: at most `cap` rows, in the order asked, from the
// range asked (no range: the first `cap`).
function client(rows: { name: string; size: number }[], cap: number) {
  const calls: unknown[][] = [];
  return {
    calls,
    rpc(name: string, args: unknown) {
      const q = { name, args, order: '' as string, from: 0, to: Infinity };
      const b = {
        order(col: string) { q.order = col; calls.push(['order', col]); return b; },
        range(from: number, to: number) { q.from = from; q.to = to; calls.push(['range', from, to]); return b; },
        then(ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) {
          const all = q.order === 'name' ? [...rows].sort((x, y) => (x.name < y.name ? -1 : 1)) : rows;
          const page = all.slice(q.from, Math.min(q.to + 1, all.length)).slice(0, cap);
          return Promise.resolve({ data: page, error: null }).then(ok, ko);
        },
      };
      calls.push(['rpc', name]);
      return b;
    },
  };
}

const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `u1/s/img/${String(n - i).padStart(5, '0')}.jpg`, size: 10 }));

Deno.test('6. share_files is read page by page, ordered by name: 1 001 photos all come back (copy and quota see them all)', async () => {
  const c = client(photos(PAGE + 1), PAGE);
  const got = await supabaseStore(c).files('u1', ['s']);
  eq(got.length, PAGE + 1);
  eq(new Set(got.map(f => f.name)).size, PAGE + 1, 'no photo twice');
  eq(got.reduce((n, f) => n + f.size, 0), (PAGE + 1) * 10, 'the bytes counted for the quota');
  eq(c.calls.filter(x => x[0] === 'order').every(x => x[1] === 'name'), true, 'a stable order on every page');
});

Deno.test('6. share_files on a server capping lower than PAGE still reads everything', async () => {
  const c = client(photos(1234), 500);
  eq((await supabaseStore(c).files('u1', ['s'])).length, 1234);
});

// A client whose from('sessions') records the filters of each call.
function tableClient() {
  const calls: unknown[][] = [];
  return {
    calls,
    from(table: string) {
      const ops: unknown[][] = [['from', table]];
      const b: Record<string, unknown> = {};
      for (const k of ['select', 'update', 'delete', 'insert', 'eq', 'in', 'limit']) b[k] = (...a: unknown[]) => { ops.push([k, ...a]); return b; };
      b.then = (ok: (v: unknown) => unknown) => { calls.push(ops); return Promise.resolve({ data: ops.some(o => o[0] === 'update') ? [{ id: 'r1' }] : [], error: null }).then(ok); };
      return b;
    },
  };
}

Deno.test('pass 2 #2. the reservation is deleted and finished by id and state, never by slug', async () => {
  const c = tableClient(), s = supabaseStore(c);
  await s.dropReservation('u1', 'r1');
  eq(c.calls[0], [['from', 'sessions'], ['delete'], ['eq', 'user_id', 'u1'], ['eq', 'id', 'r1'], ['eq', 'source->>share_state', 'copying']]);
  eq(await s.finishSession('u1', 'r1', { items: [] }), true);
  eq(c.calls[1], [['from', 'sessions'], ['update', { items: [] }], ['eq', 'user_id', 'u1'], ['eq', 'id', 'r1'], ['eq', 'source->>share_state', 'copying'], ['select', 'id']]);
  ok(!JSON.stringify(c.calls).includes('slug'), 'no slug in either');
});

// P12: a client whose session_shares has no sheet_id column yet (`fresh`: false) or has it.
function sharesClient(fresh: boolean) {
  const calls: unknown[][] = [];
  return {
    calls,
    from(table: string) {
      const ops: unknown[][] = [['from', table]];
      const b: Record<string, unknown> = {};
      for (const k of ['select', 'eq', 'limit', 'delete']) b[k] = (...a: unknown[]) => { ops.push([k, ...a]); return b; };
      const answer = () => {
        calls.push(ops);
        const cols = String((ops.find(o => o[0] === 'select') || [])[1] || '');
        if (cols.includes('sheet_id') && !fresh) return { data: null, error: { code: '42703', message: 'column session_shares.sheet_id does not exist' } };
        if (ops.some(o => o[0] === 'delete')) return { data: [], error: null };
        return { data: { token: 't', owner: 'o', session_id: 's', ...(cols.includes('sheet_id') ? { sheet_id: null } : {}), sender_name: 'L', revoked_at: null }, error: null };
      };
      b.maybeSingle = () => Promise.resolve(answer());
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve(answer()).then(ok);
      return b;
    },
  };
}

Deno.test('P12: a table without sheet_id (the function deployed before the SQL) — the share is read as before, a session link opens', async () => {
  const old = sharesClient(false), got = await supabaseStore(old).share('t');
  eq(got, { token: 't', owner: 'o', session_id: 's', sender_name: 'L', revoked_at: null });
  eq(old.calls.length, 2, 'asked with sheet_id, then without');
  const now = sharesClient(true);
  eq((await supabaseStore(now).share('t'))!.sheet_id, null);
  eq(now.calls.length, 1, 'one read once the column exists');
});

Deno.test('P12: the end of a sheet copy deletes its reservation by id and state, and says whether one was deleted', async () => {
  const c = sharesClient(true);
  eq(await supabaseStore(c).endReservation('u1', 'r1'), false, 'nothing deleted');
  eq(c.calls[0], [['from', 'sessions'], ['delete'], ['eq', 'user_id', 'u1'], ['eq', 'id', 'r1'], ['eq', 'source->>share_state', 'copying'], ['select', 'id']]);
});
