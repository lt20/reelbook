// P11 G3b — the « Glossary » page of a notebook: its link on the notebook's count line and under « Words in this
// sheet », its route (#<notebook>/glossary: opened, reloaded, left by Back), the order of its rows, the sense label,
// the « Not sure » pill, its search, a row opening the definition sheet, and a change of account.
// Real layout, the 44 px target, the group chips that do not move: tests/e2e/p11-g3b-check.mjs, in a browser.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SH = require('../app/sheet.js');
const {app, ownUrl, ownKey} = require('./harness.cjs');
const G = SH.glossary;

// A word as a row of glossary_words (docs/audit-design/P11-glossary.md › Data contract)
const row = (id, term, more = {}) => ({id, theme: 'kite', term, sense: null, forms: [term], definition: `Définition de ${term}.`,
  confidence: 'sure', doubt: null, spelling: null, photo: null, related: [], sheets: [], ...more});
// Twelve entries of « Kitesurf », given out of order: digits, an accent, a capital, one word in two senses, forms
const KITE = [
  row('k01', 'Zénith'), row('k02', 'écoute'), row('k03', 'empannage', {forms: ['empannage', 'jibe', 'jibes']}),
  row('k04', 'aile', {sense: 'le kite', related: ['barre']}), row('k05', 'aile', {sense: 'du foil'}), row('k06', '360'), row('k07', '11 h', {forms: ['à 11 h', '11 h']}),
  row('k08', 'barre droite'), row('k09', 'barre', {sheets: [{slug: 'a', quote: 'la barre', where: 'text'}]}),
  row('k10', 'abattre', {confidence: 'unsure', doubt: 'Le mot peut aussi désigner autre chose.', definition: 'Tourner la planche pour partir dans le sens où le vent souffle, avec de la vitesse.'}),
  row('k11', 'au vent'), row('k12', 'carre', {sense: 'de la planche', forms: ['carre', 'carres', 'prise de carre']})
];
const ORDER = ['11 h', '360', 'abattre', 'aile · du foil', 'aile · le kite', 'au vent', 'barre', 'barre droite', 'carre', 'écoute', 'empannage', 'Zénith'];
const FIGHT = [row('f1', 'garde', {theme: 'fight'})];
const labels = html => [...String(html).matchAll(/<b[^>]*>([^<]*)<\/b>(?:<span class="gl-sense"[^>]*> · ([^<]*)<\/span>)?/g)].map(m => m[1] + (m[2] ? ' · ' + m[2] : ''));

test('P11 G3b — the rows are alphabetical in the notebook\'s language: digits first and by value, accents and case ignored, two senses by their label', () => {
  const words = G.read(KITE);
  assert.deepEqual(G.sorted(words, 'fr').map(w => w.term + (w.sense && w.term === 'aile' ? ' · ' + w.sense : '')), ORDER);
  assert.deepEqual(G.sorted(words).map(w => w.key), G.sorted(words, 'fr').map(w => w.key), 'no language known: the same order here');
  assert.deepEqual(G.sorted(words, 'not a language').length, 12, 'a language tag the browser refuses does not break the page');
  assert.deepEqual(words.map(w => w.key), KITE.map(r => r.id), 'the words read are left in their own order');
  assert.deepEqual(labels(G.rowsHtml(G.sorted(words, 'fr'), words, 'fr')), ORDER, 'no letter heading between the rows');
});

