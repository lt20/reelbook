// P8 R12: a share link opened with no account (#gate: the title only), the token kept through the L41 screens, the
// copy once signed in with « Get started » on a new account's home, the invitation sent at sign-up, the waiting list
// that keeps the link, and « Invites left » in Settings. The SQL: tests/invite-schema.test.cjs, tests/sql/r12-invites.sql.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, hostedUrl, ownKey} = require('./harness.cjs');

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve)); };
// The GET answer, with fields it must never show even if a server sent them (exercise names, doses, photos).
const GET = {sender_name: 'Laurent', title: 'Kicks du mardi', notebook_title: 'MMA', count: 4,
  items: [{title: 'Teep kick', dose: '3 × 8'}], thumbnail: 'owner/teep/img/1.jpg'};
const FULL = {taken: 50, total: 50, open: false, today_left: 5};
const OPEN = {taken: 10, total: 50, open: true, today_left: 5};
const lib = [{id: 'strength', title: 'Strength', groups: []}];
const cfgWin = {REELBOOK: {library: lib, defaults: ['strength'], hosted: {name: 'Reelbook hosted', url: hostedUrl, anonKey: ownKey, blurb: 'Free for now.'}, repo: 'https://github.com/lt20/reelbook'}};
const rpcOf = ({seats = FULL, left = 2, joined = [], taken = null, invites = null, acks = []} = {}) => async (name, args) => {
  if (name === 'beta_seats') return {data: seats, error: null};
  if (name === 'share_invites') return {data: left === null ? null : {left}, error: null};
  if (name === 'join_waitlist') { joined.push(args); return {data: 'ok', error: null}; }
  if (name === 'pending_share_invite') return {data: taken, error: null}; // read only: the same answer until acknowledged
  if (name === 'ack_share_invite') { acks.push(args && args.p_token); return {data: true, error: null}; }
  if (name === 'my_invites') return {data: invites, error: null};
  return {data: null, error: {code: 'PGRST202', message: 'no function'}};
};
const withFn = (page, answer) => {
  for (const c of page.clients) c.functions = {invoke: async (name, o) => { c.calls.push(['invoke', name, JSON.parse(JSON.stringify(o || {}))]); return answer(name, o || {}); }};
};
const gatePage = async (opts = {}) => {
  const page = await app({remembered: {mode: 'hosted'}, tables: {user_themes: [], sheets: [], sessions: [], requests: [], notes: [], practice_log: []}, dom: true, timerCap: 1000, win: cfgWin, rpc: rpcOf(opts)});
  await settle();
  withFn(page, opts.fn || (() => ({data: GET, error: null})));
  page.go('#s-' + TOKEN); await settle();
  return page;
};
const invoked = page => page.clients.flatMap(c => c.calls.filter(x => x[0] === 'invoke'));

test('R12: signed out, #s-<token> shows the contentless page — sender, title, notebook and count, never an exercise, a dose or a photo', async () => {
  const page = await gatePage();
  assert.equal(page.element('gate').hidden, false);
  assert.equal(page.element('auth').hidden, true);
  const body = page.element('gate-body').innerHTML;
  assert.match(body, /<p class="recv-over">Laurent sent you a session<\/p><h1>Kicks du mardi<\/h1><span class="recv-meta">MMA · 4 exercises<\/span>/);
  assert.match(body, /id="gate-create">Create my account to open it</);
  assert.match(body, /id="gate-signin">I already have an account</);
  assert.match(body, /Laurent’s invite: you skip the waiting list/);
  assert.doesNotMatch(body, /Teep|3 × 8|<img|img\/1\.jpg/);
  assert.equal(page.element('gate-full').hidden, true);
  // the GET, with the anon key: no body, no dry run
  assert.deepEqual(invoked(page), [['invoke', `share?token=${TOKEN}`, {method: 'GET'}]]);
});

test('R12: no invite line when the sender has none left but seats are open, or on a backend without share_invites', async () => {
  let page = await gatePage({seats: OPEN, left: 0});
  assert.doesNotMatch(page.element('gate-body').innerHTML, /skip the waiting list/);
  assert.match(page.element('gate-body').innerHTML, /Create my account to open it/);
  page = await gatePage({seats: null, left: null});
  assert.doesNotMatch(page.element('gate-body').innerHTML, /skip the waiting list/);
  assert.match(page.element('gate-body').innerHTML, /Create my account to open it/);
});

test('R12: a revoked or unknown link — R11\'s words, a way into Reelbook', async () => {
  const page = await gatePage({fn: () => ({data: null, error: {name: 'FunctionsHttpError', context: {status: 404, json: async () => ({error: 'not_found', message: 'This link no longer works. Ask for a new one.'})}}})});
  assert.match(page.element('gate-body').innerHTML, /<h1 class="gate-err">This link no longer works\. Ask for a new one\.<\/h1>/);
  await page.fire('gate-home');
  assert.equal(page.element('auth').hidden, false);
  assert.equal(page.storage.has('rb.share'), false, 'nothing kept');
});

