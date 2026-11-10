// P11 G3a — the glossary in a sheet: the placing rules of the underlines one by one (app/sheet.js, on the mini DOM),
// « Words in this sheet », the definition sheet's states, and the read of glossary_words by the app (a backend
// without the table stays silent; another account or a « Move » takes the words shown away).
// Real layout, history and scrolling: tests/e2e/p11-g3a-check.mjs, in a browser.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SH = require('../app/sheet.js');
const {parse} = require('./mini-dom.cjs');
const {app, ownUrl, ownKey} = require('./harness.cjs');
const G = SH.glossary;

// A word as a row of glossary_words (docs/audit-design/P11-glossary.md › Data contract)
const row = (id, term, sheets, more = {}) => ({id, theme: 'kite', term, sense: null, forms: [term], definition: `Définition de ${term}.`,
  confidence: 'sure', doubt: null, spelling: null, photo: null, related: [], sheets: sheets.map(([slug, quote, where = 'text']) => ({slug, quote, where})), ...more});
const SHEET = `<div class="wrap fiche"><header><div><p class="eyebrow">Saut · carre</p><h1>Le saut sur la carre</h1></div></header>
<p class="lead">Un saut part de la carre : envoi du kite à midi, puis la  <b>Carre</b>
 se relâche.</p><div class="kit"><span>carre affûtée</span></div>
<h2>La carre en bref</h2><div class="cond"><div class="c"><b>carre</b><span>carre</span></div></div><div class="dose"><div class="d"><b>3</b><span>carre</span></div></div>
<div class="steps"><div class="step"><figure><img src="a.jpg" alt="carre"><span class="palm">carre</span></figure><h3>Sur la carre</h3><p>Garde la carre, puis choque la barre.</p></div></div>
<ul><li>Voir <a href="#x">la carre en détail</a>, puis borde.</li><li>Le bord de la fenêtre, puis deux bords.</li></ul>
<p class="note">La carre ne se relâche pas.</p><blockquote>« Tiens ta carre »</blockquote><p>Un paragraphe simple pour la carre.</p>
<details class="rb-why"><summary><h2>Pourquoi la carre</h2></summary><p>Parce que la carre retient la planche.</p></details>
<p class="loop"><span class="arrow">↻</span> Enchaîne, la carre toujours plantée.</p>
<h2>Plus facile / plus dur</h2><p>Plus facile : la carre à peine posée.</p>
<p>Dérive sous <b>le</b> vent. Puis <em>remonte <b>au</b></em> vent <i>arrière</i>, et repars <strong>plein <a href="#y">vent</a></strong> arrière. Vise le <a href="#z">largue</a> serré.</p>
<ul><li>Reste <mark>en</mark> appui<ul><li>long sur la planche.</li></ul></li></ul>
<footer>Source : la carre.</footer></div><div class="wrap"><section class="notes"><h2>My notes</h2><ul><li>ma carre</li></ul></section></div>`;
const marks = doc => doc.querySelectorAll('.gw').map(g => `${g.getAttribute('data-gw')}:${g.textContent}`);
const under = (rows, slug = 's1', html = SHEET) => { const doc = parse(html), before = doc.body.textContent; const keys = G.underline(doc.body, G.read(rows), slug); return {doc, keys, same: doc.body.textContent === before}; };

test('P11 G3a — a word is underlined only in a sheet its `sheets` lists with where « text »', () => {
  assert.deepEqual(marks(under([row('a', 'carre', [['s1', 'part de la carre']])]).doc), ['a:carre']);
  assert.deepEqual(marks(under([row('a', 'carre', [['other', 'part de la carre']])]).doc), [], 'another sheet');
  for (const where of ['title', 'caption', 'chip', '']) assert.deepEqual(marks(under([row('a', 'carre', [['s1', 'part de la carre', where]])]).doc), [], where);
  assert.deepEqual(marks(under([]).doc), [], 'no word');
});

test('P11 G3a — the place is the first occurrence of the quote: tags ignored, whitespace collapsed, case ignored', () => {
  const r = under([row('a', 'carre', [['s1', 'PUIS LA CARRE se relâche']])]);
  assert.deepEqual(marks(r.doc), ['a:Carre'], 'the quote runs over <b> and a line break; the text keeps its own case');
  assert.equal(r.doc.querySelector('.gw').parentNode.tagName, 'B');
  assert.equal(r.same, true, 'the text of the sheet is unchanged');
  const g = r.doc.querySelector('.gw');
  assert.deepEqual([g.getAttribute('role'), g.getAttribute('tabindex'), g.children.length, g.children[0].tagName], ['button', '0', 1, 'SPAN']);
  // the quote names the place: « carre » comes earlier in the lead, the quote is in the step
  assert.equal(under([row('a', 'carre', [['s1', 'Garde la carre']])]).doc.querySelector('.gw').closest('.step') !== null, true);
});

