const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, hostedUrl, ownUrl, ownKey} = require('./harness.cjs');

test('a new visitor sees hosted sign-in before any backend choice', async () => {
  const page = await app();
  assert.equal(page.element('auth').hidden, false);
  assert.equal(page.element('setup').hidden, true);
  assert.equal(page.element('a-submit').disabled, false);
  assert.equal(page.clients[0].url, hostedUrl);
  await page.fire('a-toggle');
  assert.equal(page.element('setup').hidden, false);
  await page.fire('pick-hosted');
  assert.equal(page.element('auth').hidden, false);
  assert.equal(page.element('auth-title').textContent, 'Create an account');
});

test('an existing self-hosted session opens on its remembered project', async () => {
  const page = await app({
    remembered: {mode: 'own', url: ownUrl, key: ownKey},
    sessions: {[ownUrl]: {id: 'existing-user', email: 'user@example.test'}}
  });
  assert.equal(page.clients[0].url, ownUrl);
  assert.equal(page.element('home').hidden, false);
  assert.equal(page.element('setup').hidden, true);
});

test('self-hosted sign-in on a new device stores the project and uses it', async () => {
  const page = await app();
  await page.fire('a-own');
  assert.equal(page.element('login-own-form').hidden, false);
  page.element('login-own-url').value = ownUrl;
  page.element('login-own-key').value = ownKey;
  await page.fire('login-own-form', 'submit');
  assert.equal(page.clients.at(-1).url, ownUrl);
  assert.deepEqual(JSON.parse(page.storage.get('rb.backend')), {mode: 'own', url: ownUrl, key: ownKey});
  page.element('a-email').value = 'user@example.test';
  page.element('a-pass').value = 'example-password';
  await page.fire('auth-form', 'submit');
  assert.equal(page.clients.at(-1).calls[0][0], 'in');
  assert.equal(page.clients.at(-1).calls[0][1].email, 'user@example.test');
});

test('leaving sign-up restores the remembered backend', async () => {
  const page = await app({remembered: {mode: 'hosted'}});
  await page.fire('a-toggle');
  await page.fire('pick-own');
  page.element('own-url').value = ownUrl;
  page.element('own-key').value = ownKey;
  await page.fire('own-form', 'submit');
  assert.equal(page.clients.at(-1).url, ownUrl);
  assert.deepEqual(JSON.parse(page.storage.get('rb.backend')), {mode: 'hosted'});
  await page.fire('a-toggle');
  assert.equal(page.clients.at(-1).url, hostedUrl);
  assert.equal(page.element('auth-title').textContent, 'Sign in');
});

test('sign-up saves its chosen backend after account creation', async () => {
  const page = await app();
  await page.fire('a-toggle');
  await page.fire('pick-own');
  page.element('own-url').value = ownUrl;
  page.element('own-key').value = ownKey;
  await page.fire('own-form', 'submit');
  page.element('a-email').value = 'new@example.test';
  page.element('a-pass').value = 'example-password';
  await page.fire('auth-form', 'submit');
  assert.equal(page.clients.at(-1).calls[0][0], 'up');
  assert.deepEqual(JSON.parse(page.storage.get('rb.backend')), {mode: 'own', url: ownUrl, key: ownKey});
  assert.equal(page.element('auth-title').textContent, 'Sign in');
  assert.equal(page.element('a-info').hidden, false);
});

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'existing-user', email: 'user@example.test'}}};
const reel = 'https://www.instagram.com/reel/DeGBCfjsbTt/';

test('a pasted link is kept until queued, and « + Add a video » asks before dropping it', async () => {
  const page = await app(signedIn);
  await page.fire('btn-new');
  assert.equal(page.element('sheet-new').hidden, false);
  page.element('f-url').value = reel;
  await page.fire('f-url', 'input');
  assert.equal(page.storage.get('rb.draft'), reel);
  await page.fire('btn-new');
  assert.equal(page.element('sheet-new').hidden, false, 'the form stays open');
  assert.equal(page.element('pending-dlg').open, true);
  assert.equal(page.element('pd-url').textContent, reel, 'the dialog names the pending link');
  assert.equal(page.element('pd-queue').textContent, 'Queue it, then add another');
  await page.fire('pd-queue');
  const insert = page.clients.at(-1).calls.find(c => c[0] === 'insert');
  assert.equal(JSON.stringify(insert), JSON.stringify(['insert', 'requests', {url: reel}]));
  assert.equal(page.storage.has('rb.draft'), false);
  assert.equal(page.element('pending-dlg').open, false);
  assert.equal(page.element('sheet-new').hidden, false, 'a fresh form is open for the next link');
});

test('a link left in the field comes back on the next launch', async () => {
  const page = await app({...signedIn, stored: {'rb.draft': reel}});
  assert.equal(page.element('f-url').value, reel);
  assert.equal(page.element('sheet-new').hidden, false);
  assert.equal(page.element('f-err').hidden, false);
});

test('discarding from the dialog forgets the link', async () => {
  const page = await app({...signedIn, stored: {'rb.draft': reel}});
  await page.fire('btn-new');
  await page.fire('pd-discard');
  assert.equal(page.storage.has('rb.draft'), false);
  assert.equal(page.clients.at(-1).calls.some(c => c[0] === 'insert'), false);
});