test('P11 G3b — a row: the word, its sense only when the notebook has two entries for it, « Not sure » when unsure, the definition; no thumbnail, no chevron, no control', () => {
  const words = G.read(KITE), by = Object.fromEntries(G.rowsHtml(words, words, 'fr').split('</li>').filter(Boolean).map(h => [/data-gw="([^"]+)"/.exec(h)[1], h]));
  assert.equal(by.k09, '<li><button type="button" class="glp-row" data-gw="k09"><span class="glp-w"><b lang="fr">barre</b></span><span class="glp-def" lang="fr">Définition de barre.</span></button>');
  assert.match(by.k04, /<b lang="fr">aile<\/b><span class="gl-sense" lang="fr"> · le kite<\/span><\/span>/);
  assert.match(by.k05, /<b lang="fr">aile<\/b><span class="gl-sense" lang="fr"> · du foil<\/span>/);
  assert.doesNotMatch(by.k12, /gl-sense/, '« carre » has a sense but no other entry: the label is not shown in the list');
  assert.match(by.k10, /<b lang="fr">abattre<\/b><span class="glp-pill">Not sure<\/span><\/span><span class="glp-def"/);
  assert.equal(Object.values(by).filter(h => h.includes('glp-pill')).length, 1);
  const all = Object.values(by).join('');
  assert.doesNotMatch(all, /<img|<svg|›|<a |<input|<select|textarea|Remove|Delete|Edit|Add/, 'read only: a row is one button that opens the definition');
  assert.equal(all.match(/<button /g).length, 12);
  // what the model wrote is text, never markup
  const odd = G.read([row('x', '<i>kite</i> & co', {definition: 'Une "aile" <b>tractée</b>.'})]);
  assert.match(G.rowsHtml(odd, odd), /<b>&lt;i&gt;kite&lt;\/i&gt; &amp; co<\/b><\/span><span class="glp-def">Une &quot;aile&quot; &lt;b&gt;tractée&lt;\/b&gt;\.<\/span>/);
});

test('P11 G3b — « Glossary 52 › »: one string for the notebook page and the end of a sheet; « Words in this sheet » carries it after its chips', () => {
  assert.equal(G.linkHtml('#kite/glossary', 52), '<a class="gl-go" href="#kite/glossary" aria-label="Glossary, 52 words">Glossary 52 ›</a>');
  assert.equal(G.linkHtml('#kite/glossary', 1), '<a class="gl-go" href="#kite/glossary" aria-label="Glossary, 1 word">Glossary 1 ›</a>');
  assert.equal(G.linkHtml('#kite/glossary', 0), '', 'no entry, no link');
  assert.deepEqual([G.count(1), G.count(2), G.count(52)], ['1 word', '2 words', '52 words']);
  const words = G.read(KITE), link = G.linkHtml('#kite/glossary', words.length);
  const end = G.endBlock(words, 'a', link);
  assert.match(end, /^<details class="rb-more gl-end"><summary>Words in this sheet · 1<\/summary><div class="gl-chips"><button [^>]*data-gw="k09"[^>]*>barre<\/button><\/div><p class="gl-all"><a class="gl-go" href="#kite\/glossary" aria-label="Glossary, 12 words">Glossary 12 ›<\/a><\/p><\/details>$/);
  assert.doesNotMatch(G.endBlock(words, 'a'), /gl-all|gl-go/, 'without a link the block is lot G3a\'s');
  assert.equal(G.endBlock(words, 'other', link), '', 'a sheet without word has no block, so no link either');
});

// ---- the app
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}, win: {RBSheet: SH}}; // the harness does not load sheet.js
const tables = (words = [...KITE, ...FIGHT]) => ({
  user_themes: [{id: 'kite', title: 'Kitesurf', groups: ['Jumps'], builtin: true, position: 0}, {id: 'fight', title: 'Fight', groups: [], builtin: true, position: 1},
    {id: 'yoga', title: 'Yoga', groups: [], builtin: true, position: 2}],
  sheets: ['a', 'b'].map(slug => ({slug, kind: 'sheet', theme: 'kite', group: 'Jumps', title: 'Sheet ' + slug, summary: '', html: '<p>Tiens la barre.</p><footer>Source</footer>', source: {}}))
    .concat([{slug: 'c', kind: 'sheet', theme: 'fight', group: '', title: 'Sheet c', summary: '', html: '<a href="#">Home</a>', source: {}},
      {slug: 'd', kind: 'sheet', theme: 'yoga', group: '', title: 'Sheet d', summary: '', html: '<a href="#">Home</a>', source: {}}]),
  sessions: [], notes: [], requests: [], glossary_words: words
});
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve)); };
const go = async (page, hash) => { page.location.hash = hash; await settle(); };
// the fake backend filters glossary_words by its theme, as the real one does; `src.rows` can change (another account)
const byTheme = (src, asked = []) => (table, ops) => {
  if (table !== 'glossary_words' || !ops.some(o => o[0] === 'select')) return null;
  const theme = (ops.find(o => o[0] === 'eq' && o[1] === 'theme') || [])[2];
  asked.push(theme);
  return {data: src.rows.filter(r => r.theme === theme), error: null};
};
const open = async (hash, more = {}) => {
  const src = more.src || {rows: [...KITE, ...FIGHT]}, asked = [];
  const page = await app({...signedIn, tables: tables(src.rows), hold: byTheme(src, asked), dom: true, hash, ...more});
  await settle();
  return Object.assign(page, {asked, src});
};
const gone = {error: {code: 'PGRST205', message: "Could not find the table 'public.glossary_words' in the schema cache"}, status: 404};
const down = {error: {message: 'Failed to fetch'}, status: 0};
const el = (page, id) => page.element(id);
const pageOf = page => ({shown: !el(page, 'glossary').hidden, n: el(page, 'glp-n').hidden ? null : el(page, 'glp-n').textContent, by: !el(page, 'glp-by').hidden,
  search: !el(page, 'glp-search').hidden, rows: el(page, 'glp-list').hidden ? [] : labels(el(page, 'glp-list').innerHTML), msg: el(page, 'glp-msg').innerHTML});
