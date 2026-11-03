const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../../app/sw.js'), 'utf8');
const shellVersion = source.match(/const VERSION = ['"]([^'"]+)['"]/)?.[1];
const origin = 'https://app.example.test';
const keyOf = request => typeof request === 'string' ? request : request.url;
const response = body => ({body, ok: true, status: 200, clone() { return response(body); }});
const tick = () => new Promise(resolve => setImmediate(resolve));

function worker(network = async request => response(keyOf(request))) {
  const listeners = {};
  const stores = new Map();
  const calls = [];
  const cache = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    return {
      async match(request) { return entries.get(keyOf(request)); },
      async put(request, value) { entries.set(keyOf(request), value); },
      async delete(request) { return entries.delete(keyOf(request)); },
      async keys() { return [...entries.keys()].map(url => ({url})); },
      async addAll(requests) { for (const request of requests) entries.set(new URL(request, origin + '/reelbook/').href, response('shell')); }
    };
  };
  const caches = {
    open: async name => cache(name),
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    async match(request) { for (const entries of stores.values()) if (entries.has(keyOf(request))) return entries.get(keyOf(request)); }
  };
  vm.runInNewContext(source, {
    self: {addEventListener(type, listener) { listeners[type] = listener; }, skipWaiting() {}, clients: {claim() {}}},
    caches, URL, location: {origin},
    fetch(request, options) { calls.push([keyOf(request), options]); return network(request, options); }
  });
  async function dispatch(type, extra = {}) {
    let answer;
    const waits = [];
    listeners[type]({
      ...extra,
      waitUntil(promise) { waits.push(Promise.resolve(promise)); },
      respondWith(promise) { answer = Promise.resolve(promise); }
    });
    return {answer, waits};
  }
  return {cache, caches, calls, dispatch, stores};
}

test('L19 — app shell is stale-while-revalidate, including index.html; refresh is used on the next start', async () => {
  assert.ok(shellVersion, 'VERSION is defined');
  let finish;
  const w = worker(() => new Promise(resolve => { finish = resolve; }));
  const url = origin + '/reelbook/index.html';
  await (await w.cache(shellVersion)).put(url, response('cached shell'));
  const event = await w.dispatch('fetch', {request: {url, method: 'GET'}});
  assert.equal((await event.answer).body, 'cached shell');
  await tick();
  assert.equal(w.calls.length, 1, 'refresh starts in the background');
  finish(response('fresh shell'));
  await Promise.all(event.waits);
  await tick();
  assert.equal((await (await w.cache(shellVersion)).match(url)).body, 'fresh shell');
});

test('L19 — an uncached shell request retains a network fallback', async () => {
  const w = worker(async () => response('network shell'));
  const url = origin + '/reelbook/index.html';
  const event = await w.dispatch('fetch', {request: {url, method: 'GET'}});
  assert.equal((await event.answer).body, 'network shell');
  assert.equal(w.calls.length, 1);
});

test('L19 — an offline shell request serves its cached copy', async () => {
  const w = worker(async () => { throw Error('offline'); });
  const url = origin + '/reelbook/index.html';
  await (await w.cache(shellVersion)).put(url, response('offline shell'));
  const event = await w.dispatch('fetch', {request: {url, method: 'GET'}});
  assert.equal((await event.answer).body, 'offline shell');
});

test('L19 — signed storage photos are cache-first and token changes do not cause a network request', async () => {
  const w = worker(async () => response('photo bytes'));
  const base = 'https://storage.example.test/storage/v1/object/sign/sheets/user/sheet/photo.jpg';
  const first = await w.dispatch('fetch', {request: {url: base + '?token=first', method: 'GET'}});
  assert.equal((await first.answer).body, 'photo bytes');
  await Promise.all(first.waits);
  const second = await w.dispatch('fetch', {request: {url: base + '?token=second', method: 'GET'}});
  assert.equal((await second.answer).body, 'photo bytes');
  assert.equal(w.calls.length, 1);
});

test('L19 — a signed photo already cached remains available offline', async () => {
  let online = true;
  const w = worker(async () => { if (!online) throw Error('offline'); return response('photo bytes'); });
  const base = 'https://storage.example.test/storage/v1/object/sign/sheets/user/sheet/photo.jpg';
  await (await w.dispatch('fetch', {request: {url: base + '?token=first', method: 'GET'}})).answer;
  online = false;
  const event = await w.dispatch('fetch', {request: {url: base + '?token=new', method: 'GET'}});
  assert.equal((await event.answer).body, 'photo bytes');
  assert.equal(w.calls.length, 1);
});

test('L19 — signed photo cache holds at most 300 entries and evicts the oldest', async () => {
  const w = worker(async request => response(keyOf(request)));
  const base = 'https://storage.example.test/storage/v1/object/sign/sheets/user/';
  for (let i = 0; i < 301; i++) {
    const event = await w.dispatch('fetch', {request: {url: base + i + '.jpg?token=t', method: 'GET'}});
    await event.answer;
    await Promise.all(event.waits);
  }
  const photoCaches = [...w.stores.entries()].filter(([name]) => name !== shellVersion);
  assert.ok(photoCaches.length > 0, 'photos have a dedicated cache');
  const keys = photoCaches.flatMap(([, entries]) => [...entries.keys()]);
  assert.ok(keys.length <= 300, `${keys.length} signed photos remain`);
  assert.equal(keys.some(key => key.includes('/0.jpg')), false, 'oldest photo was evicted');
  assert.equal(keys.some(key => key.includes('/300.jpg')), true);
  assert.ok(keys.every(key => !key.includes('token=')), 'cache keys omit signed tokens');
});

test('L19 — sign-out clears the signed-photo cache', async () => {
  const w = worker(async () => response('photo bytes'));
  const url = 'https://storage.example.test/storage/v1/object/sign/sheets/user/photo.jpg?token=t';
  await (await w.dispatch('fetch', {request: {url, method: 'GET'}})).answer;
  const event = await w.dispatch('message', {data: {type: 'CLEAR_USER_CACHE'}});
  await Promise.all(event.waits);
  const photoCaches = [...w.stores.entries()].filter(([name]) => name !== shellVersion);
  assert.equal(photoCaches.flatMap(([, entries]) => [...entries.keys()]).length, 0);
});
