// P8 R18 (Laurent's business tests, 9 Nov 2026): sharing a session is sending it to a training partner, and nothing
// else. A session page has « Share » (outlined, next to « Log »), and its « ⋯ » too: one sheet, « Send “<title>” to a
// training partner », the first name (asked the first time, then filled in, always editable), « Send ». No text share
// anywhere for a sheet, a session or a notebook; no Share on a sheet's or a notebook's « ⋯ », a sheet's Done, New move.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const RS = require('../app/sessions.js');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv', LINK = 'https://lt20.github.io/reelbook/#s-' + TOKEN, NB = ' ';

test('R18: the first name — spaces folded and trimmed, first letter upper case, 40 characters at most', () => {
  assert.equal(RS.shareFirstName('laurent'), 'Laurent');
  assert.equal(RS.shareFirstName('  laurent  '), 'Laurent');
  assert.equal(RS.shareFirstName('élodie'), 'Élodie');
  assert.equal(RS.shareFirstName(' jean\n  marc '), 'Jean marc');
  assert.equal(RS.shareFirstName('Léa'), 'Léa');
  assert.equal(RS.shareFirstName('   '), '');
  assert.equal(RS.shareFirstName(null), '');
  assert.equal(RS.shareFirstName('a'.repeat(60)).length, 40);
});

test('R18: the message in English — « Laurent is sharing the session “<title>” with you (n exercises). Open it in Reelbook: <link> »', () => {
  assert.equal(RS.sharePartnerText({sender: 'laurent', title: 'Arms day', count: 2, url: LINK, lang: 'en'}),
    `Laurent is sharing the session “Arms day” with you (2 exercises). Open it in Reelbook: ${LINK}`);
  assert.equal(RS.sharePartnerText({sender: 'Léa', title: 'Row\n day', count: 1, url: LINK}),
    `Léa is sharing the session “Row day” with you (1 exercise). Open it in Reelbook: ${LINK}`, 'one exercise; no lang: English');
});

test('R18: the message in French — « Laurent vous partage la séance « <titre> » (n exercices). Ouvrez-la dans Reelbook : <lien> », French spacing', () => {
  assert.equal(RS.sharePartnerText({sender: ' laurent ', title: 'Kicks du mardi', count: 4, url: LINK, lang: 'fr'}),
    `Laurent vous partage la séance «${NB}Kicks du mardi${NB}» (4 exercices). Ouvrez-la dans Reelbook${NB}: ${LINK}`);
  assert.equal(RS.sharePartnerText({sender: 'Léa', title: 'Gainage', count: 1, url: LINK, lang: 'fr'}),
    `Léa vous partage la séance «${NB}Gainage${NB}» (1 exercice). Ouvrez-la dans Reelbook${NB}: ${LINK}`);
});

test('R18: the text builders of R6 are gone from the app (no sheet, session or notebook text)', () => {
  for (const k of ['shareSheetText', 'shareSessionText', 'shareNotebookText']) assert.equal(RS[k], undefined, k);
  const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
  assert.doesNotMatch(html, /Or send as text|Copy text|Share as text|id="share-copy"|id="share-go"|id="tech-share"/);
});

