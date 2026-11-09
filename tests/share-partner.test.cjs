// P8 R11: « Send to a training partner » (a session's Share sheet, « Stop sharing » in its ⋯) and « <sender> sent you a
// session » (#s-<token>, the Edge Function share). The function itself: tests/share-function.test.cjs (Deno).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const RS = require('../app/sessions.js');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';

test('R11: #s-<token> is read only with a 22-character URL-safe token', () => {
  assert.equal(RS.shareTokenOf('s-' + TOKEN), TOKEN);
  for (const bad of ['s-short', 's-' + TOKEN + 'x', 'S-' + TOKEN, TOKEN, 's-' + TOKEN.slice(0, 21) + '!', '', null, 'session/s-' + TOKEN]) assert.equal(RS.shareTokenOf(bad), null, String(bad));
});

test('R11: the message — « <sender>: <title>, n exercises. Get your own copy: <link> », one line, no photo or note', () => {
  assert.equal(RS.sharePartnerText({sender: 'Laurent', title: 'Kicks du mardi', count: 4, url: 'https://lt20.github.io/reelbook/#s-' + TOKEN}),
    'Laurent: Kicks du mardi, 4 exercises. Get your own copy: https://lt20.github.io/reelbook/#s-' + TOKEN);
  assert.equal(RS.sharePartnerText({sender: ' Léa\n', title: 'Row\n day', count: 1, url: 'u'}), 'Léa: Row day, 1 exercise. Get your own copy: u');
});

// ---------- in the app ----------
const user = meta => ({id: 'u1', email: 'user@example.test', user_metadata: meta || {}});
const settle = async () => { for (let i = 0; i < 25; i++) await new Promise(resolve => setImmediate(resolve)); };
const tables = (extra = {}) => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: ['Arms'], builtin: true, position: 0}],
  sheets: [
    {slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Hammer curl', summary: '', html: '<h1>Hammer curl</h1>', exercises: [], source: {url: 'https://www.instagram.com/reel/abc/'}, added_at: '2026-10-01T10:00:00Z'},
    {slug: 'row', kind: 'sheet', theme: 'strength', group: 'Back', title: 'Row', summary: '', html: '<h1>Row</h1>', exercises: [], added_at: '2026-10-02T10:00:00Z'}],
  sessions: [{slug: 'routine', theme: 'strength', title: 'Routine', origin: 'user', items: [{slug: 'curl', dose: '3 × 10'}, {slug: 'row', dose: ''}]}],
  requests: [], notes: [{slug: 'curl', body: 'SECRET NOTE'}], practice_log: [],
  ...extra
});
const open = async (hash, {meta, extra, failing = {}, writes = {}, nav = {}} = {}) => {
  const page = await app({remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: user(meta)}, tables: tables(extra), failing, writes,
    hash, dom: true, nav, timerCap: 1000, href: 'https://lt20.github.io/reelbook/', auth: () => ({async updateUser(a) { page.updated = a; return {data: {user: user({...meta, ...a.data})}, error: null}; }})});
  await settle(); return page;
};
const clickIn = (page, id, selector) => page.element(id).listeners.click({target: {closest: s => s === selector ? {dataset: {}} : null}});
const share = async page => { await page.fire('nav-more'); clickIn(page, 'nav-actions', '#nav-share'); await settle(); };
const writesOf = (page, table) => page.clients[0].calls.filter(c => c[1] === table);

test('R11: a backend without session_shares — the row stays, disabled, « Coming soon »; nothing is written', async () => {
  const page = await open('#session/routine', {failing: {session_shares: {error: {code: 'PGRST205', message: 'no table'}, status: 404}}});
  await share(page);
  // drawn « Checking… » with the sheet, then repainted once the table is read (the ⋯ opened first already read it)
  assert.match(page.element('share-dlg').innerHTML + page.element('share-rows').innerHTML, /<button type="button" class="nav-it" id="share-partner" disabled>Send to a training partner<small>Coming soon<\/small><\/button>/);
  assert.match(page.element('share-dlg').innerHTML, /id="share-text"/, 'the text share is still there');
  assert.deepEqual(writesOf(page, 'session_shares'), []);
  await page.fire('nav-more');
  assert.doesNotMatch(page.element('nav-actions').innerHTML, /Stop sharing/);
});

test('R11: a sheet or a notebook has no partner row (sessions only)', async () => {
  const page = await open('#strength', {extra: {session_shares: []}});
  await share(page);
  assert.doesNotMatch(page.element('share-dlg').innerHTML, /training partner/);
});

