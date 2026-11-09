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
// `href`: the page's address (default https://app.example.test/reelbook/), e.g. the published app (L26).
// `rpc`: (name, args, client) -> the answer of client.rpc (none by default: no database function, as before L29).
// `getUser`: client.auth.getUser (none by default), e.g. the user_metadata #welcome reads (L43).
// `docEl`: a document.documentElement (none by default), e.g. {lang: 'en'} to read <html lang> (L30).
// `win`: more properties of the window, e.g. window.RBL, the landing's API (L30: app/landing.js is not loaded here).
// `source`: script -> script, the app's script changed before it runs (e.g. a mode constant set otherwise, R9).
// `history`: the window's history (none by default), e.g. to see the share route's replaceState (R10). 'stack': a
// browser's session history (P8 R4): setting location.hash pushes an entry (none when it is the same), location.replace
// replaces it, back / forward / go move in it and fire hashchange, each entry keeps its state; a move before the first
// entry leaves the app (page.history.left counts them). page.history.entries and .index show where it is,
// page.history.go(-1) is the browser's Back button.
// The query of `href` is location.search; page.focused journals the ids focused, in order (R10).
// `globals`: more globals of the page's realm, e.g. Safari's ClipboardItem and Blob (R10).
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
async function app({remembered, sessions = {}, stored = {}, tables = null, failing = {}, writes = {}, hash = '', dom = false, library = [{id: 'strength', title: 'Strength', groups: []}], nav = {}, idb = null, hold = () => null, missing = [], fetch = null, confirm = null, timerCap = Infinity, href = 'https://app.example.test/reelbook/', win = {}, rpc = null, docEl = null, auth = null, cfg = null, getUser = null, source = null, history = null, globals = {}} = {}) {
  const elements = new Map();
  const storage = new Map([...(remembered ? [['rb.backend', JSON.stringify(remembered)]] : []), ...Object.entries(stored)]);
  const clients = [], appended = [], clicked = [];
  // P8 R19: an element the app clicks without adding it to the page (a download link) is journalled in page.clicked
  const made = tag => ({tagName: String(tag).toUpperCase(), click() { clicked.push({tagName: this.tagName, href: this.href, download: this.download}); }});
  // location.hash set by the app fires hashchange, as in a browser
  const winListeners = {};
  // every listener of the window and of the document, by type (win() and doc() fire them all, in order)
  const winAll = {}, docAll = {};
  let currentHash = hash;
  const stack = history === 'stack' ? {entries: [{hash, state: null}], index: 0, left: 0} : null;
  const fireHash = () => queueMicrotask(() => winListeners.hashchange && winListeners.hashchange());
  const hashOf = u => new URL(String(u), href).hash;
  if (stack) history = {
    get state() { return stack.entries[stack.index].state; },
    get length() { return stack.entries.length; },
    replaceState(state, title, url) {
      const e = stack.entries[stack.index]; e.state = state == null ? null : JSON.parse(JSON.stringify(state));
      if (url != null) e.hash = currentHash = hashOf(url);
    },
    go(n) {
      const to = stack.index + n; if (!n || to >= stack.entries.length) return;
      if (to < 0) { stack.left++; return; }
      const was = currentHash; stack.index = to; currentHash = stack.entries[to].hash;
      if (currentHash !== was) fireHash();
    },
    back() { this.go(-1); }, forward() { this.go(1); }
  };
  if (stack) stack.go = n => history.go(n); // the browser's Back (-1) and Forward (1) buttons
  const focused = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: true, disabled: false, value: '', textContent: '', innerHTML: '',
      listeners: {}, classList: {toggle() {}},
      addEventListener(type, listener) { this.listeners[type] = listener; },
      focus() { focused.push(id); }, reset() {}, setAttribute() {}, scrollIntoView() {},
      showModal() { this.open = true; }, close() { this.open = false; }
    });
    return elements.get(id);
  };
  const context = {
    URL, URLSearchParams, console,
    crypto: globalThis.crypto, // Web Crypto, as every browser has it (L28: the shortcut key and its SHA-256)
    // timers run as microtasks; one of timerCap ms or more never fires (a test that waits for the work, not the time)
    setTimeout: (fn, ms) => { if (tables && !(ms >= timerCap)) queueMicrotask(fn); },
    location: {
      href, origin: new URL(href).origin, pathname: new URL(href).pathname, search: new URL(href).search,
      get hash() { return currentHash; },
      set hash(v) {
        const h = !v || String(v).startsWith('#') ? String(v || '') : '#' + v;
        if (stack) { if (h === currentHash) return; stack.entries.splice(stack.index + 1, Infinity, {hash: h, state: null}); stack.index++; }
        currentHash = h; fireHash();
      },
      ...(stack ? {replace(u) { const h = hashOf(u), was = currentHash; stack.entries[stack.index] = {hash: h, state: null}; currentHash = h; if (h !== was) fireHash(); }} : {})
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
      get length() { return storage.size; },
      key: i => [...storage.keys()][i] ?? null
    },
    window: {
      REELBOOK: {
        library,
        hosted: {name: 'Reelbook hosted', url: hostedUrl, anonKey: ownKey, blurb: 'Free for now.', ...(cfg || {})},
        repo: 'https://github.com/lt20/reelbook'
      },
      scrollTo() {}, addEventListener(type, listener) { winListeners[type] = listener; (winAll[type] = winAll[type] || []).push(listener); },
      ...(idb ? {indexedDB: fakeIndexedDB(idb)} : {}),
      ...(confirm ? {confirm} : {}),
      ...win
    },
    document: {
      ...(docEl ? {documentElement: docEl} : {}),
      getElementById: element,
      body: {insertAdjacentHTML() {}},
      // L42b: a script the app adds (Turnstile's), journalled in page.appended; a test fires its onload / onerror
      head: {appendChild(n) { appended.push(n); return n; }},
      createElement: tag => made(tag),
      addEventListener(type, listener) { (docAll[type] = docAll[type] || []).push(listener); },
      title: 'Reelbook'
    },
    navigator: nav,
    ...(history ? {history} : {}),
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
              for (const o of ops) if (o[0] === 'in') client.ins.push([table, o[1], o[2]]);
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
        const client = {url, key, options, calls: [], ins: [], selects: [], from: tables ? query : table => ({
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
          async signOut() { return {error: null}; },
          ...(auth ? auth(() => client) : {}), // L41: a test's own answers (verifyOtp, resend, updateUser...)
          ...(getUser ? {getUser} : {})
        }};
        if (rpc) client.rpc = async (name, args) => rpc(name, args, client);
        clients.push(client);
        return client;
      }
    }
  };
  if (dom) Object.assign(context.document, sheetDocument, {createElement: tag => String(tag).toLowerCase() === 'a' ? made(tag) : sheetDocument.createElement(tag)});
  Object.assign(context, globals);
  vm.createContext(context);
  vm.runInContext(sessionsJs, context);
  vm.runInContext(source ? source(script) : script, context);
  await Promise.resolve();
  return {
    element, clients, storage, appended, clicked, focused, history: stack,
    window: context.window, // e.g. window.turnstile, set when a test loads Cloudflare's script (L42b)
    location: context.location, // e.g. a mailto: the app opened by setting location.href (L26)
    async fire(id, type = 'click') {
      const listener = element(id).listeners[type];
      assert.ok(listener, `${id} handles ${type}`);
      await listener({preventDefault() {}});
      await Promise.resolve();
    },
    go(h) { context.location.hash = h; },
    // a window event the app listens to (e.g. beforeinstallprompt), with the event object given
    async win(type, ev = {}) { assert.ok(winAll[type], `window handles ${type}`); for (const l of winAll[type]) await l(ev); await Promise.resolve(); },
    // a document event (e.g. visibilitychange), after setting `props` on the document (e.g. {visibilityState: 'hidden'})
    async doc(type, props = {}, ev = {}) { Object.assign(context.document, props); assert.ok(docAll[type], `document handles ${type}`); for (const l of docAll[type]) await l(ev); await Promise.resolve(); }
  };
}

module.exports = {app, html, script, hostedUrl, ownUrl, ownKey};