// ---------- in the app ----------
const user = meta => ({id: 'u1', email: 'user@example.test', user_metadata: meta || {}});
const settle = async () => { for (let i = 0; i < 25; i++) await new Promise(resolve => setImmediate(resolve)); };
const tables = (extra = {}) => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: ['Arms'], builtin: true, position: 0}],
  sheets: [
    {slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Hammer curl', summary: '', html: '<h1>Hammer curl</h1>', exercises: [], source: {url: 'https://www.instagram.com/reel/abc/'}, added_at: '2026-10-01T10:00:00Z'},
    {slug: 'row', kind: 'sheet', theme: 'strength', group: 'Back', title: 'Row', summary: '', html: '<h1>Row</h1>', exercises: [], added_at: '2026-10-02T10:00:00Z'}],
  sessions: [
    {slug: 'routine', theme: 'strength', title: 'Routine', origin: 'user', items: [{slug: 'curl', dose: '3 × 10'}, {slug: 'row', dose: ''}]},
    {slug: 'mardi', theme: 'strength', title: 'La séance du mardi', why: 'Pour garder le rythme avec les bras et le dos', origin: 'user', items: [{slug: 'curl', dose: '3 × 10'}]},
    {slug: 'empty', theme: 'strength', title: 'Empty one', origin: 'user', items: []}],
  requests: [], notes: [{slug: 'curl', body: 'SECRET NOTE'}], practice_log: [],
  ...extra
});
const open = async (hash, {meta, extra, failing = {}, writes = {}, nav = {}, updateUser, hold} = {}) => {
  const page = await app({remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: user(meta)}, tables: tables(extra), failing, writes,
    hash, dom: true, nav, timerCap: 1000, href: 'https://lt20.github.io/reelbook/', ...(hold ? {hold} : {}),
    auth: () => ({async updateUser(a) { (page.updates = page.updates || []).push(JSON.parse(JSON.stringify(a))); if (updateUser) return updateUser(a); return {data: {user: user({...meta, ...a.data})}, error: null}; }})});
  await settle(); return page;
};
const clickIn = (page, id, selector) => page.element(id).listeners.click({target: {closest: s => s === selector ? {dataset: {}} : null}});
const menu = async page => { await page.fire('nav-more'); await settle(); return page.element('nav-actions').innerHTML; };
const send = async (page, name) => { if (name != null) page.element('share-name').value = name; await page.element('share-form').listeners.submit({preventDefault() {}}); await settle(); };
const writesOf = (page, table) => page.clients[0].calls.filter(c => c[1] === table);
const plain = v => JSON.parse(JSON.stringify(v));

test('R18: a session page — Start filled, then « Log » and « Share » outlined side by side; Share has the line icon and opens the sheet', async () => {
  const page = await open('#session/routine', {extra: {session_shares: []}});
  const html = page.element('view').innerHTML;
  assert.match(html, /<div class="acts2 stack duo"><p class="pl-start"><button type="button" class="btn" id="play-start">Start<\/button><\/p><div class="practice" id="practice">[\s\S]*?id="practice-done"[^>]*>Log<[\s\S]*?<\/div><p class="ses-share"><button type="button" class="btn ghost" id="ses-share" aria-haspopup="dialog"><svg class="ic-share"[^>]*stroke="currentColor"[\s\S]*?<\/svg>Share<\/button><\/p><\/div>/);
  assert.equal((html.match(/class="btn"[ >]/g) || []).length, 1, 'one filled action on the page: Start');
  await page.fire('ses-share'); await settle();
  assert.equal(page.element('share-dlg').open, true);
  assert.match(page.element('share-dlg').innerHTML, /<h2 id="share-h">Send “Routine” to a training partner<\/h2>/);
});

test('R18: a session with no exercise still has Share; its sheet says why and « Send » is disabled', async () => {
  const page = await open('#session/empty', {extra: {session_shares: []}});
  assert.match(page.element('view').innerHTML, /id="ses-share"/);
  assert.doesNotMatch(page.element('view').innerHTML, /id="play-start"/);
  await page.fire('ses-share'); await settle();
  assert.equal(page.element('share-why').textContent, 'This session has no exercise yet. Add one, then send it.');
  assert.equal(page.element('share-send').disabled, true);
  await send(page, 'Laurent');
  assert.deepEqual(writesOf(page, 'session_shares'), []);
});

test('R18: the sheet holds no text and no story — one sentence, the first name, « Send », the privacy note', async () => {
  const page = await open('#session/routine', {extra: {session_shares: []}});
  await menu(page); clickIn(page, 'nav-actions', '#nav-share'); await settle();
  const dlg = page.element('share-dlg').innerHTML;
  assert.doesNotMatch(dlg, /Or send as text|id="share-text"|Copy text|Share…|share-story|Story image|share-rows/);
  assert.match(dlg, /<label>Your first name <input id="share-name" type="text" maxlength="40" autocomplete="given-name"[^>]* required value=""><\/label>/);
  assert.match(dlg, /<div class="actions"><button class="btn" type="submit" id="share-send"[^>]*>Send<\/button><\/div>/);
  assert.match(dlg, /Your notes and log are never shared\./);
  assert.equal(page.element('share-why').textContent, 'They get their own copy of the 2 sheets and the session, even without an account.');
  assert.equal(page.element('share-send').disabled, false);
  assert.doesNotMatch(dlg, /SECRET/);
});

