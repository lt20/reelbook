// The app harness shared by tests/*.cjs and the acceptance tests written by Codex
// (scripts/codex-acceptance.sh): the script of app/index.html run in a `vm` with a fake DOM and a
// fake Supabase client. Moved verbatim from tests/auth-flow.test.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'the app script exists');
new vm.Script(script);
const sessionsJs = fs.readFileSync(path.join(__dirname, '../app/sessions.js'), 'utf8');

const hostedUrl = 'https://hosted.example.test';
const ownUrl = 'https://personal.example.test';
const ownKey = 'a-public-anon-key-long-enough';

// A sheet's html in tests holds only `<a href="…">text</a>` links: enough for loadSheet's link rewriting.
const sheetLinks = html => [...String(html || '').matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)].map(([, href, text]) => ({
  tagName: 'A', text, attrs: {href}, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; }
}));
class SheetParser { parseFromString(html) { return {body: {children: sheetLinks(html)}}; } }
const sheetDocument = {
  importNode: n => n,
  createDocumentFragment: () => ({nodes: [], appendChild(n) { this.nodes.push(n); }, querySelectorAll(sel) { return sel === 'a[href]' ? this.nodes : []; }}),
  createElement: () => ({frag: null, appendChild(f) { this.frag = f; }, get innerHTML() { return this.frag.nodes.map(a => `<a href="${a.attrs.href}">${a.text}</a>`).join(''); }})
};