test('keyword search finds sheets, accents and case ignored; an old one-page session is not shown', async () => {
  const page = await app({
    remembered: {mode: 'own', url: ownUrl, key: ownKey},
    sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}},
    tables: {
      user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
      sheets: [
        {slug: 'ange', kind: 'sheet', theme: 'strength', group: 'Shoulders', title: "L'ange au sol", summary: 'À plat ventre, bras tendus.', source: {author: 'Georges'}, exercises: []},
        {slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Curl marteau', summary: 'Haltères, coudes fixes.', exercises: []},
        {slug: 'routine', kind: 'session', theme: 'strength', title: 'Routine épaules', summary: 'Cinq exercices.', exercises: [{anchor: 'rot', title: "Rotation externe d'épaule", group: 'Shoulders', summary: 'Avec un élastique.'}]}
      ]
    }
  });
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  assert.equal(page.element('home').hidden, false);
  assert.equal(page.element('search').hidden, false);
  const search = async q => { page.element('q').value = q; await page.fire('q', 'input'); return page.element('results').innerHTML; };
  let html = await search('HALTERES');
  assert.match(html, /href="#curl"/);
  assert.doesNotMatch(html, /#ange/);
  assert.equal(page.element('portal').hidden, true);
  html = await search('EPAULE');
  assert.doesNotMatch(html, /#routine/, 'v1 session hidden, its exercises too');
  assert.match(html, /Nothing matches/);
  html = await search('shoulders plat');
  assert.match(html, /#ange/);
  assert.doesNotMatch(html, /#routine/);
  html = await search('pilates');
  assert.match(html, /Nothing matches/);
  await search('');
  assert.equal(page.element('results').hidden, true);
  assert.equal(page.element('portal').hidden, false);
});

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const v2Tables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}, {id: 'mobility', title: 'Mobility', groups: [], builtin: true, position: 1}],
  sheets: [
    {slug: 'gsp-angel', kind: 'sheet', theme: 'strength', group: 'Shoulders', title: 'Floor angel', summary: 'Face down.', duration: '', exercises: []},
    {slug: 'gsp-rot', kind: 'sheet', theme: 'mobility', group: 'Shoulders', title: 'External rotation', summary: 'With a band.', duration: '', exercises: []},
    {slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Hammer curl', summary: 'Dumbbells.', exercises: []},
    {slug: 'old-routine', kind: 'session', theme: 'strength', title: 'Old routine', summary: 'One page.', exercises: [{anchor: 'a', title: 'Old move', group: 'Arms', summary: ''}]}
  ],
  sessions: [{slug: 'gsp-shoulders', theme: 'strength', title: 'GSP shoulders', format: '5 rounds · 60 s rest', why: 'Healthy shoulders.', key_points: ['Slow', 'Breathe'],
    source: {author: 'Georges', url: 'https://example.test/v'}, origin: 'video', thumbnail: '',
    items: [{slug: 'gsp-rot', dose: '3×10'}, {slug: 'deleted-sheet', dose: '1 min'}, {slug: 'gsp-angel', dose: '30 s'}]}]
});

test('v2 sessions show in their notebook, in search and on their own page', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#strength'});
  await settle();
  const groups = page.element('groups').innerHTML;
  assert.match(groups, /Sessions <span class="n">1<\/span>/, 'the old one-page session is not counted');
  assert.match(groups, /href="#session\/gsp-shoulders"/);
  assert.doesNotMatch(groups, /old-routine|Old move/, 'no v1 session card, no v1 exercise card');
  // L12: standalone sheets · sessions (their exercise sheets): gsp-angel belongs to the video session
  assert.equal(page.element('count').textContent, '1 sheet · 1 session (1 exercise)');
  assert.match(groups, /2 exercises/, 'the deleted sheet is not counted');
  assert.match(groups, /href="#gsp-angel"[\s\S]*?in 1 session/);
  assert.doesNotMatch(groups.match(/href="#curl"[\s\S]*?<\/a>/)[0], /in \d session/);
  page.element('q').value = 'rounds'; await page.fire('q', 'input');
  assert.match(page.element('results').innerHTML, /#session\/gsp-shoulders/);
});

test('a v2 session page lists its sheets in order with their dose, and moves to another notebook', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#session/gsp-shoulders'});
  await settle();
  assert.equal(page.element('view').hidden, false);
  const html = page.element('view').innerHTML;
  assert.match(html, /<h1>GSP shoulders<\/h1>/);
  assert.match(html, /5 rounds · 60 s rest/);
  assert.match(html, /<li>Slow<\/li><li>Breathe<\/li>/);
  assert.match(html, /href="https:\/\/example.test\/v"/);
  // L5: an exercise card opens the sheet inside the session, #session/<slug>/<n>
  assert.match(html, /href="#session\/gsp-shoulders\/1"><span class="k">1<\/span>[\s\S]*?<h3>External rotation<\/h3>[\s\S]*?3×10[\s\S]*?href="#session\/gsp-shoulders\/2"><span class="k">2<\/span>[\s\S]*?<h3>Floor angel<\/h3>[\s\S]*?30 s/);
  assert.doesNotMatch(html, /deleted-sheet|1 min/);
  page.element('view').listeners.click({target: {closest: () => true}});
  assert.equal(page.element('move-dlg').open, true);
  assert.equal(page.element('mv-title').textContent, 'Move this session');
  assert.equal(page.element('mv-group-l').hidden, true);
  page.element('mv-theme').value = 'mobility';
  await page.fire('mv-form', 'submit');
  assert.match(page.element('sheet-top').innerHTML, /Moved to Mobility\./);
});