const type = async (page, text) => { el(page, 'glp-q').value = text; await page.fire('glp-q', 'input'); };
const asDom = page => { const v = el(page, 'view'); v.querySelectorAll = () => []; v.insertAdjacentHTML = () => {}; el(page, 'gl-dlg').classList = {toggle() {}, add() {}, remove() {}, contains: () => false}; return v; };
const tapRow = (page, key) => el(page, 'glp-list').listeners.click({preventDefault() {}, target: {closest: sel => sel === '[data-gw]' ? {getAttribute: () => key, classList: {contains: () => false}, isConnected: true, focus() { page.focused.push('row ' + key); }} : null}});

test('P11 G3b — the notebook page: the count unchanged, « Glossary 12 › » beside it, read once per arrival and only read', async () => {
  const page = await open('#kite'), plain = await open('#kite', {src: {rows: []}});
  assert.equal(el(page, 'gl-go').innerHTML, '<a class="gl-go" href="#kite/glossary" aria-label="Glossary, 12 words">Glossary 12 ›</a>');
  assert.equal(el(page, 'count').textContent, el(plain, 'count').textContent, 'the count is what it was');
  assert.match(el(page, 'count').textContent, /^2 sheets/);
  assert.deepEqual(page.asked, ['kite'], 'one read for the arrival');
  await go(page, '#kite~Jumps');
  assert.match(el(page, 'gl-go').innerHTML, /Glossary 12 ›/, 'a group\'s grid is the notebook still');
  await go(page, '#fight');
  assert.equal(el(page, 'gl-go').innerHTML, '<a class="gl-go" href="#fight/glossary" aria-label="Glossary, 1 word">Glossary 1 ›</a>', 'another notebook, its own count');
  await go(page, '');
  assert.equal(el(page, 'gl-go').innerHTML, '', 'the home page has no link');
  await go(page, '#a'); await go(page, '#kite');
  assert.match(el(page, 'gl-go').innerHTML, /Glossary 12 ›/);
  // a search in the notebook: the line counts results, the link leaves; it comes back with the count
  el(page, 'q').value = 'sheet'; await page.fire('q', 'input'); await settle();
  assert.equal(el(page, 'gl-go').innerHTML, '');
  el(page, 'q').value = ''; await page.fire('q', 'input'); await settle();
  assert.match(el(page, 'gl-go').innerHTML, /Glossary 12 ›/);
  assert.deepEqual(page.clients.at(-1).calls.filter(c => c[1] === 'glossary_words' && c[0] !== 'select'), [], 'nothing is written');
  const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
  assert.match(html, /<div class="cnt-row"><p class="cnt" id="count" aria-live="polite"><\/p><span id="gl-go"><\/span><\/div>/, 'the count line is a row: the count, then the link');
  assert.doesNotMatch(html.slice(html.indexOf('const menuHtml'), html.indexOf('const paintMenu')), /gloss/i, 'nothing in the ⋯ menu');
});