test('P11 G3a — a quote that is not found underlines nothing; neither does a quote without one of the forms', () => {
  assert.deepEqual(marks(under([row('a', 'carre', [['s1', 'la carre est ailleurs']])]).doc), []);
  assert.deepEqual(marks(under([row('a', 'carre', [['s1', 'envoi du kite']])]).doc), []);
  assert.deepEqual(marks(under([row('a', 'carre', [['s1', 'part de la carre']], {forms: []})]).doc), [], 'no form');
});

test('P11 G3a — inside the quote the longest form wins, whole words only', () => {
  assert.deepEqual(marks(under([row('a', 'envoi', [['s1', 'envoi du kite à midi']], {forms: ['envoi', 'envoi du kite', 'kite']})]).doc), ['a:envoi du kite']);
  assert.deepEqual(marks(under([row('a', 'bord', [['s1', 'puis deux bords']])]).doc), [], '« bord » is not underlined inside « bords »');
  assert.deepEqual(marks(under([row('a', 'bord', [['s1', 'puis deux bords']], {forms: ['bord', 'bords']})]).doc), ['a:bords']);
});

test('P11 G3a — running text is every paragraph, list item, note and quotation block of the body; never a heading, what is laid on a photo, a chip, the eyebrow, a tile, a link, the footer, « My notes »', () => {
  for (const quote of ['Le saut sur la carre', 'Saut · carre', 'carre affûtée', 'La carre en bref', 'Sur la carre', 'la carre en détail', 'Source : la carre.', 'ma carre', 'Pourquoi la carre', 'Plus facile / plus dur'])
    assert.deepEqual(marks(under([row('a', quote.includes('facile') ? 'facile' : 'carre', [['s1', quote]])]).doc), [], quote);
  for (const [quote, where] of [['Garde la carre', 'P'], ['La carre ne se relâche pas.', 'P'], ['Tiens ta carre', 'BLOCKQUOTE'], ['Le bord de la fenêtre', 'LI'],
    ['Un paragraphe simple pour la carre.', 'P'], ['la carre retient la planche', 'P'], ['la carre toujours plantée', 'P'], ['la carre à peine posée', 'P']])
    assert.equal(under([row('a', quote.includes('bord') ? 'bord' : 'carre', [['s1', quote]])]).doc.querySelector('.gw').parentNode.tagName, where, quote);
  // the app's own paragraphs around the sheet (its top bar, the actions row) are not the sheet's text
  const chrome = '<div class="wrap" id="sheet-top"><p class="from">From the session carre</p><p class="flash">Moved to carre.</p></div><div class="wrap fiche"><div class="acts2"><p class="pr-last">Last time: carre</p></div><p>Ici la carre.</p></div>';
  for (const quote of ['From the session carre', 'Moved to carre.', 'Last time: carre']) assert.deepEqual(marks(under([row('a', 'carre', [['s1', quote]])], 's1', chrome).doc), [], quote);
  assert.deepEqual(marks(under([row('a', 'carre', [['s1', 'carre']])], 's1', chrome).doc), ['a:carre']);
  const tiles = under([row('a', 'carre', [['s1', 'carre']])]);
  assert.deepEqual([marks(tiles.doc), tiles.doc.querySelector('.gw').parentNode.getAttribute('class')], [['a:carre'], 'lead'], 'a bare quote lands in the lead, not in a tile');
});

test('P11 G3a — one underline per word and per sheet; two words can share a paragraph', () => {
  const r = under([row('a', 'carre', [['s1', 'Garde la carre'], ['s1', 'part de la carre']]), row('b', 'choquer', [['s1', 'choque la barre']], {forms: ['choque']})]);
  assert.deepEqual(marks(r.doc), ['a:carre', 'b:choque']);
  assert.deepEqual(r.keys, ['a', 'b'], 'in display order');
});

