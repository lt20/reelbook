// L27, the demo in the service worker (app/sw.js) beyond the acceptance test: the files the app lists on a first
// visit are kept even before the worker controls the page (KEEP_DEMO), and a new VERSION keeps them.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/sw.js'), 'utf8');
const keyOf = r => typeof r === 'string' ? r : r.url;
const response = body => ({body, ok: true, status: 200, redirected: false, clone() { return response(body); }});
const base = 'https://app.example.test/reelbook/demo/';

function worker() {
  const listeners = {}, stores = new Map(), calls = [];
  let online = true;
  const open = async name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {match: async r => m.get(keyOf(r)), put: async (r, v) => { m.set(keyOf(r), v); }, delete: async r => m.delete(keyOf(r)), keys: async () => [...m.keys()].map(url => ({url})), addAll: async () => {}};
  };
  vm.runInNewContext(source, {
    self: {addEventListener: (t, l) => { listeners[t] = l; }, skipWaiting() {}, clients: {claim() {}}},
    caches: {open, keys: async () => [...stores.keys()], delete: async n => stores.delete(n)},
    URL, Request: class { constructor(url) { this.url = url; } }, location: {origin: 'https://app.example.test'},
    fetch: async r => { calls.push(keyOf(r)); if (!online) throw new Error('offline'); return response(keyOf(r)); }
  });
  const dispatch = async (type, extra) => {
    let answer; const waits = [];
    listeners[type]({...extra, waitUntil: p => waits.push(Promise.resolve(p)), respondWith: p => { answer = Promise.resolve(p); }});
    const out = answer ? await answer : undefined;
    await Promise.all(waits);
    return out;
  };
  return {dispatch, calls, stores, offline: () => { online = false; }};
}

test('KEEP_DEMO keeps the listed demo files, which then answer offline', async () => {
  const w = worker();
  await w.dispatch('message', {data: {type: 'KEEP_DEMO', urls: [base + 'catalogue.json', base + 'push-up/img/02-lower.svg']}});
  assert.deepEqual([...w.stores.get('rb-demo-2').keys()], [base + 'catalogue.json', base + 'push-up/img/02-lower.svg']);
  w.offline();
  const r = await w.dispatch('fetch', {request: {url: base + 'push-up/img/02-lower.svg', method: 'GET', mode: 'cors'}});
  assert.equal(r.ok, true);
});

test('KEEP_DEMO ignores what is not a demo file of this origin', async () => {
  const w = worker();
  await w.dispatch('message', {data: {type: 'KEEP_DEMO', urls: ['https://evil.example.test/demo/x.svg', 'https://app.example.test/reelbook/index.html', base + '../sw.js', 'not a url', 42]}});
  assert.equal(w.calls.length, 0);
});

test('a new shell version keeps the demo cache', async () => {
  const w = worker();
  await w.dispatch('message', {data: {type: 'KEEP_DEMO', urls: [base + 'catalogue.json']}});
  w.stores.set('rb-shell-1', new Map());
  await w.dispatch('activate', {});
  assert.ok(w.stores.has('rb-demo-2'));
  assert.ok(!w.stores.has('rb-shell-1'));
});

// L37: a device that kept the old demo (rb-demo-1) and is updated without opening the new one keeps an offline
// demo, the old one whole, until KEEP_DEMO has filled rb-demo-2; then rb-demo-1 goes.
test('a new demo cache keeps the old demo offline until it is complete', async () => {
  const w = worker();
  w.stores.set('rb-demo-1', new Map([[base + 'catalogue.json', response('old catalogue')], [base + 'goblet-squat/index.html', response('old sheet')]]));
  w.stores.set('rb-shell-1', new Map());
  await w.dispatch('activate', {});
  assert.ok(w.stores.has('rb-demo-1'), 'the old demo stays through the update');
  assert.ok(!w.stores.has('rb-shell-1'));
  w.offline();
  const get = url => w.dispatch('fetch', {request: {url, method: 'GET', mode: 'cors'}});
  assert.equal((await get(base + 'catalogue.json')).body, 'old catalogue');
  assert.equal((await get(base + 'goblet-squat/index.html')).body, 'old sheet');
  // a KEEP_DEMO cut short (offline) leaves the old demo in place
  await w.dispatch('message', {data: {type: 'KEEP_DEMO', urls: [base + 'catalogue.json', base + 'sampler/index.html']}});
  assert.ok(w.stores.has('rb-demo-1'));
});

test('a complete KEEP_DEMO drops the old demo cache, and the new copy answers first', async () => {
  const w = worker();
  w.stores.set('rb-demo-1', new Map([[base + 'catalogue.json', response('old catalogue')]]));
  await w.dispatch('message', {data: {type: 'KEEP_DEMO', urls: [base + 'catalogue.json', base + 'spinning-back-kick/index.html']}});
  assert.ok(!w.stores.has('rb-demo-1'));
  w.offline();
  const r = await w.dispatch('fetch', {request: {url: base + 'catalogue.json', method: 'GET', mode: 'cors'}});
  assert.equal(r.body, base + 'catalogue.json', 'the new copy');
});