test('P11 G3b — no link: a notebook without entry, a backend without the table, a failed read', async () => {
  const none = await open('#yoga');
  assert.deepEqual([el(none, 'gl-go').innerHTML, none.asked], ['', ['yoga']], 'no entry');
  const old = await open('#kite', {failing: {glossary_words: gone}, hold: () => null});
  assert.equal(el(old, 'gl-go').innerHTML, '', 'no table');
  await go(old, '#fight'); await go(old, '#kite');
  assert.equal(old.clients.at(-1).selects.filter(s => s[0] === 'glossary_words').length, 1, 'a backend without the table is asked once');
  const off = await open('#kite', {failing: {glossary_words: down}, hold: () => null});
  assert.equal(el(off, 'gl-go').innerHTML, '', 'a failed read');
  for (const page of [none, old, off]) {
    assert.match(el(page, 'count').textContent, /sheet/, 'the count is there');
    assert.doesNotMatch(el(page, 'count').textContent + el(page, 'home').innerHTML, /gloss|could not/i, 'and nothing is said');
  }
});

test('P11 G3b — the route: #<notebook>/glossary opens the page, « ‹ Kitesurf » leads back; it survives a reload and the browser\'s Back', async () => {
  const page = await open('#kite', {history: 'stack'});
  await go(page, /href="([^"]+)"/.exec(el(page, 'gl-go').innerHTML)[1]);
  assert.equal(page.location.hash, '#kite/glossary');
  assert.deepEqual(pageOf(page), {shown: true, n: '12 words', by: true, search: true, rows: ORDER, msg: ''});
  assert.deepEqual([el(page, 'home').hidden, el(page, 'view').hidden], [true, true]);
  assert.deepEqual([el(page, 'nav-bar').hidden, el(page, 'nav-back').textContent, el(page, 'nav-title').textContent, el(page, 'nav-more').hidden], [false, '‹ Kitesurf', 'Glossary', true]);
  assert.deepEqual(page.asked, ['kite'], 'the words read for the notebook page serve the page');
  page.history.go(-1); await settle(); // the browser's Back
  assert.deepEqual([page.location.hash, el(page, 'glossary').hidden, el(page, 'home').hidden], ['#kite', true, false]);
  assert.match(el(page, 'gl-go').innerHTML, /Glossary 12 ›/);
  page.history.go(1); await settle(); // and Forward
  assert.deepEqual(pageOf(page).rows, ORDER);
  await page.fire('nav-back'); await settle(); // the app's « ‹ Kitesurf »
  assert.deepEqual([page.location.hash, el(page, 'glossary').hidden, el(page, 'home').hidden], ['#kite', true, false]);
  // a reload: the app starts at the address
  const again = await open('#kite/glossary');
  assert.deepEqual(pageOf(again), {shown: true, n: '12 words', by: true, search: true, rows: ORDER, msg: ''});
  assert.equal(el(again, 'nav-back').textContent, '‹ Kitesurf');
  // from a sheet's end block, the page is the same one (the harness page is not a DOM: what the app hands to
  // « Words in this sheet » and to the underlining is watched; their markup is tested above and in lot G3a)
  const log = [], gl = {...G, underline: (root, words, slug) => { log.push(['underline', slug, words.length]); return []; }, endBlock: (words, slug, link) => { log.push(['end', slug, link]); return G.endBlock(words, slug, link); }};
  const sheet = await open('#b', {win: {RBSheet: {...SH, glossary: gl}}});
  asDom(sheet); await go(sheet, '#a');
  assert.deepEqual(log.slice(-2), [['underline', 'a', 12], ['end', 'a', '<a class="gl-go" href="#kite/glossary" aria-label="Glossary, 12 words">Glossary 12 ›</a>']], 'under the chips of « Words in this sheet », the notebook\'s whole count');
  await go(sheet, '#kite/glossary');
  assert.deepEqual([pageOf(sheet).rows, el(sheet, 'view').hidden], [ORDER, true]);
  const n = log.length;
  await go(sheet, '#a');
  assert.deepEqual([el(sheet, 'view').hidden, el(sheet, 'glossary').hidden], [false, true]);
  assert.deepEqual(log.slice(n).map(x => x[0] + ' ' + x[1]), ['underline a', 'end a'], 'back on the sheet, its words are laid again, once');
  // an address that names no notebook is the home page, as any unknown address
  const lost = await open('#nope/glossary');
  assert.deepEqual([el(lost, 'glossary').hidden, el(lost, 'home').hidden, lost.asked], [true, false, []]);
});

