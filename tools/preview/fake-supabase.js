// Fake supabase-js for the Reelbook preview (tools/preview/build.sh). Never shipped in app/.
// Data: window.__FAKE (vendor/fake-data.js) = {user_themes, sheets, sessions, notes, requests, ...}.
// Writes stay in memory (a reload starts again from fake-data.js).
// Query options:
//   ?noauth                         no session: the app shows the sign-in screen
//   ?missing=sessions,practice_log  those tables answer like a backend without them
//                                   (PostgREST PGRST205, HTTP 404); a table.column entry
//                                   (?missing=sheets.search_text): a read selecting that column answers
//                                   42703 « column … does not exist » (HTTP 400), and the rows lose it
//   ?empty=sheets,sessions,...      those tables start with no row (an empty account: ?empty=all)
//   ?quota                          my_quota() answers (L29: the usage line of Settings); without it, PGRST202
//   ?quota=full                     and a new link is refused: « quota: 10 links per day » (P0001, HTTP 400)
// Storage: a signed URL for <user id>/<slug>/<rel> is the local file files/<slug>/<rel>.
(function () {
  const D = window.__FAKE || {};
  const U = {id: 'u1', email: 'demo@reelbook.test'};
  // ?cli: rb.py login has run (#welcome, L43); ?new: an account made a minute ago
  if (new URLSearchParams(location.search).has('cli')) U.user_metadata = {reelbook_cli_at: new Date().toISOString()};
  if (new URLSearchParams(location.search).has('new')) U.created_at = new Date(Date.now() - 60000).toISOString();
  const params = new URLSearchParams(location.search);
  let signedIn = !params.has('noauth');
  const missing = new Set((params.get('missing') || '').split(',').map(s => s.trim()).filter(Boolean));
  for (const t of (params.get('empty') || '').split(',').map(s => s.trim()).filter(Boolean)) {
    if (t === 'all') { for (const k of Object.keys(D)) if (k !== 'user_themes') D[k] = []; } else D[t] = [];
  }
  const local = p => 'files/' + String(p).replace(/^u1\//, '');
  const uid = () => 'fake-' + Math.random().toString(36).slice(2, 10);
  const now = () => new Date().toISOString();
  const DEFAULTS = {
    requests: () => ({id: uid(), status: 'queued', theme: null, slug: null, note: null, created_at: now(), processed_at: null}),
    sessions: () => ({id: uid(), format: '', why: '', key_points: [], source: {}, origin: 'user', thumbnail: '', items: [], created_at: now(), updated_at: now()}),
    sheets: () => ({id: uid(), kind: 'sheet', summary: '', duration: '', thumbnail: '', source: {}, html: '', added_at: now()}),
    notes: () => ({body: '', updated_at: now()}),
    user_themes: () => ({description: '', groups: [], builtin: false, position: 0, created_at: now()}),
    capture_tokens: () => ({id: uid(), created_at: now(), last_used_at: null, revoked_at: null}) // L28
  };
  const KEYS = {notes: ['slug'], user_themes: ['id'], sheets: ['slug'], sessions: ['slug']};
  const clone = v => JSON.parse(JSON.stringify(v));
  const cmp = (a, b) => (a == null) - (b == null) || (a < b ? -1 : a > b ? 1 : 0);

  class Query {
    constructor(table) { this.t = table; this.f = []; this.op = 'select'; this.one = 0; this.sorts = []; this.max = null; this.opts = {}; }
    select(cols) { this.cols = String(cols || '').split(',').map(c => c.trim().replace(/"/g, '')); return this; }
    order(col, {ascending = true} = {}) { this.sorts.push([col, ascending]); return this; }
    limit(n) { this.max = n; return this; }
    range(from, to) { this.from = from; this.max = to - from + 1; return this; }
    eq(k, v) { this.f.push(r => r[k] === v); return this; }
    neq(k, v) { this.f.push(r => r[k] !== v); return this; }
    in(k, vs) { this.f.push(r => vs.includes(r[k])); return this; }
    gte(k, v) { this.f.push(r => r[k] != null && r[k] >= v); return this; }
    lte(k, v) { this.f.push(r => r[k] != null && r[k] <= v); return this; }
    gt(k, v) { this.f.push(r => r[k] != null && r[k] > v); return this; }
    lt(k, v) { this.f.push(r => r[k] != null && r[k] < v); return this; }
    is(k, v) { this.f.push(r => (v === null ? r[k] == null : r[k] === v)); return this; }
    match(o) { for (const k in o) this.eq(k, o[k]); return this; }
    single() { this.one = 1; return this; }
    maybeSingle() { this.one = 2; return this; }
    insert(r) { this.op = 'insert'; this.row = r; return this; }
    upsert(r, opts = {}) { this.op = 'upsert'; this.row = r; this.opts = opts; return this; }
    update(r) { this.op = 'update'; this.row = r; return this; }
    delete() { this.op = 'delete'; return this; }
    run() {
      if (missing.has(this.t)) {
        return {data: null, status: 404, statusText: 'Not Found', error: {code: 'PGRST205', details: null, hint: null,
          message: `Could not find the table 'public.${this.t}' in the schema cache`}};
      }
      const gone = [...missing].filter(m => m.startsWith(this.t + '.')).map(m => m.slice(this.t.length + 1));
      const asked = gone.find(c => (this.cols || []).includes(c));
      if (asked) {
        return {data: null, status: 400, statusText: 'Bad Request', error: {code: '42703', details: null, hint: null,
          message: `column ${this.t}.${asked} does not exist`}};
      }
      if (this.t === 'requests' && this.op === 'insert' && params.get('quota') === 'full') {
        return {data: null, status: 400, statusText: 'Bad Request', error: {code: 'P0001', details: null,
          hint: 'The count starts again at midnight UTC. For more, ask whoever runs this backend.', message: 'quota: 10 links per day'}};
      }
      const rows = D[this.t] = D[this.t] || [];
      for (const r of rows) for (const c of gone) delete r[c];
      const fresh = r => Object.assign((DEFAULTS[this.t] || (() => ({})))(), clone(r));
      let out;
      if (this.op === 'insert') {
        out = [].concat(this.row).map(fresh);
        rows.push(...out);
      } else if (this.op === 'upsert') {
        const keys = this.opts.onConflict ? this.opts.onConflict.split(',') : (KEYS[this.t] || ['id']);
        out = [].concat(this.row).map(r => {
          const hit = rows.find(x => keys.every(k => x[k] === r[k]));
          if (hit) return Object.assign(hit, clone(r));
          const n = fresh(r); rows.push(n); return n;
        });
      } else {
        out = rows.filter(r => this.f.every(f => f(r)));
        if (this.op === 'update') out.forEach(r => Object.assign(r, clone(this.row)));
        if (this.op === 'delete') D[this.t] = rows.filter(r => !out.includes(r));
        if (this.op === 'select') {
          for (const [col, asc] of [...this.sorts].reverse()) out = [...out].sort((a, b) => (asc ? 1 : -1) * cmp(a[col], b[col]));
          if (this.from) out = out.slice(this.from);
          if (this.max != null) out = out.slice(0, this.max);
        }
      }
      let data = clone(out);
      if (this.one) {
        if (data.length > 1 || (this.one === 1 && !data.length)) {
          return {data: null, status: 406, error: {code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null}};
        }
        data = data[0] || null;
      }
      return {data, error: null, status: this.op === 'insert' ? 201 : 200};
    }
    then(ok, ko) { return Promise.resolve().then(() => this.run()).then(ok, ko); }
  }

  window.supabase = {
    createClient() {
      const subs = [];
      const emit = (event, session) => subs.forEach(cb => setTimeout(() => cb(event, session), 0));
      const session = () => (signedIn ? {user: U, access_token: 'fake'} : null);
      return {
        from: t => new Query(t),
        rpc: async name => name === 'my_quota' && params.has('quota')
          ? {data: {requests_today: params.get('quota') === 'full' ? 10 : (D.requests || []).filter(r => String(r.created_at || '').slice(0, 10) === now().slice(0, 10)).length,
              max_requests_per_day: 10, sheets: (D.sheets || []).length, max_sheets: 300, storage_bytes: 80 * 1048576, max_storage_mb: 200}, error: null, status: 200}
          : {data: null, status: 404, error: {code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache (preview)`}},
        storage: {
          from: () => ({
            createSignedUrls: async paths => ({data: paths.map(p => ({path: p, signedUrl: local(p), error: null})), error: null}),
            createSignedUrl: async p => ({data: {signedUrl: local(p)}, error: null}),
            list: async () => ({data: [], error: null}),
            remove: async paths => ({data: paths.map(name => ({name})), error: null}),
            upload: async p => ({data: {path: p}, error: null})
          })
        },
        auth: {
          onAuthStateChange(cb) { subs.push(cb); setTimeout(() => cb('INITIAL_SESSION', session()), 0); return {data: {subscription: {unsubscribe() {}}}}; },
          getSession: async () => ({data: {session: session()}, error: null}),
          getUser: async () => ({data: {user: signedIn ? U : null}, error: null}),
          signInWithPassword: async () => { signedIn = true; emit('SIGNED_IN', session()); return {data: {session: session(), user: U}, error: null}; },
          signUp: async () => ({data: {session: null, user: null}, error: null}),
          signOut: async () => { signedIn = false; emit('SIGNED_OUT', null); return {error: null}; }
        }
      };
    }
  };
})();