test('R12: the beta full and the invites used — the waiting list, which keeps the link', async () => {
  const joined = [];
  const page = await gatePage({left: 0, joined});
  assert.equal(page.element('gate-full').hidden, false);
  assert.equal(page.element('gate-full-h').textContent, 'The beta is full and Laurent’s invites are used.');
  assert.equal(page.element('gate-full-p').textContent, 'Join the waiting list: we’ll keep their session for you.');
  assert.doesNotMatch(page.element('gate-body').innerHTML, /gate-create/);
  page.element('g-wl-first').value = 'Sam'; page.element('g-wl-email').value = 'sam@example.test'; page.element('g-wl-consent').checked = true;
  await page.fire('g-wl', 'submit'); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(joined)), [{first_name: 'Sam', email: 'sam@example.test', lang: 'en', consent: true, share_token: TOKEN}]);
  assert.equal(page.element('g-wl-done').hidden, false);
  assert.equal(page.element('g-wl-ok').textContent, 'When a spot opens we’ll email you, and Laurent’s session will be waiting.');
});

test('R12: a backend without the five-argument join_waitlist — joined without the link', async () => {
  const calls = [];
  const page = await app({remembered: {mode: 'hosted'}, tables: {user_themes: []}, dom: true, timerCap: 1000, win: cfgWin, rpc: async (name, args) => {
    if (name === 'beta_seats') return {data: FULL, error: null};
    if (name === 'share_invites') return {data: null, error: {code: 'PGRST202'}};
    if (name === 'join_waitlist') { calls.push(args); return args.share_token ? {data: null, error: {code: 'PGRST202', message: 'no such function'}} : {data: 'ok', error: null}; }
    return {data: null, error: null};
  }});
  await settle(); withFn(page, () => ({data: GET, error: null})); page.go('#s-' + TOKEN); await settle();
  assert.equal(page.element('gate-full-h').textContent, 'The beta is full and Laurent’s invites are used.');
  page.element('g-wl-first').value = 'Sam'; page.element('g-wl-email').value = 'sam@example.test'; page.element('g-wl-consent').checked = true;
  await page.fire('g-wl', 'submit'); await settle();
  assert.deepEqual(calls.map(c => c.share_token || null), [TOKEN, null]);
  assert.equal(page.element('g-wl-done').hidden, false);
});

test('R12: « Create my account » keeps the token through the code screen; the sign-up sends it as the invite, past a full beta', async () => {
  const page = await gatePage();
  await page.fire('gate-create');
  assert.equal(page.element('auth').hidden, false);
  assert.equal(page.element('auth-title').textContent, 'Create your account');
  assert.equal(page.element('a-share').textContent, 'Open “Kicks du mardi”');
  assert.equal(page.element('a-share-m').textContent, 'Laurent’s invite: you skip the waiting list.');
  const kept = JSON.parse(page.storage.get('rb.share'));
  assert.deepEqual({token: kept.token, url: kept.url, sender: kept.sender, title: kept.title, notebook: kept.notebook, count: kept.count, invite: kept.invite},
    {token: TOKEN, url: hostedUrl, sender: 'Laurent', title: 'Kicks du mardi', notebook: 'MMA', count: 4, invite: true});
  page.element('a-email').value = 'sam@example.test'; page.element('a-pass').value = 'example-password';
  await page.fire('auth-form', 'submit'); await settle();
  const up = page.clients.at(-1).calls.find(c => c[0] === 'up');
  assert.ok(up, 'signed up although the beta is full: the invite');
  assert.deepEqual(JSON.parse(JSON.stringify(up[1].options.data)), {invite: TOKEN, ref: TOKEN}); // P8 R13: the token is the origin too
  assert.equal(page.element('auth-title').textContent, 'Enter your code');
  assert.equal(page.element('a-share').hidden, false);
  assert.equal(page.element('a-share-m').textContent, 'Laurent’s session opens right after.');
  assert.ok(page.storage.get('rb.share'), 'still kept');
});

test('R12: without an invite left, a full beta still sends the sign-up to the waiting list (as before)', async () => {
  const page = await gatePage({seats: {...FULL}, left: 0});
  assert.equal(page.element('gate-full').hidden, false);
  // a sign-up started elsewhere with no token: the old path
  const plain = await app({remembered: {mode: 'hosted'}, tables: {user_themes: []}, dom: true, timerCap: 1000, rpc: rpcOf({})});
  await settle();
  await plain.fire('a-toggle'); await plain.fire('s-go');
  plain.element('a-email').value = 'x@example.test'; plain.element('a-pass').value = 'example-password';
  await plain.fire('auth-form', 'submit'); await settle();
  assert.equal(plain.clients.at(-1).calls.some(c => c[0] === 'up'), false);
  assert.equal(plain.element('setup').hidden, false, 'the waiting list of #setup');
});