test('P11 G3b — the page\'s states: a few entries (no search), one entry, none, no table, a failed read', async () => {
  const few = await open('#fight/glossary');
  assert.deepEqual(pageOf(few), {shown: true, n: '1 word', by: true, search: false, rows: ['garde'], msg: ''});
  const nine = await open('#kite/glossary', {src: {rows: KITE.slice(0, 9)}}), ten = await open('#kite/glossary', {src: {rows: KITE.slice(0, 10)}});
  assert.deepEqual([pageOf(nine).search, pageOf(nine).n, pageOf(ten).search, pageOf(ten).n], [false, '9 words', true, '10 words'], 'the search comes with the tenth entry');
  const none = await open('#yoga/glossary');
  assert.deepEqual(pageOf(none), {shown: true, n: null, by: false, search: false, rows: [], msg: '<p class="glp-none">No word yet. They come from your sheets.</p>'});
  const old = await open('#kite/glossary', {failing: {glossary_words: gone}, hold: () => null});
  assert.deepEqual(pageOf(old), {...pageOf(none)}, 'a backend without the table: the same page, no error');
  const off = await open('#kite/glossary', {failing: {glossary_words: down}, hold: () => null});
  assert.deepEqual(pageOf(off), {shown: true, n: null, by: false, search: false, rows: [], msg: '<p class="empty">The glossary could not be loaded.</p>'});
  await go(off, '#kite'); await go(off, '#kite/glossary');
  assert.equal(off.clients.at(-1).selects.filter(s => s[0] === 'glossary_words').length, 3, 'a failed read is asked again with the next page');
});

test('P11 G3b — while it is read the page says Loading…; an answer that comes after the page was left is not laid', async () => {
  const gates = [], src = {rows: KITE};
  const hold = (table, ops) => table === 'glossary_words' && ops.some(o => o[0] === 'select') ? new Promise(resolve => gates.push(() => resolve({data: src.rows.filter(r => r.theme === (ops.find(o => o[0] === 'eq') || [])[2]), error: null}))) : null;
  const page = await open('#kite/glossary', {hold});
  assert.deepEqual(pageOf(page), {shown: true, n: null, by: false, search: false, rows: [], msg: '<p class="loading">Loading…</p>'});
  await go(page, '#fight/glossary');
  assert.equal(gates.length, 2);
  gates[0](); await settle(); // Kitesurf answers on the Fight page
  assert.deepEqual(pageOf(page).msg, '<p class="loading">Loading…</p>');
  gates[1](); await settle();
  assert.deepEqual(pageOf(page), {shown: true, n: null, by: false, search: false, rows: [], msg: '<p class="glp-none">No word yet. They come from your sheets.</p>'});
});