test('R18: first send — the name is empty and required; « laurent » is sent as « Laurent », saved, then filled in the next time', async () => {
  const shared = [];
  const page = await open('#session/routine', {extra: {session_shares: []}, writes: {session_shares: {data: {token: TOKEN}, error: null}},
    nav: {share: async d => { shared.push(d); }}});
  await page.fire('ses-share'); await settle();
  assert.equal(page.element('share-name').value, '');
  await send(page, '   ');
  assert.equal(page.element('share-partner-err').textContent, 'Type your first name.');
  assert.deepEqual(writesOf(page, 'session_shares'), []); assert.equal(page.updates, undefined); assert.deepEqual(shared, []);
  await send(page, '  laurent ');
  assert.deepEqual(plain(writesOf(page, 'session_shares').map(c => c.slice(0, 3))), [['insert', 'session_shares', {session_slug: 'routine', sender_name: 'Laurent'}]]);
  assert.deepEqual(page.updates, [{data: {share_name: 'Laurent'}}]);
  assert.deepEqual(plain(shared), [{title: 'Routine', text: `Laurent is sharing the session “Routine” with you (2 exercises). Open it in Reelbook: ${LINK}`}]);
  assert.equal(page.element('share-dlg').open, false, 'sent: the sheet closes');
  assert.equal(page.element('r11-toast').textContent, 'Sent');
  // the next time: filled in with the name saved, which is not saved again (the link: the live one, read again)
  await page.fire('ses-share'); await settle();
  assert.equal(page.element('share-name').value, 'Laurent');
  assert.match(page.element('share-dlg').innerHTML, /required value="Laurent">/);
  await send(page);
  assert.equal(page.updates.length, 1, 'the same name: not saved again');
  assert.equal(shared[1].text, shared[0].text);
});

test('R18: the name filled in can be changed — the new one is sent and saved; the live link is reused', async () => {
  const shared = [];
  const page = await open('#session/routine', {meta: {share_name: 'Léa'}, extra: {session_shares: [{token: TOKEN, session_slug: 'routine'}]}, nav: {share: async d => { shared.push(d); }}});
  await menu(page); clickIn(page, 'nav-actions', '#nav-share'); await settle();
  assert.equal(page.element('share-name').value, 'Léa');
  await send(page, 'marie');
  assert.deepEqual(writesOf(page, 'session_shares'), [], 'the same link: nothing written');
  assert.deepEqual(page.updates, [{data: {share_name: 'Marie'}}]);
  assert.equal(shared[0].text, `Marie is sharing the session “Routine” with you (2 exercises). Open it in Reelbook: ${LINK}`);
});

test('R18: a French session sends the French message (its language, as the story card reads it), one exercise', async () => {
  const shared = [];
  const page = await open('#session/mardi', {meta: {share_name: 'Laurent'}, extra: {session_shares: [{token: TOKEN, session_slug: 'mardi'}]}, nav: {share: async d => { shared.push(d); }}});
  await page.fire('ses-share'); await settle();
  await send(page);
  assert.equal(shared[0].text, `Laurent vous partage la séance «${NB}La séance du mardi${NB}» (1 exercice). Ouvrez-la dans Reelbook${NB}: ${LINK}`);
});

test('R18: states — reading the shares (Checking…), a backend without session_shares (coming soon): « Send » disabled, nothing written', async () => {
  const page = await open('#session/routine', {meta: {share_name: 'Laurent'}, failing: {session_shares: {error: {code: 'PGRST205', message: 'no table'}, status: 404}}});
  await page.fire('ses-share'); // drawn before the shares are read
  assert.match(page.element('share-dlg').innerHTML, /<p class="share-lead why" id="share-why">Checking…<\/p>[\s\S]*id="share-send" disabled>Send</);
  await settle();
  assert.equal(page.element('share-why').textContent, 'Sending a session to a training partner is coming soon on this Reelbook.');
  assert.equal(page.element('share-send').disabled, true);
  await send(page);
  assert.deepEqual(writesOf(page, 'session_shares'), []);
  assert.doesNotMatch(await menu(page), /Stop sharing/);
});