test('P11 G3a — two places that overlap: the longer wins; two words separated by a single space: only the first', () => {
  assert.deepEqual(marks(under([row('a', 'kite', [['s1', 'envoi du kite']]), row('b', 'envoi du kite', [['s1', 'envoi du kite à midi']])]).doc), ['b:envoi du kite']);
  const glued = [row('a', 'envoi du kite', [['s1', 'envoi du kite à midi']]), row('b', 'midi', [['s1', 'kite à midi']], {forms: ['à midi', 'midi']})];
  assert.deepEqual(marks(under(glued).doc), ['a:envoi du kite'], '« à midi » follows « envoi du kite » after one space');
  assert.deepEqual(marks(under([glued[0], {...glued[1], forms: ['midi']}]).doc), ['a:envoi du kite', 'b:midi'], 'a word in between: both');
  assert.deepEqual(marks(under(glued.slice(1)).doc), ['b:à midi'], 'alone, it is underlined');
});

// Codex pass 1: a form that runs over an inline tag
const pieces = doc => doc.querySelectorAll('.gw').map(g => [g.getAttribute('class'), g.textContent, g.parentNode.tagName, g.getAttribute('role'), g.getAttribute('tabindex'), g.getAttribute('aria-label'), g.getAttribute('aria-hidden')]);
test('P11 G3a — a form that runs over an inline tag is underlined piece by piece and is one word: one button, one tab stop, one name', () => {
  const r = under([row('a', 'sous le vent', [['s1', 'Dérive sous le vent.']])]);
  assert.deepEqual(pieces(r.doc), [['gw gw-a', 'sous ', 'P', 'button', '0', 'sous le vent', null], ['gw gw-m', 'le', 'B', null, null, null, 'true'], ['gw gw-z', ' vent', 'P', null, null, null, 'true']],
    '« Dérive sous <b>le</b> vent. »: three pieces, each in its own parent; the first is the button, named by the whole word');
  assert.deepEqual(r.keys, ['a'], 'one word');
  assert.equal(new Set(r.doc.querySelectorAll('.gw').map(g => g.getAttribute('data-gw'))).size, 1, 'every piece opens the same definition');
  assert.equal(r.same, true, 'the text of the sheet is unchanged');
  // three text nodes, two tags one in the other: <em>remonte <b>au</b></em> vent
  const n = under([row('a', 'remontée au vent', [['s1', 'Puis remonte au vent arrière']], {forms: ['remonte au vent']})]);
  assert.deepEqual(pieces(n.doc).map(x => x.slice(0, 4)), [['gw gw-a', 'remonte ', 'EM', 'button'], ['gw gw-m', 'au', 'B', null], ['gw gw-z', ' vent', 'P', null]]);
  assert.equal(n.doc.querySelector('.gw-a').getAttribute('aria-label'), 'remonte au vent');
  // two pieces; a form in one text node is still one plain .gw without aria-label
  assert.deepEqual(pieces(under([row('a', 'vent arrière', [['s1', 'vent arrière, et repars']])]).doc).map(x => x.slice(0, 3)), [['gw gw-a', 'vent ', 'P'], ['gw gw-z', 'arrière', 'I']]);
  assert.deepEqual(pieces(under([row('a', 'appui', [['s1', 'Reste en appui']], {forms: ['en appui']})]).doc).map(x => x.slice(0, 3)), [['gw gw-a', 'en', 'MARK'], ['gw gw-z', ' appui', 'LI']]);
  assert.deepEqual(pieces(under([row('a', 'carre', [['s1', 'part de la carre']])]).doc), [['gw', 'carre', 'P', 'button', '0', null, null]]);
  // the tags of the sheet stay where they are: taking the words off gives the page back, tag for tag
  const all = under([row('a', 'sous le vent', [['s1', 'Dérive sous le vent.']]), row('b', 'remontée au vent', [['s1', 'remonte au vent']], {forms: ['remonte au vent']}), row('c', 'carre', [['s1', 'part de la carre']])]);
  assert.equal(all.doc.querySelectorAll('.gw').length, 7);
  for (const tag of ['b', 'em', 'i', 'strong', 'mark', 'a', 'p', 'li']) assert.equal(all.doc.querySelectorAll(tag).length, parse(SHEET).querySelectorAll(tag).length, tag);
  G.clear(all.doc.body);
  assert.equal(all.doc.body.innerHTML, parse(SHEET).body.innerHTML);
});