test('an exercise sheet links back to its video session', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#gsp-angel'});
  await settle();
  assert.match(page.element('view').innerHTML, /From the session <a href="#session\/gsp-shoulders">GSP shoulders<\/a>/);
});

test('a backend without the sessions table still loads, and Settings says how to enable sessions', async () => {
  const failing = {sessions: {error: {code: 'PGRST205', message: 'Could not find the table'}, status: 404}};
  const page = await app({...signedIn, tables: v2Tables(), hash: '#strength', failing});
  await settle();
  assert.doesNotMatch(page.element('count').textContent, /Could not load/);
  assert.match(page.element('groups').innerHTML, /href="#gsp-angel"/);
  assert.doesNotMatch(page.element('groups').innerHTML, /#session\/|in 1 session/);
  const settings = await app({...signedIn, tables: v2Tables(), hash: '#settings', failing});
  await settle();
  assert.equal(settings.element('settings').hidden, false);
  assert.equal(settings.element('s-sessions').hidden, false);
  const ok = await app({...signedIn, tables: v2Tables(), hash: '#settings'});
  await settle();
  assert.equal(ok.element('s-sessions').hidden, true);
});

test('any other sessions error is a load error', async () => {
  const page = await app({...signedIn, tables: v2Tables(), failing: {sessions: {error: {code: '42501', message: 'permission denied'}, status: 403}}});
  await settle();
  assert.match(page.element('count').textContent, /Could not load your sheets: permission denied/);
});

// ---------- composing sessions (S3) ----------
// A click inside a container whose handler delegates with ev.target.closest(selector).
const clickIn = (page, id, selector, dataset = {}) => page.element(id).listeners.click({target: {closest: s => s === selector ? {dataset} : null}});
const typeIn = (page, target) => page.element('view').listeners.input({target: {dataset: {}, ...target}});
// The writes of the signed-in client, as plain JSON ([method, table, payload, eq filters]).
const writesOf = page => JSON.parse(JSON.stringify(page.clients.at(-1).calls.filter(c => ['insert', 'update', 'delete', 'upsert'].includes(c[0]))));

test('« + New session » shows in every notebook, ticks sheets in order and opens the new session in Edit mode', async () => {
  const empty = await app({...signedIn, tables: v2Tables(), hash: '#mobility'});
  await settle();
  assert.match(empty.element('groups').innerHTML, /<h2>Sessions<\/h2><button[^>]*id="ns-open">\+ New session<\/button>[\s\S]*No session yet/);
  const page = await app({...signedIn, tables: v2Tables(), hash: '#strength'});
  await settle();
  clickIn(page, 'groups', '#ns-open');
  assert.equal(page.element('ns-dlg').open, true);
  let list = page.element('ns-list').innerHTML;
  assert.match(list, /<h3>Arms<\/h3>[\s\S]*data-pick="curl"/);
  assert.match(list, /<h3>Shoulders<\/h3>[\s\S]*data-pick="gsp-angel"/);
  assert.doesNotMatch(list, /old-routine|gsp-rot/, 'only the simple sheets of this notebook');
  page.element('ns-q').value = 'hammer'; await page.fire('ns-q', 'input');
  assert.match(page.element('ns-list').innerHTML, /data-pick="curl"/);
  assert.doesNotMatch(page.element('ns-list').innerHTML, /gsp-angel/);
  page.element('ns-q').value = ''; await page.fire('ns-q', 'input');
  for (const pick of ['gsp-angel', 'curl']) page.element('ns-list').listeners.change({target: {dataset: {pick}}});
  list = page.element('ns-list').innerHTML;
  assert.match(list, /data-pick="curl" checked><span class="o">2</);
  assert.match(list, /data-pick="gsp-angel" checked><span class="o">1</);
  await page.fire('ns-form', 'submit');
  assert.equal(page.element('ns-err').textContent, 'Give the session a title.');
  assert.equal(writesOf(page).length, 0);
  page.element('ns-title').value = '  GSP shoulders ';
  await page.fire('ns-form', 'submit');
  await settle();
  assert.deepEqual(writesOf(page), [['insert', 'sessions',
    {slug: 'my-gsp-shoulders', theme: 'strength', title: 'GSP shoulders', origin: 'user', items: [{slug: 'gsp-angel', dose: ''}, {slug: 'curl', dose: ''}]}, []]]);
  assert.equal(page.element('ns-dlg').open, false);
  assert.equal(page.element('view').hidden, false);
  const html = page.element('view').innerHTML;
  assert.match(html, /Editing the session/);
  assert.match(html, /<b>Floor angel<\/b>[\s\S]*<b>Hammer curl<\/b>/);
  assert.doesNotMatch(html, /processed again/, 'no video help on a user session');
});

test('Edit reorders, sets doses, format and title, and saves the items in full in one update', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#session/gsp-shoulders'});
  await settle();
  clickIn(page, 'view', '#ed-open');
  let html = page.element('view').innerHTML;
  assert.match(html, /If this video is processed again, the session is rewritten and these edits are lost\./);
  assert.match(html, /<h2>Why<\/h2>[\s\S]*<li>Slow<\/li>/, 'why and key points stay, read-only');
  assert.doesNotMatch(html, /id="mv-open"|id="ed-open"|deleted-sheet/);
  assert.match(html, /data-up="0" aria-label="[^"]*" disabled/);
  clickIn(page, 'view', '[data-down]', {down: '0'});
  assert.match(page.element('ed-items').innerHTML, /<b>Floor angel<\/b>[\s\S]*<b>External rotation<\/b>/);
  typeIn(page, {dataset: {dose: '0'}, value: '45 s'});
  typeIn(page, {id: 'ed-format', value: ' 3 rounds '});
  typeIn(page, {id: 'ed-title', value: 'Shoulders, Monday'});
  clickIn(page, 'view', '#ed-save');
  await settle();
  assert.deepEqual(writesOf(page), [['update', 'sessions',
    {title: 'Shoulders, Monday', format: '3 rounds', items: [{slug: 'gsp-angel', dose: '45 s'}, {slug: 'gsp-rot', dose: '3×10'}]}, [['slug', 'gsp-shoulders']]]]);
  html = page.element('view').innerHTML;
  assert.match(html, /Saved\./);
  assert.match(html, /<h1>Shoulders, Monday<\/h1>/);
  assert.match(html, /href="#session\/gsp-shoulders\/1"><span class="k">1<\/span>[\s\S]*?<h3>Floor angel<\/h3>[\s\S]*?45 s[\s\S]*?href="#session\/gsp-shoulders\/2"><span class="k">2<\/span>[\s\S]*?<h3>External rotation<\/h3>/);
});

