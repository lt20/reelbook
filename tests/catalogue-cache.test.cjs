// L19, instant start: the order in which the cached and the fresh catalogue are applied (RS.refreshCatalogue),
// with the storage and the network injected. The acceptance tests (tests/acceptance/l19) cover the snapshot.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const RS = require('../app/sessions.js');

const deferred = () => { let resolve, reject; const promise = new Promise((ok, ko) => { resolve = ok; reject = ko; }); return {promise, resolve, reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const cat = title => ({themes: [], sheets: [{slug: title, theme: 't', title}], sessions: [], notesIndex: new Set(), lastDone: new Map(), sessionsOk: true, practiceOk: true});

function run({cached = null, current = () => true, writeFails = false} = {}) {
  const net = deferred(), applied = [], written = [];
  const done = RS.refreshCatalogue({
    read: async () => cached,
    fetch: () => net.promise,
    apply: (c, from) => applied.push([from, c.sheets[0] && c.sheets[0].title]),
    write: async c => { if (writeFails) throw Error('quota'); written.push(c.sheets[0].title); },
    current
  });
  return {net, applied, written, done};
}

test('the cached catalogue shows first, then the fresh one replaces it and is saved', async () => {
  const r = run({cached: cat('old')});
  await tick();
  assert.deepEqual(r.applied, [['cache', 'old']]);
  r.net.resolve(cat('new'));
  const res = await r.done;
  await res.saved;
  assert.equal(res.source, 'network');
  assert.deepEqual(r.applied, [['cache', 'old'], ['network', 'new']]);
  assert.deepEqual(r.written, ['new']);
});

test('a fresh read that ends before the cache is read never shows the cached copy', async () => {
  const slow = deferred(), applied = [];
  const res = RS.refreshCatalogue({read: () => slow.promise, fetch: async () => cat('new'), apply: (c, from) => applied.push(from), write: async () => {}});
  assert.equal((await res).source, 'network');
  slow.resolve(cat('old'));
  await tick();
  assert.deepEqual(applied, ['network']);
});

test('a failed fresh read keeps the cached catalogue and saves nothing', async () => {
  const r = run({cached: cat('old')});
  await tick();
  r.net.reject(Error('Failed to fetch'));
  const res = await r.done;
  assert.equal(res.source, 'cache');
  assert.equal(res.error.message, 'Failed to fetch');
  assert.deepEqual(r.applied, [['cache', 'old']]);
  assert.deepEqual(r.written, []);
});

test('offline at once: the cached copy still shows when the network fails before the cache is read', async () => {
  const slow = deferred(), applied = [];
  const res = RS.refreshCatalogue({read: () => slow.promise, fetch: async () => { throw Error('offline'); }, apply: (c, from) => applied.push(from), write: async () => {}});
  await tick();
  slow.resolve(cat('old'));
  assert.equal((await res).source, 'cache');
  assert.deepEqual(applied, ['cache']);
});

test('no cache and no network: the error is returned, nothing applied', async () => {
  const r = run();
  r.net.reject(Error('offline'));
  const res = await r.done;
  assert.equal(res.source, 'none');
  assert.deepEqual(r.applied, []);
});

test('a read of a user who signed out meanwhile applies nothing, cached or fresh', async () => {
  const r = run({cached: cat('old'), current: () => false});
  r.net.resolve(cat('new'));
  const res = await r.done;
  assert.equal(res.source, 'stale');
  assert.deepEqual(r.applied, []);
  assert.deepEqual(r.written, []);
});

test('a storage that fails (quota, private mode) does not fail the catalogue', async () => {
  const net = deferred(), applied = [];
  const done = RS.refreshCatalogue({read: async () => { throw Error('no idb'); }, fetch: () => net.promise, apply: (c, from) => applied.push(from), write: async () => { throw Error('quota'); }});
  net.resolve(cat('new'));
  const res = await done;
  await res.saved;
  assert.equal(res.source, 'network');
  assert.deepEqual(applied, ['network']);
});

test('a saved value of another app version, or damaged, is no cached catalogue', () => {
  for (const bad of [null, undefined, 'x', {}, {v: 0, themes: [], sheets: []}, {v: 1, themes: [], sheets: 'x'}]) assert.equal(RS.restoreCatalogueSnapshot(bad), null);
});

test('cached photo URLs survive the snapshot', () => {
  const restored = RS.restoreCatalogueSnapshot(JSON.parse(JSON.stringify(RS.catalogueSnapshot({...cat('a'), signed: new Map([['u/a/thumb.jpg', 'https://x/sign/u/a/thumb.jpg?token=t']])}))));
  assert.equal(restored.signed.get('u/a/thumb.jpg'), 'https://x/sign/u/a/thumb.jpg?token=t');
});

test('the sign-out prefix covers every backend of that user and no other user', () => {
  const prefix = RS.catalogueCacheKey('', 'user-a');
  assert.ok(RS.catalogueCacheKey('https://one.example.test', 'user-a').startsWith(prefix));
  assert.ok(RS.catalogueCacheKey('https://two.example.test', 'user-a').startsWith(prefix));
  assert.ok(!RS.catalogueCacheKey('https://one.example.test', 'user-ab').startsWith(prefix));
});
