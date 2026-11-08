const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {app, html} = require('../../harness.cjs');

const demoDir = path.resolve(__dirname, '../../../app/demo');
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
};

// Contract selector for the demo screen: see notes.
const demo = page => page.element('demo');

test('L27 — #demo opens a read-only notebook without an account or backend', async () => {
  const page = await app({hash: '#demo', tables: {}});
  await settle();
  assert.equal(demo(page).hidden, false);
  assert.equal(page.element('auth').hidden, true);
  assert.equal(page.clients.length, 0, 'the demo does not create a Supabase client');
  assert.match(demo(page).innerHTML, /Demo · read only · Create an account/);
});

test('L27 — demo editing controls are hidden and viewing attempts no backend write', async () => {
  const page = await app({hash: '#demo', tables: {}});
  await settle();
  assert.equal(page.element('add-video-fab').hidden, true);
  assert.equal(page.element('sheet-new').hidden, true);
  assert.equal(page.element('nav-more').hidden, true);
  assert.doesNotMatch(demo(page).innerHTML, /(?:>\s*|aria-label=")(?:Move|Delete|Edit|Done today|Add to session)(?:\s*<|\b)/);
  assert.equal(page.clients.flatMap(client => client.calls).length, 0);
});

test('L27 — leaving the demo returns a visitor to the auth screen', async () => {
  const page = await app({hash: '#demo', tables: {}});
  await settle();
  page.go('');
  await settle();
  assert.equal(demo(page).hidden, true);
  assert.equal(page.element('auth').hidden, false);
  assert.equal(page.element('auth-title').textContent, 'Sign in');
});

test('L27 — the demo preserves localStorage keys belonging to a real account', async () => {
  const stored = {
    'rb.backend': JSON.stringify({mode: 'own', url: 'https://personal.example.test', key: 'a-public-anon-key-long-enough'}),
    'rb.draft': 'https://example.test/unfinished',
    'rb.seen': JSON.stringify(['existing-sheet'])
  };
  const page = await app({hash: '#demo', tables: {}, stored});
  await settle();
  for (const [key, value] of Object.entries(stored)) assert.equal(page.storage.get(key), value, key);
  assert.equal(page.clients.length, 0);
});

test('L27 — five replaceable sheet folders and a catalogue are served from app/demo', () => {
  const catalogue = path.join(demoDir, 'catalogue.json');
  assert.ok(fs.statSync(catalogue).isFile());
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(catalogue, 'utf8')));
  const sheets = fs.readdirSync(demoDir, {withFileTypes: true}).filter(entry => entry.isDirectory() && fs.existsSync(path.join(demoDir, entry.name, 'index.html')));
  assert.equal(sheets.length, 5);
  for (const sheet of sheets) {
    assert.ok(fs.statSync(path.join(demoDir, sheet.name, 'img')).isDirectory(), sheet.name);
    const images = fs.readdirSync(path.join(demoDir, sheet.name, 'img')).filter(name => /\.(?:svg|png|jpe?g)$/i.test(name));
    assert.ok(images.length > 0, `${sheet.name} has imagery`);
  }
});

test('L27 — L25 See a demo links to #demo', () => {
  assert.match(html, /<a\b[^>]*href="#demo"[^>]*>See a demo<\/a>/);
});