test('P11 G3b — the search: accents folded, the start of a word, an entry\'s forms; « 2 of 12 words »; « No word for … »', async () => {
  const page = await open('#kite/glossary');
  const found = async text => { await type(page, text); const p = pageOf(page); return [p.rows, p.n]; };
  assert.deepEqual(await found('bar'), [['barre', 'barre droite'], '2 of 12 words']);
  assert.deepEqual(await found('ECOU'), [['écoute'], '1 of 12 words'], 'accents and case folded, in what is typed');
  assert.deepEqual(await found('zenith'), [['Zénith'], '1 of 12 words'], 'and in the word');
  assert.deepEqual(await found('droite'), [['barre droite'], '1 of 12 words'], 'the start of any word of the entry');
  assert.deepEqual(await found('jibe'), [['empannage'], '1 of 12 words'], 'one of its forms');
  assert.deepEqual(await found('prise car'), [['carre'], '1 of 12 words'], 'every word typed must be found');
  assert.deepEqual(await found('11'), [['11 h'], '1 of 12 words']);
  assert.deepEqual(await found('ai'), [['aile · du foil', 'aile · le kite'], '2 of 12 words'], 'the sense label stays, from the whole notebook');
  assert.deepEqual(await found('arre'), [[], '0 of 12 words'], '« arre » starts no word');
  assert.equal(pageOf(page).msg, '<p class="glp-none">No word for “arre”.</p>');
  assert.deepEqual(await found('définition'), [[], '0 of 12 words'], 'the definitions are not searched');
  await type(page, ' <b>kitelop</b> ');
  assert.equal(pageOf(page).msg, '<p class="glp-none">No word for “&lt;b&gt;kitelop&lt;/b&gt;”.</p>', 'what is typed is shown as text');
  assert.deepEqual(await found('   '), [ORDER, '12 words'], 'nothing typed: the whole list and its count');
  assert.equal(pageOf(page).msg, '');
  // another visit starts from an empty field
  await type(page, 'bar'); await go(page, '#kite'); await go(page, '#kite/glossary');
  assert.deepEqual([el(page, 'glp-q').value, pageOf(page).rows.length], ['', 12]);
  const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
  assert.match(html, /<p class="glp-n" id="glp-n" role="status" hidden><\/p>\s*<p class="glp-by" id="glp-by" hidden>Definitions written by Reelbook\.<\/p>/, 'the count is a status, then where the definitions come from');
  assert.match(html, /<div class="search" id="glp-search" hidden><input id="glp-q" type="search"[^>]*aria-label="Search words" placeholder="Search words">/, 'the notebook search\'s field');
});

test('P11 G3b — a row opens the definition sheet of lot G3a, with « See also » and the sense; closing it gives the focus back to the row', async () => {
  const page = await open('#kite/glossary'); asDom(page);
  tapRow(page, 'k10');
  assert.equal(el(page, 'gl-dlg').open, true);
  assert.match(el(page, 'gl-in').innerHTML, /<h2 id="gl-h"[^>]*>abattre<\/h2>.*Tourner la planche pour partir.*<p class="note"><b>Not sure<\/b><span[^>]*>Le mot peut aussi désigner autre chose\.<\/span><\/p>/);
  assert.match(el(page, 'gl-in').innerHTML, /lang="fr"/, 'in the notebook\'s language');
  tapRow(page, 'k04');
  assert.match(el(page, 'gl-in').innerHTML, /abattre/, 'one sheet at a time: a second tap behind it opens nothing');
  el(page, 'gl-dlg').close(); el(page, 'gl-dlg').listeners.close();
  assert.deepEqual([el(page, 'gl-in').innerHTML, page.focused.at(-1)], ['', 'row k10']);
  tapRow(page, 'k04');
  assert.match(el(page, 'gl-in').innerHTML, /<h2 id="gl-h"[^>]*>aile<\/h2><p class="gl-of"[^>]*>le kite<\/p>.*See also.*data-gl-see="k09"/);
  el(page, 'gl-dlg').listeners.click({target: {closest: sel => sel === '[data-gl-see]' ? {getAttribute: () => 'k09'} : null}});
  assert.match(el(page, 'gl-in').innerHTML, /data-gl-back="k04".*<h2 id="gl-h"[^>]*>barre<\/h2>/, '« See also » replaces the content, with its way back');
  assert.doesNotMatch(el(page, 'gl-in').innerHTML, /<input|textarea|Remove|Delete|Edit/, 'read only');
  // leaving the page closes it
  await go(page, '#kite');
  assert.equal(el(page, 'gl-dlg').open, false);
});

