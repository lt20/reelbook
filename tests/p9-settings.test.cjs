// P9 lot S (docs/audit-design/P9-refonte.md, decisions 1, 2, 3, 8, 9, 10): Settings as an iOS grouped list with its
// sub-pages (#settings/account, #settings/computer, #settings/shortcut), and « Delete notebook » in a notebook's ⋯.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, hostedUrl, ownUrl, ownKey} = require('./harness.cjs');

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const user = {id: 'u1', email: 'laurent.thevin@example.test'};
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: user}};
const tables = () => ({
  user_themes: [
    {id: 'strength', title: 'Strength', description: '', groups: [], builtin: true, position: 0, family: null},
    {id: 'custom-cooking', title: 'Cooking', description: 'Recipes I want to try', groups: ['Soups'], builtin: false, position: 3, family: 'technique'}
  ],
  sheets: [
    {slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Hammer curl', summary: '', html: '<h1>Hammer curl</h1>', exercises: []},
    {slug: 'row', kind: 'sheet', theme: 'strength', group: 'Back', title: 'Row', summary: '', html: '<h1>Row</h1>', exercises: []}
  ],
  sessions: [{slug: 'routine', theme: 'strength', title: 'Routine', origin: 'user', items: [{slug: 'curl', dose: ''}]}],
  requests: [], notes: [], capture_tokens: [{id: 7, label: 'iPhone', created_at: '2026-11-01T10:00:00Z', last_used_at: '2026-11-07T10:00:00Z', revoked_at: null}]
});
const open = async (hash, extra = {}) => { const page = await app({...signedIn, tables: tables(), hash, ...extra}); await settle(); return page; };
const clickIn = (page, id, selector) => page.element(id).listeners.click({target: {closest: s => s === selector ? {dataset: {}} : null}});
const settingsHtml = html.match(/<div id="settings"[\s\S]*?\n<\/div>\n/)[0];
const shown = page => ['root', 'account', 'computer', 'shortcut'].filter(k => !page.element('s-' + k).hidden);

test('P9 S: the root is an account card, one group (computer, shortcut, install) and Settings › Reelbook; no Notebooks section', async () => {
  const page = await open('#settings');
  assert.deepEqual(shown(page), ['root']);
  assert.equal(page.element('s-title').textContent, 'Settings');
  assert.equal(page.element('s-av').textContent, 'LT');
  assert.equal(page.element('s-user').textContent, user.email);
  assert.equal(page.element('s-backend').textContent, 'personal.example.test');
  assert.match(settingsHtml, /<a class="s-acard" id="s-acard" href="#settings\/account">/);
  const rows = [...settingsHtml.matchAll(/<(?:a|div) class="rb-row[^"]*" id="(s-pc-row|s-sc-row|s-app)"[^>]*>[\s\S]*?<span class="rb-t">([^<]+)/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(rows, [['s-pc-row', 'Set up your computer'], ['s-sc-row', 'iPhone shortcut'], ['s-app', 'Install the app']]);
  assert.match(settingsHtml, /id="s-pc-row" href="#settings\/computer">[\s\S]*?Set up your computer<small>Turns your videos into sheets<\/small>/);
  assert.match(settingsHtml, /id="s-sc-row" href="#settings\/shortcut" hidden>/);
  assert.doesNotMatch(settingsHtml.match(/<div class="rb-row s-app"[\s\S]*?<\/div>/)[0], /rb-chev/, 'Install the app has no chevron');
  assert.doesNotMatch(settingsHtml, /nblist|<h2>Notebooks<\/h2>|data-rm=/);
  assert.doesNotMatch(settingsHtml, /\bMy (computer|account)\b|Set up my computer|iPhone Shortcut/, 'decision 2 and sentence case');
  // the shortcut's row shows with its section, its line says the key
  assert.equal(page.element('s-sc-row').hidden, false);
  assert.equal(page.element('s-sc-sub').textContent, 'Key « iPhone » · last used 7 Nov');
  assert.equal(page.element('nav-back').textContent, '‹ Reelbook');
});

test('P9 S: no key yet, the shortcut row says what it does; no capture_tokens table, no row', async () => {
  const t = tables(); t.capture_tokens = [];
  const page = await app({...signedIn, tables: t, hash: '#settings'}); await settle();
  assert.equal(page.element('s-sc-sub').textContent, 'Add videos from the Share Sheet');
  const none = await open('#settings', {failing: {capture_tokens: {error: {code: 'PGRST205', message: 'table not found'}, status: 404}}});
  assert.equal(none.element('s-sc-row').hidden, true);
  assert.equal(none.element('shortcut-section').hidden, true);
});

test('P9 S: each sub-page has its title and « ‹ Settings »; Back goes up to #settings', async () => {
  const page = await open('#settings', {history: 'stack'});
  for (const [sub, title] of [['account', 'Account'], ['computer', 'Set up your computer'], ['shortcut', 'iPhone shortcut']]) {
    page.go('#settings/' + sub); await settle();
    assert.deepEqual(shown(page), [sub], sub);
    assert.equal(page.element('s-title').textContent, title);
    assert.equal(page.element('nav-title').textContent, title);
    assert.equal(page.element('nav-back').textContent, '‹ Settings');
    await page.fire('nav-back'); await settle();
    assert.equal(page.location.hash, '#settings', `${sub}: back to Settings`);
    assert.deepEqual(shown(page), ['root']);
  }
  assert.deepEqual(page.history.entries.map(e => e.hash), ['#settings', '#settings/shortcut'], 'Back went back in history');
});

test('P9 S: a deep link opens its sub-page; an unknown one is replaced by #settings', async () => {
  const acc = await open('#settings/account');
  assert.deepEqual(shown(acc), ['account']);
  assert.equal(acc.element('s-acc-user').textContent, user.email);
  assert.equal(acc.element('s-acc-av').textContent, 'LT');
  // the app's back on a deep link: no entry before it, so #settings replaces it
  await acc.fire('nav-back'); await settle();
  assert.equal(acc.location.hash, '#settings');
  for (const bad of ['#settings/nope', '#settings/constructor', '#settings/']) {
    const page = await open(bad, {history: 'stack'});
    assert.equal(page.location.hash, '#settings', bad);
    assert.deepEqual(shown(page), ['root'], bad);
    assert.equal(page.history.entries.length, 1, `${bad}: replaced, not pushed`);
  }
});

test('P9 S: #settings/shortcut on a backend without the table goes back to #settings', async () => {
  const page = await open('#settings/shortcut', {failing: {capture_tokens: {error: {code: 'PGRST205', message: 'table not found'}, status: 404}}});
  assert.equal(page.location.hash, '#settings');
  assert.deepEqual(shown(page), ['root']);
});

test('P9 S: Account — Change backend says « Use your own Supabase project » on the hosted backend only; the controls keep their ids', async () => {
  const own = await open('#settings/account');
  assert.equal(own.element('s-reset-sub').hidden, true);
  const hosted = await app({remembered: {mode: 'hosted'}, sessions: {[hostedUrl]: user}, tables: tables(), hash: '#settings/account'}); await settle();
  assert.equal(hosted.element('s-reset-sub').hidden, false);
  const acc = settingsHtml.match(/<div class="s-page" id="s-account"[\s\S]*?\n  <\/div>/)[0];
  assert.ok(acc.indexOf('id="s-reset"') < acc.indexOf('id="s-signout"'), 'Sign out last');
  assert.match(acc, /<button class="rb-row s-red" type="button" id="s-signout">/);
  assert.match(acc, /<p class="s-foot">Signing out here does not sign out your computer\.<\/p>/);
  assert.match(acc, /id="s-usage" hidden/);
});

test('P9 S: Set up your computer — four steps; one line in view, the device\'s system first; the switch shows the other', async () => {
  const comp = settingsHtml.match(/<div class="s-page" id="s-computer"[\s\S]*?\n  <\/div>/)[0];
  assert.deepEqual([...comp.matchAll(/<div class="s1">([\s\S]*?)<\/div>/g)].map(m => m[1]),
    ['Get the tools', 'Paste one line in a terminal', 'Sign in when it asks', 'Type <code>/reelbook</code> in Claude Code']);
  assert.match(comp, /<a href="#welcome">Full guide<\/a>/);
  assert.match(comp, /<pre id="s-cli"><\/pre>/);
  const visible = page => [...page.element('s-install').innerHTML.matchAll(/<div class="s-os" data-os="(sh|ps)"( hidden)?>/g)].filter(m => !m[2]).map(m => m[1]);
  const mac = await open('#settings/computer', {nav: {userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}});
  assert.deepEqual(visible(mac), ['sh']);
  assert.match(mac.element('s-install').innerHTML, /data-seg="sh" aria-pressed="true">macOS \/ Linux<\/button><button type="button" data-seg="ps" aria-pressed="false">Windows</);
  mac.element('settings').listeners.click({target: {closest: s => s === '[data-seg]' ? {dataset: {seg: 'ps'}} : null}});
  assert.deepEqual(visible(mac), ['ps']);
  const win = await open('#settings/computer', {nav: {userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}});
  assert.deepEqual(visible(win), ['ps']);
});

// ---------- Notebook ⋯ › Delete notebook ----------
const menu = page => page.element('nav-actions').innerHTML;
test('P9 S: a notebook with sheets or sessions — Delete notebook listed last, red, disabled, with the real counts', async () => {
  const page = await open('#strength');
  assert.equal(page.element('nav-more').hidden, false);
  // deleting a session keeps its sheets: every sheet counts, and the reason says how many its sessions hold
  assert.match(menu(page), /<button type="button" class="nav-it danger" id="nav-nb-delete" disabled>Delete notebook<small>Only an empty notebook can be deleted\. Move or delete its 2 sheets \(1 of them in its session\) and its session first\.<\/small><\/button><\/div>/);
  clickIn(page, 'nav-actions', '#nav-nb-delete'); await settle();
  assert.deepEqual(page.clients.flatMap(c => c.calls).filter(c => c[1] === 'user_themes' && c[0] === 'delete'), [], 'nothing deleted');
  const t = tables(); t.sessions = [];
  const only = await app({...signedIn, tables: t, hash: '#strength'}); await settle();
  assert.match(menu(only), /Move or delete its 2 sheets first\./);
});

test('P9 S: the Delete reason counts as the notebook page does (25 sheets = 16 + the 9 exercises of its 3 sessions)', async () => {
  const t = tables();
  t.sheets = Array.from({length: 25}, (_, i) => ({slug: 's' + i, kind: 'sheet', theme: 'strength', group: 'Arms', title: 'S' + i, summary: '', html: '', exercises: []}));
  t.sessions = [0, 1, 2].map(k => ({slug: 'v' + k, theme: 'strength', title: 'V' + k, origin: 'video', items: [0, 1, 2].map(j => ({slug: 's' + (k * 3 + j), dose: ''}))}));
  const page = await app({...signedIn, tables: t, hash: '#strength'}); await settle();
  assert.match(menu(page), /Move or delete its 25 sheets \(9 of them in its 3 sessions\) and its 3 sessions first\./);
  assert.equal(page.element('count').textContent, '16 sheets · 3 sessions (9 exercises)', 'the page line: same numbers');
  t.sessions = [{...t.sessions[0], items: t.sheets.slice(0, 2).map(e => ({slug: e.slug, dose: ''}))}]; t.sheets = t.sheets.slice(0, 2);
  const all = await app({...signedIn, tables: t, hash: '#strength'}); await settle();
  assert.match(menu(all), /Move or delete its 2 sheets \(all in its session\) and its session first\./);
  t.sheets = []; const none = await app({...signedIn, tables: t, hash: '#strength'}); await settle();
  assert.match(menu(none), /Move or delete its session first\./);
});

// A user_themes table whose writes change its rows (a duplicate id answers 23505, as Postgres), and whose reads can be
// made to fail: Codex pass 1 on #131.
const liveThemes = rows => {
  const db = {rows: rows.map(r => ({...r})), log: [], failReads: false};
  const answer = v => Promise.resolve(v);
  db.hold = (table, ops) => {
    if (table !== 'user_themes') return null;
    const w = ops.find(o => o[0] === 'insert' || o[0] === 'delete'), eqs = ops.filter(o => o[0] === 'eq').map(o => o.slice(1));
    if (w && w[0] === 'delete') { db.log.push(['delete', eqs]); db.rows = db.rows.filter(r => !eqs.every(([c, v]) => r[c] === v)); return answer({data: null, error: null}); }
    if (w) {
      const add = [].concat(w[1]).map(r => JSON.parse(JSON.stringify(r))); db.log.push(['insert', add.map(r => r.id)]);
      if (add.some(a => db.rows.some(r => r.id === a.id))) return answer({data: null, error: {code: '23505', message: 'duplicate key value violates unique constraint "user_themes_pkey"'}});
      db.rows.push(...add.map(a => ({description: '', family: null, ...a}))); return answer({data: add, error: null});
    }
    db.log.push(['select']);
    return answer(db.failReads ? {data: null, error: {code: 'PGRST000', message: 'Failed to fetch'}} : {data: db.rows.map(r => ({...r})), error: null});
  };
  return db;
};

test('P9 S: the DELETE went through and a read after it fails — still « deleted · Undo », and Undo restores the row', async () => {
  const db = liveThemes(tables().user_themes);
  const page = await open('', {history: 'stack', hold: db.hold});
  page.go('#custom-cooking'); await settle();
  db.failReads = true;
  await page.fire('nav-more');
  await clickIn(page, 'nav-actions', '#nav-nb-delete'); await settle();
  assert.deepEqual(db.rows.map(r => r.id), ['strength'], 'deleted on the backend');
  assert.equal(page.location.hash, '', 'home');
  assert.equal(page.element('nb-said').hidden, true, 'no « was not deleted »');
  assert.match(page.element('nb-toast').innerHTML, /^Cooking deleted · Undo<span class="qbar"/);
  assert.doesNotMatch(page.element('portal').innerHTML, /Cooking/, 'gone from home without a read');
  await page.fire('nb-undo'); await settle();
  assert.match(page.element('portal').innerHTML, /Cooking/, 'back on home');
  assert.deepEqual(db.rows.find(r => r.id === 'custom-cooking'), tables().user_themes[1], 'the same row back');
  assert.equal(page.element('nb-undo').hidden, true);
  assert.equal(page.element('nb-said').hidden, true);
});

test('P9 S: home reached before the DELETE answers — the tile goes once it is done, and comes back with Undo', async () => {
  const db = liveThemes(tables().user_themes), hold = db.hold; let release = null;
  const slow = (table, ops) => table === 'user_themes' && ops.some(o => o[0] === 'delete') ? new Promise(r => { release = () => r(hold(table, ops)); }) : hold(table, ops);
  const page = await open('#custom-cooking', {hold: slow});
  await clickIn(page, 'nav-actions', '#nav-nb-delete'); await settle();
  page.go(''); await settle();
  assert.equal(page.element('home').hidden, false);
  assert.match(page.element('portal').innerHTML, /Cooking/, 'still there while the DELETE is on its way');
  release(); await settle();
  assert.deepEqual(db.rows.map(r => r.id), ['strength']);
  assert.match(page.element('nb-toast').innerHTML, /^Cooking deleted · Undo/);
  assert.doesNotMatch(page.element('portal').innerHTML, /Cooking/, 'its tile is gone');
  assert.equal(page.location.hash, '');
  await page.fire('nb-undo'); await settle();
  assert.match(page.element('portal').innerHTML, /Cooking/, 'back with Undo');
});

test('P9 S: the last notebook cannot be deleted (« Keep at least one notebook. »); nothing written, no mark kept', async () => {
  const t = {...tables(), sheets: [], sessions: [], user_themes: [{id: 'strength', title: 'Strength', description: '', groups: [], builtin: true, position: 0, family: 'technique'}]};
  const db = liveThemes(t.user_themes);
  const page = await app({...signedIn, tables: t, hash: '#strength', hold: db.hold}); await settle();
  assert.match(menu(page), /<button type="button" class="nav-it danger" id="nav-nb-delete" disabled>Delete notebook<small>Keep at least one notebook\.<\/small><\/button>/);
  await clickIn(page, 'nav-actions', '#nav-nb-delete'); await settle();
  assert.deepEqual(db.log.filter(l => l[0] !== 'select'), [], 'no write');
  assert.deepEqual(db.rows, t.user_themes);
  assert.deepEqual([...page.storage.keys()].filter(k => /noseed/.test(k)), [], 'no per-browser mark');
  // the last one with sheets says what to move first
  const full = await app({...signedIn, tables: {...tables(), user_themes: [tables().user_themes[0]]}, hash: '#strength'}); await settle();
  assert.match(menu(full), /Only an empty notebook can be deleted\. Move or delete its 2 sheets/);
});

test('P9 S: two notebooks — a double tap sends one DELETE, the one left cannot go, Undo restores the exact row (Technique)', async () => {
  const rows = [
    {id: 'strength', title: 'Strength', description: '', groups: [], builtin: true, position: 0, family: null},
    {id: 'custom-cooking', title: 'Cooking', description: 'Recipes I want to try', groups: ['Soups'], builtin: false, position: 3, family: 'technique'}
  ];
  const t = {...tables(), sheets: [], sessions: [], user_themes: rows};
  let release = null; const db = liveThemes(rows), hold = db.hold;
  // the DELETE waits until released: a second tap and the other notebook's menu meet it on its way
  db.hold = (table, ops) => table === 'user_themes' && ops.some(o => o[0] === 'delete') ? new Promise(r => { release = () => r(hold(table, ops)); }) : hold(table, ops);
  const page = await app({...signedIn, tables: t, hash: '#custom-cooking', hold: (...a) => db.hold(...a)}); await settle();
  clickIn(page, 'nav-actions', '#nav-nb-delete'); clickIn(page, 'nav-actions', '#nav-nb-delete'); await settle();
  page.go('#strength'); await settle();
  assert.match(menu(page), /Keep at least one notebook\./, 'the other one is the last while the DELETE is on its way');
  release(); await settle();
  assert.deepEqual(db.log.filter(l => l[0] === 'delete').length, 1, 'one DELETE');
  assert.deepEqual(db.rows.map(r => r.id), ['strength']);
  assert.match(menu(page), /Keep at least one notebook\./);
  await page.fire('nb-undo'); await settle();
  assert.deepEqual(db.rows.find(r => r.id === 'custom-cooking'), rows[1], 'the same row, Kind of practice included');
  assert.deepEqual(db.log.filter(l => l[0] === 'insert'), [['insert', ['custom-cooking']]]);
  // a row with that id already there (23505): no « Try again » loop
  page.go('#custom-cooking'); await settle();
  await clickIn(page, 'nav-actions', '#nav-nb-delete'); await settle();
  db.rows.push({...rows[1], family: null}); // added again meanwhile
  await page.fire('nb-undo'); await settle();
  assert.equal(page.element('nb-undo').hidden, true, 'no retry offered');
  // Undo after signing out writes nothing
  const out = await app({...signedIn, tables: t, hash: '#custom-cooking'}); await settle();
  await clickIn(out, 'nav-actions', '#nav-nb-delete'); await settle();
  out.clients.at(-1).authListener('SIGNED_OUT', null); await settle();
  await out.fire('nb-undo'); await settle();
  assert.equal(out.clients.flatMap(c => c.calls).filter(c => c[1] === 'user_themes' && c[0] === 'insert').length, 0);
});

test('P9 S: an empty notebook — Delete notebook deletes at once, goes home, « Cooking deleted · Undo »; Undo puts the same row back', async () => {
  const page = await open('', {history: 'stack'});
  page.go('#custom-cooking'); await settle();
  assert.match(menu(page), /<button type="button" class="nav-it danger" id="nav-nb-delete">Delete notebook<\/button>/);
  await page.fire('nav-more');
  await clickIn(page, 'nav-actions', '#nav-nb-delete'); await settle();
  const calls = () => page.clients.flatMap(c => c.calls).filter(c => c[1] === 'user_themes');
  assert.deepEqual(calls().map(c => [c[0], c[3]]), [['delete', [['id', 'custom-cooking']]]]);
  assert.equal(page.location.hash, '', 'home');
  assert.equal(page.element('home').hidden, false);
  assert.equal(page.history.index, 0, 'Back, not a new entry');
  assert.equal(page.element('nb-undo').hidden, false);
  assert.match(page.element('nb-toast').innerHTML, /^Cooking deleted · Undo<span class="qbar"/);
  await page.fire('nb-undo'); await settle();
  const ins = calls().filter(c => c[0] === 'insert');
  assert.equal(ins.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(ins[0][2])), {id: 'custom-cooking', title: 'Cooking', description: 'Recipes I want to try', groups: ['Soups'], builtin: false, position: 3, family: 'technique'});
  assert.equal(page.element('nb-undo').hidden, true);
  // the bar ended: no Undo any more
  page.go('#custom-cooking'); await settle();
  await clickIn(page, 'nav-actions', '#nav-nb-delete'); await settle();
  await page.fire('nb-undo', 'animationend');
  assert.equal(page.element('nb-undo').hidden, true);
  await page.fire('nb-undo'); await settle();
  assert.equal(calls().filter(c => c[0] === 'insert').length, 1, 'nothing more inserted');
});

test('P9 S: Undo for another account writes nothing; a refused delete says so and stays', async () => {
  const page = await open('#custom-cooking');
  await clickIn(page, 'nav-actions', '#nav-nb-delete'); await settle();
  page.clients.at(-1).authListener('SIGNED_IN', {user: {id: 'u2', email: 'u2@example.test'}, access_token: 't'}); await settle();
  await page.fire('nb-undo'); await settle();
  assert.equal(page.clients.flatMap(c => c.calls).filter(c => c[1] === 'user_themes' && c[0] === 'insert').length, 0);
  const refused = await open('#custom-cooking', {writes: {user_themes: {data: null, error: {code: '42501', message: 'permission denied'}}}});
  await clickIn(refused, 'nav-actions', '#nav-nb-delete'); await settle();
  assert.equal(refused.location.hash, '#custom-cooking', 'still on the notebook');
  assert.equal(refused.element('nb-undo').hidden, true);
  assert.equal(refused.element('nb-said').textContent, 'Cooking was not deleted. Try again.');
});
