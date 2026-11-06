// L38: the #demo dressing — the banner speaks the landing's language (L30: rb.lang, window.RBL, same dictionary),
// the pages are drawn with the app's own pieces (.tcard notebooks, a row of session cards, one row of photo cards
// per group), and no editing control shows on any demo page. The catalogue here is a fixture with three notebooks,
// so the tests do not depend on the content of app/demo/ (L37 replaces it).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {app, hostedUrl} = require('./harness.cjs');

const landingJs = fs.readFileSync(path.join(__dirname, '../app/landing.js'), 'utf8');
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve)); };
// The real window.RBL of app/landing.js (no document: only its dictionary and language), the saved choice `saved`.
const rbl = saved => {
  const window = {localStorage: {getItem: k => k === 'rb.lang' ? saved : null, setItem() {}}, navigator: {language: 'en-GB'}};
  vm.runInNewContext(landingJs, {window, console});
  return window.RBL;
};
const library = [
  {id: 'fight', title: 'Fight techniques', sub: 'Striking, defense, clinch, footwork.', color: 2, icon: 'fight', groups: ['Kicks', 'Clinch']},
  {id: 'yoga', title: 'Yoga & stretching', sub: 'Poses, stretches, breathing, flows.', color: 1, icon: 'yoga', groups: []},
  {id: 'strength', title: 'Strength', sub: 'Weights, bodyweight, bands.', color: 0, icon: 'strength', groups: []}
];
const catalogue = {
  title: 'Reelbook demo', intro: 'A sample notebook.',
  notebooks: [{id: 'fight', title: 'Fight techniques'}, {id: 'yoga', title: 'Yoga & stretching'}],
  sheets: [
    {slug: 'spin-kick', notebook: 'fight', group: 'Kicks', title: 'Spinning back kick', summary: 'Turn, look, kick.', thumbnail: 'img/thumb.jpg', author: 'Reelbook demo'},
    {slug: 'clinch-entry', notebook: 'fight', group: 'Clinch', title: 'Clinch entry', summary: 'Close the distance.', thumbnail: 'img/thumb.jpg', author: 'Reelbook demo'},
    {slug: 'down-dog', notebook: 'yoga', group: 'Poses', title: 'Downward dog', summary: 'Hips high.', thumbnail: 'img/thumb.jpg', author: 'Reelbook demo'},
    {slug: 'goblet', notebook: 'strength', group: 'Legs', title: 'Goblet squat', summary: 'One weight.', thumbnail: 'img/thumb.jpg', author: 'Reelbook demo'}
  ],
  sessions: [{slug: 'flow', notebook: 'yoga', title: 'Morning flow', format: '2 rounds', why: 'Wake up.', thumbnail: 'down-dog/img/thumb.jpg', author: 'Reelbook demo',
    items: [{slug: 'down-dog', dose: '5 breaths'}, {slug: 'goblet', dose: '10 reps'}]}]
};
const sheetHtml = title => `<html lang="en"><body><h1>${title}</h1><a href="#">Top</a></body></html>`;
const fetch = async url => {
  const rel = String(url).replace(/^demo\//, '');
  const body = rel === 'catalogue.json' ? JSON.stringify(catalogue) : /^[a-z-]+\/index\.html$/.test(rel) ? sheetHtml(rel.split('/')[0]) : null;
  return body === null ? {ok: false, status: 404} : {ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body};
};
const open = (hash, more = {}) => app({hash, tables: {}, fetch, library, dom: true, ...more});
const signedIn = () => ({stored: {['rb.auth.' + hostedUrl.replace(/\W/g, '')]: JSON.stringify({user: {id: 'u1'}}), 'rb.backend': JSON.stringify({mode: 'hosted'})}, sessions: {[hostedUrl]: {id: 'u1'}}});
const banner = page => (page.element('demo').innerHTML.match(/<a class="demo-banner"[^>]*>[^<]*<\/a>/) || [''])[0];

test('L38 — the banner is in French when the landing\'s language is French, in English otherwise', async () => {
  let page = await open('#demo', {win: {RBL: rbl('fr')}});
  await settle();
  assert.match(banner(page), /lang="fr">Démo · lecture seule · Créer un compte</);
  page = await open('#demo', {win: {RBL: rbl('en')}});
  await settle();
  assert.match(banner(page), /href="#">Demo · read only · Create an account</);
  assert.doesNotMatch(banner(page), /lang=/);
  page = await open('#demo'); // landing.js not loaded: English
  await settle();
  assert.match(banner(page), />Demo · read only · Create an account</);
});

test('L38 — with an account on this device, the banner leads back to its notebooks, in the chosen language', async () => {
  let page = await open('#demo', {win: {RBL: rbl('fr')}, ...signedIn()});
  await settle();
  assert.match(banner(page), />Démo · lecture seule · Revenir à mes carnets</);
  page = await open('#demo', {win: {RBL: rbl('en')}, ...signedIn()});
  await settle();
  assert.match(banner(page), />Demo · read only · Back to my notebooks</);
});

test('L38 — the demo home shows the notebooks as .tcard cards from the library, then a row of sessions', async () => {
  const page = await open('#demo');
  await settle();
  const html = page.element('demo').innerHTML;
  const cards = [...html.matchAll(/<a class="tcard" href="#demo\/notebook\/([a-z]+)"[^>]*style="--t:var\(--p(\d)\)"/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(cards, [['fight', '2'], ['yoga', '1'], ['strength', '0']], 'catalogue notebooks first, then one a sheet names; colour of the library');
  assert.match(html, /<use href="icons\.svg#nb-fight"\/>/);
  assert.match(html, /aria-label="Yoga &amp; stretching, 1 sheet, 1 session"/);
  assert.match(html, /<div class="thumbs"><img src="demo\/spin-kick\/img\/thumb\.jpg" alt="Spinning back kick">/);
  assert.match(html, /<h2>Sessions <span class="n">1<\/span><\/h2><div class="group-row"><a class="card big" href="#demo\/session\/flow">/);
  assert.doesNotMatch(html, /class="grid"/, 'no flat grid on the home page');
});

test('L38 — a demo notebook page: its cover, group chips, the Sessions row, one row of photo cards per group', async () => {
  let page = await open('#demo/notebook/fight');
  await settle();
  let html = page.element('demo').innerHTML;
  assert.match(html, /class="wide demo-nbp" style="--t:var\(--p2\)"/);
  assert.match(html, /<h1>Fight techniques<\/h1>/);
  assert.match(html, /<nav class="group-chips" aria-label="Groups"><a [^>]*data-grp="demo-grp-0">Kicks 1<\/a><a [^>]*data-grp="demo-grp-1">Clinch 1<\/a><\/nav>/);
  assert.match(html, /<section id="demo-grp-0"><h2>Kicks <span class="n">1<\/span><\/h2><div class="group-row"><a class="card" href="#demo\/spin-kick">/);
  page = await open('#demo/notebook/yoga');
  await settle();
  html = page.element('demo').innerHTML;
  assert.doesNotMatch(html, /group-chips/, 'one group: no chips');
  assert.match(html, /<h2>Sessions <span class="n">1<\/span><\/h2><\/div><div class="group-row"><a class="card big" href="#demo\/session\/flow">/);
  assert.match(html, />in 1 session</);
  page = await open('#demo/notebook/nope');
  await settle();
  assert.match(page.element('demo').innerHTML, /class="tcard"/, 'an unknown notebook shows the demo home');
});

test('L38 — a sheet opened from the session shows its place, its dose and previous / next; otherwise its notebook', async () => {
  const page = await open('#demo/session/flow');
  await settle();
  page.go('#demo/goblet'); await settle();
  let html = page.element('demo').innerHTML;
  assert.match(html, /‹ Morning flow<\/a><\/p><p class="seat">2\/2 · 10 reps<\/p>/);
  assert.match(html, /<a class="prev" href="#demo\/down-dog">← Previous<\/a><a class="next" href="#demo\/session\/flow">Back to the session<\/a>/);
  page.go('#demo'); await settle();
  page.go('#demo/spin-kick'); await settle();
  html = page.element('demo').innerHTML;
  assert.match(html, /<a href="#demo\/notebook\/fight">‹ Fight techniques<\/a>/);
  assert.doesNotMatch(html, /class="seq"/);
});

test('L38 — no editing control on any demo page, and nothing written to localStorage', async () => {
  const stored = {'rb.lang': 'fr', 'rb.seen.u1': '["a"]'};
  const page = await open('#demo', {win: {RBL: rbl('fr')}, stored});
  await settle();
  const before = JSON.stringify([...page.storage]);
  const controls = /(?:>\s*|aria-label=")(?:Move|Delete|Edit|Done today|Add to session|My notes|\+ New session|Start)(?:\s*<|\b)|<(?:textarea|input|button)\b/;
  for (const h of ['#demo', '#demo/notebook/fight', '#demo/notebook/yoga', '#demo/session/flow', '#demo/down-dog', '#demo/spin-kick']) {
    page.go(h); await settle();
    assert.doesNotMatch(page.element('demo').innerHTML, controls, h);
    assert.equal(page.element('add-video-fab').hidden, true, h);
  }
  assert.equal(JSON.stringify([...page.storage]), before);
  assert.equal(page.clients.length, 0);
});