test('P11 G3b — another account or a lost session: no word and no count of the account left stay on the page or on the link', async () => {
  const page = await open('#kite/glossary'); asDom(page);
  const client = page.clients.at(-1);
  tapRow(page, 'k10');
  assert.equal(el(page, 'gl-dlg').open, true);
  page.src.rows = [row('z1', 'zeste')]; // what the next account has
  client.authListener('SIGNED_OUT', null); // signed out from another tab
  await settle();
  assert.deepEqual([el(page, 'gl-dlg').open, el(page, 'gl-in').innerHTML, el(page, 'glp-list').innerHTML, el(page, 'glp-n').textContent, el(page, 'glp-msg').innerHTML, el(page, 'gl-go').innerHTML, el(page, 'glossary').hidden],
    [false, '', '', '', '', '', true]);
  tapRow(page, 'k10');
  assert.equal(el(page, 'gl-dlg').open, false, 'a row of the account left opens nothing');
  client.authListener('SIGNED_IN', {user: {id: 'u2', email: 'other@example.test'}});
  await settle();
  assert.deepEqual(pageOf(page), {shown: true, n: '1 word', by: true, search: false, rows: ['zeste'], msg: ''}, 'the page of the account that arrives: its own words only');
  // straight from one account to another, a search typed and the definition open
  page.src.rows = KITE; client.authListener('SIGNED_IN', {user: {id: 'u3', email: 'third@example.test'}}); await settle();
  await type(page, 'bar'); tapRow(page, 'k09');
  assert.deepEqual([pageOf(page).n, el(page, 'gl-dlg').open], ['2 of 12 words', true]);
  page.src.rows = [row('z1', 'zeste')];
  client.authListener('SIGNED_IN', {user: {id: 'u4', email: 'fourth@example.test'}}); await settle();
  assert.deepEqual([pageOf(page), el(page, 'gl-dlg').open, el(page, 'glp-q').value], [{shown: true, n: '1 word', by: true, search: false, rows: ['zeste'], msg: ''}, false, '']);
  // the link of the notebook page follows the account too
  await go(page, '#kite');
  assert.match(el(page, 'gl-go').innerHTML, /Glossary 1 ›/);
  page.src.rows = KITE; client.authListener('SIGNED_IN', {user: {id: 'u5', email: 'fifth@example.test'}}); await settle();
  assert.match(el(page, 'gl-go').innerHTML, /Glossary 12 ›/);
  assert.doesNotMatch(el(page, 'gl-go').innerHTML, /Glossary 1 ›/);
});

test('P11 G3b — a link read for the account left never lands on the next account\'s notebook page', async () => {
  const gates = [], src = {rows: KITE};
  const hold = (table, ops) => table === 'glossary_words' && ops.some(o => o[0] === 'select') ? new Promise(resolve => { const rows = src.rows; gates.push(() => resolve({data: rows, error: null})); }) : null;
  const page = await open('#kite', {hold});
  assert.equal(gates.length, 1);
  src.rows = [row('z1', 'zeste')];
  page.clients.at(-1).authListener('SIGNED_IN', {user: {id: 'u2', email: 'other@example.test'}}); await settle();
  gates[0](); await settle(); // the first account's twelve words answer now
  assert.equal(el(page, 'gl-go').innerHTML, '');
  gates.at(-1)(); await settle();
  assert.match(el(page, 'gl-go').innerHTML, /Glossary 1 ›/);
});

// Codex pass 1: Kitesurf, Fight, then Kitesurf again while the first read of Kitesurf is still on its way: two reads of
// the same notebook, for the same account, are waited for. Only the one asked last counts, whatever the order of the
// answers. Each gate answers what the test hands it (rows, or an error).
const gated = () => {
  const gates = [];
  const hold = (table, ops) => table === 'glossary_words' && ops.some(o => o[0] === 'select')
    ? new Promise(resolve => gates.push(Object.assign(answer => resolve(answer), {theme: (ops.find(o => o[0] === 'eq' && o[1] === 'theme') || [])[2]}))) : null;
  return {gates, hold};
};
const rowsOf = rows => ({data: rows, error: null});
const LINK12 = '<a class="gl-go" href="#kite/glossary" aria-label="Glossary, 12 words">Glossary 12 ›</a>';