test('P11 G3a — a form that would run over a link or out of its block is not underlined', () => {
  // « repars <strong>plein <a>vent</a></strong> arrière »: a piece would be inside the link
  assert.deepEqual(marks(under([row('a', 'plein vent', [['s1', 'repars plein vent arrière']])]).doc), [], 'the quote runs over a link');
  assert.deepEqual(marks(under([row('a', 'plein vent', [['s1', 'repars plein vent arrière']], {forms: ['plein vent', 'plein']})]).doc), [], 'no shorter form either: the quote is not running text');
  assert.deepEqual(marks(under([row('a', 'plein arrière', [['s1', 'plein arrière']])]).doc), [], 'nor the words on both sides of the link');
  assert.deepEqual(marks(under([row('a', 'largue', [['s1', 'Vise le largue serré']], {forms: ['largue serré', 'le largue']})]).doc), []);
  assert.deepEqual(marks(under([row('a', 'vise', [['s1', 'Vise le']])]).doc), ['a:Vise'], 'the text before the link is still running text');
  // out of its block: a list item in a list item, a block tag in a paragraph
  assert.deepEqual(marks(under([row('a', 'appui long', [['s1', 'appui long']])]).doc), []);
  assert.deepEqual(marks(under([row('a', 'appui long', [['s1', 'en appui long sur']])]).doc), []);
  const boxed = '<div class="wrap fiche"><ul><li>Tire un <div>bord</div> franc ici, <span>bord <b>de</b></span> mer.</li></ul></div>';
  assert.deepEqual(marks(under([row('a', 'bord franc', [['s1', 'un bord franc']], {forms: ['bord franc', 'bord']})], 's1', boxed).doc), ['a:bord'], 'not over the <div>; the shorter form inside it is');
  assert.deepEqual(marks(under([row('a', 'bord de mer', [['s1', 'bord de mer']])], 's1', boxed).doc), ['a:bord ', 'a:de', 'a: mer'], 'inline tags one in the other are fine');
});

test('P11 G3a — taking the words off a page: plain text again, no « Words in this sheet »', () => {
  const r = under([row('a', 'carre', [['s1', 'part de la carre']]), row('b', 'bord', [['s1', 'Le bord de la fenêtre']])]);
  const box = r.doc.createElement('div'), end = r.doc.createElement('details'), end2 = r.doc.createElement('details');
  box.setAttribute('class', 'wrap'); box.setAttribute('data-gl-box', ''); end.setAttribute('class', 'rb-more gl-end'); end2.setAttribute('class', 'rb-more gl-end');
  box.appendChild(end); r.doc.body.appendChild(box); r.doc.querySelector('.fiche').appendChild(end2);
  G.clear(r.doc.body);
  assert.equal(r.doc.body.innerHTML, parse(SHEET).body.innerHTML, 'the page as it was before the words');
  G.clear(r.doc.body); G.clear(null);
  assert.deepEqual(marks(under([row('a', 'carre', [['s1', 'part de la carre']])]).doc), ['a:carre'], 'and the words can be laid again');
});

test('P11 G3a — « Words in this sheet · n »: every word that lists the sheet, alphabetical, the sense where a term has two entries', () => {
  const words = G.read([row('1', 'pop', [['s1', 'x']]), row('2', 'bord', [['s1', 'x', 'title']], {sense: 'le rivage'}), row('3', 'bord', [['s1', 'x']], {sense: 'la direction'}),
    row('4', 'Aile', [['s1', 'x', 'chip']], {sense: 'le kite'}), row('5', 'carre', [['other', 'x']]), row('6', '11 h', [['s1', 'quote not in the sheet']])]);
  const html = G.endBlock(words, 's1');
  assert.match(html, /^<details class="rb-more gl-end"><summary>Words in this sheet · 5<\/summary>/, 'folded (no open attribute), counted');
  assert.deepEqual([...html.matchAll(/<button type="button" class="gl-chip" data-gw="(\d)">(.*?)<\/button>/g)].map(m => m[1] + ':' + m[2].replace(/<[^>]+>/g, '')), ['6:11 h', '4:Aile', '3:bord · la direction', '2:bord · le rivage', '1:pop']);
  assert.doesNotMatch(html, /Glossary|<a /, 'no dead link: « Glossary n › » is lot G3b');
  assert.equal(G.endBlock(words, 'none'), '');
  assert.equal(G.endBlock([], 's1'), '');
});