test('R12: the token survives a reload from Mail (resume) and the forgot-password screen', async () => {
  const share = JSON.stringify({token: TOKEN, url: hostedUrl, at: Date.now(), sender: 'Laurent', title: 'Kicks du mardi', notebook: 'MMA', count: 4, invite: true});
  const pending = JSON.stringify({email: 'sam@example.test', type: 'signup', at: Date.now() - 120000, from: 'signup', verified: false, url: hostedUrl});
  let page = await app({remembered: {mode: 'hosted'}, stored: {'rb.share': share, 'rb.pending': pending}, dom: true, timerCap: 1000});
  await settle();
  assert.equal(page.element('auth-title').textContent, 'Enter your code');
  assert.equal(page.element('a-share').textContent, 'Open “Kicks du mardi”');
  assert.equal(page.element('a-share').hidden, false);
  page = await gatePage();
  await page.fire('gate-signin');
  assert.equal(page.element('auth-title').textContent, 'Sign in');
  assert.equal(page.element('a-share-m').textContent, 'Laurent’s session opens right after.');
  await page.fire('a-forgot');
  assert.equal(page.element('auth-title').textContent, 'Forgot your password');
  assert.equal(page.element('a-share').hidden, false);
  assert.ok(page.storage.get('rb.share'));
});

const signedIn = async ({tables, fn, stored = {}, rpc = rpcOf({}), remembered = {mode: 'hosted'}, sessions = {}} = {}) => {
  const share = JSON.stringify({token: TOKEN, url: hostedUrl, at: Date.now(), sender: 'Laurent', title: 'Kicks du mardi', notebook: 'MMA', count: 4, invite: true});
  const page = await app({remembered, stored: {'rb.share': share, ...stored}, sessions, tables: tables || {user_themes: [], sheets: [], sessions: [], requests: [], notes: [], practice_log: []},
    dom: true, timerCap: 1000, win: cfgWin, rpc});
  await settle();
  withFn(page, fn || ((name, o) => ({data: {slug: 'kicks-du-mardi', notebook: {id: 'mma', title: 'MMA'}, existing: false}, error: null})));
  page.clients[0].authListener('SIGNED_IN', {user: {id: 'u1', email: 'sam@example.test', user_metadata: {}}}); await settle();
  return page;
};

test('R12: signed in, the kept token is copied once — the catalogue first (default notebooks), then the copy; the session opens and the token goes', async () => {
  const page = await signedIn();
  const calls = page.clients[0].calls;
  const seeded = calls.findIndex(c => c[0] === 'insert' && c[1] === 'user_themes'), copied = calls.findIndex(c => c[0] === 'invoke');
  assert.ok(seeded > -1, 'the default notebooks were made');
  assert.ok(copied > seeded, 'before the copy (R11 debt)');
  assert.deepEqual(invoked(page), [['invoke', 'share', {body: {token: TOKEN}}]]);
  assert.equal(page.location.hash, '#session/kicks-du-mardi');
  assert.equal(page.storage.has('rb.share'), false);
  assert.deepEqual(JSON.parse(page.storage.get('rb.first.u1')), {title: 'Kicks du mardi', sender: 'Laurent', notebook: 'MMA', count: 4});
  // the first home: « Get started »
  page.go('#'); await settle();
  const c = page.element('first-steps');
  assert.equal(c.hidden, false);
  assert.match(c.innerHTML, /<h2 id="first-h">Get started<\/h2><span class="meta">2 of 3 done<\/span>/);
  assert.match(c.innerHTML, /<div class="t1">Account<\/div>/);
  assert.match(c.innerHTML, /<div class="t1">Kicks du mardi from Laurent<\/div><div class="t2">4 sheets in MMA, ready to practise\.<\/div>/);
  assert.match(c.innerHTML, /<span class="ck n" aria-hidden="true">3<\/span><div><div class="t1">Save your own videos: share a reel to Reelbook<\/div>/);
  assert.equal(invoked(page).length, 1, 'once');
});