// `failing`: table -> {error, status} answered instead of rows (a backend without that table).
// `writes`: table -> {data, error} answered to an insert / update / delete / upsert (default: one row written).
// `dom`: a minimal DOMParser for a sheet's html made of `<a href="…">text</a>` links only, so loadSheet renders it.
// `library`: the built-in notebooks of the app config (window.REELBOOK.library).
// `nav`: the navigator (none of its APIs by default, e.g. no wakeLock).
// `idb`: a Map standing for IndexedDB's key-value store (none by default: the app reads the network only).
// `missing`: ['table.column', ...] columns this backend does not have: a read whose select names one answers
// PostgREST's 42703 « column … does not exist » (HTTP 400), as a backend before that column's migration.
// client.selects journals every projection asked, [table, columns], in order.
// `hold`: (table, ops) -> a promise a read or write waits for before answering (still on its way), or null; a
// promise resolving to {data, error} answers that instead of the table's rows at that time (a read made earlier).
// `fetch`: the window's fetch (none by default: the app reads its backend through the fake client only), e.g. the
// demo's static files (L27).
// IndexedDB as the app uses it (open, one 'kv' store, get / put; a ranged delete is not supported and fails).
const fakeIndexedDB = store => ({
  open() {
    const r = {};
    queueMicrotask(() => {
      r.result = {transaction() {
        const t = {}, done = q => { queueMicrotask(() => t.oncomplete && t.oncomplete()); return q; };
        t.objectStore = () => ({get: k => done({result: store.get(k)}), put: (v, k) => done(store.set(k, JSON.parse(JSON.stringify(v))))});
        return t;
      }};
      r.onsuccess();
    });
    return r;
  }
});
async function app({remembered, sessions = {}, stored = {}, tables = null, failing = {}, writes = {}, hash = '', dom = false, library = [{id: 'strength', title: 'Strength', groups: []}], nav = {}, idb = null, hold = () => null, missing = [], fetch = null} = {}) {
  const elements = new Map();
  const storage = new Map([...(remembered ? [['rb.backend', JSON.stringify(remembered)]] : []), ...Object.entries(stored)]);
  const clients = [];
  // location.hash set by the app fires hashchange, as in a browser
  const winListeners = {};
  let currentHash = hash;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: true, disabled: false, value: '', textContent: '', innerHTML: '',
      listeners: {}, classList: {toggle() {}},
      addEventListener(type, listener) { this.listeners[type] = listener; },
      focus() {}, reset() {}, setAttribute() {}, scrollIntoView() {},
      showModal() { this.open = true; }, close() { this.open = false; }
    });
    return elements.get(id);
  };
  const context = {
    URL, console,
    crypto: globalThis.crypto, // Web Crypto, as every browser has it (L28: the shortcut key and its SHA-256)
    setTimeout: fn => { if (tables) queueMicrotask(fn); },
    location: {
      href: 'https://app.example.test/reelbook/', origin: 'https://app.example.test', pathname: '/reelbook/',
      get hash() { return currentHash; },
      set hash(v) { currentHash = !v || String(v).startsWith('#') ? String(v || '') : '#' + v; queueMicrotask(() => winListeners.hashchange && winListeners.hashchange()); }
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    window: {
      REELBOOK: {
        library,
        hosted: {name: 'Reelbook hosted', url: hostedUrl, anonKey: ownKey, blurb: 'Free for now.'},
        repo: 'https://github.com/lt20/reelbook'
      },
      scrollTo() {}, addEventListener(type, listener) { winListeners[type] = listener; },
      ...(idb ? {indexedDB: fakeIndexedDB(idb)} : {})
    },
    document: {
      getElementById: element,
      body: {insertAdjacentHTML() {}},
      addEventListener() {},
      title: 'Reelbook'
    },
    navigator: nav,
    ...(fetch ? {fetch} : {}),
    ...(dom ? {DOMParser: SheetParser} : {}),
    supabase: {
      createClient(url, key, options) {
        // with `tables`, a read chain resolves to that table's rows (maybeSingle: the first row matching its eq
        // filters); a write is recorded in client.calls as [method, table, payload, eq filters]. Without
        // `tables`, only inserts are recorded.
        const WRITES = ['insert', 'update', 'delete', 'upsert'];
        const query = table => {
          const ops = [];
          const result = () => {
            const sel = ops.find(o => o[0] === 'select');
            if (sel) {
              client.selects.push([table, sel[1]]);
              const cols = String(sel[1] || '').split(',').map(c => c.trim().replace(/"/g, ''));
              const gone = missing.find(m => m.startsWith(table + '.') && cols.includes(m.slice(table.length + 1)));
              if (gone) return {data: null, error: {code: '42703', message: `column ${gone} does not exist`, details: null, hint: null}, status: 400};
            }
            if (failing[table]) return {data: null, ...failing[table]};
            const eqs = ops.filter(o => o[0] === 'eq').map(o => o.slice(1)), w = ops.find(o => WRITES.includes(o[0]));
            if (w) {
              client.calls.push([w[0], table, w[1], eqs]);
              return writes[table] || {data: w[0] === 'insert' ? [].concat(w[1]).map(r => ({format: '', why: '', key_points: [], source: {}, thumbnail: '', ...r})) : [{}], error: null};
            }
            const rows = tables[table] || [];
            if (ops.some(o => o[0] === 'maybeSingle' || o[0] === 'single')) return {data: rows.find(r => eqs.every(([c, v]) => r[c] === v)) || null, error: null};
            return {data: rows, error: null};
          };
          const wait = () => hold(table, ops);
          const q = new Proxy({}, {get: (_, k) => k === 'then' ? (ok, ko) => Promise.resolve().then(wait).then(v => v || result()).then(ok, ko) : (...a) => { ops.push([k, ...a]); return q; }});
          return q;
        };
        const client = {url, key, options, calls: [], selects: [], from: tables ? query : table => ({
          async insert(row) { client.calls.push(['insert', table, row]); return {error: null}; }
        }),
          // storage: list answers one photo; list and remove are recorded in client.calls (not in writesOf)
          storage: {from: () => ({createSignedUrls: async () => ({data: []}),
            async list(dir) { client.calls.push(['list', dir]); return {data: [{name: 'thumb.jpg'}], error: null}; },
            async remove(paths) { client.calls.push(['remove', paths]); return {data: [], error: null}; }})}, auth: {
          onAuthStateChange(listener) {
            client.authListener = listener; // a test can fire a later auth event (another account signed in)
            queueMicrotask(() => listener('INITIAL_SESSION', sessions[url] ? {user: sessions[url]} : null));
            return {data: {subscription: {unsubscribe() {}}}};
          },
          async signInWithPassword(credentials) { client.calls.push(['in', credentials]); return {error: null}; },
          async signUp(credentials) { client.calls.push(['up', credentials]); return {data: {session: null}, error: null}; },
          async signOut() { return {error: null}; }
        }};
        clients.push(client);
        return client;
      }
    }
  };
  if (dom) Object.assign(context.document, sheetDocument);
  vm.createContext(context);
  vm.runInContext(sessionsJs, context);
  vm.runInContext(script, context);
  await Promise.resolve();
  return {
    element, clients, storage,
    async fire(id, type = 'click') {
      const listener = element(id).listeners[type];
      assert.ok(listener, `${id} handles ${type}`);
      await listener({preventDefault() {}});
      await Promise.resolve();
    },
    go(h) { context.location.hash = h; },
    // a window event the app listens to (e.g. beforeinstallprompt), with the event object given
    async win(type, ev = {}) { assert.ok(winListeners[type], `window handles ${type}`); await winListeners[type](ev); await Promise.resolve(); }
  };
}

module.exports = {app, html, hostedUrl, ownUrl, ownKey};