test('P11 G3b — the link, A → B → A with the answers out of order: the older read of A, failed or with other words, never replaces the newer one', async () => {
  for (const [name, late] of [['fails', down], ['has no table', gone], ['answers three other words', rowsOf(KITE.slice(0, 3))], ['answers no word', rowsOf([])]]) {
    const {gates, hold} = gated(), page = await open('#kite', {hold});
    await go(page, '#fight'); await go(page, '#kite');
    assert.deepEqual(gates.map(g => g.theme), ['kite', 'fight', 'kite'], 'two reads of Kitesurf are on their way');
    assert.equal(el(page, 'gl-go').innerHTML, '', 'nothing while it is read');
    gates[2](rowsOf(KITE)); await settle(); // the read asked last answers first
    assert.equal(el(page, 'gl-go').innerHTML, LINK12);
    gates[0](late); await settle(); // then the read asked first
    assert.equal(el(page, 'gl-go').innerHTML, LINK12, `the older read ${name}: the link stays, with its count`);
    gates[1](rowsOf(FIGHT)); await settle();
    assert.equal(el(page, 'gl-go').innerHTML, LINK12, 'the notebook left answers last: nothing moves');
    // a next arrival reads again and shows the same; not after « no table », which lot G3a keeps for the whole
    // visit whichever read said it (glossGone): out of this fix
    if (late !== gone) { await go(page, '#kite~Jumps'); assert.equal(el(page, 'gl-go').innerHTML, LINK12, 'the next arrival shows it again'); }
  }
  // the other order: the older read answers first and is not laid; the link waits for the read asked last
  const {gates, hold} = gated(), page = await open('#kite', {hold});
  await go(page, '#fight'); await go(page, '#kite');
  gates[0](rowsOf(KITE.slice(0, 3))); await settle();
  assert.equal(el(page, 'gl-go').innerHTML, '', 'three words of a read given up are not shown');
  gates[2](rowsOf(KITE)); await settle();
  assert.equal(el(page, 'gl-go').innerHTML, LINK12);
});

test('P11 G3b — the « Glossary » page, A → B → A with the answers out of order: the page keeps the words of the read asked last', async () => {
  const full = {shown: true, n: '12 words', by: true, search: true, rows: ORDER, msg: ''};
  for (const [name, late] of [['fails', down], ['answers three other words', rowsOf(KITE.slice(0, 3))], ['answers no word', rowsOf([])]]) {
    const {gates, hold} = gated(), page = await open('#kite/glossary', {hold});
    await go(page, '#fight/glossary'); await go(page, '#kite/glossary');
    assert.deepEqual(gates.map(g => g.theme), ['kite', 'fight', 'kite']);
    assert.equal(pageOf(page).msg, '<p class="loading">Loading…</p>');
    gates[2](rowsOf(KITE)); await settle();
    assert.deepEqual(pageOf(page), full);
    gates[0](late); await settle();
    assert.deepEqual(pageOf(page), full, `the older read ${name}: the page is unchanged`);
    gates[1](rowsOf(FIGHT)); await settle();
    assert.deepEqual(pageOf(page), full);
    // the definition sheet a row opens still reads the twelve words (glNow is the last read's)
    asDom(page); tapRow(page, 'k04'); await settle();
    assert.match(el(page, 'gl-in').innerHTML, /barre/, '« See also » of « aile · le kite » finds « barre »');
  }
});

test('P11 G3b — the shell: the page is in the markup once, read only; sheet.js?v= and the cache version moved', () => {
  const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8'), sw = fs.readFileSync(path.join(__dirname, '../app/sw.js'), 'utf8');
  const v = html.match(/<script src="sheet\.js\?v=(\d+)"><\/script>/)[1];
  assert.ok(Number(v) >= 10); assert.ok(sw.includes(`'./sheet.js?v=${v}'`), 'SHELL names the same version');
  assert.ok(Number(sw.match(/const VERSION = 'rb-shell-(\d+)'/)[1]) >= 77);
  const at = html.indexOf('<div id="glossary" class="wrap" hidden>'), block = html.slice(at, html.indexOf('</div>\n', html.indexOf('id="glp-list"', at)));
  assert.ok(at > 0);
  assert.equal(html.match(/id="glossary"/g).length, 1);
  assert.match(block, /<h1 id="glp-h">Glossary<\/h1>/);
  assert.equal(block.match(/<(?:button|input|select|textarea)\b/g).length, 1, 'one control: the search field');
  assert.doesNotMatch(html, /from\('glossary_words'\)\.(?:insert|update|delete|upsert)|from\('glossary_words'\)[^;]*\.(?:insert|update|delete|upsert)\(/, 'the app never writes the table');
});