test('Edit: a write that changes no row shows an error and keeps the edits and the saved session as they were', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#session/gsp-shoulders', writes: {sessions: {data: [], error: null}}});
  await settle();
  clickIn(page, 'view', '#ed-open');
  clickIn(page, 'view', '[data-out]', {out: '0'});
  assert.doesNotMatch(page.element('ed-items').innerHTML, /External rotation/);
  clickIn(page, 'view', '#ed-save');
  await settle();
  assert.equal(page.element('ed-err').hidden, false);
  assert.match(page.element('ed-err').textContent, /Could not save/);
  assert.match(page.element('view').innerHTML, /Editing the session/, 'still in Edit mode');
  clickIn(page, 'view', '#ed-cancel');
  assert.match(page.element('view').innerHTML, /href="#session\/gsp-shoulders\/1"><span class="k">1<\/span>[\s\S]*?<h3>External rotation<\/h3>/, 'the session is unchanged');
});

test('Delete session asks in an app dialog, deletes the row only and refreshes the notebook', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#session/gsp-shoulders'});
  await settle();
  clickIn(page, 'view', '#ed-open');
  clickIn(page, 'view', '#ed-delete');
  assert.equal(page.element('del-dlg').open, true);
  assert.equal(page.element('del-name').textContent, 'GSP shoulders');
  await page.fire('del-cancel');
  assert.equal(page.element('del-dlg').open, false);
  assert.equal(writesOf(page).length, 0);
  clickIn(page, 'view', '#ed-delete');
  await page.fire('del-ok');
  await settle();
  assert.deepEqual(writesOf(page), [['delete', 'sessions', null, [['slug', 'gsp-shoulders']]]]);
  assert.equal(page.element('home').hidden, false);
  const groups = page.element('groups').innerHTML;
  assert.doesNotMatch(groups, /#session\/gsp-shoulders|in 1 session/);
  assert.match(groups, /href="#gsp-angel"/, 'its sheets stay');
  assert.match(page.element('flash').textContent, /Session deleted/);
});

test('Delete sheet asks in an app dialog, deletes the row, its photos and its note, then opens the notebook', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#gsp-angel'});
  await settle();
  assert.match(page.element('view').innerHTML, /id="sd-open">Delete sheet</);
  clickIn(page, 'view', '#sd-open');
  assert.equal(page.element('sd-dlg').open, true);
  assert.equal(page.element('sd-name').textContent, 'Floor angel');
  assert.match(page.element('sd-what').textContent, /It leaves the session « GSP shoulders »\./);
  await page.fire('sd-cancel');
  assert.equal(page.element('sd-dlg').open, false);
  assert.equal(writesOf(page).length, 0);
  clickIn(page, 'view', '#sd-open');
  await page.fire('sd-ok');
  await settle();
  assert.deepEqual(writesOf(page), [['delete', 'sheets', null, [['slug', 'gsp-angel']]], ['delete', 'notes', null, [['slug', 'gsp-angel']]]]);
  assert.deepEqual(page.clients.at(-1).calls.find(c => c[0] === 'remove'), ['remove', ['existing-user/gsp-angel/img/thumb.jpg']]);
  assert.equal(page.element('sd-dlg').open, false);
  assert.equal(page.element('home').hidden, false);
  assert.doesNotMatch(page.element('groups').innerHTML, /href="#gsp-angel"/);
  assert.match(page.element('flash').textContent, /Sheet deleted/);
});

