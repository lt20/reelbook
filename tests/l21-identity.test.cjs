// L21, notebook identity: a cover per notebook (colour + pictogram). Pictograms in app/icons.svg, one per library
// notebook (config.js `icon`), `custom` for a notebook an account described itself. app/config.js is a protected
// zone: ids, titles, colours, groups, profiles and defaults must stay as L20 left them (tests/fixtures/config-l20.json).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const appDir = path.join(__dirname, '../app');
const read = f => fs.readFileSync(path.join(appDir, f), 'utf8');
const loadConfig = () => { const window = {}; vm.runInNewContext(read('config.js'), {window}); return window.REELBOOK; };
const CFG = JSON.parse(JSON.stringify(loadConfig())); // plain objects, comparable with deepEqual
const svg = read('icons.svg');
const html = read('index.html');
const symbols = new Map([...svg.matchAll(/<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/g)].map(m => [(m[1].match(/id="nb-([a-z0-9-]+)"/) || [])[1], m]));

test('L21 — every library notebook has an icon that exists in icons.svg, plus « custom »', () => {
  assert.equal(CFG.library.length, 29);
  for (const t of CFG.library) {
    assert.match(t.icon || '', /^[a-z0-9-]+$/, `${t.id} has an icon`);
    assert.ok(symbols.has(t.icon), `nb-${t.icon} (${t.id}) is a symbol of icons.svg`);
  }
  assert.ok(symbols.has('custom'), 'nb-custom for a notebook an account described');
  assert.equal(new Set(CFG.library.map(t => t.icon)).size, 29, 'one pictogram per library notebook');
  assert.equal(symbols.size, 30, 'no orphan symbol');
});

