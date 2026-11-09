// P8 R13: where a sign-up came from. ?r=<code> read from the address (its form checked), kept on the device (rb.ref)
// and taken off the address; sent with the sign-up (options.data.ref, the share token first) and with the waiting list
// (join_waitlist, six arguments, falling back to four); the app's own shares add r=text, r=story and r=app.
// The SQL: tests/attribution-schema.test.cjs and tests/sql/r13-attribution.sql.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, hostedUrl} = require('./harness.cjs');
const RS = require('../app/sessions.js');
const C = require('../app/card.js');

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
const answer = data => ({data, error: null});
const OPEN = {taken: 14, total: 50, open: true, today_left: 7};
const FULL = {taken: 50, total: 50, open: false, today_left: 7};
const plain = v => JSON.parse(JSON.stringify(v));

test('R13 ?r= validation: one code of [a-z0-9-]{1,32}, exactly; anything else is no origin', () => {
  for (const [search, code] of [['?r=story', 'story'], ['?r=hn', 'hn'], ['r=text', 'text'], ['?x=1&r=app', 'app'],
    ['?r=a-b-1', 'a-b-1'], ['?r=' + 'a'.repeat(32), 'a'.repeat(32)]]) assert.equal(RS.refCodeOf(search), code, search);
  for (const search of ['', '?', '?r=', '?r=' + 'a'.repeat(33), '?r=HN', '?r=st ory', '?r=st%20ory', '?r=a_b', '?r=a.b',
    '?r=<b>', '?r=été', '?ref=story', null, undefined]) assert.equal(RS.refCodeOf(search), null, String(search));
  assert.equal(RS.refCodeOf('?r=story&r=hn'), 'story', 'the first r');
  assert.equal(RS.refUrl('text'), 'https://lt20.github.io/reelbook/?r=text');
  assert.equal(RS.refUrl('Bad Code'), RS.REELBOOK_URL, 'never a malformed query');
});

test('R13 the shares: R6 texts end with ?r=text, R7 card prints ?r=story', () => {
  for (const t of [RS.shareSheetText({title: 'Row'}), RS.shareSessionText({title: 'S', items: []}), RS.shareNotebookText({title: 'N', groups: []})]) {
    assert.match(t, /Saved with Reelbook: https:\/\/lt20\.github\.io\/reelbook\/\?r=text$/);
  }
  assert.equal(C.URL_LINE, 'lt20.github.io/reelbook/?r=story');
});

test('R13 an address with ?r=story: the code is kept on the device, the address loses ?r= and keeps the rest', async () => {
  const urls = [];
  const page = await app({href: 'https://app.example.test/reelbook/?demo&r=story', hash: '#x', history: {state: null, replaceState: (s, t, u) => urls.push(u)},
    rpc: async () => answer(OPEN)});
  await settle();
  const kept = JSON.parse(page.storage.get('rb.ref'));
  assert.equal(kept.code, 'story'); assert.ok(Date.now() - kept.at < 5000);
  assert.equal(urls[0], '/reelbook/?demo#x');
});

test('R13 a malformed ?r=: nothing kept, an older code stays; the address still loses it', async () => {
  const urls = [], older = JSON.stringify({code: 'hn', at: Date.now() - 1000});
  const page = await app({href: 'https://app.example.test/reelbook/?r=Bad%20Code', stored: {'rb.ref': older},
    history: {state: null, replaceState: (s, t, u) => urls.push(u)}, rpc: async () => answer(OPEN)});
  await settle();
  assert.equal(page.storage.get('rb.ref'), older);
  assert.ok(urls.includes('/reelbook/'), urls.join(' '));
});

// The hosted sign-up form, its button, signUp answering ok (a code sent). Returns the signUp calls.
async function signUp(page) {
  const client = page.clients.at(-1), calls = [];
  client.auth.signUp = async c => { calls.push(c); return {data: {session: null}, error: null}; };
  page.element('a-email').value = 'new@example.test';
  page.element('a-pass').value = 'example-password';
  await page.fire('auth-form', 'submit'); await settle();
  return calls;
}

test('R13 sign-up: the kept code goes as user_metadata.ref, then leaves the device', async () => {
  const page = await app({href: 'https://app.example.test/reelbook/?r=story', history: {state: null, replaceState() {}}, rpc: async () => answer(OPEN)});
  await settle();
  await page.fire('intro-signup'); await settle();
  assert.equal(page.clients.at(-1).url, hostedUrl);
  const calls = await signUp(page);
  assert.equal(calls.length, 1);
  assert.deepEqual(plain(calls[0].options.data), {ref: 'story'});
  assert.equal(page.storage.has('rb.ref'), false, 'used once');
});