test('R18: errors — the link cannot be made: said in the sheet, which stays; the name not saved: said, the message still sent', async () => {
  const shared = [];
  const page = await open('#session/routine', {extra: {session_shares: []}, writes: {session_shares: {data: null, error: {code: '500', message: 'down'}}}, nav: {share: async d => { shared.push(d); }}});
  await page.fire('ses-share'); await settle();
  await send(page, 'Laurent');
  assert.equal(page.element('share-partner-err').textContent, 'Reelbook could not make the link. Check the connection and try again.');
  assert.equal(page.element('share-dlg').open, true);
  assert.deepEqual(shared, []);
  assert.equal(page.element('share-send').disabled, false, 'Send again');
  const p2 = await open('#session/routine', {extra: {session_shares: [{token: TOKEN, session_slug: 'routine'}]}, nav: {share: async d => { shared.push(d); }},
    updateUser: async () => ({data: null, error: {message: 'offline'}})});
  await p2.fire('ses-share'); await settle();
  await send(p2, 'Laurent');
  assert.equal(shared.length, 1);
  assert.equal(p2.element('share-partner-err').textContent, 'Reelbook could not save your first name. It will be asked again next time.');
  assert.equal(p2.element('share-dlg').open, true);
});

test('R18: without navigator.share the message is copied; closed by the person: nothing; a refused clipboard shows it to copy by hand', async () => {
  const copied = [];
  const ses = {meta: {share_name: 'Laurent'}, extra: {session_shares: [{token: TOKEN, session_slug: 'routine'}]}};
  const page = await open('#session/routine', {...ses, nav: {clipboard: {writeText: async t => { copied.push(t); }}}});
  await page.fire('ses-share'); await settle(); await send(page);
  assert.deepEqual(copied, [`Laurent is sharing the session “Routine” with you (2 exercises). Open it in Reelbook: ${LINK}`]);
  assert.equal(page.element('share-toast').textContent, 'Message copied');
  let fail = {name: 'AbortError'};
  const p2 = await open('#session/routine', {...ses, nav: {share: async () => { throw fail; }, clipboard: {writeText: async t => { copied.push(t); }}}});
  await p2.fire('ses-share'); await settle(); await send(p2);
  assert.equal(copied.length, 1, 'closed: nothing copied');
  assert.equal(p2.element('share-dlg').open, true);
  fail = {name: 'NotAllowedError'};
  await send(p2);
  assert.equal(copied.length, 2, 'a share that fails copies');
  const p3 = await open('#session/routine', {...ses, nav: {}});
  await p3.fire('ses-share'); await settle(); await send(p3);
  assert.equal(p3.element('share-link').hidden, false);
  assert.match(p3.element('share-link').textContent, /^Laurent is sharing the session “Routine”/);
  assert.equal(p3.element('share-toast').textContent, 'Select the message and copy it');
});

test('R18: no Share in the ⋯ of a sheet or a notebook; the session ⋯ keeps it first', async () => {
  const page = await open('#session/routine', {extra: {session_shares: []}});
  assert.match(await menu(page), /<div class="nav-list"><button type="button" class="nav-it" id="nav-share">Share<\/button>/);
  const sheet = await open('#curl');
  assert.doesNotMatch(await menu(sheet), /nav-share|>Share</);
  const nb = await open('#strength');
  assert.doesNotMatch(await menu(nb), /nav-share|>Share</);
});

test('R18: « Share Reelbook » in Settings stays (it shares the app, not a content)', () => {
  const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
  assert.match(html, /id="s-share"[\s\S]*?Share Reelbook<small>Sends a link to Reelbook, not your notebooks<\/small>/);
});