test('R11: first share — asks the first name once (user_metadata.share_name), makes the token, shares the message', async () => {
  const shared = [];
  const page = await open('#session/routine', {extra: {session_shares: []}, writes: {session_shares: {data: {token: TOKEN}, error: null}},
    nav: {share: async d => { shared.push(d); }}});
  await share(page);
  assert.match(page.element('share-dlg').innerHTML + page.element('share-rows').innerHTML, /id="share-partner">Send to a training partner<small>They get their own copy of the 2 sheets and the session<\/small>/);
  page.fire('share-partner'); await settle();
  assert.match(page.element('share-rows').outerHTML, /Your first name, as your training partners will see it <input id="share-name" type="text" maxlength="40"/);
  page.element('share-name').value = '  Laurent  ';
  await page.element('share-rows').listeners.submit({preventDefault() {}}); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(page.updated)), {data: {share_name: 'Laurent'}});
  assert.deepEqual(JSON.parse(JSON.stringify(writesOf(page, 'session_shares').map(c => c.slice(0, 3)))), [['insert', 'session_shares', {session_slug: 'routine', sender_name: 'Laurent'}]]);
  assert.deepEqual(JSON.parse(JSON.stringify(shared)), [{title: 'Routine', text: `Laurent: Routine, 2 exercises. Get your own copy: https://lt20.github.io/reelbook/#s-${TOKEN}`}]);
  assert.doesNotMatch(JSON.stringify(shared), /SECRET|img|thumb/);
});

test('R11: sharing again reuses the live token (no insert), with the name already known; ⋯ then offers « Stop sharing », which revokes it', async () => {
  const shared = [];
  const page = await open('#session/routine', {meta: {share_name: 'Léa'}, extra: {session_shares: [{token: TOKEN, session_slug: 'routine'}]}, nav: {share: async d => { shared.push(d); }}});
  await page.fire('nav-more'); await settle();
  assert.match(page.element('nav-actions').innerHTML, /id="nav-share">Share<\/button><button type="button" class="nav-it" id="ses-unshare">Stop sharing<small>The link stops working\./);
  clickIn(page, 'nav-actions', '#nav-share'); await settle();
  await page.fire('share-partner'); await settle();
  assert.deepEqual(writesOf(page, 'session_shares'), [], 'the same link: nothing written');
  assert.match(shared[0].text, new RegExp(`^Léa: Routine, 2 exercises\\. Get your own copy: https://lt20\\.github\\.io/reelbook/#s-${TOKEN}$`));
  await page.fire('nav-more');
  clickIn(page, 'nav-actions', '#ses-unshare'); await settle();
  const w = writesOf(page, 'session_shares');
  assert.equal(w.length, 1); assert.equal(w[0][0], 'update'); assert.ok(w[0][2].revoked_at); assert.deepEqual(w[0][3], [['session_slug', 'routine']]);
  assert.equal(page.element('r11-toast').textContent, 'Sharing stopped');
});

const received = async (invoke, opts = {}) => {
  const page = await open('', opts);
  page.clients[0].functions = invoke ? {invoke: async (name, o) => { (page.invoked = page.invoked || []).push([name, JSON.parse(JSON.stringify(o.body))]); return invoke(o.body); }} : undefined;
  page.go('#s-' + TOKEN); await settle();
  return page;
};
const httpError = (status, body) => ({data: null, error: {name: 'FunctionsHttpError', context: {status, json: async () => body}}});

