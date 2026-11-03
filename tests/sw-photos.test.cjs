// L19, service worker photo cache (app/sw.js) beyond the acceptance tests: a republished photo (new rbv) is fetched
// again, and a photo still downloading at sign-out is not put back in the emptied cache.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/sw.js'), 'utf8');
const keyOf = r => typeof r === 'string' ? r : r.url;
const response = body => ({body, ok: true, status: 200, clone() { return response(body); }});

function worker(network) {
  const listeners = {}, stores = new Map(), calls = [];
  const open = async name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {match: async r => m.get(keyOf(r)), put: async (r, v) => { m.set(keyOf(r), v); }, delete: async r => m.delete(keyOf(r)), keys: async () => [...m.keys()].map(url => ({url}))};
  };
  vm.runInNewContext(source, {
    self: {addEventListener: (t, l) => { listeners[t] = l; }, skipWaiting() {}, clients: {claim() {}}},
    caches: {open, keys: async () => [...stores.keys()], delete: async n => stores.delete(n)},
    URL, location: {origin: 'https://app.example.test'},
    fetch: (r, o) => { calls.push(keyOf(r)); return network(r, o); }
  });
  const dispatch = (type, extra) => {
    let answer; const waits = [];
    listeners[type]({...extra, waitUntil: p => waits.push(Promise.resolve(p)), respondWith: p => { answer = Promise.resolve(p); }});
    return {answer, waits};
  };
  const photos = () => [...stores.entries()].filter(([n]) => n.startsWith('rb-photos')).flatMap(([, m]) => [...m.keys()]);
  return {dispatch, calls, photos};
}
const photo = 'https://s.example.test/storage/v1/object/sign/sheets/u/a/img/1.jpg';
const get = url => ({request: {url, method: 'GET'}});

test('a new rbv (sheet republished) fetches the photo again; the token alone does not', async () => {
  const w = worker(async () => response('bytes'));
  for (const url of [photo + '?token=a&rbv=1', photo + '?token=b&rbv=1', photo + '?token=c&rbv=2']) {
    const e = w.dispatch('fetch', get(url)); await e.answer; await Promise.all(e.waits);
  }
  assert.equal(w.calls.length, 2);
  assert.deepEqual(w.photos(), [photo + '?rbv=1', photo + '?rbv=2']);
});

test('a photo still downloading at sign-out stays out of the cache', async () => {
  let finish;
  const w = worker(() => new Promise(resolve => { finish = resolve; }));
  const e = w.dispatch('fetch', get(photo + '?token=a'));
  await new Promise(resolve => setImmediate(resolve));
  const clear = w.dispatch('message', {data: {type: 'CLEAR_USER_CACHE'}});
  await Promise.all(clear.waits);
  finish(response('bytes'));
  assert.equal((await e.answer).body, 'bytes');
  await Promise.all(e.waits);
  assert.deepEqual(w.photos(), []);
});
