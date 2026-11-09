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
//   ?links=2                        requests: only the first 2 not done, queued (P8 R1: a new account with 2 links sent)
//   ?quota                          my_quota() answers (L29: the usage line of Settings); without it, PGRST202
//   ?quota=full                     and a new link is refused: « quota: 10 links per day » (P0001, HTTP 400)
//   ?confirm=off                    signUp gives a session at once (email confirmation off, today's hosted project)
//   ?own                            nothing here: pick an own backend in the app; a code may be longer than 6 digits
//   ?resend=soon|hour|offline       resend and resetPasswordForEmail answer that (L41); ?net=off: every auth call fails
// Auth (L41), the answers measured on a real Auth (progress/2026-11-07-L41.md), by address (signUp, signIn):
//   exists@…  HTTP 422 user_already_exists · oldexists@…  a user without identities · pending@…  sign-in: email_not_confirmed
//   soon@…  sign-up: « after 42 seconds » · hour@…  sign-up: email rate limit · wrong@…  sign-in: invalid_credentials
// Codes: 123456 good; 111111 otp_expired (HTTP 403, wrong and expired alike); 999999 HTTP 429 over_request_rate_limit;
//   a password « same-password-1 » answers same_password; window.__fakeLink() is the session of an email's link.
// Storage: a signed URL for <user id>/<slug>/<rel> is the local file files/<slug>/<rel>.
// R11, the Edge Function share (functions.invoke('share')) and session_shares: ?share&#s-PREVIEWshareToken00001 is a session
//   « Shadow boxing du mardi » sent by Laurent (3 exercises; the account already has jab-cross by the same video).
//   ?share       (needed for the incoming share) · ?share=gone  the link is revoked · ?share=quota  the copy is refused: « quota: 200 MB of photos »
//   ?share=own   the link is one of this account's own · ?share=done  already copied once
//   ?missing=session_shares  a backend without the table and the function (the share row says « Coming soon »)
//   ?name        the account already has its share name (user_metadata.share_name = Laurent)
// R12, the same link signed out (?noauth&share&#s-PREVIEWshareToken00001): the GET (functions.invoke('share?token=…'))
//   answers the title only; ?invites=<n>  share_invites and my_invites answer {left: n} (absent: PGRST202, no invite line);
//   with ?seats=50 the beta is full (the invite line, or the waiting list with ?invites=0)
(function () {
  const D = window.__FAKE || {};
  const U = {id: 'u1', email: 'demo@reelbook.test'};
  // ?cli: rb.py login has run (#welcome, L43); ?new: an account made a minute ago
  if (new URLSearchParams(location.search).has('cli')) U.user_metadata = {reelbook_cli_at: new Date().toISOString()};
  if (new URLSearchParams(location.search).has('new')) U.created_at = new Date(Date.now() - 60000).toISOString();
  const params = new URLSearchParams(location.search);
  // A session the fake gave survives a reload, as a real one (the resume of L41).
  const fakeStore = {get() { try { return sessionStorage.getItem('fake.signedIn') === '1'; } catch { return false; } }, set(v) { try { if (v) sessionStorage.setItem('fake.signedIn', '1'); else sessionStorage.removeItem('fake.signedIn'); } catch { /* preview only */ } }};
  let signedIn = !params.has('noauth') || fakeStore.get();
  const missing = new Set((params.get('missing') || '').split(',').map(s => s.trim()).filter(Boolean));
  const allSheets = (D.sheets || []).map(r => ({...r})); // R12: the sender's sheets, also for an empty account (?empty=all)
  for (const t of (params.get('empty') || '').split(',').map(s => s.trim()).filter(Boolean)) {
    if (t === 'all') { for (const k of Object.keys(D)) if (k !== 'user_themes') D[k] = []; } else D[t] = [];
  }
  if (params.has('name')) U.user_metadata = {...(U.user_metadata || {}), share_name: 'Laurent'};
  // R11: the sender's side of the incoming share. Its two new sheets are taken out of this account (their photos stay
  // in files/, so the copy shows them under the same slugs); the session that held them goes too.
  const SHARE_TOKEN = 'PREVIEWshareToken00001', SENT = ['session-shadow-garde', 'session-shadow-esquives'];
  const pool = allSheets.filter(r => SENT.includes(r.slug));
  if (params.has('share')) { // without it, the account's data stay as the other lots' captures know them
    D.sheets = (D.sheets || []).filter(r => !SENT.includes(r.slug));
    D.sessions = (D.sessions || []).filter(s => !(s.items || []).some(i => SENT.includes(i.slug)));
  }
  const jab = allSheets.find(r => r.slug === 'jab-cross');
  const sent = {title: 'Shadow boxing du mardi', notebook: {id: 'fight', title: 'Fight techniques'}, sender: 'Laurent',
    items: [[jab, '3 × 1 min'], [pool[0], '3 × 8'], [pool[1], '2 × 10']].filter(x => x[0])};
  let copied = params.get('share') === 'done' ? 'shadow-boxing-du-mardi' : null;
  const fnAnswer = (status, body) => ({data: null, error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {name: 'FunctionsHttpError', context: new Response(JSON.stringify(body), {status})})});
  const invokeShare = async body => {
    await new Promise(r => setTimeout(r, 150));
    if (missing.has('session_shares')) return fnAnswer(404, {code: 'NOT_FOUND', message: 'Requested function was not found'});
    if (!body || body.token !== SHARE_TOKEN || params.get('share') === 'gone') return fnAnswer(404, {error: 'not_found', message: 'This link no longer works. Ask for a new one.'});
    if (!signedIn) return fnAnswer(401, {error: 'signin', message: 'Sign in to Reelbook to add this session.'});
    if (params.get('share') === 'own') return fnAnswer(409, {error: 'own', message: 'This session is already yours.'});
    if (body.dry_run) {
      return {data: {sender_name: sent.sender, title: sent.title, count: sent.items.length, notebook: sent.notebook,
        items: sent.items.map(([r, dose]) => ({title: r.title, dose, author: (r.source || {}).author || '', have: D.sheets.some(x => x.slug === r.slug), mine: D.sheets.some(x => x.slug === r.slug) ? r.title : null})),
        copy: copied ? {slug: copied, notebook: 'fight'} : null}, error: null};
    }
    if (copied) return {data: {slug: copied, notebook: sent.notebook, existing: true}, error: null};
    if (params.get('share') === 'quota') return fnAnswer(403, {error: 'quota', message: 'Not enough room in your Reelbook for this session (200 MB of photos). Delete sheets you no longer need, or ask whoever runs this backend for more.'});
    const nb = body.notebook || 'fight';
    if (!(D.user_themes || []).some(t => t.id === nb)) D.user_themes.push({id: nb, title: sent.notebook.title, description: '', groups: [], builtin: true, position: 9, created_at: now()});
    for (const [r] of sent.items) if (!D.sheets.some(x => x.slug === r.slug)) D.sheets.push({...clone(r), theme: nb, added_at: now()});
    copied = 'shadow-boxing-du-mardi';
    D.sessions.push({id: uid(), slug: copied, theme: nb, title: sent.title, format: '', why: '', key_points: [], source: {share: SHARE_TOKEN, shared_by: sent.sender}, origin: 'user', thumbnail: '',
      items: sent.items.map(([r, dose]) => ({slug: r.slug, dose})), created_at: now(), updated_at: now()});
    return {data: {slug: copied, notebook: {id: nb, title: ((D.user_themes || []).find(t => t.id === nb) || {}).title || sent.notebook.title}, existing: false, kept: 1, copied: pool.length}, error: null};
  };
  // R12: the GET of a link's page, to anybody: the sender, the title, the notebook's title and the count only
  const previewShare = async token => {
    await new Promise(r => setTimeout(r, 150));
    if (missing.has('session_shares')) return fnAnswer(404, {code: 'NOT_FOUND', message: 'Requested function was not found'});
    if (token !== SHARE_TOKEN || params.get('share') === 'gone') return fnAnswer(404, {error: 'not_found', message: 'This link no longer works. Ask for a new one.'});
    return {data: {sender_name: sent.sender, title: sent.title, notebook_title: sent.notebook.title, count: sent.items.length}, error: null};
  };
  if (params.has('links')) D.requests = (D.requests || []).filter(r => r.status !== 'done').slice(0, Number(params.get('links')) || 0).map(r => ({...r, status: 'queued', note: null, processed_at: null}));
  const local = p => 'files/' + String(p).replace(/^u1\//, '');
  const uid = () => 'fake-' + Math.random().toString(36).slice(2, 10);
  const now = () => new Date().toISOString();
  const DEFAULTS = {
    requests: () => ({id: uid(), status: 'queued', theme: null, slug: null, note: null, created_at: now(), processed_at: null}),
    sessions: () => ({id: uid(), format: '', why: '', key_points: [], source: {}, origin: 'user', thumbnail: '', items: [], created_at: now(), updated_at: now()}),
    sheets: () => ({id: uid(), kind: 'sheet', summary: '', duration: '', thumbnail: '', source: {}, html: '', added_at: now()}),
    notes: () => ({body: '', updated_at: now()}),
    user_themes: () => ({description: '', groups: [], builtin: false, position: 0, created_at: now()}),
    capture_tokens: () => ({id: uid(), created_at: now(), last_used_at: null, revoked_at: null}), // L28
    session_shares: () => ({token: 'PREVIEWmine' + Math.random().toString(36).slice(2, 13).padEnd(11, '0'), owner: U.id, created_at: now(), revoked_at: null}) // R11
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
    not(k, op, v) { this.f.push(op === 'is' ? (r => (v === null ? r[k] != null : r[k] !== v)) : (r => r[k] !== v)); return this; } // P8 R14: .not('level', 'is', null)
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

  let seatReads = 0;
  const fakeSeats = () => {
    const v = params.get('seats'); seatReads++;
    const taken = v === 'closed' ? 14 : v === 'last' ? (seatReads > 1 ? 50 : 49) : +v;
    return {taken, total: 50, open: v !== 'closed' && taken < 50, today_left: 7};
  };

  window.supabase = {
    createClient() {
      const subs = [];
      const emit = (event, session) => subs.forEach(cb => setTimeout(() => cb(event, session), 0));
      const session = () => (signedIn ? {user: U, access_token: 'fake'} : null);
      const fakeError = o => Object.assign(new Error(o.message), {name: 'AuthApiError'}, o);
      const SOON = {status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.'};
      const HOUR = {status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded'};
      const signIn = (event, email) => { signedIn = true; fakeStore.set(true); if (email) U.email = email; U.created_at = now(); emit(event, session()); };
      window.__fakeLink = email => signIn('SIGNED_IN', email);
      const mailAnswer = async () => {
        const r = params.get('resend');
        if (params.get('net') === 'off' || r === 'offline') throw fakeError({name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch'});
        return {data: {}, error: r === 'soon' ? fakeError(SOON) : r === 'hour' ? fakeError(HOUR) : null};
      };
      return {
        from: t => new Query(t),
        functions: {invoke: async (name, {body} = {}) => name === 'share' ? invokeShare(body)
          : String(name).startsWith('share?token=') ? previewShare(decodeURIComponent(String(name).slice(12)))
          : fnAnswer(404, {code: 'NOT_FOUND', message: 'Requested function was not found'})},
        // L31: ?seats=<taken> of 50, ?seats=closed, ?seats=last (the last seat, then taken when asked again, before a sign-up)
        rpc: async name => name === 'beta_seats' && params.has('seats') ? {data: fakeSeats(), error: null, status: 200}
          : (name === 'share_invites' || name === 'my_invites') && params.has('invites') ? {data: {left: +params.get('invites'), total: 2}, error: null, status: 200}
          : name === 'pending_share_invite' || name === 'ack_share_invite' ? {data: null, error: null, status: 200}
          : name === 'join_waitlist' && params.has('seats') ? {data: 'ok', error: null, status: 200}
          : name === 'my_quota' && params.has('quota')
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
          signInWithPassword: async ({email}) => {
            if (params.get('net') === 'off') throw fakeError({name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch'});
            if (/^wrong@/.test(email)) return {data: {}, error: fakeError({status: 400, code: 'invalid_credentials', message: 'Invalid login credentials'})};
            if (/^pending@/.test(email)) return {data: {}, error: fakeError({status: 400, code: 'email_not_confirmed', message: 'Email not confirmed'})};
            signIn('SIGNED_IN', email); return {data: {session: session(), user: U}, error: null};
          },
          signUp: async ({email}) => {
            if (params.get('net') === 'off') throw fakeError({name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch'});
            if (/^exists@/.test(email)) return {data: {}, error: fakeError({status: 422, code: 'user_already_exists', message: 'User already registered'})};
            if (/^oldexists@/.test(email)) return {data: {session: null, user: {id: 'x', identities: []}}, error: null};
            if (/^soon@/.test(email)) return {data: {}, error: fakeError(SOON)};
            if (/^hour@/.test(email)) return {data: {}, error: fakeError(HOUR)};
            if (params.get('confirm') === 'off') { signIn('SIGNED_IN', email); return {data: {session: session(), user: U}, error: null}; }
            return {data: {session: null, user: {id: 'new', email, identities: [{}]}}, error: null};
          },
          resend: () => mailAnswer(),
          resetPasswordForEmail: () => mailAnswer(),
          verifyOtp: async ({email, token, type}) => {
            if (params.get('net') === 'off') throw fakeError({name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch'});
            if (token === '999999') return {data: {}, error: fakeError({status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached'})};
            if (token === '111111') return {data: {}, error: fakeError({status: 403, code: 'otp_expired', message: 'Token has expired or is invalid'})};
            signIn(type === 'recovery' ? 'PASSWORD_RECOVERY' : 'SIGNED_IN', email); return {data: {session: session(), user: U}, error: null};
          },
          updateUser: async ({password, data}) => {
            if (data) { U.user_metadata = {...(U.user_metadata || {}), ...data}; emit('USER_UPDATED', session()); return {data: {user: U}, error: null}; }
            if (password === 'same-password-1') return {data: {}, error: fakeError({status: 422, code: 'same_password', message: 'New password should be different from the old password.'})};
            emit('USER_UPDATED', session()); return {data: {user: U}, error: null};
          },
          signOut: async () => { signedIn = false; fakeStore.set(false); emit('SIGNED_OUT', null); return {error: null}; }
        }
      };
    }
  };
})();