test('P11 G3a — the definition sheet: word, sense, ✕, spelling, definition, Not sure, photo, See also, one-level back', () => {
  const words = G.read([
    row('1', 'carre', [['s1', 'x']], {related: ['pop', 'bord (le rivage)', 'planche', 'aile', 'carre'], photo: {slug: 's1', file: '01.jpg'}}),
    row('2', 'pop', [], {confidence: 'unsure', doubt: 'Le mot peut aussi désigner <autre chose>.', spelling: 'pap', sheets: [{slug: 's1', quote: 'un Pap franc', where: 'text'}, {slug: 's2', quote: 'pop', where: 'text'}]}),
    row('3', 'bord', [], {sense: 'le rivage'}), row('4', 'bord', [], {sense: 'la direction'}), row('5', 'aile', [], {sense: 'le kite'}), row('6', 'aile', [], {sense: 'du foil'})]);
  const [carre, pop, rivage] = words;
  const a = G.defHtml(carre, {words, caption: 'This sheet', lang: 'fr'});
  assert.match(a, /^<div class="gl-top"><h2 id="gl-h" tabindex="-1" lang="fr">carre<\/h2><button type="button" class="share-x" id="gl-close" aria-label="Close">✕<\/button><\/div><p class="gl-def" lang="fr">Définition de carre\.<\/p>/);
  assert.match(a, /<div class="gl-ph"><figure><img data-gl-ph alt="carre" tabindex="0" role="button"><\/figure><p class="gl-cap">This sheet<\/p><\/div><h3 class="gl-h">See also<\/h3>/);
  assert.deepEqual([...a.matchAll(/data-gl-see="(\d)"[^>]*>(.*?)<\/button>/g)].map(m => m[1] + ':' + m[2].replace(/<[^>]+>/g, '')), ['2:pop', '3:bord · le rivage', '5:aile · le kite', '6:aile · du foil'],
    'a related word without entry (planche) and the word itself are not shown; a bare term with two entries shows both');
  assert.doesNotMatch(a, /Not sure|Spelled|gl-back|gl-of/);
  assert.doesNotMatch(G.defHtml(carre, {words}), /gl-ph/, 'no caption (the photo\'s sheet is gone): no photo');
  const b = G.defHtml(pop, {words, back: carre});
  assert.match(b, /^<div class="gl-top"><button type="button" class="gl-back" data-gl-back="1">‹ <span>carre<\/span><\/button><h2 id="gl-h" tabindex="-1">pop<\/h2>/);
  assert.match(b, /<p class="gl-sp">Spelled “<span>pap<\/span>” in 1 sheet<\/p><p class="gl-def">Définition de pop\.<\/p><p class="note"><b>Not sure<\/b><span>Le mot peut aussi désigner &lt;autre chose&gt;\.<\/span><\/p>$/);
  assert.match(G.defHtml(rivage, {words}), /<h2 id="gl-h" tabindex="-1">bord<\/h2><p class="gl-of">le rivage<\/p><button/);
  assert.doesNotMatch(a + b, /<(input|textarea|a )|Remove|Edit|Delete/, 'read only');
});

test('P11 G3a — rows the app cannot use are left out', () => {
  const words = G.read([null, {id: 'x', term: 'sans définition'}, {id: 'y', definition: 'sans terme'}, row('1', 'ok', [['s1', 'q']], {photo: {slug: 's1', file: '../secret.jpg'}, forms: 'ok', sheets: [{slug: 's1'}, null, {quote: 'no slug'}], related: null}), row('1', 'twice', [])]);
  assert.deepEqual(JSON.parse(JSON.stringify(words)), [{key: '1', term: 'ok', sense: '', definition: 'Définition de ok.', forms: [], unsure: false, doubt: '', spelling: '', photo: null, related: [], sheets: [{slug: 's1', quote: '', where: ''}]}]);
  assert.deepEqual(G.read(undefined), []);
});

// Codex pass 2: « 01-front(2).jpg », which the CLI and storage take, lost its photo
test('P11 G3a — a photo keeps any plain file name storage takes; a path, no name, a control character, ? or # is refused', () => {
  const photo = file => G.read([row('1', 'ok', [['s1', 'q']], {photo: {slug: 's1', file}})])[0].photo;
  for (const file of ['01-front(2).jpg', 'vue de côté.jpg', 'a_b-c.d.JPG', '.hidden.jpg', "l'aile [2] & co +1.jpg"]) assert.deepEqual({...photo(file)}, {slug: 's1', file}, file);
  for (const file of ['../x.jpg', 'a/b.jpg', '', '   ', '.', '..', 'a\\b.jpg', '..\\x.jpg', 'x.jpg?token=1', 'x.jpg#top', 'a\nb.jpg', 'a\u0000.jpg', 'a\u007f.jpg', null, 7, ['x.jpg']]) assert.equal(photo(file), null, JSON.stringify(file));
});