test('R12: an account that already had sheets gets the copy but no « Get started »; a refused copy shows R11\'s sheet', async () => {
  const tables = {user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}], sheets: [{slug: 'curl', kind: 'sheet', theme: 'strength', title: 'Curl', summary: '', html: '<h1>Curl</h1>', exercises: [], added_at: '2026-10-01T10:00:00Z'}], sessions: [], requests: [], notes: [], practice_log: []};
  let page = await signedIn({tables});
  assert.equal(page.storage.has('rb.first.u1'), false);
  page = await signedIn({tables, fn: (name, o) => o.body && o.body.dry_run ? {data: null, error: {name: 'FunctionsHttpError', context: {status: 409, json: async () => ({error: 'own', message: 'This session is already yours.'})}}}
    : {data: null, error: {name: 'FunctionsHttpError', context: {status: 409, json: async () => ({error: 'own', message: 'This session is already yours.'})}}}});
  assert.match(page.element('recv-dlg').innerHTML, /This session is already yours\./);
  assert.equal(page.storage.has('rb.share'), false);
});

test('R12: offline, the token stays for the next start', async () => {
  const page = await signedIn({fn: () => ({data: null, error: {name: 'FunctionsFetchError'}})});
  assert.match(page.element('recv-dlg').innerHTML, /could not reach the server/);
  assert.ok(page.storage.get('rb.share'));
});

test('R12: a session waiting for its password copies nothing yet', async () => {
  const pending = JSON.stringify({email: 'sam@example.test', type: 'signup', at: Date.now(), from: 'signup', verified: true, url: hostedUrl});
  const page = await signedIn({stored: {'rb.pending': pending}, sessions: {[hostedUrl]: {id: 'u1', email: 'sam@example.test', user_metadata: {}}}});
  assert.equal(page.element('auth-title').textContent, 'Choose your password');
  assert.deepEqual(invoked(page), []);
  assert.ok(page.storage.get('rb.share'));
});

test('R12: a token the waiting list kept opens « <sender> sent you a session » (the person chooses), once', async () => {
  const page = await app({remembered: {mode: 'hosted'}, sessions: {}, tables: {user_themes: [], sheets: [], sessions: [], requests: [], notes: [], practice_log: []}, dom: true, timerCap: 1000, win: cfgWin, rpc: rpcOf({taken: TOKEN})});
  await settle();
  withFn(page, (name, o) => ({data: {sender_name: 'Laurent', title: 'Kicks du mardi', count: 1, notebook: {id: 'mma', title: 'MMA'}, items: [{title: 'Teep kick', dose: '3 × 8'}]}, error: null}));
  page.clients[0].authListener('SIGNED_IN', {user: {id: 'u1', email: 'sam@example.test', user_metadata: {}}}); await settle();
  assert.deepEqual(invoked(page), [['invoke', 'share', {body: {token: TOKEN, dry_run: true}}]], 'a dry run: nothing copied unasked');
  assert.match(page.element('recv-dlg').innerHTML, /Laurent sent you a session/);
  assert.match(page.element('recv-dlg').innerHTML, /id="recv-add">Add to my Reelbook/);
});

test('R12: a signed-in user\'s own #s- link keeps R11\'s sheet (no gate), and drops a kept copy of the same token', async () => {
  const share = JSON.stringify({token: TOKEN, url: hostedUrl, at: Date.now(), sender: 'Laurent', title: 'Kicks du mardi', count: 4});
  const page = await app({remembered: {mode: 'hosted'}, stored: {'rb.share': share}, sessions: {[hostedUrl]: {id: 'u1', email: 'sam@example.test', user_metadata: {}}},
    tables: {user_themes: [], sheets: [], sessions: [], requests: [], notes: [], practice_log: []}, dom: true, timerCap: 1000, win: cfgWin, hash: '#s-' + TOKEN});
  withFn(page, () => ({data: {sender_name: 'Laurent', title: 'Kicks du mardi', count: 1, notebook: {id: 'mma', title: 'MMA'}, items: []}, error: null}));
  await settle();
  assert.equal(page.element('gate').hidden, true);
  assert.equal(page.element('recv-dlg').open, true, 'R11\'s sheet');
  assert.equal(page.storage.has('rb.share'), false, 'the same token is not copied a second time behind it');
});

test('R12: Settings › Reelbook shows « Invites left: n » on the hosted backend; hidden without my_invites', async () => {
  const open = async invites => {
    const page = await app({remembered: {mode: 'hosted'}, sessions: {[hostedUrl]: {id: 'u1', email: 'a@example.test'}}, tables: {user_themes: [], sheets: [], sessions: [], requests: [], notes: [], practice_log: []}, dom: true, timerCap: 1000, rpc: rpcOf({invites})});
    await settle(); page.go('#settings'); await settle(); return page;
  };
  let page = await open({left: 2, total: 2});
  assert.equal(page.element('s-invites').hidden, false);
  assert.equal(page.element('s-invites-n').textContent, 'Invites left: 2');
  page = await open(null);
  assert.equal(page.element('s-invites').hidden, true);
});

