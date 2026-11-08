// Debt D2 (docs/audit-design/COORDINATION.md, « Debt »): a stale queue read after a removal (#28), a practice log
// retry past midnight (#32), the queue removal sent as the page goes away (#28).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const user = {id: 'u1', email: 'user@example.test'};
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: user}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const plain = v => JSON.parse(JSON.stringify(v)); // objects of the vm realm
const waiting = () => ({id: 'waiting', status: 'queued', url: 'https://www.instagram.com/reel/waiting/', theme: null, note: null, created_at: new Date().toISOString(), processed_at: null});
const queueTables = () => ({user_themes: [], sheets: [], sessions: [], notes: [], requests: [waiting()]});
const remove = async page => {
  await page.fire('queue-toggle');
  await page.element('queue').listeners.click({target: {closest: s => s === '[data-del]' ? {dataset: {del: 'waiting'}, disabled: false} : null}});
  await settle();
};
const deletes = page => page.clients.at(-1).calls.filter(c => c[0] === 'delete');
const shows = page => /reel\/waiting/.test(page.element('queue').innerHTML) && page.element('queue-sec').hidden === false;

// ---------- 1. a read sent before the DELETE answered, answering after it ----------

test('D2 — a queue read sent while the DELETE is on its way, answering after it, does not bring the row back', async () => {
  let releaseDel = null, releaseRead = null, holdRead = false;
  const hold = (table, ops) => {
    if (table !== 'requests') return null;
    if (ops.some(o => o[0] === 'delete')) return new Promise(resolve => { releaseDel = () => resolve(null); });
    // the list read (neq done): held, then answers the rows as they were when the server read them (row still there)
    if (holdRead && ops.some(o => o[0] === 'neq')) return new Promise(resolve => { releaseRead = () => resolve({data: [waiting()], error: null}); });
    return null;
  };
  const page = await app({...signedIn, tables: queueTables(), hold, stored: {'rb.welcome.u1': '1'}}); // the home page, not #welcome
  await settle();
  assert.ok(shows(page));
  await remove(page);
  await page.fire('queue-undo', 'animationend'); // the DELETE leaves, held
  await settle();
  holdRead = true;
  await page.doc('visibilitychange', {visibilityState: 'visible'}); // the page comes back: a queue read leaves, held
  await settle();
  assert.ok(releaseDel && releaseRead, 'both requests are on their way');
  releaseDel(); await settle();
  assert.equal(deletes(page).length, 1);
  releaseRead(); await settle();
  assert.equal(shows(page), false, 'the stale read does not show the removed row');
  // the next read, sent after the DELETE answered, is believed again (here the fake backend still holds the row)
  holdRead = false;
  await page.doc('visibilitychange', {visibilityState: 'visible'});
  await settle();
  assert.ok(shows(page), 'a read sent after the answer is not filtered');
});

// ---------- 3. the removal sent as the page goes away ----------

const leavingPage = async ({answer = async () => ({ok: true, status: 204}), token = 'tok-1', expiresIn = 3600} = {}) => {
  const fetches = [];
  const fetch = (url, init) => { fetches.push(plain([url, init])); return answer(); };
  const page = await app({...signedIn, tables: queueTables(), fetch});
  await settle();
  if (token) page.clients.at(-1).authListener('TOKEN_REFRESHED', {user, access_token: token, expires_at: Math.floor(Date.now() / 1000) + expiresIn});
  await settle();
  await remove(page);
  return {page, fetches};
};
const sentDirect = [`${ownUrl}/rest/v1/requests?id=eq.waiting`, {method: 'DELETE', keepalive: true, headers: {apikey: ownKey, Authorization: 'Bearer tok-1'}}];

test('D2 — page hidden with a removal pending: the DELETE goes straight to PostgREST, keepalive, with the token in memory', async () => {
  const {page, fetches} = await leavingPage();
  await page.doc('visibilitychange', {visibilityState: 'hidden'});
  await settle();
  assert.deepEqual(fetches, [sentDirect]);
  assert.equal(deletes(page).length, 0, 'not through supabase-js');
  assert.equal(shows(page), false);
});

