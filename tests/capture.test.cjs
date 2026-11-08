// L28: Paste link and Settings › iPhone shortcut, beyond the acceptance tests (Codex review, pass 1).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'reader@example.test'}}};
const tables = () => ({user_themes: [], sheets: [], sessions: [], notes: [], requests: [], capture_tokens: []});
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

test('Paste link takes the first supported link of a text holding several', async () => {
  const page = await app({...signedIn, tables: tables(), nav: {clipboard: {async readText() { return 'see https://example.com/a then https://youtu.be/abc.'; }}}});
  await settle();
  await page.fire('add-video-fab'); await settle();
  assert.equal(page.element('f-url').value, 'https://youtu.be/abc');
  page.element('f-url').value = '';
  await page.fire('paste-link'); await settle();
  assert.equal(page.element('f-url').value, 'https://youtu.be/abc');
  assert.equal(page.element('f-err').hidden, true);
});

test('a link typed while Paste link waits for the clipboard is kept', async () => {
  let answer = null;
  const page = await app({...signedIn, tables: tables(), nav: {clipboard: {readText: () => new Promise(resolve => { answer = resolve; })}}});
  await settle();
  await page.fire('add-video-fab'); await settle();
  answer('');                                   // the read + started: nothing
  await settle();
  const pasting = page.fire('paste-link');
  page.element('f-url').value = 'https://youtu.be/typed';
  answer('https://www.instagram.com/reel/old/');
  await pasting; await settle();
  assert.equal(page.element('f-url').value, 'https://youtu.be/typed');
  assert.notEqual(page.storage.get('rb.draft'), 'https://www.instagram.com/reel/old/');
});

test('a link pre-filled by + is kept as the draft (a closed PWA finds it again)', async () => {
  const reel = 'https://www.instagram.com/reel/abc/';
  const page = await app({...signedIn, tables: tables(), nav: {clipboard: {async readText() { return reel; }}}});
  await settle();
  await page.fire('add-video-fab'); await settle();
  assert.equal(page.storage.get('rb.draft'), reel);
});

test('a failed read right after a key is made keeps the key on screen', async () => {
  let made = false;
  const hold = (table, ops) => table === 'capture_tokens' && made && ops.some(o => o[0] === 'select') ? Promise.resolve({data: null, error: {message: 'network'}}) : null;
  const page = await app({...signedIn, tables: tables(), hash: '#settings', hold});
  await settle();
  assert.equal(page.element('shortcut-section').hidden, false);
  made = true;
  await page.fire('shortcut-create'); await settle();
  assert.match(page.element('shortcut-token').textContent, /^Bearer rb_[0-9a-f]{64}$/);
  assert.equal(page.element('shortcut-section').hidden, false);
  assert.equal(page.element('shortcut-new').hidden, false);
});