test('L21 — pictograms: 24 × 24, stroke 1.75, currentColor, no fill, nothing external', () => {
  assert.doesNotMatch(svg, /<script|<image|<style|href=|url\(|<text|font/i, 'self-contained line drawings');
  for (const [name, m] of symbols) {
    const a = m[1];
    assert.match(a, /viewBox="0 0 24 24"/, name);
    assert.match(a, /stroke-width="1\.75"/, name);
    assert.match(a, /stroke="currentColor"/, name);
    assert.match(a, /fill="none"/, name);
    assert.doesNotMatch(m[2], /stroke-width|fill="(?!none)|#[0-9a-f]{3,6}/i, `${name}: no own colour or width`);
  }
});

test('L21 — protected zone: config.js keeps the L20 ids, titles, colours, groups, profiles and defaults', () => {
  const snap = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/config-l20.json'), 'utf8'));
  assert.deepEqual(CFG.defaults, snap.defaults);
  assert.equal(CFG.hosted.name, snap.hosted.name);
  assert.equal(CFG.hosted.url, snap.hosted.url);
  assert.deepEqual(CFG.library.map(({id, title, sub, color, profile, groups}) => ({id, title, sub, color, profile, groups})), snap.library);
  // L21 adds the key `icon` and nothing else to a notebook (L23 may add its own keys: listed here when it lands);
  // P8 R14 adds `family`, the kind of practice by default (tests/p8-r14.test.cjs checks its values)
  const known = new Set(['id', 'title', 'sub', 'color', 'profile', 'groups', 'icon', 'facets', 'family']);
  for (const t of CFG.library) for (const k of Object.keys(t)) assert.ok(known.has(k), `${t.id}: unexpected key ${k}`);
});

test('L21 — service worker: icons.svg in SHELL, config.js version matches index.html, VERSION bumped past L20', () => {
  const sw = read('sw.js');
  const shell = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  assert.match(shell, /'\.\/icons\.svg'/);
  const v = html.match(/<script src="config\.js\?v=(\d+)"><\/script>/)[1];
  assert.match(shell, new RegExp(`'\\./config\\.js\\?v=${v}'`));
  assert.ok(Number(v) >= 7, 'config.js changed: its ?v= is bumped');
  assert.ok(Number(sw.match(/const VERSION = 'rb-shell-(\d+)'/)[1]) >= 35, 'cache VERSION bumped');
});

test('L21 — CSS: covers in a commented L21 block, motion only without reduced motion', () => {
  const block = html.slice(html.indexOf('/* ---- L21'), html.indexOf('</style>'));
  assert.ok(block.length > 100, 'an L21 block');
  assert.match(block, /color-mix\(in srgb,var\(--t,var\(--accent\)\) 14%,var\(--paper\)\)/, 'the band: notebook colour over the paper');
  for (const m of block.matchAll(/transition:(?!none)[^;}]+/g)) {
    const at = block.lastIndexOf('@media', m.index);
    assert.ok(at >= 0 && /prefers-reduced-motion:no-preference/.test(block.slice(at, at + 60)), `guarded: ${m[0]}`);
  }
});

// ---------- in the app (harness) ----------
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'reader@example.test'}}};
const library = CFG.library.filter(t => ['strength', 'kitesurf', 'cook', 'wingfoil'].includes(t.id));
const sheets = [{slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Hammer curl', summary: 'Curl.'}];
const tables = () => ({
  user_themes: [
    {id: 'strength', title: 'Strength', groups: ['Arms'], builtin: true, position: 0},
    {id: 'kitesurf', title: 'Kitesurf', groups: [], builtin: true, position: 1},
    {id: 'pottery', title: 'Pottery', description: 'Wheel and hand building.', groups: [], builtin: false, position: 2}
  ], sheets});
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const ico = name => new RegExp(`<svg class="nb-ico"[^>]*aria-hidden="true"[^>]*><use href="icons\\.svg#nb-${name}"/></svg>`);

test('L21 — home: each notebook card has a cover (pictogram, counter, title); a custom notebook shows « custom »', async () => {
  const page = await app({...signedIn, library, tables: tables()});
  await settle();
  const portal = page.element('portal').innerHTML;
  const card = id => portal.match(new RegExp(`<a class="tcard" href="#${id}"[\\s\\S]*?</a>`))[0];
  assert.match(card('strength'), /<div class="cover"><span class="nb-badge"><svg[\s\S]*?<\/svg><\/span><div><p class="eyebrow">1 sheet<\/p><h2>Strength<\/h2><\/div><\/div>/);
  assert.match(card('strength'), ico('strength'));
  assert.match(card('kitesurf'), ico('kitesurf'));
  assert.match(card('pottery'), ico('custom'));
  assert.match(card('strength'), /style="--t:var\(--p0\)"/, 'the colour stays the notebook\'s');
  assert.doesNotMatch(portal.match(/<button[^>]*id="add-nb">[\s\S]*?<\/button>/)[0], /nb-ico/, 'the add card has no pictogram');
});

test('L21 — Add a notebook: each library notebook listed with its pictogram', async () => {
  const page = await app({...signedIn, library, tables: tables()});
  await settle();
  page.element('add-nb').listeners.click();
  const lib = page.element('lib').innerHTML;
  const rows = [...lib.matchAll(/<button type="button" data-add="([a-z]+)"[^>]*>(<svg[\s\S]*?<\/svg>)<b>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(rows.map(r => r[0]), ['wingfoil', 'cook'], 'library order, the ones not added yet');
  for (const [id, s] of rows) assert.match(s, ico(id));
});

test('L21 — notebook page: its pictogram on the cover and in the compact bar; home and a custom notebook', async () => {
  const page = await app({...signedIn, library, hash: '#strength', tables: tables()});
  await settle();
  assert.match(page.element('h-ico').innerHTML, ico('strength'));
  assert.match(page.element('nav-ico').innerHTML, ico('strength'));
  assert.equal(page.element('nav-title').textContent, 'Strength');

  const custom = await app({...signedIn, library, hash: '#pottery', tables: tables()});
  await settle();
  assert.match(custom.element('h-ico').innerHTML, ico('custom'));
  assert.match(custom.element('nav-ico').innerHTML, ico('custom'));

  const home = await app({...signedIn, library, tables: tables()});
  await settle();
  assert.equal(home.element('h-ico').innerHTML, '', 'the home page keeps the Reelbook mark');
  assert.equal(home.element('nav-ico').innerHTML, '');
});

test('L21 — markup: the header and bar pictogram holders are hidden from screen readers', () => {
  assert.match(html, /<span class="nb-badge" id="h-ico" aria-hidden="true"><\/span>/);
  assert.match(html, /<span id="nav-ico" aria-hidden="true"><\/span>/);
});
