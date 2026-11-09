// R6 (P8, « Socle commun » 24): « Share » first in the « ⋯ » menu of a sheet, a session and a notebook, and the
// « Send as text » sheet: the exact text (app/sessions.js builders), Share… through navigator.share, Copy text as
// the fallback. Never a photo, a note, the practice log or a date in the text.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const RS = require('../app/sessions.js');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const URL_RB = 'https://lt20.github.io/reelbook/?r=text'; // P8 R13

test('R6: a sheet\'s text — title, dose, key points numbered, the video credit, a blank line, the Reelbook line', () => {
  assert.equal(RS.shareSheetText({title: 'Floor angel', dose: '2–3 sets · 6–8 reps per set · 60 s rest',
    keys: ['Ribs down. Keep the lower back on the floor.', 'Slow arms.'], author: 'coach.demo', url: 'https://www.instagram.com/reel/abc/'}),
  'Floor angel\n2–3 sets · 6–8 reps per set · 60 s rest\n1. Ribs down. Keep the lower back on the floor.\n2. Slow arms.\n'
    + 'Video: @coach.demo https://www.instagram.com/reel/abc/\n\nSaved with Reelbook: ' + URL_RB);
  // no dose, no author: those lines go, the link stays; « @ » is never doubled; a name with spaces is kept as is
  assert.equal(RS.shareSheetText({title: 'Row', keys: ['Pull the elbow back.'], url: 'https://youtu.be/x'}),
    'Row\n1. Pull the elbow back.\nVideo: https://youtu.be/x\n\nSaved with Reelbook: ' + URL_RB);
  assert.match(RS.shareSheetText({title: 'Row', author: '@coach'}), /\nVideo: @coach\n/);
  assert.match(RS.shareSheetText({title: 'Row', author: 'Coach Démo'}), /\nVideo: Coach Démo\n/);
  // nothing to credit, a link that is not http(s): no video line at all
  assert.equal(RS.shareSheetText({title: 'Row', url: 'javascript:alert(1)'}), 'Row\n\nSaved with Reelbook: ' + URL_RB);
  // each field on one line
  assert.equal(RS.shareSheetText({title: ' Row\n  two ', dose: '3 ×\n10'}).split('\n').slice(0, 2).join('|'), 'Row two|3 × 10');
});

test('R6: the text follows the content\'s language (French, else English)', () => {
  const fr = RS.shareSheetText({title: 'Pompes inclinées', dose: '3 séries de 10',
    keys: ['Les mains sur le banc, dans l\'axe des épaules.', 'Descends avec la poitrine vers le banc et pousse.'], author: 'coach'});
  assert.match(fr, /\nVidéo : @coach\n\nEnregistré avec Reelbook : https:\/\/lt20\.github\.io\/reelbook\/\?r=text$/);
  assert.match(RS.shareSessionText({title: 'Gainage', items: [{title: 'Planche', dose: '30 s'}], lang: 'fr'}), /^Gainage — 1 exercice\n1\. Planche — 30 s\n\nEnregistré avec Reelbook :/);
  assert.match(RS.shareNotebookText({title: 'Force', groups: [['Bras', ['Curl']]], lang: 'fr'}), /^Force — 1 fiche\nBras : Curl\n/);
});