test('R18 (Codex #126): the name still being saved, the sheet closed and opened for another session — the late answer leaves it alone', async () => {
  const shared = [];
  let release;
  const gate = new Promise(r => { release = r; });
  let page;
  page = await open('#session/routine', {extra: {session_shares: [{token: TOKEN, session_slug: 'routine'}, {token: TOKEN, session_slug: 'mardi'}]},
    nav: {share: async d => { shared.push(d); }}, updateUser: async a => { if ((page.updates || []).length > 1) return {data: {user: user(a.data)}, error: null}; await gate; return {data: {user: user(a.data)}, error: {message: 'offline'}}; }});
  await page.fire('ses-share'); await settle();
  await send(page, 'Laurent'); // shared at once; the name's save waits
  assert.equal(shared.length, 1);
  await page.fire('share-close');
  page.go('#session/mardi'); await settle();
  await page.fire('ses-share'); await settle();
  assert.match(page.element('share-dlg').innerHTML, /Send “La séance du mardi” to a training partner/);
  release(); await settle();
  assert.equal(page.element('share-dlg').open, true, 'the sheet of the other session stays open');
  assert.equal(page.element('share-partner-err').textContent, '', 'nothing said in it about the first send');
  assert.notEqual(page.element('r11-toast').textContent, 'Sent');
  assert.equal(page.element('share-send').disabled, false, 'its « Send » is its own');
});

test('R18 (Codex #126 pass 2): the clipboard answers late, after the sheet was opened for another session — its sheet never shows the first message', async () => {
  let refuse;
  const gate = new Promise(r => { refuse = r; });
  const page = await open('#session/routine', {meta: {share_name: 'Laurent'}, extra: {session_shares: [{token: TOKEN, session_slug: 'routine'}, {token: TOKEN, session_slug: 'mardi'}]},
    nav: {clipboard: {writeText: async () => { await gate; throw new Error('refused'); }}}});
  await page.fire('ses-share'); await settle();
  await send(page); // the copy waits
  await page.fire('share-close');
  page.go('#session/mardi'); await settle();
  await page.fire('ses-share'); await settle();
  refuse(); await settle();
  assert.equal(page.element('share-link').hidden, true, 'the message of the first session is not shown');
  assert.equal(page.element('share-link').textContent, '');
  assert.notEqual(page.element('share-toast').textContent, 'Select the message and copy it');
});

test('R18 (Codex #126 pass 3): a link known from before is not sent until this opening has read the shares again (it may be revoked)', async () => {
  const shared = [];
  let held = false, release;
  const gate = new Promise(r => { release = r; });
  const page = await open('#session/routine', {meta: {share_name: 'Laurent'}, extra: {session_shares: [{token: TOKEN, session_slug: 'routine'}]},
    nav: {share: async d => { shared.push(d); }}, hold: (table, ops) => held && table === 'session_shares' && ops.some(o => o[0] === 'select') ? gate : null});
  await page.fire('nav-more'); await settle(); // the shares read once: the link is known
  held = true;
  await page.fire('ses-share'); await settle(); // its own read waits
  await send(page);
  assert.deepEqual(shared, [], 'the link known from before is not sent as is');
  held = false; release(); await settle();
  assert.equal(shared.length, 1, 'sent once the database said the link is live');
});

test('R18 (Codex #126 pass 3): the first name of a send still being saved — a sheet opened for another session sends at once', async () => {
  const shared = [];
  let release;
  const gate = new Promise(r => { release = r; });
  const page = await open('#session/routine', {extra: {session_shares: [{token: TOKEN, session_slug: 'routine'}, {token: TOKEN, session_slug: 'mardi'}]},
    nav: {share: async d => { shared.push(d); }}, updateUser: async a => { await gate; return {data: {user: user(a.data)}, error: null}; }});
  await page.fire('ses-share'); await settle();
  await send(page, 'Laurent'); // shared; the name's save waits
  await page.fire('share-close');
  page.go('#session/mardi'); await settle();
  await page.fire('ses-share'); await settle();
  assert.equal(page.element('share-send').disabled, false);
  await send(page, 'Laurent');
  assert.equal(shared.length, 2, 'not blocked by the save of the first send');
  assert.match(shared[1].text, /La séance du mardi/);
  release(); await settle();
});