test('Delete sheet keeps the sheet and says so when the delete fails', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#curl', writes: {sheets: {data: [], error: null}}});
  await settle();
  clickIn(page, 'view', '#sd-open');
  await page.fire('sd-ok');
  await settle();
  assert.equal(page.element('sd-dlg').open, true);
  assert.match(page.element('sd-err').textContent, /Could not delete/);
  assert.equal(page.clients.at(-1).calls.some(c => c[0] === 'remove'), false, 'photos kept');
});

// ---------- old one-page sessions (v1), left on an older self-hosted backend (S4) ----------
test('old one-page sessions are hidden, and Settings says how to rebuild them', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#settings'});
  await settle();
  assert.equal(page.element('settings').hidden, false);
  assert.equal(page.element('s-v1').hidden, false);
  assert.match(page.element('s-v1').innerHTML, /^1 old-format session hidden: run <code>python3 tools\/rb.py requeue-sessions<\/code>, then <code>\/reelbook<\/code>, to rebuild them\.$/);
  assert.match(page.element('nblist').innerHTML, /Strength<\/b><small>2 sheets · 1 session</);
  page.go('');
  await settle();
  assert.match(page.element('count').textContent, /^0 practised · 3 saved · 1 session · 2 notebooks$/); // L6: practice_log empty
  assert.match(page.element('portal').innerHTML, /2 sheets · 1 session/);
  const tables = v2Tables(); tables.sheets = tables.sheets.filter(s => s.kind !== 'session');
  const clean = await app({...signedIn, tables, hash: '#settings'});
  await settle();
  assert.equal(clean.element('s-v1').hidden, true, 'no hint once every old session is rebuilt');
});

test('a link to an old session, or an old #<slug>~<anchor> link, opens the home page without failing', async () => {
  for (const hash of ['#old-routine', '#old-routine~a', '#gsp-angel~x']) {
    const page = await app({...signedIn, tables: v2Tables(), hash});
    await settle();
    assert.equal(page.element('home').hidden, false, hash);
    assert.equal(page.element('view').hidden, true, hash);
    assert.doesNotMatch(page.element('count').textContent, /Could not load/, hash);
  }
});

test('a link in a sheet to another sheet or a session is kept; an unknown #anchor stays on the sheet', async () => {
  const tables = v2Tables();
  tables.sheets.find(s => s.slug === 'curl').html = '<a href="#gsp-angel">Floor angel</a><a href="#session/gsp-shoulders">GSP</a>'
    + '<a href="#cues">Cues</a><a href="#session/gone">Gone</a><a href="#">Home</a><a href="https://example.test/v">Video</a>';
  const page = await app({...signedIn, tables, hash: '#curl', dom: true});
  await settle();
  const html = page.element('view').innerHTML;
  assert.doesNotMatch(html, /could not be loaded/);
  assert.match(html, /<a href="#gsp-angel">Floor angel<\/a>/, 'existing sheet: kept');
  assert.match(html, /<a href="#session\/gsp-shoulders">GSP<\/a>/, 'existing session: kept');
  assert.match(html, /<a href="#curl">Cues<\/a>/, 'unknown anchor: the current sheet');
  assert.match(html, /<a href="#curl">Gone<\/a>/, 'unknown session: the current sheet');
  assert.match(html, /<a href="#">Home<\/a>/);
  assert.match(html, /<a href="https:\/\/example.test\/v">Video<\/a>/);
});

test('« Add to session » appends the sheet once, says when it is already there, and can create a session', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#curl'});
  await settle();
  assert.match(page.element('view').innerHTML, /id="as-open">Add to session</);
  clickIn(page, 'view', '#as-open');
  assert.equal(page.element('as-dlg').open, true);
  assert.match(page.element('as-session').innerHTML, /<optgroup label="Strength"><option value="gsp-shoulders">GSP shoulders<\/option><\/optgroup><option value="__new_session__">New session…<\/option>/);
  assert.equal(page.element('as-session').value, 'gsp-shoulders');
  await page.fire('as-form', 'submit');
  assert.deepEqual(writesOf(page), [['update', 'sessions',
    {items: [{slug: 'gsp-rot', dose: '3×10'}, {slug: 'deleted-sheet', dose: '1 min'}, {slug: 'gsp-angel', dose: '30 s'}, {slug: 'curl', dose: ''}]}, [['slug', 'gsp-shoulders']]]]);
  assert.match(page.element('sheet-top').innerHTML, /Added to <a href="#session\/gsp-shoulders">GSP shoulders<\/a>\./);
  clickIn(page, 'view', '#as-open');
  await page.fire('as-form', 'submit');
  assert.equal(page.element('as-err').textContent, 'This sheet is already in that session.');
  assert.equal(writesOf(page).length, 1, 'no second write');
  page.element('as-session').value = '__new_session__'; await page.fire('as-session', 'change');
  assert.equal(page.element('as-new-l').hidden, false);
  assert.equal(page.element('as-hint').textContent, 'It is created in Strength.');
  page.element('as-new').value = 'Arms day';
  await page.fire('as-form', 'submit');
  assert.deepEqual(writesOf(page)[1], ['insert', 'sessions', {slug: 'my-arms-day', theme: 'strength', title: 'Arms day', origin: 'user', items: [{slug: 'curl', dose: ''}]}, []]);
  assert.match(page.element('sheet-top').innerHTML, /Added to <a href="#session\/my-arms-day">Arms day<\/a>/);
});