// ---- the app: glossary_words is read with the sheet, kept for the visit of the notebook, and may be missing
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}, win: {RBSheet: SH}}; // the harness does not load sheet.js
const tables = () => ({
  user_themes: [{id: 'kite', title: 'Kitesurf', groups: ['Jumps'], builtin: true, position: 0}, {id: 'fight', title: 'Fight', groups: [], builtin: true, position: 1}],
  sheets: ['a', 'b'].map(slug => ({slug, kind: 'sheet', theme: 'kite', group: 'Jumps', title: 'Sheet ' + slug, summary: '', html: '<a href="#">Home</a>', source: {}}))
    .concat([{slug: 'c', kind: 'sheet', theme: 'fight', group: '', title: 'Sheet c', summary: '', html: '<a href="#">Home</a>', source: {}}]),
  sessions: [], notes: [], requests: [], glossary_words: [row('1', 'carre', [['a', 'la carre']])]
});
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve)); };
const go = async (page, hash) => { page.location.hash = hash; await settle(); };
const reads = page => page.clients.at(-1).selects.filter(s => s[0] === 'glossary_words').length;

test('P11 G3a — the words are read with the sheet, once for the visit of the notebook, and only read', async () => {
  const page = await app({...signedIn, tables: tables(), dom: true, hash: '#a'});
  await settle();
  const client = page.clients.at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(client.selects.filter(s => s[0] === 'glossary_words'))), [['glossary_words', 'id,term,sense,forms,definition,confidence,doubt,spelling,photo,related,sheets']]);
  assert.match(page.element('view').innerHTML, /id="play-start"/, 'the sheet is shown');
  await go(page, '#b');
  assert.equal(reads(page), 1, 'another sheet of the same notebook: no new read');
  await go(page, '#c');
  assert.equal(reads(page), 2, 'a sheet of another notebook reads its own words');
  await go(page, '#kite'); await go(page, '#a');
  assert.equal(reads(page), 3, 'back through the notebook page: read again');
  assert.deepEqual(client.calls.filter(c => c[1] === 'glossary_words' && c[0] !== 'select'), [], 'nothing is written');
});

test('P11 G3a — a backend without glossary_words: the sheet shows as before, no message, and the table is not asked again', async () => {
  const gone = {error: {code: 'PGRST205', message: "Could not find the table 'public.glossary_words' in the schema cache"}, status: 404};
  const page = await app({...signedIn, tables: tables(), failing: {glossary_words: gone}, dom: true, hash: '#a'});
  await settle();
  const plain = await app({...signedIn, tables: {...tables(), glossary_words: []}, dom: true, hash: '#a'});
  await settle();
  assert.equal(page.element('view').innerHTML, plain.element('view').innerHTML, 'the same page as with an empty glossary');
  assert.doesNotMatch(page.element('view').innerHTML, /gl-end|class="gw"|Words in this sheet|could not/i);
  await go(page, '#c'); await go(page, '#kite'); await go(page, '#b');
  assert.equal(reads(page), 1, 'asked once, then never until the next start');
  // a read that fails for another reason is asked again with the next sheet
  const flaky = await app({...signedIn, tables: tables(), failing: {glossary_words: {error: {message: 'Failed to fetch'}, status: 0}}, dom: true, hash: '#a'});
  await settle(); await go(flaky, '#b');
  assert.match(flaky.element('view').innerHTML, /id="play-start"/);
  assert.equal(reads(flaky), 2);
});

// ---- Codex pass 1: the words shown never outlive the account or the notebook they belong to
// The harness page is not a DOM: `clear` and `underline` are watched instead (what they do is tested above).
const watched = () => {
  const log = [];
  const gl = {...G, underline: (root, words, slug) => { log.push(['underline', slug, words.map(w => w.term).join()]); return []; }, clear: () => { log.push(['clear']); }};
  return {log, win: {RBSheet: {...SH, glossary: gl}}};
};
const fightWords = [row('9', 'garde', [['a', 'en garde']], {theme: 'fight'}), row('8', 'jab', [['c', 'un jab']], {theme: 'fight'})];
// the fake backend filters glossary_words by its theme, as the real one does
const byTheme = (rows, asked) => (table, ops) => {
  if (table !== 'glossary_words' || !ops.some(o => o[0] === 'select')) return null;
  const theme = (ops.find(o => o[0] === 'eq' && o[1] === 'theme') || [])[2];
  asked.push(theme);
  return {data: rows.filter(r => r.theme === theme), error: null};
};
const asDom = page => { const v = page.element('view'); v.querySelectorAll = () => []; v.insertAdjacentHTML = () => {}; page.element('gl-dlg').classList = {toggle() {}, add() {}, remove() {}, contains: () => false}; return v; };
const tapWord = (page, key) => page.element('view').listeners.click({preventDefault() {}, target: {closest: sel => sel === '[data-gw]' ? {getAttribute: () => key, classList: {contains: () => false}} : null}});