test('R6: a session\'s text — « n exercises », one line per exercise with its dose, the distinct credits', () => {
  assert.equal(RS.shareSessionText({title: 'Kicks du mardi', lang: 'en', items: [
    {title: 'Front kick', dose: '3 × 10 per side', author: 'coach.a'},
    {title: 'Round kick', dose: '', author: '@coach.a'},
    {title: 'Knee strike', dose: '30 s', author: 'Coach B'},
    {title: 'Shadow', dose: '2 min'}
  ]}), 'Kicks du mardi — 4 exercises\n1. Front kick — 3 × 10 per side\n2. Round kick\n3. Knee strike — 30 s\n4. Shadow — 2 min\n'
    + 'Videos: @coach.a, Coach B\n\nSaved with Reelbook: ' + URL_RB);
  // one credit: « Video: »; none: no credit line; the session's own video credit comes first
  assert.match(RS.shareSessionText({title: 'S', author: 'own', items: [{title: 'A', author: 'own'}]}), /\nVideo: @own\n/);
  assert.equal(RS.shareSessionText({title: 'S', items: [{title: 'A', dose: '5'}]}), 'S — 1 exercise\n1. A — 5\n\nSaved with Reelbook: ' + URL_RB);
  assert.equal(RS.shareSessionText({title: 'Empty', items: []}), 'Empty — 0 exercises\n\nSaved with Reelbook: ' + URL_RB);
});

test('R6: a notebook\'s text — « n sheets », one line per group, 20 titles at most then « … and n more »', () => {
  assert.equal(RS.shareNotebookText({title: 'Strength', groups: [['Arms', ['Hammer curl', 'Dips']], ['Back', []], ['', ['Loose one']]]}),
    'Strength — 3 sheets\nArms: Hammer curl, Dips\nLoose one\n\nSaved with Reelbook: ' + URL_RB);
  const many = Array.from({length: 25}, (_, i) => 'S' + (i + 1));
  const t = RS.shareNotebookText({title: 'Big', groups: [['A', many.slice(0, 18)], ['B', many.slice(18, 23)], ['C', many.slice(23)]]});
  assert.equal(t, `Big — 25 sheets\nA: ${many.slice(0, 18).join(', ')}\nB: S19, S20\n… and 5 more\n\nSaved with Reelbook: ${URL_RB}`);
  assert.equal(RS.SHARE_MAX, 20);
  assert.equal(RS.shareNotebookText({title: 'One', groups: [['G', ['A']]]}).split('\n')[0], 'One — 1 sheet');
});