test('R13 sign-up: the code survives a reload (kept on the device), and expires after 30 days', async () => {
  const fresh = await app({stored: {'rb.ref': JSON.stringify({code: 'hn', at: Date.now() - 29 * 86400000})}, rpc: async () => answer(OPEN)});
  await settle(); await fresh.fire('intro-signup'); await settle();
  assert.deepEqual(plain((await signUp(fresh))[0].options.data), {ref: 'hn'});
  const old = await app({stored: {'rb.ref': JSON.stringify({code: 'hn', at: Date.now() - 31 * 86400000})}, rpc: async () => answer(OPEN)});
  await settle(); await old.fire('intro-signup'); await settle();
  const calls = await signUp(old);
  assert.equal(calls[0].options.data, undefined, 'no origin, no data');
  assert.equal(old.storage.has('rb.ref'), false);
  const bad = await app({stored: {'rb.ref': JSON.stringify({code: 'NOT OK', at: Date.now()})}, rpc: async () => answer(OPEN)});
  await settle(); await bad.fire('intro-signup'); await settle();
  assert.equal((await signUp(bad))[0].options.data, undefined, 'a tampered value is not sent');
});

for (const p of ['lp', 's']) {
  const fill = page => { page.element(`${p}-wl-first`).value = 'Camille'; page.element(`${p}-wl-email`).value = 'camille@example.test'; page.element(`${p}-wl-consent`).checked = true; };
  const toSetup = async page => { if (p === 's') { await page.fire('intro-signin'); await page.fire('a-toggle'); await settle(); } };
  const BASE = {first_name: 'Camille', email: 'camille@example.test', lang: 'en', consent: true};

  test(`R13 waiting list (${p}): with a kept code, six arguments (share_token null, ref)`, async () => {
    const joins = [];
    const page = await app({stored: {'rb.ref': JSON.stringify({code: 'story', at: Date.now()})},
      rpc: async (name, args) => { if (name === 'join_waitlist') { joins.push(args); return answer('ok'); } return answer(FULL); }});
    await settle(); await toSetup(page); fill(page);
    await page.fire(`${p}-wl`, 'submit'); await settle();
    assert.deepEqual(plain(joins), [{...BASE, share_token: null, ref: 'story'}]);
    assert.equal(page.element(`${p}-wl-done`).hidden, false);
  });

  test(`R13 waiting list (${p}): a backend without R13's section — the four arguments, the same message`, async () => {
    const joins = [];
    const page = await app({stored: {'rb.ref': JSON.stringify({code: 'story', at: Date.now()})},
      rpc: async (name, args) => {
        if (name === 'join_waitlist') { joins.push(args); return 'ref' in args ? {data: null, error: {code: 'PGRST202', message: 'no such function'}} : answer('ok'); }
        return answer(FULL);
      }});
    await settle(); await toSetup(page); fill(page);
    await page.fire(`${p}-wl`, 'submit'); await settle();
    assert.deepEqual(plain(joins), [{...BASE, share_token: null, ref: 'story'}, BASE]);
    assert.equal(page.element(`${p}-wl-done`).hidden, false);
  });

  test(`R13 waiting list (${p}): no code, the four arguments as before`, async () => {
    const joins = [];
    const page = await app({rpc: async (name, args) => { if (name === 'join_waitlist') { joins.push(args); return answer('ok'); } return answer(FULL); }});
    await settle(); await toSetup(page); fill(page);
    await page.fire(`${p}-wl`, 'submit'); await settle();
    assert.deepEqual(plain(joins), [BASE]);
  });
}

test('R13 a refusal of the six-argument call (not PGRST202) is the form\'s error, no second call', async () => {
  const joins = [];
  const page = await app({stored: {'rb.ref': JSON.stringify({code: 'story', at: Date.now()})},
    rpc: async (name, args) => { if (name === 'join_waitlist') { joins.push(args); return {data: null, error: {code: 'P0001', message: 'waitlist: full today'}}; } return answer(FULL); }});
  await settle();
  page.element('lp-wl-first').value = 'Camille'; page.element('lp-wl-email').value = 'camille@example.test'; page.element('lp-wl-consent').checked = true;
  const warn = console.warn; console.warn = () => {};
  try { await page.fire('lp-wl', 'submit'); await settle(); } finally { console.warn = warn; }
  assert.equal(joins.length, 1);
  assert.equal(page.element('lp-wl-err').hidden, false);
});