test('P11 G3a — another account or a lost session: the definition closes, the words kept are forgotten, the page loses its words', async () => {
  const w = watched(), asked = [];
  const page = await app({...signedIn, win: w.win, tables: tables(), hold: byTheme(tables().glossary_words, asked), dom: true, hash: '#b'});
  await settle(); asDom(page); await go(page, '#a');
  assert.deepEqual(w.log.at(-1), ['underline', 'a', 'carre']);
  tapWord(page, '1');
  assert.equal(page.element('gl-dlg').open, true);
  assert.match(page.element('gl-in').innerHTML, /<h2 id="gl-h"[^>]*>carre<\/h2>.*Définition de carre\./);
  const cleared = w.log.filter(x => x[0] === 'clear').length, client = page.clients.at(-1);
  client.authListener('SIGNED_OUT', null); // signed out from another tab
  await settle();
  assert.equal(page.element('gl-dlg').open, false, 'the definition is closed');
  assert.equal(page.element('gl-in').innerHTML, '', 'and emptied');
  assert.equal(w.log.filter(x => x[0] === 'clear').length, cleared + 1, 'the underlines and « Words in this sheet » leave the page');
  tapWord(page, '1');
  assert.equal(page.element('gl-dlg').open, false, 'a word of the account left opens nothing');
  // another account on the same device: its own words are read, nothing of the first one is laid on its page
  const n = asked.length;
  client.authListener('SIGNED_IN', {user: {id: 'u2', email: 'other@example.test'}});
  await settle(); await go(page, '#b'); await go(page, '#a');
  assert.ok(asked.length > n, 'the glossary is read again for the new account');
  // straight from one account to another (no sign-out in between), the definition open
  tapWord(page, '1');
  assert.equal(page.element('gl-dlg').open, true);
  client.authListener('SIGNED_IN', {user: {id: 'u3', email: 'third@example.test'}});
  await settle();
  assert.deepEqual([page.element('gl-dlg').open, page.element('gl-in').innerHTML], [false, '']);
});

test('P11 G3a — « Move » to another notebook: the words of the notebook left go, the page takes those of the notebook it joins', async () => {
  const w = watched(), asked = [];
  const rows = tables().glossary_words.concat(fightWords);
  const page = await app({...signedIn, win: w.win, tables: tables(), hold: byTheme(rows, asked), dom: true, hash: '#b'});
  await settle(); asDom(page); await go(page, '#a');
  assert.deepEqual([asked.at(-1), w.log.at(-1)], ['kite', ['underline', 'a', 'carre']]);
  const move = async (theme, group) => {
    page.element('view').listeners.click({target: {closest: sel => sel === '#mv-open'}});
    assert.equal(page.element('move-dlg').open, true);
    page.element('mv-theme').value = theme; page.element('mv-group').value = group;
    await page.fire('mv-form', 'submit'); await settle();
  };
  const from = w.log.length;
  await move('fight', 'Striking');
  assert.match(page.element('sheet-top').innerHTML, /Moved to Fight · Striking\./);
  assert.equal(asked.at(-1), 'fight', 'the words of the notebook joined are read');
  assert.deepEqual(w.log.slice(from), [['clear'], ['underline', 'a', 'garde,jab']], 'the words of Kitesurf leave, then the page is read with those of Fight');
  tapWord(page, '1');
  assert.ok(!page.element('gl-dlg').open, '« carre » (Kitesurf) opens nothing any more');
  tapWord(page, '9');
  assert.match(page.element('gl-in').innerHTML, /Définition de garde\./, 'a word of Fight does');
  page.element('gl-dlg').open = false;
  // a new group in the same notebook: the words stay
  const kept = w.log.length, reads = asked.length;
  await move('fight', 'Footwork');
  assert.deepEqual([w.log.length, asked.length], [kept, reads]);
});