// ---------- Codex #118, pass 1: the four defects ----------
const DB_ERROR = {status: 500, code: 'unexpected_failure', message: 'Database error saving new user'};
const TODAY_MSG = 'Enough sign-ups for today: your account was not created. Try again tomorrow.';
const blank = () => ({user_themes: [], sheets: [], sessions: [], requests: [], notes: [], practice_log: []});
const waitlisted = async ({taken = TOKEN, stored = {}, fn, acks = []} = {}) => {
  const page = await app({remembered: {mode: 'hosted'}, stored, sessions: {}, tables: blank(), dom: true, timerCap: 1000, win: cfgWin, rpc: rpcOf({taken, acks})});
  await settle();
  withFn(page, fn || (() => ({data: {sender_name: 'Laurent', title: 'Kicks du mardi', count: 1, notebook: {id: 'mma', title: 'MMA'}, items: []}, error: null})));
  page.clients[0].authListener('SIGNED_IN', {user: {id: 'u1', email: 'Sam@Example.test', user_metadata: {}}}); await settle();
  return page;
};
const held = (page, key) => { const v = page.storage.get('rb.shareTok.' + key); return v ? JSON.parse(v).token : null; };
const httpErr = (status, error, message) => ({data: null, error: {name: 'FunctionsHttpError', context: {status, json: async () => ({error, message})}}});

test('Codex #118 (1, pass 2): the server keeps the waiting list\'s token until the app acknowledges it — after the sheet was shown, never before', async () => {
  // offline, then 503 not deployed: nothing acknowledged, nothing kept on the device (the server has it)
  for (const fn of [() => ({data: null, error: {name: 'FunctionsFetchError'}}), () => httpErr(503, 'not_ready', "This link can't be opened yet.")]) {
    const acks = [];
    const page = await waitlisted({fn, acks});
    assert.deepEqual(invoked(page), [['invoke', 'share', {body: {token: TOKEN, dry_run: true}}]]);
    assert.deepEqual(acks, [], 'not acknowledged: offered again at the next start');
    assert.equal(page.storage.has('rb.shareTok.u1'), false, 'the server keeps it, not the device');
  }
  // the next start, the server still answers it: shown, then acknowledged
  const acks = [];
  const page = await waitlisted({acks});
  assert.match(page.element('recv-dlg').innerHTML, /Laurent sent you a session/);
  assert.deepEqual(acks, [TOKEN]);
});

test('Codex #118 (1, pass 2): a link refused for good (revoked) is acknowledged; another account meanwhile acknowledges nothing', async () => {
  let acks = [];
  await waitlisted({acks, fn: () => httpErr(404, 'not_found', 'This link no longer works. Ask for a new one.')});
  assert.deepEqual(acks, [TOKEN]);
  // another account signs in while the server answers u1's: that answer is left (no sheet, no acknowledgement), and
  // u1's token is still on the server for u1's next sign-in
  acks = [];
  const waiting = [], pending = {u1: TOKEN, u2: null};
  const page = await app({remembered: {mode: 'hosted'}, sessions: {}, tables: blank(), dom: true, timerCap: 1000, win: cfgWin, rpc: async (name, args, client) => {
    if (name === 'pending_share_invite') { const who = page.who; await new Promise(r => waiting.push(r)); return {data: pending[who], error: null}; }
    if (name === 'ack_share_invite') { acks.push(args.p_token); return {data: true, error: null}; }
    return rpcOf({})(name, args);
  }});
  await settle(); withFn(page, () => ({data: {sender_name: 'Laurent', title: 'Kicks du mardi', count: 1, notebook: {id: 'mma', title: 'MMA'}, items: []}, error: null}));
  page.who = 'u1'; page.clients[0].authListener('SIGNED_IN', {user: {id: 'u1', email: 'sam@example.test', user_metadata: {}}}); await settle();
  page.who = 'u2'; page.clients[0].authListener('SIGNED_IN', {user: {id: 'u2', email: 'max@example.test', user_metadata: {}}}); await settle();
  for (const r of waiting.splice(0)) r(); await settle();
  assert.deepEqual(invoked(page), [], 'u1\'s answer is not shown to u2');
  assert.deepEqual(acks, []);
  page.who = 'u1'; page.clients[0].authListener('SIGNED_IN', {user: {id: 'u1', email: 'sam@example.test', user_metadata: {}}}); await settle();
  for (const r of waiting.splice(0)) r(); await settle();
  assert.deepEqual(invoked(page), [['invoke', 'share', {body: {token: TOKEN, dry_run: true}}]], 'u1 back: offered');
  assert.deepEqual(acks, [TOKEN]);
});

