const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, ownUrl, ownKey} = require('../../harness.cjs');

const reel = 'https://www.instagram.com/reel/EXAMPLE0001/';
const signedIn = {
  remembered: {mode: 'own', url: ownUrl, key: ownKey},
  sessions: {[ownUrl]: {id: 'u1', email: 'reader@example.test'}}
};
const tables = () => ({user_themes: [], sheets: [], sessions: [], notes: [], requests: [], capture_tokens: []});
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const requestWrites = page => page.clients.flatMap(client => client.calls).filter(call => call[1] === 'requests' && call[0] === 'insert');

test('L28 Step A — Add a video has a Paste link button that reads a supported clipboard link without queueing it', async () => {
  assert.match(html, /<button\b[^>]*id="paste-link"[^>]*>\s*Paste link\s*<\/button>/);
  let reads = 0;
  const page = await app({...signedIn, tables: tables(), nav: {clipboard: {async readText() { reads++; return reel; }}}});
  await settle();
  await page.fire('add-video-fab');
  await page.fire('paste-link');
  await settle();
  assert.equal(reads, 1);
  assert.equal(page.element('f-url').value, reel);
  assert.deepEqual(requestWrites(page), []);
  await page.fire('sheet-new', 'submit');
  await settle();
  assert.equal(requestWrites(page).length, 1, 'queueing requires the existing submit gesture');
});

test('L28 Step A — Paste link says when the clipboard is empty or contains an unsupported link', async () => {
  let clipboard = '';
  const page = await app({...signedIn, tables: tables(), nav: {clipboard: {async readText() { return clipboard; }}}});
  await settle();
  await page.fire('add-video-fab');
  for (const value of ['', 'https://example.test/video']) {
    clipboard = value;
    await page.fire('paste-link');
    await settle();
    assert.equal(page.element('f-url').value, '');
    assert.equal(page.element('f-err').hidden, false);
    assert.ok(page.element('f-err').textContent.trim());
    assert.deepEqual(requestWrites(page), []);
  }
});

test('L28 Step A — denied clipboard access leaves Add a video usable and queues nothing', async () => {
  const page = await app({...signedIn, tables: tables(), nav: {clipboard: {async readText() { throw new Error('NotAllowedError'); }}}});
  await settle();
  await page.fire('add-video-fab');
  await page.fire('paste-link');
  await settle();
  assert.equal(page.element('sheet-new').hidden, false);
  assert.equal(page.element('f-url').value, '');
  assert.equal(page.element('f-err').hidden, false);
  assert.ok(page.element('f-err').textContent.trim());
  assert.deepEqual(requestWrites(page), []);
});

test('L28 Step A — floating + pre-fills a supported clipboard link, permission permitting, but never sends it', async () => {
  const page = await app({...signedIn, tables: tables(), nav: {clipboard: {async readText() { return reel; }}}});
  await settle();
  await page.fire('add-video-fab');
  await settle();
  assert.equal(page.element('sheet-new').hidden, false);
  assert.equal(page.element('f-url').value, reel);
  assert.deepEqual(requestWrites(page), []);
});

test('L28 Step A — an existing unqueued draft is preserved when floating + checks the clipboard', async () => {
  const draft = 'https://youtu.be/abc123';
  const page = await app({...signedIn, tables: tables(), stored: {'rb.draft': draft}, nav: {clipboard: {async readText() { return reel; }}}});
  await settle();
  await page.fire('add-video-fab');
  await settle();
  assert.equal(page.element('f-url').value, draft);
  assert.equal(page.storage.get('rb.draft'), draft);
  assert.deepEqual(requestWrites(page), []);
});

test('L28 Step B — Settings hides iPhone shortcut when a select shows capture_tokens is absent', async () => {
  const page = await app({...signedIn, tables: tables(), hash: '#settings', failing: {capture_tokens: {error: {code: 'PGRST205', message: 'table not found'}, status: 404}}});
  await settle();
  assert.ok(page.clients.some(client => client.selects.some(([table]) => table === 'capture_tokens')));
  assert.equal(page.element('shortcut-section').hidden, true);
  assert.deepEqual(page.clients.flatMap(client => client.calls).filter(call => call[1] === 'capture_tokens'), []);
});

test('L28 Step B — Settings shows iPhone shortcut and the specified iOS Share Sheet steps when the table exists, even with no tokens', async () => {
  const page = await app({...signedIn, tables: tables(), hash: '#settings'});
  await settle();
  assert.equal(page.element('shortcut-section').hidden, false);
  const section = html.match(/<section\b[^>]*id="shortcut-section"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section, 'Settings contains the shortcut section');
  for (const text of ['iPhone shortcut', 'Share Sheet', 'Get URLs', 'Get contents of URL', 'POST']) assert.ok(section.includes(text), text);
  assert.doesNotMatch(section, /download[^<]*\.shortcut|href="[^"]*\.shortcut"/i);
});

test('L28 Step B — creating a labeled token stores a hash and shows the secret once', async () => {
  const page = await app({...signedIn, tables: tables(), hash: '#settings'});
  await settle();
  page.element('shortcut-label').value = 'My iPhone';
  await page.fire('shortcut-create');
  await settle();
  const writes = page.clients.flatMap(client => client.calls).filter(call => call[0] === 'insert' && call[1] === 'capture_tokens');
  assert.equal(writes.length, 1);
  const row = Array.isArray(writes[0][2]) ? writes[0][2][0] : writes[0][2];
  assert.equal(row.label, 'My iPhone');
  assert.match(row.token_hash, /^[a-f0-9]{64}$/i);
  const secret = page.element('shortcut-token').textContent.trim();
  assert.ok(secret);
  assert.notEqual(secret, row.token_hash);
  assert.equal(page.storage.has('rb.capture_token'), false);
  page.go(''); await settle();
  page.go('#settings'); await settle();
  assert.equal(page.element('shortcut-token').textContent.includes(secret), false);
});

test('L28 Step B — revoking a token updates only its own row', async () => {
  const token = {id: 'token-1', user_id: 'u1', label: 'My iPhone', token_hash: 'a'.repeat(64), created_at: '2026-11-04T10:00:00Z', last_used_at: null, revoked_at: null};
  const page = await app({...signedIn, tables: {...tables(), capture_tokens: [token]}, hash: '#settings'});
  await settle();
  await page.fire('shortcut-revoke');
  await settle();
  const writes = page.clients.flatMap(client => client.calls).filter(call => call[0] === 'update' && call[1] === 'capture_tokens');
  assert.equal(writes.length, 1);
  assert.ok(writes[0][2].revoked_at);
  assert.deepEqual(writes[0][3], [['id', 'token-1']]);
});