test('« From the session » and « in N sessions » follow an added sheet without a reload', async () => {
  const tables = v2Tables();
  tables.sessions.push({slug: 'mob', theme: 'mobility', title: 'Mobility flow', format: '', why: '', key_points: [], source: {}, origin: 'video', thumbnail: '', items: [{slug: 'gsp-rot', dose: ''}]});
  const page = await app({...signedIn, tables, hash: '#curl'});
  await settle();
  assert.doesNotMatch(page.element('sheet-top').innerHTML, /From the session/);
  clickIn(page, 'view', '#as-open');
  assert.match(page.element('as-session').innerHTML, /<optgroup label="Strength">[\s\S]*<optgroup label="Mobility"><option value="mob">Mobility flow/);
  page.element('as-session').value = 'mob';
  await page.fire('as-form', 'submit');
  assert.match(page.element('sheet-top').innerHTML, /From the session <a href="#session\/mob">Mobility flow<\/a>/);
  page.go('#strength'); await settle();
  assert.match(page.element('groups').innerHTML.match(/href="#curl"[\s\S]*?<\/a>/)[0], /in 1 session/);
});

test('a v2 session page has its own notes, keyed session/<slug>, and its card shows « note »', async () => {
  const tables = v2Tables();
  tables.notes = [{slug: 'session/gsp-shoulders', body: 'Felt good', updated_at: '2026-11-01T10:00:00Z'}];
  const nb = await app({...signedIn, tables, hash: '#strength'});
  await settle();
  const groups = nb.element('groups').innerHTML;
  assert.match(groups.match(/href="#session\/gsp-shoulders"[\s\S]*?<\/a>/)[0], /class="note"/);
  assert.doesNotMatch(groups.match(/href="#gsp-angel"[\s\S]*?<\/a>/)[0], /class="note"/, 'a session note is not a sheet note');
  const page = await app({...signedIn, tables, hash: '#session/gsp-shoulders'});
  await settle();
  assert.match(page.element('view').innerHTML, /My notes/);
  assert.equal(page.element('n-text').value, 'Felt good');
  page.element('n-text').value = 'Felt better';
  await page.fire('n-text', 'input'); // L5: notes save themselves
  await settle();
  assert.deepEqual(writesOf(page), [['upsert', 'notes', {slug: 'session/gsp-shoulders', body: 'Felt better'}, []]]);
});

// ---------- L1 (design audit P0) ----------
test('C1: saving a video session after changing one dose keeps its long format and long doses byte for byte', async () => {
  const tables = v2Tables();
  const format = '4 rounds of the circuit, 45 s of work and 15 s of rest per exercise, 2 min of rest between rounds; '
    + 'start slowly, keep the breathing calm, stop before any shoulder pain and finish with 5 min of easy walking';
  const longDose = '3 × 12 slow reps, 3 s down, 1 s pause, 20 s of rest';
  assert.ok(format.length > 200 && format.length <= 240 && longDose.length > 40 && longDose.length <= 60);
  Object.assign(tables.sessions[0], {format, items: [{slug: 'gsp-rot', dose: longDose}, {slug: 'gsp-angel', dose: '30 s'}]});
  const page = await app({...signedIn, tables, hash: '#session/gsp-shoulders'});
  await settle();
  clickIn(page, 'view', '#ed-open');
  const html = page.element('view').innerHTML;
  assert.match(html, /id="ed-format" type="text" maxlength="240"/, 'the format input allows 240 characters');
  assert.match(html, /id="ed-title" type="text" maxlength="80"/);
  assert.match(html, /data-dose="0" value="[^"]*" maxlength="60"/, 'a dose input allows 60 characters');
  typeIn(page, {dataset: {dose: '1'}, value: '40 s'});
  clickIn(page, 'view', '#ed-save');
  await settle();
  const [[method, table, row]] = writesOf(page);
  assert.equal(`${method} ${table}`, 'update sessions');
  assert.equal(row.format, format, 'the format is saved whole');
  assert.deepEqual(row.items, [{slug: 'gsp-rot', dose: longDose}, {slug: 'gsp-angel', dose: '40 s'}]);
  assert.ok(page.element('view').innerHTML.includes(format), 'the saved page shows the whole format');
});