test('Codex #118 (1): joined without the link before db push — the device copy is offered and goes once the sheet has opened; refused for good, it goes too', async () => {
  let page = await waitlisted({taken: null, stored: {'rb.shareTok.u1': JSON.stringify({token: TOKEN, url: hostedUrl, at: Date.now()})}, fn: () => ({data: null, error: {name: 'FunctionsFetchError'}})});
  assert.equal(held(page, 'u1'), TOKEN, 'offline: kept');
  page = await waitlisted({taken: null, stored: {'rb.shareTok.u1': JSON.stringify({token: TOKEN, url: hostedUrl, at: Date.now()}), 'rb.shareTok.u2': JSON.stringify({token: 'ZyXwVuTsRqPoNmLkJiHgFe', url: hostedUrl, at: Date.now()})},
    fn: () => httpErr(404, 'not_found', 'This link no longer works. Ask for a new one.')});
  assert.match(page.element('recv-dlg').innerHTML, /This link no longer works/);
  assert.equal(page.storage.has('rb.shareTok.u1'), false);
  assert.ok(page.storage.get('rb.shareTok.u2'), 'another account\'s stays its own');
});

test('Codex #118 (2): beta full and invites used — « I already have an account » stays on the page, and signs in with the token kept', async () => {
  for (const seats of [FULL, {...FULL, total: 0, taken: 0}]) { // full, and sign-ups closed
    const page = await gatePage({seats, left: 0});
    assert.equal(page.element('gate-full').hidden, false);
    assert.doesNotMatch(page.element('gate-body').innerHTML, /gate-create/);
    assert.match(page.element('gate-body').innerHTML, /id="gate-signin">I already have an account</);
    await page.fire('gate-signin');
    assert.equal(page.element('auth').hidden, false);
    assert.equal(page.element('auth-title').textContent, 'Sign in');
    assert.equal(JSON.parse(page.storage.get('rb.share')).token, TOKEN);
  }
});

test('Codex #118 (3): joined without the link (four arguments) — no promise to keep the session, the link kept on this device under the address, the account\'s at its sign-in', async () => {
  const page = await app({remembered: {mode: 'hosted'}, tables: {user_themes: []}, dom: true, timerCap: 1000, win: cfgWin, rpc: async (name, args) => {
    if (name === 'beta_seats') return {data: FULL, error: null};
    if (name === 'share_invites') return {data: {left: 0}, error: null};
    if (name === 'join_waitlist') return args.share_token ? {data: null, error: {code: 'PGRST202', message: 'no such function'}} : {data: 'ok', error: null};
    return {data: null, error: null};
  }});
  await settle(); withFn(page, () => ({data: GET, error: null})); page.go('#s-' + TOKEN); await settle();
  page.element('g-wl-first').value = 'Sam'; page.element('g-wl-email').value = 'Sam@Example.test'; page.element('g-wl-consent').checked = true;
  await page.fire('g-wl', 'submit'); await settle();
  assert.equal(page.element('g-wl-done').hidden, false);
  assert.doesNotMatch(page.element('g-wl-ok').textContent + page.element('gate-full-p').textContent, /keep their session|will be waiting/);
  assert.equal(page.element('g-wl-ok').textContent, 'When a spot opens we’ll email you. Keep Laurent’s link: it opens their session once you have your account.');
  assert.equal(page.element('gate-full-p').textContent, 'Join the waiting list.');
  assert.equal(held(page, 'sam@example.test'), TOKEN);
  // later, that address signs in on this device: the token is the account's, and « Laurent sent you a session » opens
  const later = await waitlisted({taken: null, stored: {'rb.shareTok.sam@example.test': page.storage.get('rb.shareTok.sam@example.test')}});
  assert.deepEqual(invoked(later), [['invoke', 'share', {body: {token: TOKEN, dry_run: true}}]]);
  assert.equal(later.storage.has('rb.shareTok.sam@example.test'), false);
  assert.equal(later.storage.has('rb.shareTok.u1'), false, 'gone once the sheet has opened');
});

test('Codex #118 (4): beta full, an invite left, the sign-ups of the day reached — « Try again tomorrow », never the page again', async () => {
  // known before the sign-up: nothing sent
  let page = await gatePage({seats: {...FULL, today_left: 0}, left: 2});
  await page.fire('gate-create');
  page.element('a-email').value = 'sam@example.test'; page.element('a-pass').value = 'example-password';
  await page.fire('auth-form', 'submit'); await settle();
  assert.equal(page.clients.at(-1).calls.some(c => c[0] === 'up'), false);
  assert.equal(page.element('a-err').textContent, TODAY_MSG);
  assert.equal(page.element('gate').hidden, true); assert.equal(page.element('auth').hidden, false);
  // reached while signing up: Auth's generic refusal, beta_seats says why
  let seats = {...FULL};
  page = await app({remembered: {mode: 'hosted'}, tables: blank(), dom: true, timerCap: 1000, win: cfgWin, rpc: async (name, a) => name === 'beta_seats' ? {data: seats, error: null} : rpcOf({})(name, a),
    auth: () => ({async signUp(c) { seats = {...FULL, today_left: 0}; return {data: {user: null, session: null}, error: DB_ERROR}; }})});
  await settle(); withFn(page, () => ({data: GET, error: null})); page.go('#s-' + TOKEN); await settle();
  await page.fire('gate-create');
  page.element('a-email').value = 'sam@example.test'; page.element('a-pass').value = 'example-password';
  await page.fire('auth-form', 'submit'); await settle();
  assert.equal(page.element('a-err').textContent, TODAY_MSG);
  assert.equal(page.element('gate').hidden, true);
  assert.notEqual(page.location.hash, '#s-' + TOKEN);
});

