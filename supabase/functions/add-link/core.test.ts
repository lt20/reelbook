// Unit tests of add-link's logic with a stubbed client (no network, no Supabase):
//   deno test --no-remote supabase/functions/add-link/core.test.ts
// (also run by tests/add-link.test.cjs when Deno is installed).
import { handle, hashToken, RATE_MAX, validateLink, type Client } from './core.ts';

const eq = (a: unknown, b: unknown, msg = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const ok = (v: unknown, msg: string) => { if (!v) throw new Error(msg); };

const KEY = 'rb_' + '0123456789abcdef'.repeat(4);
const T0 = new Date('2026-11-04T10:00:00.000Z');

type Row = Record<string, unknown>;
type Call = [string, string, unknown, [string, unknown][]];

// A stub of the supabase-js calls core.ts makes: select…eq…maybeSingle on capture_tokens, a conditional
// update…eq…is…select, an insert on requests. Writes are journaled; update applies its filters like PostgREST.
function stub(tokens: Row[], opts: { insertError?: { code?: string; message?: string }; readError?: boolean } = {}) {
  const calls: Call[] = [];
  const client: Client = {
    from(table: string) {
      const ops: [string, ...unknown[]][] = [];
      const run = () => {
        const filters = ops.filter(o => o[0] === 'eq' || o[0] === 'is').map(o => [o[1], o[2]] as [string, unknown]);
        const match = (r: Row) => filters.every(([c, v]) => (r[c] ?? null) === v);
        const write = ops.find(o => o[0] === 'update' || o[0] === 'insert');
        if (write) {
          calls.push([write[0], table, write[1], filters]);
          if (write[0] === 'insert') return { data: null, error: opts.insertError || null };
          const hit = tokens.filter(match);
          hit.forEach(r => Object.assign(r, write[1] as Row));
          return { data: hit.map(r => ({ id: r.id })), error: null };
        }
        if (opts.readError) return { data: null, error: { code: '57014' } };
        const found = tokens.find(match);
        return { data: found ? { ...found } : null, error: null }; // a copy, as over the network
      };
      const q: Record<string, unknown> = new Proxy({}, {
        get: (_, k) => k === 'then'
          ? (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve().then(run).then(res, rej)
          : (...a: unknown[]) => { ops.push([String(k), ...a]); return q; },
      });
      return q;
    },
  };
  return { client, calls, inserts: () => calls.filter(c => c[0] === 'insert') };
}

const token = async (extra: Row = {}): Promise<Row> => ({
  id: 'tok-1', user_id: 'u1', token_hash: await hashToken(KEY), revoked_at: null,
  window_start: '2026-11-04T09:00:00.000Z', window_count: 0, last_used_at: null, ...extra,
});
const post = (body: unknown, auth: string | null = `Bearer ${KEY}`, method = 'POST') =>
  new Request('https://fn.example.test/add-link', {
    method, headers: auth ? { authorization: auth } : {}, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
const reel = 'https://www.instagram.com/reel/abc/';

Deno.test('validateLink: the app hosts only, as URL.toString()', () => {
  eq(validateLink(' https://youtu.be/abc '), 'https://youtu.be/abc');
  eq(validateLink('https://m.facebook.com/watch/?v=1'), 'https://m.facebook.com/watch/?v=1');
  for (const bad of [null, 42, '', 'ftp://www.instagram.com/reel/x', 'https://instagram.com.evil.test/', 'https://notinstagram.org/', 'https://' + 'a'.repeat(3000) + '.instagram.com/']) {
    eq(validateLink(bad), null, String(bad).slice(0, 40));
  }
});

Deno.test('hashToken: SHA-256 hex of the key', async () => {
  eq(await hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

Deno.test('a known key queues one requests row for its account and takes a slot', async () => {
  const row = await token(), s = stub([row]);
  const res = await handle(post({ url: reel, note: '  from the bus  ' }), s.client, () => T0);
  eq(res.status, 201); eq((await res.text()).trim(), 'Queued in Reelbook.');
  eq(s.inserts(), [['insert', 'requests', { user_id: 'u1', url: reel, note: 'from the bus' }, []]]);
  eq(row.window_count, 1); eq(row.window_start, T0.toISOString()); eq(row.last_used_at, T0.toISOString());
  const upd = s.calls.find(c => c[0] === 'update')!;
  eq(upd[3], [['id', 'tok-1'], ['window_start', '2026-11-04T09:00:00.000Z'], ['window_count', 0], ['revoked_at', null]]);
});

Deno.test('unknown, revoked, missing or malformed keys are refused without any write', async () => {
  const cases: [string | null, Row[]][] = [
    [`Bearer ${KEY}`, []],
    [`Bearer ${KEY}`, [await token({ revoked_at: '2026-11-04T09:30:00Z' })]],
    [null, [await token()]],
    [`Basic ${KEY}`, [await token()]],
    ['Bearer rb_short', [await token()]],
  ];
  for (const [auth, tokens] of cases) {
    const s = stub(tokens);
    const res = await handle(post({ url: reel }, auth), s.client, () => T0);
    eq(res.status, 401, String(auth));
    eq(s.calls, [], String(auth));
  }
});

Deno.test('only POST', async () => {
  const s = stub([await token()]);
  const res = await handle(post(null, `Bearer ${KEY}`, 'GET'), s.client, () => T0);
  eq(res.status, 405); eq(res.headers.get('allow'), 'POST'); eq(s.calls, []);
});

Deno.test('an invalid body or an unsupported link is refused, nothing queued', async () => {
  for (const body of ['not json', 'null', { url: 'https://example.test/v' }, { url: 'javascript:alert(1)' }, {}]) {
    const s = stub([await token()]);
    const res = await handle(post(body), s.client, () => T0);
    eq(res.status, 400, JSON.stringify(body)); eq(s.inserts(), []);
  }
});

Deno.test(`rate limit: ${RATE_MAX} links a minute per key, then 429 until the window ends`, async () => {
  const row = await token(), s = stub([row]);
  let t = T0.getTime();
  for (let i = 0; i < RATE_MAX; i++) eq((await handle(post({ url: reel }), s.client, () => new Date(t += 1000))).status, 201, `link ${i + 1}`);
  const limited = await handle(post({ url: reel }), s.client, () => new Date(t += 1000));
  eq(limited.status, 429); eq(s.inserts().length, RATE_MAX);
  // the window opened at T0 + 1 s: one minute later a new one starts
  eq((await handle(post({ url: reel }), s.client, () => new Date(T0.getTime() + 61_000))).status, 201);
  eq(row.window_count, 1);
});

Deno.test('a lost race on the counters reads again; three lost races answer 429', async () => {
  const row = await token(), s = stub([row]);
  const client: Client = {
    from(table: string) {
      const q = s.client.from(table);
      // another request bumps the counter between this read and this write, every time
      if (table === 'capture_tokens') return new Proxy(q, { get: (t, k) => k === 'update' ? (v: Row) => { row.window_count = (row.window_count as number) + 1; return t.update(v); } : t[k as string] });
      return q;
    },
  };
  const res = await handle(post({ url: reel }), client, () => T0);
  eq(res.status, 429); eq(s.inserts(), []);
});

Deno.test('a list of URLs, or one link per line: the first one is queued', async () => {
  for (const url of [[reel, 'https://youtu.be/b'], `${reel}\nhttps://youtu.be/b`]) {
    const s = stub([await token()]);
    eq((await handle(post({ url }), s.client, () => T0)).status, 201);
    eq((s.inserts()[0][2] as Row).url, reel);
  }
});

Deno.test("the database's quota message is sent back as is", async () => {
  const s = stub([await token()], { insertError: { code: 'P0001', message: 'quota: 10 links per day' } });
  const res = await handle(post({ url: reel }), s.client, () => T0);
  eq(res.status, 429); eq((await res.text()).trim(), 'quota: 10 links per day');
});

Deno.test('the key never reaches a log nor an answer', async () => {
  const seen: string[] = [];
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(saved) as (keyof typeof saved)[]) console[k] = (...a: unknown[]) => { seen.push(a.map(String).join(' ')); };
  try {
    const answers: string[] = [];
    for (const s of [stub([await token()]), stub([], {}), stub([await token()], { readError: true }), stub([await token()], { insertError: { code: 'XX000', message: 'boom ' + KEY } })]) {
      answers.push(await (await handle(post({ url: reel }), s.client, () => T0)).text());
    }
    ok(seen.length > 0, 'errors are logged (by code)');
    for (const line of [...seen, ...answers]) ok(!line.includes(KEY) && !line.includes(KEY.slice(3)), 'key leaked: ' + line);
  } finally { Object.assign(console, saved); }
});