// ---- Codex pass 2: an answer asked for a notebook is never laid on a sheet that has left it
// Each reading of glossary_words stays on its way until the test answers it, in the order the test picks.
const gated = (rows, asked) => {
  const gates = [];
  const hold = (table, ops) => {
    if (table !== 'glossary_words' || !ops.some(o => o[0] === 'select')) return null;
    const theme = (ops.find(o => o[0] === 'eq' && o[1] === 'theme') || [])[2];
    asked.push(theme);
    return new Promise(resolve => gates.push({theme, answer: () => resolve({data: rows.filter(r => r.theme === theme), error: null})}));
  };
  // the oldest reading of that notebook still on its way
  return {hold, answer: async theme => { gates.splice(gates.findIndex(g => g.theme === theme), 1)[0].answer(); await settle(); }};
};
const moveTo = async (page, theme, group) => {
  page.element('view').listeners.click({target: {closest: sel => sel === '#mv-open'}});
  page.element('mv-theme').value = theme; page.element('mv-group').value = group;
  await page.fire('mv-form', 'submit'); await settle();
};
// Sheet a (Kitesurf) is open and the words of Kitesurf are still on their way; `blocks`: every « Words in this sheet »
// laid before the sheet's footer.
const openUnanswered = async () => {
  const w = watched(), asked = [], blocks = [];
  const g = gated(tables().glossary_words.concat(fightWords), asked);
  const page = await app({...signedIn, win: w.win, tables: tables(), hold: g.hold, dom: true, hash: '#b'});
  await settle();
  asDom(page).querySelectorAll = sel => sel === 'footer' ? [{insertAdjacentHTML: (at, html) => blocks.push(html)}] : [];
  await go(page, '#a');
  assert.deepEqual([asked, w.log, blocks], [['kite'], [], []], 'one reading of Kitesurf, not answered: nothing on the page yet');
  return {page, w, asked, blocks, answer: g.answer};
};
const onlyFight = ({page, w, blocks}, why) => {
  assert.deepEqual(w.log, [['clear'], ['underline', 'a', 'garde,jab']], why);
  assert.equal(blocks.length, 1, 'one « Words in this sheet »: ' + why);
  assert.match(blocks[0], /garde/); assert.doesNotMatch(blocks[0], /carre/);
  tapWord(page, '1');
  assert.ok(!page.element('gl-dlg').open, '« carre » (Kitesurf) opens nothing');
  tapWord(page, '9');
  assert.match(page.element('gl-in').innerHTML, /Définition de garde\./);
  page.element('gl-dlg').open = false;
};

test('P11 G3a — « Move » before the words of the notebook left have come: they come first, and are not laid on the sheet', async () => {
  const t = await openUnanswered();
  await moveTo(t.page, 'fight', 'Striking');
  assert.deepEqual(t.asked, ['kite', 'fight']);
  await t.answer('kite');
  assert.deepEqual([t.w.log, t.blocks], [[['clear']], []], 'the answer of Kitesurf lays nothing on a sheet of Fight');
  tapWord(t.page, '1');
  assert.ok(!t.page.element('gl-dlg').open);
  await t.answer('fight');
  onlyFight(t, 'Kitesurf answered first, then Fight');
});

test('P11 G3a — « Move » before the words of the notebook left have come: they come last, and change nothing', async () => {
  const t = await openUnanswered();
  await moveTo(t.page, 'fight', 'Striking');
  await t.answer('fight');
  onlyFight(t, 'Fight answered');
  await t.answer('kite');
  onlyFight(t, 'Fight answered first, then Kitesurf');
});

test('P11 G3a — moved away and back before any answer: the last reading alone is laid, once', async () => {
  const t = await openUnanswered();
  await moveTo(t.page, 'fight', 'Striking');
  await moveTo(t.page, 'kite', 'Jumps');
  assert.deepEqual(t.asked, ['kite', 'fight', 'kite']);
  const laid = () => t.w.log.filter(l => l[0] === 'underline');
  await t.answer('kite'); // the reading asked with the sheet, before both moves
  assert.deepEqual(laid(), [], 'not the reading the page waits for');
  await t.answer('fight');
  assert.deepEqual(laid(), []);
  await t.answer('kite');
  assert.deepEqual(laid(), [['underline', 'a', 'carre']]);
  assert.equal(t.blocks.length, 1); assert.match(t.blocks[0], /carre/);
});

test('P11 G3a — the shell: sheet.js?v= and the cache version moved, the definition is one dialog.dlg', () => {
  const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8'), sw = fs.readFileSync(path.join(__dirname, '../app/sw.js'), 'utf8');
  const v = html.match(/<script src="sheet\.js\?v=(\d+)"><\/script>/)[1];
  assert.ok(Number(v) >= 9); assert.ok(sw.includes(`'./sheet.js?v=${v}'`), 'SHELL names the same version');
  assert.ok(Number(sw.match(/const VERSION = 'rb-shell-(\d+)'/)[1]) >= 76);
  assert.equal(html.match(/<dialog class="dlg gl-dlg" id="gl-dlg"/g).length, 1);
  assert.doesNotMatch(html, /@property|\dlh\b/, 'no lh unit, no @property (the prototype\'s way of sizing a word\'s target)');
});