test('Codex #118 (4): a sign-up refused « beta: full » with the page\'s invite — the page offers the waiting list, not the same button', async () => {
  const page = await app({remembered: {mode: 'hosted'}, tables: blank(), dom: true, timerCap: 1000, win: cfgWin, rpc: rpcOf({}),
    auth: () => ({async signUp() { return {data: {user: null, session: null}, error: DB_ERROR}; }})});
  await settle(); withFn(page, () => ({data: GET, error: null})); page.go('#s-' + TOKEN); await settle();
  await page.fire('gate-create');
  page.element('a-email').value = 'sam@example.test'; page.element('a-pass').value = 'example-password';
  await page.fire('auth-form', 'submit'); await settle();
  assert.equal(page.element('gate').hidden, false);
  assert.doesNotMatch(page.element('gate-body').innerHTML, /gate-create|skip the waiting list/);
  assert.match(page.element('gate-body').innerHTML, /gate-signin/);
  assert.equal(page.element('gate-full').hidden, false);
  assert.equal(page.element('g-wl-email').value, 'sam@example.test');
});

test('Codex #118 (coordinator): the auth screens\' share lines in French too, and the switch relabels them', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const window = {localStorage: {getItem: () => null, setItem() {}}, navigator: {language: 'fr-FR'}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'app/landing.js'), 'utf8'), {window, console});
  const RBL = window.RBL;
  const page = await app({remembered: {mode: 'hosted'}, tables: blank(), dom: true, timerCap: 1000, win: {...cfgWin, RBL}, rpc: rpcOf({})});
  await settle(); withFn(page, () => ({data: GET, error: null})); page.go('#s-' + TOKEN); await settle();
  await page.fire('gate-create');
  assert.equal(page.element('a-share').textContent, 'Ouvrir « Kicks du mardi »');
  assert.equal(page.element('a-share-m').textContent, 'Invitation de Laurent : tu passes la liste d’attente.');
  await page.fire('a-toggle'); await settle();
  assert.equal(page.element('a-share-m').textContent, 'La séance de Laurent s’ouvre juste après.');
  RBL.setLang('en'); await settle();
  assert.equal(page.element('a-share').textContent, 'Open “Kicks du mardi”');
  assert.equal(page.element('a-share-m').textContent, 'Laurent’s session opens right after.');
});

test('Codex #118 (2, pass 2): a kept link survives every answer that may change on a later try, not only offline', async () => {
  for (const [status, error] of [[503, 'not_ready'], [500, 'failed'], [401, 'signin'], [409, 'copying']]) {
    const page = await signedIn({fn: () => httpErr(status, error, 'Try again in a moment.')});
    assert.ok(page.storage.get('rb.share'), `kept after ${error}`);
    assert.equal(JSON.parse(page.storage.get('rb.share')).token, TOKEN);
    assert.equal(invoked(page).length, 1, `${error}: no dry run behind it`);
  }
  // a final refusal still drops it (R11's sheet says why)
  const page = await signedIn({fn: () => httpErr(404, 'not_found', 'This link no longer works. Ask for a new one.')});
  assert.equal(page.storage.has('rb.share'), false);
});

test('Codex #118 (4, pass 2): the copy lock holds one token for one sign-in — sign out, open another link, sign in again: the new one is copied', async () => {
  const page = await signedIn();
  assert.deepEqual(invoked(page), [['invoke', 'share', {body: {token: TOKEN}}]]);
  page.clients[0].authListener('SIGNED_OUT', null); await settle();
  const OTHER = 'ZyXwVuTsRqPoNmLkJiHgFe';
  page.storage.set('rb.share', JSON.stringify({token: OTHER, url: hostedUrl, at: Date.now(), sender: 'Olga', title: 'Arms', notebook: 'MMA', count: 2, invite: false}));
  page.clients[0].authListener('SIGNED_IN', {user: {id: 'u1', email: 'sam@example.test', user_metadata: {}}}); await settle();
  assert.deepEqual(invoked(page).map(c => c[2].body.token), [TOKEN, OTHER]);
  assert.equal(page.storage.has('rb.share'), false);
  // and a later token, same sign-in: copied too (route() runs it)
  const THIRD = 'QqQqQqQqQqQqQqQqQqQqQq';
  page.storage.set('rb.share', JSON.stringify({token: THIRD, url: hostedUrl, at: Date.now(), sender: 'Max', title: 'Legs', notebook: 'MMA', count: 1, invite: false}));
  page.go('#settings'); await settle();
  assert.deepEqual(invoked(page).map(c => c[2].body.token), [TOKEN, OTHER, THIRD]);
});