test('C2: the add-notebook card counts « N more to pick from » and suggests notebooks not added yet', async () => {
  const lib = ['strength', 'kitesurf', 'mobility', 'cook', 'pilates', 'golf'].map(id => ({id, title: id === 'kitesurf' ? 'Kitesurf' : id === 'cook' ? 'Cooking' : id === 'mobility' ? 'Mobility & rehab' : id[0].toUpperCase() + id.slice(1), groups: []}));
  const tables = v2Tables();
  tables.user_themes.push({id: 'kitesurf', title: 'Kitesurf', groups: [], builtin: true, position: 2});
  const page = await app({...signedIn, tables, library: lib});
  await settle();
  let card = page.element('portal').innerHTML.match(/<button[^>]*id="add-nb">[\s\S]*?<\/button>/)[0];
  assert.match(card, /<p class="eyebrow">3 more to pick from<\/p>/);
  assert.match(card, /<p>Cooking, pilates, golf… or one you describe yourself\.<\/p>/, 'Kitesurf is already a notebook');
  const one = await app({...signedIn, tables, library: lib.slice(0, 4)});
  await settle();
  card = one.element('portal').innerHTML.match(/<button[^>]*id="add-nb">[\s\S]*?<\/button>/)[0];
  assert.match(card, /1 more to pick from<\/p>[\s\S]*<p>Cooking… or one you describe yourself\.<\/p>/);
  const none = await app({...signedIn, tables, library: lib.slice(0, 3)});
  await settle();
  card = none.element('portal').innerHTML.match(/<button[^>]*id="add-nb">[\s\S]*?<\/button>/)[0];
  assert.doesNotMatch(card, /more to pick|class="eyebrow"/, 'nothing left to pick: no eyebrow at all');
  assert.match(card, /<h2>\+ Add a notebook<\/h2><p>Describe one yourself\.<\/p>/);
});

test('C2: a queue row without a notebook shows no notebook label, and its reason sits on its own line', async () => {
  const tables = v2Tables();
  tables.requests = [
    {id: 3, url: 'https://www.tiktok.com/@coach/video/7312', status: 'error', theme: null, note: 'Video unavailable (private account)', created_at: '2026-11-01T08:00:00Z'},
    {id: 2, url: 'https://www.youtube.com/shorts/aBcD1234', status: 'processing', theme: 'strength', note: '', created_at: '2026-11-02T20:00:00Z'}
  ];
  const page = await app({...signedIn, tables});
  await settle();
  const rows = page.element('queue').innerHTML.split('<div class="q">').slice(1);
  assert.match(rows[0], /<small>added 1 Nov<\/small><small class="why">Video unavailable \(private account\)<\/small>/);
  assert.match(rows[0], /Failed/);
  assert.match(rows[1], /<small>added 2 Nov · Strength<\/small><\/div>/);
});

test('C5: sign-up asks Supabase to send the confirmation link back to the app, not to localhost', async () => {
  const page = await app();
  await page.fire('a-toggle');
  await page.fire('pick-hosted');
  page.element('a-email').value = 'new@example.test';
  page.element('a-pass').value = 'example-password';
  await page.fire('auth-form', 'submit');
  const [kind, credentials] = page.clients.at(-1).calls[0];
  assert.equal(kind, 'up');
  assert.deepEqual(JSON.parse(JSON.stringify(credentials.options)), {emailRedirectTo: 'https://app.example.test/reelbook/'});
});

test('C5: a load error on a self-hosted backend says the project may be paused; on the hosted one it does not', async () => {
  const failing = {sessions: {error: {message: 'Failed to fetch'}, status: 0}};
  const own = await app({...signedIn, tables: v2Tables(), failing});
  await settle();
  assert.equal(own.element('count').textContent,
    'Could not load your sheets: Failed to fetch. Your Supabase project may be paused: open your Supabase dashboard and restore it.');
  const hosted = await app({remembered: {mode: 'hosted'}, sessions: {[hostedUrl]: {id: 'u1', email: 'user@example.test'}}, tables: v2Tables(), failing});
  await settle();
  assert.equal(hosted.clients.at(-1).url, hostedUrl);
  assert.equal(hosted.element('count').textContent, 'Could not load your sheets: Failed to fetch');
});

test('C6: a sheet is wrapped in its language: its own <html lang>, else French when it reads French, else none', async () => {
  const shown = async sheetHtml => {
    const tables = v2Tables();
    tables.sheets.find(s => s.slug === 'curl').html = sheetHtml;
    const page = await app({...signedIn, tables, hash: '#curl', dom: true});
    await settle();
    const html = page.element('view').innerHTML;
    assert.match(html, /<a href="#gsp-angel">Floor angel<\/a>/, 'the sheet is shown');
    return (html.match(/<div lang="([^"]*)"><a href="#gsp-angel">/) || [])[1] || '';
  };
  const link = '<a href="#gsp-angel">Floor angel</a>';
  assert.equal(await shown(`<!doctype html><html lang="fr-CH"><head><style>p{}</style></head><body><p>Hold it.</p>${link}</body></html>`), 'fr-CH');
  assert.equal(await shown(`<html><body><h1>Curl marteau</h1><p>Debout, les haltères le long du corps, coudes fixes et dos droit.</p>${link}</body></html>`), 'fr');
  assert.equal(await shown(`<p>Allongez-vous sur le dos : l'épaule reste au sol.</p>${link}`), 'fr');
  assert.equal(await shown(`<p>Stand tall, dumbbells by your sides, elbows fixed. Curl up, lower slowly. A la carte: le cardio.</p>${link}`), '');
  assert.equal(await shown(link), '');
});