test('R11: #s- on a backend without the function (or without the table) — « This link can\'t be opened yet. »', async () => {
  let page = await received(null);
  assert.equal(page.element('recv-dlg').open, true);
  assert.match(page.element('recv-dlg').innerHTML, /<h2 id="recv-h">This link can&#39;t be opened yet\.<\/h2>|<h2 id="recv-h">This link can't be opened yet\.<\/h2>/);
  page = await received(() => httpError(404, {code: 'NOT_FOUND', message: 'Requested function was not found'}));
  assert.match(page.element('recv-dlg').innerHTML, /can(&#39;|')t be opened yet/);
  page = await received(() => httpError(503, {error: 'not_ready', message: "This link can't be opened yet."}));
  assert.match(page.element('recv-dlg').innerHTML, /can(&#39;|')t be opened yet/);
  page = await received(() => httpError(404, {error: 'not_found', message: 'This link no longer works. Ask for a new one.'}));
  assert.match(page.element('recv-dlg').innerHTML, /This link no longer works/);
});

test('R11: « Laurent sent you a session » — the exercises, « You have it », « we\'ll keep yours », Into, the privacy line; Add copies and opens it', async () => {
  const preview = {sender_name: 'Laurent', title: 'Kicks du mardi', count: 2, notebook: {id: 'fight', title: 'MMA'}, copy: null,
    items: [{title: 'Low kick', dose: '3 × 8', author: '@coach', have: true, mine: 'Mon low kick'}, {title: 'Teep', dose: '2 × 10', author: '', have: false, mine: null}]};
  const page = await received(body => body.dry_run ? {data: preview, error: null} : {data: {slug: 'kicks', notebook: {id: 'fight', title: 'MMA'}, existing: false}, error: null});
  const h = page.element('recv-dlg').innerHTML;
  assert.match(h, /<p class="recv-over">From Laurent<\/p><h2 id="recv-h">Laurent sent you a session<\/h2>/);
  assert.match(h, /<span class="recv-t">Kicks du mardi<\/span><span class="recv-meta">MMA · 2 exercises<\/span>/);
  assert.match(h, /<b>Low kick<\/b><small class="dose">3 × 8<\/small><small>Video by @coach<\/small><\/span><span class="recv-have">.*You have it<\/span>/);
  assert.match(h, /You already have 1 of these sheets \(Mon low kick\): we(&#39;|')ll keep yours\./);
  assert.match(h, /<option value="strength">Strength<\/option><option value="fight" selected>MMA \(new notebook\)<\/option>/);
  assert.match(h, /You get your own copy: the sheets with their photos, and the session\. Laurent(&#39;|')s notes and log stay private\./);
  assert.match(h, /<button class="btn" type="button" id="recv-add">Add to my Reelbook<\/button><button class="btn quiet" type="button" id="recv-no">Not now<\/button>/);
  assert.doesNotMatch(h, /<img/);
  assert.deepEqual(page.invoked, [['share', {token: TOKEN, dry_run: true}]]);
  page.element('recv-nb').value = 'strength';
  await page.fire('recv-add'); await settle();
  assert.deepEqual(page.invoked[1], ['share', {token: TOKEN, notebook: 'strength'}]);
  assert.equal(page.location.hash, '#session/kicks');
  assert.equal(page.element('r11-toast').textContent, 'Added to MMA');
});

test('R11: over quota — the function\'s message is shown in the sheet, which stays open', async () => {
  const msg = 'Not enough room in your Reelbook for this session (200 MB of photos). Delete sheets you no longer need, or ask whoever runs this backend for more.';
  const page = await received(body => body.dry_run ? {data: {sender_name: 'Laurent', title: 'K', count: 1, notebook: {id: 'strength', title: 'Strength'}, items: [], copy: null}, error: null}
    : httpError(403, {error: 'quota', message: msg}));
  await page.fire('recv-add'); await settle();
  assert.equal(page.element('recv-err').textContent, msg);
  assert.equal(page.element('recv-err').hidden, false);
  assert.equal(page.element('recv-dlg').open, true);
});

test('R11 (Codex #114): a link opened before the notebooks are read — « Into » gets them when they arrive, keeping the choice', async () => {
  let release, held = true;
  const gate = new Promise(r => { release = r; });
  const preview = {sender_name: 'Laurent', title: 'K', count: 1, notebook: {id: 'fight', title: 'MMA'}, copy: null, items: [{title: 'Teep', dose: '', author: '', have: false, mine: null}]};
  const calls = [];
  const page = await app({remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: user()}, tables: tables(), dom: true, timerCap: 1000,
    href: 'https://lt20.github.io/reelbook/', hash: '#s-' + TOKEN,
    hold: table => table === 'user_themes' && held ? gate : null});
  page.clients[0].functions = {invoke: async (name, o) => { calls.push(o.body); return {data: preview, error: null}; }};
  page.go('#s-' + TOKEN); await settle();
  assert.equal(page.element('recv-dlg').open, true);
  assert.match(page.element('recv-dlg').innerHTML, /Laurent sent you a session/);
  assert.doesNotMatch(page.element('recv-dlg').innerHTML, /<option value="strength">/, 'the notebooks are not read yet');
  assert.match(page.element('recv-dlg').innerHTML, /<option value="fight" selected>MMA \(new notebook\)<\/option>/);
  page.element('recv-nb').value = 'fight';
  held = false; release(); await settle();
  const opts = page.element('recv-nb').innerHTML;
  assert.match(opts, /<option value="strength">Strength<\/option>/, 'her notebook, once read');
  assert.match(opts, /<option value="fight" selected>MMA \(new notebook\)<\/option>/, 'the choice is kept');
  assert.equal(page.element('recv-nb').value, 'fight');
});

// ---------- Codex #114 pass 2 ----------

test('R11 (Codex #114 pass 2): another account signs in while the link is being read — no link is made for it, nothing is shared', async () => {
  const shared = [];
  let held = false, release;
  const gate = new Promise(r => { release = r; });
  const page = await app({remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: user({share_name: 'Laurent'})},
    tables: tables({session_shares: []}), writes: {session_shares: {data: {token: TOKEN}, error: null}}, dom: true, timerCap: 1000,
    href: 'https://lt20.github.io/reelbook/', hash: '#session/routine', nav: {share: async d => { shared.push(d); }},
    hold: (table, ops) => held && table === 'session_shares' && ops.some(o => o[0] === 'select') ? gate : null});
  await settle();
  await share(page);
  held = true;
  page.fire('share-partner'); await settle(); // A's share waits for its live-token read
  page.clients[0].authListener('SIGNED_IN', {user: {id: 'u2', email: 'b@example.test', user_metadata: {share_name: 'Bea'}}, access_token: 't2'});
  await settle();
  held = false; release(); await settle();
  assert.deepEqual(writesOf(page, 'session_shares'), [], 'no share row inserted under the account that came after');
  assert.deepEqual(shared, [], 'nothing offered to send');
});

test('R11 (Codex #114 pass 2): a session still being copied (share_state copying) is not shown or opened; its slug stays taken', async () => {
  const copying = {slug: 'kicks', theme: 'strength', title: 'Kicks being copied', origin: 'user', items: [], source: {share: TOKEN, share_state: 'copying'}};
  const done = {slug: 'kicks-done', theme: 'strength', title: 'Kicks copied', origin: 'user', items: [{slug: 'curl', dose: ''}], source: {share: 'x'.repeat(22), share_state: 'done'}};
  let page = await open('#session/kicks', {extra: {sessions: [...tables().sessions, copying, done]}});
  assert.doesNotMatch(page.element('view').innerHTML, /Kicks being copied/, 'not opened');
  page = await open('#session/kicks-done', {extra: {sessions: [...tables().sessions, copying, done]}});
  assert.match(page.element('view').innerHTML, /Kicks copied/, 'a finished copy opens');
  page.go('#strength'); await settle();
  assert.match(page.element('groups').innerHTML, /Kicks copied/, 'the notebook lists the finished copy');
  assert.doesNotMatch(page.element('groups').innerHTML, /Kicks being copied/, 'not the reservation');
  const app2 = require('node:fs').readFileSync(require('node:path').join(__dirname, '../app/index.html'), 'utf8');
  assert.match(app2, /const takenSlugs = \(\) => new Set\(\[\.\.\.v2Sessions\.map\(s => s\.slug\), \.\.\.copyingSlugs,/);
});

// ---------- Codex #114 pass 3 ----------

const A_PREVIEW = {sender_name: 'Laurent', title: 'Kicks du mardi', count: 1, notebook: {id: 'fight', title: 'MMA'}, copy: null,
  items: [{title: 'Low kick', dose: '3 × 8', author: '', have: true, mine: 'Mon low kick'}]};

for (const [what, ev, session] of [
  ['A signs out', 'SIGNED_OUT', null],
  ['B signs in', 'SIGNED_IN', {user: {id: 'u2', email: 'b@example.test', user_metadata: {}}, access_token: 't2'}]]) {
  test(`R11 (Codex #114 pass 3): ${what} while the link is being read — the sheet closes and A's answer never shows`, async () => {
    let release;
    const gate = new Promise(r => { release = r; });
    const page = await received(async () => { await gate; return {data: A_PREVIEW, error: null}; });
    assert.equal(page.element('recv-dlg').open, true);
    page.clients[0].authListener(ev, session); await settle();
    assert.equal(page.element('recv-dlg').open, false, 'closed on the change of account');
    release(); await settle();
    assert.equal(page.element('recv-dlg').open, false, 'the late answer does not reopen it');
    assert.doesNotMatch(page.element('recv-dlg').innerHTML, /Mon low kick|sent you a session/, "A's titles are never painted");
  });
}

test('R11 (Codex #114 pass 3): the sheet painted for A, then B signs in — it closes and « Add to my Reelbook » copies nothing', async () => {
  const page = await received(body => body.dry_run ? {data: A_PREVIEW, error: null} : {data: {slug: 'kicks', notebook: {id: 'fight', title: 'MMA'}, existing: false}, error: null});
  assert.match(page.element('recv-dlg').innerHTML, /Mon low kick/);
  page.clients[0].authListener('SIGNED_IN', {user: {id: 'u2', email: 'b@example.test', user_metadata: {}}, access_token: 't2'});
  await settle();
  assert.equal(page.element('recv-dlg').open, false);
  await page.fire('recv-add'); await settle();
  assert.deepEqual(page.invoked, [['share', {token: TOKEN, dry_run: true}]], 'no copy asked for B by the sheet opened as A');
});
