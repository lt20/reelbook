const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../../app');
const origin = 'https://app.example.test';
const absolute = value => new URL(value, `${origin}/reelbook/`).href;

function worker() {
  const listeners = new Map();
  const stores = new Map();
  let online = true;
  const response = url => ({ok: true, redirected: false, url, clone() { return response(url); }});
  const key = request => typeof request === 'string' ? absolute(request) : request.url;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async addAll(requests) { for (const request of requests) entries.set(key(request), response(key(request))); },
        async match(request) { return entries.get(key(request)); },
        async put(request, value) { entries.set(key(request), value); },
        async keys() { return [...entries.keys()].map(url => ({url})); },
        async delete(request) { return entries.delete(key(request)); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); }
  };
  class Request {
    constructor(url, options = {}) {
      this.url = absolute(url);
      this.method = options.method || 'GET';
      this.mode = options.mode || 'cors';
    }
  }
  const context = {
    URL, Request, caches,
    location: {origin},
    fetch: async input => {
      if (!online) throw new Error('offline');
      return response(key(input));
    },
    self: {
      addEventListener(type, listener) { listeners.set(type, listener); },
      skipWaiting() {},
      clients: {claim() {}}
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), context);
  const dispatch = async (type, request) => {
    const pending = [];
    let answer;
    const event = {
      request,
      waitUntil(promise) { pending.push(Promise.resolve(promise)); },
      respondWith(promise) { answer = Promise.resolve(promise); }
    };
    listeners.get(type)(event);
    if (answer) {
      const result = await answer;
      await Promise.all(pending);
      return result;
    }
    await Promise.all(pending);
  };
  return {
    install: () => dispatch('install'),
    fetch: url => dispatch('fetch', new Request(url)),
    offline: () => { online = false; }
  };
}

test('L27 — the service worker caches demo files on first visit and serves them offline', async () => {
  const demo = path.join(root, 'demo');
  const sheets = fs.readdirSync(demo, {withFileTypes: true}).filter(entry => entry.isDirectory() && fs.existsSync(path.join(demo, entry.name, 'index.html')));
  assert.equal(sheets.length, 5);
  const urls = ['demo/catalogue.json'];
  for (const sheet of sheets) {
    urls.push(`demo/${sheet.name}/index.html`);
    const image = fs.readdirSync(path.join(demo, sheet.name, 'img')).find(name => /\.(?:svg|png|jpe?g)$/i.test(name));
    assert.ok(image, sheet.name);
    urls.push(`demo/${sheet.name}/img/${image}`);
  }
  const sw = worker();
  await sw.install();
  for (const url of urls) assert.equal((await sw.fetch(url)).ok, true, `${url} loads on the first visit`);
  sw.offline();
  for (const url of urls) assert.equal((await sw.fetch(url)).ok, true, `${url} remains available offline`);
});