test('C6: accessibility base — focus ring, live regions, input border token, theme colours, notch padding', () => {
  assert.match(html, /a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,summary:focus-visible,[^{]*\{outline:3px solid var\(--ink\);outline-offset:2px\}/);
  assert.match(html, /<div class="flash" id="flash" role="status" hidden>/);
  assert.match(html, /<p class="cnt" id="count" aria-live="polite">/);
  assert.match(html, /--line-strong:#8f8a80;/);
  assert.equal((html.match(/--line-strong:#6b7079;/g) || []).length, 2, 'dark tokens: system and forced');
  assert.match(html, /\ninput,textarea,select\{[^}]*border:1px solid var\(--line-strong\)/);
  assert.match(html, /<meta name="theme-color" content="#f3f1ec" media="\(prefers-color-scheme: light\)">/);
  assert.match(html, /<meta name="theme-color" content="#15171a" media="\(prefers-color-scheme: dark\)">/);
  assert.match(html, /padding-inline:max\(16px,env\(safe-area-inset-left\)\) max\(16px,env\(safe-area-inset-right\)\)/);
});

test('C1: a text past its limit that the user did not touch is saved as it is; an edited one is clipped', async () => {
  const tables = v2Tables();
  const title = 'T'.repeat(85), format = 'F'.repeat(241), longDose = 'D'.repeat(61);
  Object.assign(tables.sessions[0], {title, format, items: [{slug: 'gsp-rot', dose: longDose}, {slug: 'gsp-angel', dose: '30 s'}]});
  const page = await app({...signedIn, tables, hash: '#session/gsp-shoulders'});
  await settle();
  clickIn(page, 'view', '#ed-open');
  clickIn(page, 'view', '[data-down]', {down: '0'});
  typeIn(page, {dataset: {dose: '0'}, value: '40 s'});
  clickIn(page, 'view', '#ed-save');
  await settle();
  let [[, , row]] = writesOf(page);
  assert.equal(row.title, title, 'untouched title kept whole');
  assert.equal(row.format, format, 'untouched format kept whole (rb.py publish does not enforce the limit)');
  assert.deepEqual(row.items, [{slug: 'gsp-angel', dose: '40 s'}, {slug: 'gsp-rot', dose: longDose}], 'untouched dose kept whole, even moved');
  const edited = await app({...signedIn, tables, hash: '#session/gsp-shoulders'});
  await settle();
  clickIn(edited, 'view', '#ed-open');
  typeIn(edited, {id: 'ed-format', value: format + 'G'});
  typeIn(edited, {dataset: {dose: '0'}, value: longDose + 'E'});
  clickIn(edited, 'view', '#ed-save');
  await settle();
  [[, , row]] = writesOf(edited);
  assert.equal(row.format, format.slice(0, 240), 'an edited format is clipped to its limit');
  assert.equal(row.items[0].dose, longDose.slice(0, 60), 'an edited dose is clipped to its limit');
  assert.equal(row.title, title);
});

// ---------- L19, pass 4: a catalogue read overtaken by a local change ----------
test('a sheet deleted while the catalogue is being read does not come back, and the saved catalogue drops it', async () => {
  const RS = require('../app/sessions.js');
  const tables = v2Tables(), idb = new Map(), key = RS.catalogueCacheKey(ownUrl, 'existing-user');
  const before = {data: tables.sheets.map(s => ({...s})), error: null}; // what the read in flight will answer
  idb.set(key, RS.catalogueSnapshot({themes: tables.user_themes, sheets: tables.sheets.filter(s => s.kind !== 'session'),
    sessions: tables.sessions, sessionsOk: true, notesIndex: new Set(), lastDone: new Map(), practiceOk: true}));
  let release, reads = 0;
  const gate = new Promise(r => { release = r; });
  const hold = (t, ops) => t === 'sheets' && ops.some(o => o[0] === 'order') && reads++ === 0 ? gate : null;
  const page = await app({...signedIn, tables, hash: '#gsp-angel', idb, hold});
  await settle();
  assert.equal(reads, 1, 'the catalogue read is on its way');
  clickIn(page, 'view', '#sd-open');
  await page.fire('sd-ok');
  await settle();
  assert.deepEqual(writesOf(page)[0], ['delete', 'sheets', null, [['slug', 'gsp-angel']]]);
  tables.sheets = tables.sheets.filter(s => s.slug !== 'gsp-angel'); // the backend no longer has it
  release(before); // the read made before the delete answers now
  await settle();
  assert.equal(reads, 2, 'read again once');
  assert.doesNotMatch(page.element('groups').innerHTML, /href="#gsp-angel"/);
  assert.match(page.element('groups').innerHTML, /href="#curl"/);
  assert.deepEqual(idb.get(key).sheets.map(s => s.slug).sort(), ['curl', 'gsp-rot']);
});