// ---------- Codex #118, pass 3 ----------
test('Codex #118 (pass 3, 1): joined from the landing, then a link\'s page — its own form, and its words only after its own call with the token', async () => {
  const joined = [];
  const page = await app({remembered: {mode: 'hosted'}, tables: blank(), dom: true, timerCap: 1000, win: cfgWin, rpc: rpcOf({left: 0, joined})});
  await settle();
  page.element('lp-wl-first').value = 'Sam'; page.element('lp-wl-email').value = 'sam@example.test'; page.element('lp-wl-consent').checked = true;
  await page.fire('lp-wl', 'submit'); await settle();
  assert.equal(page.element('lp-wl-done').hidden, false, 'the landing: joined');
  withFn(page, () => ({data: GET, error: null})); page.go('#s-' + TOKEN); await settle();
  assert.equal(page.element('gate-full').hidden, false);
  assert.equal(page.element('g-wl').hidden, false, 'the link\'s own form');
  assert.equal(page.element('g-wl-done').hidden, true, 'no « session will be waiting » yet');
  page.element('g-wl-first').value = 'Sam'; page.element('g-wl-email').value = 'sam@example.test'; page.element('g-wl-consent').checked = true;
  await page.fire('g-wl', 'submit'); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(joined)).map(j => j.share_token || null), [null, TOKEN]);
  assert.equal(page.element('g-wl-done').hidden, false);
});

test('Codex #118 (pass 3, 2): a copy refused by a quota keeps the link until a sheet has opened', async () => {
  let n = 0;
  // the copy: 403 quota; the dry run behind it: offline → kept
  let page = await signedIn({fn: (name, o) => o.body.dry_run ? {data: null, error: {name: 'FunctionsFetchError'}} : httpErr(403, 'quota', 'Your Reelbook is full.')});
  assert.equal(JSON.parse(page.storage.get('rb.share')).token, TOKEN, 'kept: no sheet opened');
  // the dry run answers: the sheet opens (it says why), then the link goes
  page = await signedIn({fn: (name, o) => { n++; return o.body.dry_run ? {data: {sender_name: 'Laurent', title: 'Kicks du mardi', count: 1, notebook: {id: 'mma', title: 'MMA'}, items: []}, error: null} : httpErr(403, 'quota', 'Your Reelbook is full.'); }});
  assert.match(page.element('recv-dlg').innerHTML, /Laurent sent you a session/);
  assert.equal(page.storage.has('rb.share'), false);
  assert.equal(n, 2);
});

test('Codex #118 (pass 3, 3): while the copy of a kept link runs, the waiting list\'s token waits — one resumption at a time, and the session opens', async () => {
  const rpcs = [], acks = [];
  let release;
  const page = await app({remembered: {mode: 'hosted'}, stored: {'rb.share': JSON.stringify({token: TOKEN, url: hostedUrl, at: Date.now(), sender: 'Laurent', title: 'Kicks du mardi', notebook: 'MMA', count: 4, invite: true})},
    sessions: {}, tables: blank(), dom: true, timerCap: 1000, win: cfgWin, rpc: async (name, args) => { rpcs.push(name); return rpcOf({taken: TOKEN, acks})(name, args); }});
  await settle();
  withFn(page, async (name, o) => {
    if (o.body.dry_run) return {data: {sender_name: 'Laurent', title: 'Kicks du mardi', count: 1, notebook: {id: 'mma', title: 'MMA'}, items: []}, error: null};
    await new Promise(r => { release = r; }); // a slow copy
    return {data: {slug: 'kicks-du-mardi', notebook: {id: 'mma', title: 'MMA'}, existing: false}, error: null};
  });
  page.clients[0].authListener('SIGNED_IN', {user: {id: 'u1', email: 'sam@example.test', user_metadata: {}}}); await settle();
  page.go('#settings'); await settle(); // a route() while the copy runs
  assert.equal(rpcs.includes('pending_share_invite'), false, 'not asked while the copy runs');
  release(); await settle();
  assert.equal(page.location.hash, '#session/kicks-du-mardi', 'the copy\'s session opens');
  assert.equal(page.storage.has('rb.share'), false);
  assert.deepEqual(invoked(page).filter(c => c[2].body.dry_run), [], 'no sheet over it');
});