// ---------- in the app ----------
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const vid = 'https://www.instagram.com/reel/abc/';
const tables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: ['Arms'], builtin: true, position: 0}],
  sheets: [
    {slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Hammer curl', summary: '', html: '<h1>Hammer curl</h1>', exercises: [], source: {url: vid, author: 'coach.a'}, added_at: '2026-10-01T10:00:00Z'},
    {slug: 'row', kind: 'sheet', theme: 'strength', group: 'Back', title: 'Row', summary: '', html: '<h1>Row</h1>', exercises: [], added_at: '2026-10-02T10:00:00Z'},
    // an exercise sheet of a session made from one video: not one of the notebook's own sheets
    {slug: 'kick', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Front kick', summary: '', html: '<h1>Front kick</h1>', exercises: [], added_at: '2026-10-03T10:00:00Z'}
  ],
  sessions: [{slug: 'routine', theme: 'strength', title: 'Routine', origin: 'user', items: [{slug: 'curl', dose: '3 × 10'}, {slug: 'row', dose: ''}]},
    {slug: 'kicks', theme: 'strength', title: 'Kicks', origin: 'video', items: [{slug: 'kick', dose: '10'}]}],
  requests: [],
  notes: [{slug: 'curl', body: 'SECRET NOTE right shoulder'}, {slug: 'session/routine', body: 'SECRET NOTE session'}],
  practice_log: [{slug: 'curl', done_on: '2026-11-07'}]
});
const open = async (hash, nav = {}) => { const page = await app({...signedIn, tables: tables(), hash, dom: true, nav, timerCap: 1000}); await settle(); return page; };
const clickIn = (page, id, selector) => page.element(id).listeners.click({target: {closest: s => s === selector ? {dataset: {}} : null}});
const firstItem = html => (html.match(/<div class="nav-list"><button type="button" class="nav-it[^"]*" id="([^"]+)"/) || [])[1];
const unesc = s => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const preview = page => unesc((page.element('share-dlg').innerHTML.match(/<pre class="share-prev" id="share-text"[^>]*>([\s\S]*?)<\/pre>/) || [])[1] || '');
const share = async page => { await page.fire('nav-more'); clickIn(page, 'nav-actions', '#nav-share'); await settle(); };

test('R6: « Share » is the first item of the « ⋯ » menu of a sheet, a session and a notebook (not of a group grid)', async () => {
  const page = await open('#curl');
  assert.equal(firstItem(page.element('nav-actions').innerHTML), 'nav-share');
  page.go('#session/routine'); await settle();
  assert.equal(firstItem(page.element('nav-actions').innerHTML), 'nav-share');
  assert.match(page.element('nav-actions').innerHTML, /id="nav-share">Share<\/button><button type="button" class="nav-it" id="ed-open">Edit/);
  page.go('#strength'); await settle();
  assert.equal(page.element('nav-more').hidden, false, 'a notebook page has a menu');
  assert.equal(page.element('nav-actions').innerHTML,
    '<h2 id="nav-actions-h">Strength</h2><div class="nav-list"><button type="button" class="nav-it" id="nav-share">Share</button></div>'
    + '<div class="actions"><button class="btn ghost" type="button" id="nav-close">Close</button></div>');
  page.go('#strength~Arms'); await settle();
  assert.equal(page.element('nav-more').hidden, true, 'a group grid has none');
  page.go('#'); await settle();
  assert.equal(page.element('nav-bar').hidden, true);
});

test('R6: Share opens « Share “<title>” » with the exact text, the privacy note, Share… and Copy text', async () => {
  const shared = [];
  const page = await open('#session/routine', {share: async d => { shared.push(d); }, clipboard: {writeText: async () => { throw new Error('unused'); }}});
  await share(page);
  const dlg = page.element('share-dlg');
  assert.equal(dlg.open, true);
  assert.equal(page.element('nav-actions').open, false, 'the menu closes');
  assert.match(dlg.innerHTML, /<h2 id="share-h">Share “Routine”<\/h2>/);
  assert.match(dlg.innerHTML, /Your notes and log are never shared\./);
  assert.match(dlg.innerHTML, /<button class="btn" type="button" id="share-go">Share…<\/button><button class="btn quiet" type="button" id="share-copy">Copy text<\/button>/);
  const text = 'Routine — 2 exercises\n1. Hammer curl — 3 × 10\n2. Row\nVideo: @coach.a\n\nSaved with Reelbook: ' + URL_RB;
  assert.equal(preview(page), text);
  assert.doesNotMatch(dlg.innerHTML, /SECRET|2026-|<img|thumb/, 'no note, no date, no photo');
  await page.fire('share-go');
  assert.deepEqual(JSON.parse(JSON.stringify(shared)), [{title: 'Routine', text}]);
  await page.fire('share-close');
  assert.equal(dlg.open, false);
});

test('R6: a sheet and a notebook share their own text (the notebook: its own sheets, as its page counts them); never the note or the practice log', async () => {
  const page = await open('#curl', {});
  await share(page);
  assert.equal(preview(page), 'Hammer curl\nVideo: @coach.a ' + vid + '\n\nSaved with Reelbook: ' + URL_RB);
  assert.match(page.element('share-dlg').innerHTML, /Share “Hammer curl”/);
  assert.doesNotMatch(page.element('share-dlg').innerHTML, /SECRET|2026-/);
  page.go('#strength'); await settle();
  await share(page);
  // the count of the page (« 2 sheets · 1 session (1 exercise) »): the notebook's own sheets, not a session's exercises
  assert.equal(preview(page), 'Strength — 2 sheets\nArms: Hammer curl\nBack: Row\n\nSaved with Reelbook: ' + URL_RB);
  assert.match(page.element('count').textContent, /^2 sheets · /);
});

test('R6: without navigator.share, Copy text is the one filled button; it copies the exact text and says « Copied »', async () => {
  const copied = [];
  const page = await open('#session/routine', {clipboard: {writeText: async t => { copied.push(t); }}});
  await share(page);
  const dlg = page.element('share-dlg');
  assert.doesNotMatch(dlg.innerHTML, /id="share-go"/);
  assert.match(dlg.innerHTML, /<div class="actions"><button class="btn" type="button" id="share-copy">Copy text<\/button><\/div>/);
  await page.fire('share-copy'); await settle();
  assert.deepEqual(copied, [preview(page)]);
  assert.equal(page.element('share-toast').textContent, 'Copied');
  assert.equal(page.element('share-toast').hidden, false);
});

test('R6: a share closed by the person copies nothing; a share that fails copies; a refused clipboard says to copy by hand', async () => {
  const copied = [];
  let fail = {name: 'AbortError'};
  const page = await open('#curl', {share: async () => { throw fail; }, clipboard: {writeText: async t => { copied.push(t); }}});
  await share(page);
  await page.fire('share-go'); await settle();
  assert.deepEqual(copied, []);
  fail = {name: 'NotAllowedError'};
  await page.fire('share-go'); await settle();
  assert.equal(copied.length, 1);
  assert.equal(page.element('share-toast').textContent, 'Copied');
  const bare = await open('#curl', {});
  await share(bare);
  await bare.fire('share-copy'); await settle();
  assert.equal(bare.element('share-toast').textContent, 'Select the text and copy it');
});

test('R6: on a sheet still loading, « Share » is greyed until its page is drawn; on a sheet that failed, it says why', async () => {
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const page = await app({...signedIn, tables: tables(), hash: '#curl', dom: true, nav: {}, timerCap: 1000,
    hold: (table, ops) => table === 'sheets' && ops.some(o => o[0] === 'single') ? slow : null});
  await settle();
  const menu = () => page.element('nav-actions').innerHTML;
  assert.match(page.element('view').innerHTML, /Loading the sheet…/);
  assert.match(menu(), /<div class="nav-list"><button type="button" class="nav-it" id="nav-share" disabled>Share<small>Once the sheet has loaded<\/small><\/button>/);
  await page.fire('nav-more'); clickIn(page, 'nav-actions', '#nav-share'); await settle();
  assert.notEqual(page.element('share-dlg').open, true, 'nothing to share yet');
  release(null); await settle(); // the read answers: the sheet is drawn, the open menu is painted again
  assert.match(menu(), /<div class="nav-list"><button type="button" class="nav-it" id="nav-share">Share<\/button>/);
  await share(page);
  assert.equal(page.element('share-dlg').open, true);
  const failed = await app({...signedIn, tables: tables(), hash: '#curl', dom: true, nav: {}, timerCap: 1000,
    hold: (table, ops) => table === 'sheets' && ops.some(o => o[0] === 'single') ? Promise.resolve({data: null, error: {message: 'gone'}, status: 404}) : null});
  await settle();
  assert.match(failed.element('view').innerHTML, /This sheet could not be loaded/);
  assert.match(failed.element('nav-actions').innerHTML, /id="nav-share" disabled>Share<small>The sheet could not be loaded<\/small>/);
});

test('R6: a sheet that declares its language (<html lang="fr">) gets French labels, however short its text', async () => {
  const t = tables();
  t.sheets[0] = {...t.sheets[0], html: '<!doctype html><html lang="fr"><body><h1>Curl</h1></body></html>'};
  const page = await app({...signedIn, tables: t, hash: '#curl', dom: true, nav: {}, timerCap: 1000});
  await settle();
  await share(page);
  assert.equal(preview(page), 'Hammer curl\nVidéo : @coach.a ' + vid + '\n\nEnregistré avec Reelbook : ' + URL_RB);
  assert.match(page.element('share-dlg').innerHTML, /<pre class="share-prev" id="share-text" aria-label="Preview of the message" lang="fr">/);
  // without a declared language, the same short text reads English
  const plain = await open('#curl');
  await share(plain);
  assert.match(preview(plain), /\nVideo: @coach\.a /);
});