test('D2 — pagehide with a removal pending sends the same direct DELETE, once', async () => {
  const {page, fetches} = await leavingPage();
  await page.win('pagehide');
  await page.doc('visibilitychange', {visibilityState: 'hidden'}); // already sent: nothing more
  await settle();
  assert.deepEqual(fetches, [sentDirect]);
  assert.equal(deletes(page).length, 0);
});

test('D2 — the toast ending (page still open) keeps supabase-js', async () => {
  const {page, fetches} = await leavingPage();
  await page.fire('queue-undo', 'animationend');
  await settle();
  assert.equal(fetches.length, 0);
  assert.deepEqual(deletes(page).map(c => c[3]), [[['id', 'waiting']]]);
});

test('D2 — no token in memory, or one about to expire: supabase-js sends it as before', async () => {
  for (const opts of [{token: null}, {expiresIn: 10}]) {
    const {page, fetches} = await leavingPage(opts);
    await page.win('pagehide');
    await settle();
    assert.equal(fetches.length, 0, JSON.stringify(opts));
    assert.deepEqual(deletes(page).map(c => c[3]), [[['id', 'waiting']]], JSON.stringify(opts));
  }
});

test('D2 — a direct DELETE refused (401) or cut off puts the row back with the reason', async () => {
  for (const answer of [async () => ({ok: false, status: 401}), async () => { throw new TypeError('Load failed'); }]) {
    const {page, fetches} = await leavingPage({answer});
    await page.doc('visibilitychange', {visibilityState: 'hidden'});
    await settle();
    assert.equal(fetches.length, 1);
    assert.ok(shows(page), 'the row is back');
    assert.match(page.element('queue').innerHTML, /Could not remove it: /);
  }
});

// ---------- 2. practice log: a retry past midnight ----------

const logTables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: ['Arms'], builtin: true, position: 0}],
  sheets: [{slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Hammer curl', summary: '', html: '', source: {}}],
  sessions: [], notes: [], requests: [], practice_log: []
});
const click = async (page, id) => { await page.element('view').listeners.click({target: {closest: sel => sel === `#${id}` ? {id} : null}}); await settle(); };
const inserts = page => plain(page.clients.at(-1).calls.filter(c => c[0] === 'insert' && c[1] === 'practice_log')).map(c => c[2]);
const localDay = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

test('D2 — a Save whose answer is lost, retried after midnight, sends the same row (id and day of the first try)', async () => {
  // the local day moves on without waiting: from UTC+14 to UTC-11 (25 hours apart, so always another date)
  const tz = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Kiritimati';
    const writes = {practice_log: {data: null, error: {message: 'Failed to fetch'}}};
    const page = await app({...signedIn, tables: logTables(), dom: true, hash: '#curl', writes});
    await settle();
    await click(page, 'practice-done');
    page.element('practice-text').value = '3x10';
    await click(page, 'practice-save');
    assert.match(page.element('view').innerHTML, /Not saved\. Try again\./);
    const first = inserts(page)[0];
    process.env.TZ = 'Pacific/Pago_Pago';
    assert.notEqual(localDay(), first.done_on, 'the local day has changed');
    writes.practice_log = {data: null, error: {code: '23505', message: 'duplicate key value violates unique constraint "practice_log_pkey"'}};
    page.element('practice-text').value = '3x10';
    await click(page, 'practice-save');
    const sent = inserts(page);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1], first, 'the same id, day and text');
    const html = page.element('view').innerHTML;
    assert.doesNotMatch(html, /Not saved/);
    assert.equal([...html.matchAll(/<li><time/g)].length, 1, 'one entry in the Log');
    assert.match(html, new RegExp(`<time datetime="${first.done_on}">`), 'dated the day of the first try');
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
});
