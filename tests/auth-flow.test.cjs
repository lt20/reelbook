const {test} = require('node:test');
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
async function app({remembered, sessions = {}, stored = {}, tables = null, failing = {}, writes = {}, hash = '', dom = false, library = [{id: 'strength', title: 'Strength', groups: []}]} = {}) {
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
      scrollTo() {}, addEventListener(type, listener) { winListeners[type] = listener; }
    },
    document: {
      getElementById: element,
      body: {insertAdjacentHTML() {}},
      addEventListener() {},
      title: 'Reelbook'
    },
    navigator: {},
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
          const q = new Proxy({}, {get: (_, k) => k === 'then' ? (ok, ko) => Promise.resolve().then(result).then(ok, ko) : (...a) => { ops.push([k, ...a]); return q; }});
          return q;
        };
        const client = {url, key, options, calls: [], from: tables ? query : table => ({
          async insert(row) { client.calls.push(['insert', table, row]); return {error: null}; }
        }),
          // storage: list answers one photo; list and remove are recorded in client.calls (not in writesOf)
          storage: {from: () => ({createSignedUrls: async () => ({data: []}),
            async list(dir) { client.calls.push(['list', dir]); return {data: [{name: 'thumb.jpg'}], error: null}; },
            async remove(paths) { client.calls.push(['remove', paths]); return {data: [], error: null}; }})}, auth: {
          onAuthStateChange(listener) {
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
    go(h) { context.location.hash = h; }
  };
}

test('a new visitor sees hosted sign-in before any backend choice', async () => {
  const page = await app();
  assert.equal(page.element('auth').hidden, false);
  assert.equal(page.element('setup').hidden, true);
  assert.equal(page.element('a-submit').disabled, false);
  assert.equal(page.clients[0].url, hostedUrl);
  await page.fire('a-toggle');
  assert.equal(page.element('setup').hidden, false);
  await page.fire('pick-hosted');
  assert.equal(page.element('auth').hidden, false);
  assert.equal(page.element('auth-title').textContent, 'Create an account');
});

test('an existing self-hosted session opens on its remembered project', async () => {
  const page = await app({
    remembered: {mode: 'own', url: ownUrl, key: ownKey},
    sessions: {[ownUrl]: {id: 'existing-user', email: 'user@example.test'}}
  });
  assert.equal(page.clients[0].url, ownUrl);
  assert.equal(page.element('home').hidden, false);
  assert.equal(page.element('setup').hidden, true);
});

test('self-hosted sign-in on a new device stores the project and uses it', async () => {
  const page = await app();
  await page.fire('a-own');
  assert.equal(page.element('login-own-form').hidden, false);
  page.element('login-own-url').value = ownUrl;
  page.element('login-own-key').value = ownKey;
  await page.fire('login-own-form', 'submit');
  assert.equal(page.clients.at(-1).url, ownUrl);
  assert.deepEqual(JSON.parse(page.storage.get('rb.backend')), {mode: 'own', url: ownUrl, key: ownKey});
  page.element('a-email').value = 'user@example.test';
  page.element('a-pass').value = 'example-password';
  await page.fire('auth-form', 'submit');
  assert.equal(page.clients.at(-1).calls[0][0], 'in');
  assert.equal(page.clients.at(-1).calls[0][1].email, 'user@example.test');
});

test('leaving sign-up restores the remembered backend', async () => {
  const page = await app({remembered: {mode: 'hosted'}});
  await page.fire('a-toggle');
  await page.fire('pick-own');
  page.element('own-url').value = ownUrl;
  page.element('own-key').value = ownKey;
  await page.fire('own-form', 'submit');
  assert.equal(page.clients.at(-1).url, ownUrl);
  assert.deepEqual(JSON.parse(page.storage.get('rb.backend')), {mode: 'hosted'});
  await page.fire('a-toggle');
  assert.equal(page.clients.at(-1).url, hostedUrl);
  assert.equal(page.element('auth-title').textContent, 'Sign in');
});

test('sign-up saves its chosen backend after account creation', async () => {
  const page = await app();
  await page.fire('a-toggle');
  await page.fire('pick-own');
  page.element('own-url').value = ownUrl;
  page.element('own-key').value = ownKey;
  await page.fire('own-form', 'submit');
  page.element('a-email').value = 'new@example.test';
  page.element('a-pass').value = 'example-password';
  await page.fire('auth-form', 'submit');
  assert.equal(page.clients.at(-1).calls[0][0], 'up');
  assert.deepEqual(JSON.parse(page.storage.get('rb.backend')), {mode: 'own', url: ownUrl, key: ownKey});
  assert.equal(page.element('auth-title').textContent, 'Sign in');
  assert.equal(page.element('a-info').hidden, false);
});

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'existing-user', email: 'user@example.test'}}};
const reel = 'https://www.instagram.com/reel/DeGBCfjsbTt/';

test('a pasted link is kept until queued, and « + Add a video » asks before dropping it', async () => {
  const page = await app(signedIn);
  await page.fire('btn-new');
  assert.equal(page.element('sheet-new').hidden, false);
  page.element('f-url').value = reel;
  await page.fire('f-url', 'input');
  assert.equal(page.storage.get('rb.draft'), reel);
  await page.fire('btn-new');
  assert.equal(page.element('sheet-new').hidden, false, 'the form stays open');
  assert.equal(page.element('pending-dlg').open, true);
  assert.equal(page.element('pd-url').textContent, reel, 'the dialog names the pending link');
  assert.equal(page.element('pd-queue').textContent, 'Queue it, then add another');
  await page.fire('pd-queue');
  const insert = page.clients.at(-1).calls.find(c => c[0] === 'insert');
  assert.equal(JSON.stringify(insert), JSON.stringify(['insert', 'requests', {url: reel}]));
  assert.equal(page.storage.has('rb.draft'), false);
  assert.equal(page.element('pending-dlg').open, false);
  assert.equal(page.element('sheet-new').hidden, false, 'a fresh form is open for the next link');
});

test('a link left in the field comes back on the next launch', async () => {
  const page = await app({...signedIn, stored: {'rb.draft': reel}});
  assert.equal(page.element('f-url').value, reel);
  assert.equal(page.element('sheet-new').hidden, false);
  assert.equal(page.element('f-err').hidden, false);
});

test('discarding from the dialog forgets the link', async () => {
  const page = await app({...signedIn, stored: {'rb.draft': reel}});
  await page.fire('btn-new');
  await page.fire('pd-discard');
  assert.equal(page.storage.has('rb.draft'), false);
  assert.equal(page.clients.at(-1).calls.some(c => c[0] === 'insert'), false);
});

test('keyword search finds sheets, accents and case ignored; an old one-page session is not shown', async () => {
  const page = await app({
    remembered: {mode: 'own', url: ownUrl, key: ownKey},
    sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}},
    tables: {
      user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
      sheets: [
        {slug: 'ange', kind: 'sheet', theme: 'strength', group: 'Shoulders', title: "L'ange au sol", summary: 'À plat ventre, bras tendus.', source: {author: 'Georges'}, exercises: []},
        {slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Curl marteau', summary: 'Haltères, coudes fixes.', exercises: []},
        {slug: 'routine', kind: 'session', theme: 'strength', title: 'Routine épaules', summary: 'Cinq exercices.', exercises: [{anchor: 'rot', title: "Rotation externe d'épaule", group: 'Shoulders', summary: 'Avec un élastique.'}]}
      ]
    }
  });
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  assert.equal(page.element('home').hidden, false);
  assert.equal(page.element('search').hidden, false);
  const search = async q => { page.element('q').value = q; await page.fire('q', 'input'); return page.element('results').innerHTML; };
  let html = await search('HALTERES');
  assert.match(html, /href="#curl"/);
  assert.doesNotMatch(html, /#ange/);
  assert.equal(page.element('portal').hidden, true);
  html = await search('EPAULE');
  assert.doesNotMatch(html, /#routine/, 'v1 session hidden, its exercises too');
  assert.match(html, /Nothing matches/);
  html = await search('shoulders plat');
  assert.match(html, /#ange/);
  assert.doesNotMatch(html, /#routine/);
  html = await search('pilates');
  assert.match(html, /Nothing matches/);
  await search('');
  assert.equal(page.element('results').hidden, true);
  assert.equal(page.element('portal').hidden, false);
});

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const v2Tables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}, {id: 'mobility', title: 'Mobility', groups: [], builtin: true, position: 1}],
  sheets: [
    {slug: 'gsp-angel', kind: 'sheet', theme: 'strength', group: 'Shoulders', title: 'Floor angel', summary: 'Face down.', duration: '', exercises: []},
    {slug: 'gsp-rot', kind: 'sheet', theme: 'mobility', group: 'Shoulders', title: 'External rotation', summary: 'With a band.', duration: '', exercises: []},
    {slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Hammer curl', summary: 'Dumbbells.', exercises: []},
    {slug: 'old-routine', kind: 'session', theme: 'strength', title: 'Old routine', summary: 'One page.', exercises: [{anchor: 'a', title: 'Old move', group: 'Arms', summary: ''}]}
  ],
  sessions: [{slug: 'gsp-shoulders', theme: 'strength', title: 'GSP shoulders', format: '5 rounds · 60 s rest', why: 'Healthy shoulders.', key_points: ['Slow', 'Breathe'],
    source: {author: 'Georges', url: 'https://example.test/v'}, origin: 'video', thumbnail: '',
    items: [{slug: 'gsp-rot', dose: '3×10'}, {slug: 'deleted-sheet', dose: '1 min'}, {slug: 'gsp-angel', dose: '30 s'}]}]
});

test('v2 sessions show in their notebook, in search and on their own page', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#strength'});
  await settle();
  const groups = page.element('groups').innerHTML;
  assert.match(groups, /Sessions <span class="n">1<\/span>/, 'the old one-page session is not counted');
  assert.match(groups, /href="#session\/gsp-shoulders"/);
  assert.doesNotMatch(groups, /old-routine|Old move/, 'no v1 session card, no v1 exercise card');
  assert.match(page.element('count').textContent, /^2 sheets · 1 session · /);
  assert.match(groups, /2 exercises/, 'the deleted sheet is not counted');
  assert.match(groups, /href="#gsp-angel"[\s\S]*?in 1 session/);
  assert.doesNotMatch(groups.match(/href="#curl"[\s\S]*?<\/a>/)[0], /in \d session/);
  page.element('q').value = 'rounds'; await page.fire('q', 'input');
  assert.match(page.element('results').innerHTML, /#session\/gsp-shoulders/);
});

test('a v2 session page lists its sheets in order with their dose, and moves to another notebook', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#session/gsp-shoulders'});
  await settle();
  assert.equal(page.element('view').hidden, false);
  const html = page.element('view').innerHTML;
  assert.match(html, /<h1>GSP shoulders<\/h1>/);
  assert.match(html, /5 rounds · 60 s rest/);
  assert.match(html, /<li>Slow<\/li><li>Breathe<\/li>/);
  assert.match(html, /href="https:\/\/example.test\/v"/);
  assert.match(html, /href="#gsp-rot"><span class="k">1<\/span>[\s\S]*?3×10[\s\S]*?href="#gsp-angel"><span class="k">2<\/span>[\s\S]*?30 s/);
  assert.doesNotMatch(html, /deleted-sheet|1 min/);
  page.element('view').listeners.click({target: {closest: () => true}});
  assert.equal(page.element('move-dlg').open, true);
  assert.equal(page.element('mv-title').textContent, 'Move this session');
  assert.equal(page.element('mv-group-l').hidden, true);
  page.element('mv-theme').value = 'mobility';
  await page.fire('mv-form', 'submit');
  assert.match(page.element('sheet-top').innerHTML, /Moved to Mobility\./);
});

test('an exercise sheet links back to its video session', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#gsp-angel'});
  await settle();
  assert.match(page.element('view').innerHTML, /From the session <a href="#session\/gsp-shoulders">GSP shoulders<\/a>/);
});

test('a backend without the sessions table still loads, and Settings says how to enable sessions', async () => {
  const failing = {sessions: {error: {code: 'PGRST205', message: 'Could not find the table'}, status: 404}};
  const page = await app({...signedIn, tables: v2Tables(), hash: '#strength', failing});
  await settle();
  assert.doesNotMatch(page.element('count').textContent, /Could not load/);
  assert.match(page.element('groups').innerHTML, /href="#gsp-angel"/);
  assert.doesNotMatch(page.element('groups').innerHTML, /#session\/|in 1 session/);
  const settings = await app({...signedIn, tables: v2Tables(), hash: '#settings', failing});
  await settle();
  assert.equal(settings.element('settings').hidden, false);
  assert.equal(settings.element('s-sessions').hidden, false);
  const ok = await app({...signedIn, tables: v2Tables(), hash: '#settings'});
  await settle();
  assert.equal(ok.element('s-sessions').hidden, true);
});

test('any other sessions error is a load error', async () => {
  const page = await app({...signedIn, tables: v2Tables(), failing: {sessions: {error: {code: '42501', message: 'permission denied'}, status: 403}}});
  await settle();
  assert.match(page.element('count').textContent, /Could not load your sheets: permission denied/);
});

// ---------- composing sessions (S3) ----------
// A click inside a container whose handler delegates with ev.target.closest(selector).
const clickIn = (page, id, selector, dataset = {}) => page.element(id).listeners.click({target: {closest: s => s === selector ? {dataset} : null}});
const typeIn = (page, target) => page.element('view').listeners.input({target: {dataset: {}, ...target}});
// The writes of the signed-in client, as plain JSON ([method, table, payload, eq filters]).
const writesOf = page => JSON.parse(JSON.stringify(page.clients.at(-1).calls.filter(c => ['insert', 'update', 'delete', 'upsert'].includes(c[0]))));

test('« + New session » shows in every notebook, ticks sheets in order and opens the new session in Edit mode', async () => {
  const empty = await app({...signedIn, tables: v2Tables(), hash: '#mobility'});
  await settle();
  assert.match(empty.element('groups').innerHTML, /<h2>Sessions<\/h2><button[^>]*id="ns-open">\+ New session<\/button>[\s\S]*No session yet/);
  const page = await app({...signedIn, tables: v2Tables(), hash: '#strength'});
  await settle();
  clickIn(page, 'groups', '#ns-open');
  assert.equal(page.element('ns-dlg').open, true);
  let list = page.element('ns-list').innerHTML;
  assert.match(list, /<h3>Arms<\/h3>[\s\S]*data-pick="curl"/);
  assert.match(list, /<h3>Shoulders<\/h3>[\s\S]*data-pick="gsp-angel"/);
  assert.doesNotMatch(list, /old-routine|gsp-rot/, 'only the simple sheets of this notebook');
  page.element('ns-q').value = 'hammer'; await page.fire('ns-q', 'input');
  assert.match(page.element('ns-list').innerHTML, /data-pick="curl"/);
  assert.doesNotMatch(page.element('ns-list').innerHTML, /gsp-angel/);
  page.element('ns-q').value = ''; await page.fire('ns-q', 'input');
  for (const pick of ['gsp-angel', 'curl']) page.element('ns-list').listeners.change({target: {dataset: {pick}}});
  list = page.element('ns-list').innerHTML;
  assert.match(list, /data-pick="curl" checked><span class="o">2</);
  assert.match(list, /data-pick="gsp-angel" checked><span class="o">1</);
  await page.fire('ns-form', 'submit');
  assert.equal(page.element('ns-err').textContent, 'Give the session a title.');
  assert.equal(writesOf(page).length, 0);
  page.element('ns-title').value = '  GSP shoulders ';
  await page.fire('ns-form', 'submit');
  await settle();
  assert.deepEqual(writesOf(page), [['insert', 'sessions',
    {slug: 'my-gsp-shoulders', theme: 'strength', title: 'GSP shoulders', origin: 'user', items: [{slug: 'gsp-angel', dose: ''}, {slug: 'curl', dose: ''}]}, []]]);
  assert.equal(page.element('ns-dlg').open, false);
  assert.equal(page.element('view').hidden, false);
  const html = page.element('view').innerHTML;
  assert.match(html, /Editing the session/);
  assert.match(html, /<b>Floor angel<\/b>[\s\S]*<b>Hammer curl<\/b>/);
  assert.doesNotMatch(html, /processed again/, 'no video help on a user session');
});

test('Edit reorders, sets doses, format and title, and saves the items in full in one update', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#session/gsp-shoulders'});
  await settle();
  clickIn(page, 'view', '#ed-open');
  let html = page.element('view').innerHTML;
  assert.match(html, /If this video is processed again, the session is rewritten and these edits are lost\./);
  assert.match(html, /<h2>Why<\/h2>[\s\S]*<li>Slow<\/li>/, 'why and key points stay, read-only');
  assert.doesNotMatch(html, /id="mv-open"|id="ed-open"|deleted-sheet/);
  assert.match(html, /data-up="0" aria-label="[^"]*" disabled/);
  clickIn(page, 'view', '[data-down]', {down: '0'});
  assert.match(page.element('ed-items').innerHTML, /<b>Floor angel<\/b>[\s\S]*<b>External rotation<\/b>/);
  typeIn(page, {dataset: {dose: '0'}, value: '45 s'});
  typeIn(page, {id: 'ed-format', value: ' 3 rounds '});
  typeIn(page, {id: 'ed-title', value: 'Shoulders, Monday'});
  clickIn(page, 'view', '#ed-save');
  await settle();
  assert.deepEqual(writesOf(page), [['update', 'sessions',
    {title: 'Shoulders, Monday', format: '3 rounds', items: [{slug: 'gsp-angel', dose: '45 s'}, {slug: 'gsp-rot', dose: '3×10'}]}, [['slug', 'gsp-shoulders']]]]);
  html = page.element('view').innerHTML;
  assert.match(html, /Saved\./);
  assert.match(html, /<h1>Shoulders, Monday<\/h1>/);
  assert.match(html, /href="#gsp-angel"><span class="k">1<\/span>[\s\S]*?45 s[\s\S]*?href="#gsp-rot"><span class="k">2<\/span>/);
});

test('Edit: a write that changes no row shows an error and keeps the edits and the saved session as they were', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#session/gsp-shoulders', writes: {sessions: {data: [], error: null}}});
  await settle();
  clickIn(page, 'view', '#ed-open');
  clickIn(page, 'view', '[data-out]', {out: '0'});
  assert.doesNotMatch(page.element('ed-items').innerHTML, /External rotation/);
  clickIn(page, 'view', '#ed-save');
  await settle();
  assert.equal(page.element('ed-err').hidden, false);
  assert.match(page.element('ed-err').textContent, /Could not save/);
  assert.match(page.element('view').innerHTML, /Editing the session/, 'still in Edit mode');
  clickIn(page, 'view', '#ed-cancel');
  assert.match(page.element('view').innerHTML, /href="#gsp-rot"><span class="k">1<\/span>/, 'the session is unchanged');
});

test('Delete session asks in an app dialog, deletes the row only and refreshes the notebook', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#session/gsp-shoulders'});
  await settle();
  clickIn(page, 'view', '#ed-open');
  clickIn(page, 'view', '#ed-delete');
  assert.equal(page.element('del-dlg').open, true);
  assert.equal(page.element('del-name').textContent, 'GSP shoulders');
  await page.fire('del-cancel');
  assert.equal(page.element('del-dlg').open, false);
  assert.equal(writesOf(page).length, 0);
  clickIn(page, 'view', '#ed-delete');
  await page.fire('del-ok');
  await settle();
  assert.deepEqual(writesOf(page), [['delete', 'sessions', null, [['slug', 'gsp-shoulders']]]]);
  assert.equal(page.element('home').hidden, false);
  const groups = page.element('groups').innerHTML;
  assert.doesNotMatch(groups, /#session\/gsp-shoulders|in 1 session/);
  assert.match(groups, /href="#gsp-angel"/, 'its sheets stay');
  assert.match(page.element('flash').textContent, /Session deleted/);
});

test('Delete sheet asks in an app dialog, deletes the row, its photos and its note, then opens the notebook', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#gsp-angel'});
  await settle();
  assert.match(page.element('view').innerHTML, /id="sd-open">Delete sheet</);
  clickIn(page, 'view', '#sd-open');
  assert.equal(page.element('sd-dlg').open, true);
  assert.equal(page.element('sd-name').textContent, 'Floor angel');
  assert.match(page.element('sd-what').textContent, /It leaves the session « GSP shoulders »\./);
  await page.fire('sd-cancel');
  assert.equal(page.element('sd-dlg').open, false);
  assert.equal(writesOf(page).length, 0);
  clickIn(page, 'view', '#sd-open');
  await page.fire('sd-ok');
  await settle();
  assert.deepEqual(writesOf(page), [['delete', 'sheets', null, [['slug', 'gsp-angel']]], ['delete', 'notes', null, [['slug', 'gsp-angel']]]]);
  assert.deepEqual(page.clients.at(-1).calls.find(c => c[0] === 'remove'), ['remove', ['existing-user/gsp-angel/img/thumb.jpg']]);
  assert.equal(page.element('sd-dlg').open, false);
  assert.equal(page.element('home').hidden, false);
  assert.doesNotMatch(page.element('groups').innerHTML, /href="#gsp-angel"/);
  assert.match(page.element('flash').textContent, /Sheet deleted/);
});

test('Delete sheet keeps the sheet and says so when the delete fails', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#curl', writes: {sheets: {data: [], error: null}}});
  await settle();
  clickIn(page, 'view', '#sd-open');
  await page.fire('sd-ok');
  await settle();
  assert.equal(page.element('sd-dlg').open, true);
  assert.match(page.element('sd-err').textContent, /Could not delete/);
  assert.equal(page.clients.at(-1).calls.some(c => c[0] === 'remove'), false, 'photos kept');
});

// ---------- old one-page sessions (v1), left on an older self-hosted backend (S4) ----------
test('old one-page sessions are hidden, and Settings says how to rebuild them', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#settings'});
  await settle();
  assert.equal(page.element('settings').hidden, false);
  assert.equal(page.element('s-v1').hidden, false);
  assert.match(page.element('s-v1').innerHTML, /^1 old-format session hidden: run <code>python3 tools\/rb.py requeue-sessions<\/code>, then <code>\/reelbook<\/code>, to rebuild them\.$/);
  assert.match(page.element('nblist').innerHTML, /Strength<\/b><small>2 sheets · 1 session</);
  page.go('');
  await settle();
  assert.match(page.element('count').textContent, /^3 sheets · 1 session · 2 notebooks$/);
  assert.match(page.element('portal').innerHTML, /2 sheets · 1 session/);
  const tables = v2Tables(); tables.sheets = tables.sheets.filter(s => s.kind !== 'session');
  const clean = await app({...signedIn, tables, hash: '#settings'});
  await settle();
  assert.equal(clean.element('s-v1').hidden, true, 'no hint once every old session is rebuilt');
});

test('a link to an old session, or an old #<slug>~<anchor> link, opens the home page without failing', async () => {
  for (const hash of ['#old-routine', '#old-routine~a', '#gsp-angel~x']) {
    const page = await app({...signedIn, tables: v2Tables(), hash});
    await settle();
    assert.equal(page.element('home').hidden, false, hash);
    assert.equal(page.element('view').hidden, true, hash);
    assert.doesNotMatch(page.element('count').textContent, /Could not load/, hash);
  }
});

test('a link in a sheet to another sheet or a session is kept; an unknown #anchor stays on the sheet', async () => {
  const tables = v2Tables();
  tables.sheets.find(s => s.slug === 'curl').html = '<a href="#gsp-angel">Floor angel</a><a href="#session/gsp-shoulders">GSP</a>'
    + '<a href="#cues">Cues</a><a href="#session/gone">Gone</a><a href="#">Home</a><a href="https://example.test/v">Video</a>';
  const page = await app({...signedIn, tables, hash: '#curl', dom: true});
  await settle();
  const html = page.element('view').innerHTML;
  assert.doesNotMatch(html, /could not be loaded/);
  assert.match(html, /<a href="#gsp-angel">Floor angel<\/a>/, 'existing sheet: kept');
  assert.match(html, /<a href="#session\/gsp-shoulders">GSP<\/a>/, 'existing session: kept');
  assert.match(html, /<a href="#curl">Cues<\/a>/, 'unknown anchor: the current sheet');
  assert.match(html, /<a href="#curl">Gone<\/a>/, 'unknown session: the current sheet');
  assert.match(html, /<a href="#">Home<\/a>/);
  assert.match(html, /<a href="https:\/\/example.test\/v">Video<\/a>/);
});

test('« Add to session » appends the sheet once, says when it is already there, and can create a session', async () => {
  const page = await app({...signedIn, tables: v2Tables(), hash: '#curl'});
  await settle();
  assert.match(page.element('view').innerHTML, /id="as-open">Add to session</);
  clickIn(page, 'view', '#as-open');
  assert.equal(page.element('as-dlg').open, true);
  assert.match(page.element('as-session').innerHTML, /<optgroup label="Strength"><option value="gsp-shoulders">GSP shoulders<\/option><\/optgroup><option value="__new_session__">New session…<\/option>/);
  assert.equal(page.element('as-session').value, 'gsp-shoulders');
  await page.fire('as-form', 'submit');
  assert.deepEqual(writesOf(page), [['update', 'sessions',
    {items: [{slug: 'gsp-rot', dose: '3×10'}, {slug: 'deleted-sheet', dose: '1 min'}, {slug: 'gsp-angel', dose: '30 s'}, {slug: 'curl', dose: ''}]}, [['slug', 'gsp-shoulders']]]]);
  assert.match(page.element('sheet-top').innerHTML, /Added to <a href="#session\/gsp-shoulders">GSP shoulders<\/a>\./);
  clickIn(page, 'view', '#as-open');
  await page.fire('as-form', 'submit');
  assert.equal(page.element('as-err').textContent, 'This sheet is already in that session.');
  assert.equal(writesOf(page).length, 1, 'no second write');
  page.element('as-session').value = '__new_session__'; await page.fire('as-session', 'change');
  assert.equal(page.element('as-new-l').hidden, false);
  assert.equal(page.element('as-hint').textContent, 'It is created in Strength.');
  page.element('as-new').value = 'Arms day';
  await page.fire('as-form', 'submit');
  assert.deepEqual(writesOf(page)[1], ['insert', 'sessions', {slug: 'my-arms-day', theme: 'strength', title: 'Arms day', origin: 'user', items: [{slug: 'curl', dose: ''}]}, []]);
  assert.match(page.element('sheet-top').innerHTML, /Added to <a href="#session\/my-arms-day">Arms day<\/a>/);
});

test('« From the session » and « in N sessions » follow an added sheet without a reload', async () => {
  const tables = v2Tables();
  tables.sessions.push({slug: 'mob', theme: 'mobility', title: 'Mobility flow', format: '', why: '', key_points: [], source: {}, origin: 'video', thumbnail: '', items: [{slug: 'gsp-rot', dose: ''}]});
  const page = await app({...signedIn, tables, hash: '#curl'});
  await settle();
  assert.doesNotMatch(page.element('sheet-top').innerHTML, /From the session/);
  clickIn(page, 'view', '#as-open');
  assert.match(page.element('as-session').innerHTML, /<optgroup label="Strength">[\s\S]*<optgroup label="Mobility"><option value="mob">Mobility flow/);
  page.element('as-session').value = 'mob';
  await page.fire('as-form', 'submit');
  assert.match(page.element('sheet-top').innerHTML, /From the session <a href="#session\/mob">Mobility flow<\/a>/);
  page.go('#strength'); await settle();
  assert.match(page.element('groups').innerHTML.match(/href="#curl"[\s\S]*?<\/a>/)[0], /in 1 session/);
});

test('a v2 session page has its own notes, keyed session/<slug>, and its card shows « note »', async () => {
  const tables = v2Tables();
  tables.notes = [{slug: 'session/gsp-shoulders', body: 'Felt good', updated_at: '2026-11-01T10:00:00Z'}];
  const nb = await app({...signedIn, tables, hash: '#strength'});
  await settle();
  const groups = nb.element('groups').innerHTML;
  assert.match(groups.match(/href="#session\/gsp-shoulders"[\s\S]*?<\/a>/)[0], /class="note"/);
  assert.doesNotMatch(groups.match(/href="#gsp-angel"[\s\S]*?<\/a>/)[0], /class="note"/, 'a session note is not a sheet note');
  const page = await app({...signedIn, tables, hash: '#session/gsp-shoulders'});
  await settle();
  assert.match(page.element('view').innerHTML, /My notes/);
  assert.equal(page.element('n-text').value, 'Felt good');
  page.element('n-text').value = 'Felt better';
  await page.fire('n-save');
  assert.deepEqual(writesOf(page), [['upsert', 'notes', {slug: 'session/gsp-shoulders', body: 'Felt better'}, []]]);
});

// ---------- L1 (design audit P0) ----------
test('C1: saving a video session after changing one dose keeps its long format and long doses byte for byte', async () => {
  const tables = v2Tables();
  const format = '4 rounds of the circuit, 45 s of work and 15 s of rest per exercise, 2 min of rest between rounds; '
    + 'start slowly, keep the breathing calm, stop before any shoulder pain and finish with 5 min of easy walking';
  const longDose = '3 × 12 slow reps, 3 s down, 1 s pause, 20 s of rest';
  assert.ok(format.length > 200 && format.length <= 240 && longDose.length > 40 && longDose.length <= 60);
  Object.assign(tables.sessions[0], {format, items: [{slug: 'gsp-rot', dose: longDose}, {slug: 'gsp-angel', dose: '30 s'}]});
  const page = await app({...signedIn, tables, hash: '#session/gsp-shoulders'});
  await settle();
  clickIn(page, 'view', '#ed-open');
  const html = page.element('view').innerHTML;
  assert.match(html, /id="ed-format" type="text" maxlength="240"/, 'the format input allows 240 characters');
  assert.match(html, /id="ed-title" type="text" maxlength="80"/);
  assert.match(html, /data-dose="0" value="[^"]*" maxlength="60"/, 'a dose input allows 60 characters');
  typeIn(page, {dataset: {dose: '1'}, value: '40 s'});
  clickIn(page, 'view', '#ed-save');
  await settle();
  const [[method, table, row]] = writesOf(page);
  assert.equal(`${method} ${table}`, 'update sessions');
  assert.equal(row.format, format, 'the format is saved whole');
  assert.deepEqual(row.items, [{slug: 'gsp-rot', dose: longDose}, {slug: 'gsp-angel', dose: '40 s'}]);
  assert.ok(page.element('view').innerHTML.includes(format), 'the saved page shows the whole format');
});

test('C2: the add-notebook card counts « N more to pick from » and suggests notebooks not added yet', async () => {
  const lib = ['strength', 'kitesurf', 'mobility', 'cook', 'pilates', 'golf'].map(id => ({id, title: id === 'kitesurf' ? 'Kitesurf' : id === 'cook' ? 'Cooking' : id === 'mobility' ? 'Mobility & rehab' : id[0].toUpperCase() + id.slice(1), groups: []}));
  const tables = v2Tables();
  tables.user_themes.push({id: 'kitesurf', title: 'Kitesurf', groups: [], builtin: true, position: 2});
  const page = await app({...signedIn, tables, library: lib});
  await settle();
  let card = page.element('portal').innerHTML.match(/<button[^>]*id="add-nb">[\s\S]*?<\/button>/)[0];
  assert.match(card, /<p class="eyebrow">3 more to pick from<\/p>/);
  assert.match(card, /<p>Cooking, pilates, golf… or one you describe yourself\.<\/p>/, 'Kitesurf is already a notebook');
  const one = await app({...signedIn, tables, library: lib.slice(0, 4)});
  await settle();
  card = one.element('portal').innerHTML.match(/<button[^>]*id="add-nb">[\s\S]*?<\/button>/)[0];
  assert.match(card, /1 more to pick from<\/p>[\s\S]*<p>Cooking… or one you describe yourself\.<\/p>/);
  const none = await app({...signedIn, tables, library: lib.slice(0, 3)});
  await settle();
  assert.match(none.element('portal').innerHTML, /0 more to pick from<\/p>[\s\S]*<p>Describe one yourself\.<\/p>/);
});

test('C2: a queue row without a notebook shows no notebook label, and its reason sits on its own line', async () => {
  const tables = v2Tables();
  tables.requests = [
    {id: 3, url: 'https://www.tiktok.com/@coach/video/7312', status: 'error', theme: null, note: 'Video unavailable (private account)', created_at: '2026-11-01T08:00:00Z'},
    {id: 2, url: 'https://www.youtube.com/shorts/aBcD1234', status: 'processing', theme: 'strength', note: '', created_at: '2026-11-02T20:00:00Z'}
  ];
  const page = await app({...signedIn, tables});
  await settle();
  const rows = page.element('queue').innerHTML.split('<div class="q">').slice(1);
  assert.match(rows[0], /<small>added 1 Nov<\/small><small class="why">Video unavailable \(private account\)<\/small>/);
  assert.match(rows[0], /needs a look/);
  assert.match(rows[1], /<small>added 2 Nov · Strength<\/small><\/div>/);
});

test('C5: sign-up asks Supabase to send the confirmation link back to the app, not to localhost', async () => {
  const page = await app();
  await page.fire('a-toggle');
  await page.fire('pick-hosted');
  page.element('a-email').value = 'new@example.test';
  page.element('a-pass').value = 'example-password';
  await page.fire('auth-form', 'submit');
  const [kind, credentials] = page.clients.at(-1).calls[0];
  assert.equal(kind, 'up');
  assert.deepEqual(JSON.parse(JSON.stringify(credentials.options)), {emailRedirectTo: 'https://app.example.test/reelbook/'});
});

test('C5: a load error on a self-hosted backend says the project may be paused; on the hosted one it does not', async () => {
  const failing = {sessions: {error: {message: 'Failed to fetch'}, status: 0}};
  const own = await app({...signedIn, tables: v2Tables(), failing});
  await settle();
  assert.equal(own.element('count').textContent,
    'Could not load your sheets: Failed to fetch. Your Supabase project may be paused: open your Supabase dashboard and restore it.');
  const hosted = await app({remembered: {mode: 'hosted'}, sessions: {[hostedUrl]: {id: 'u1', email: 'user@example.test'}}, tables: v2Tables(), failing});
  await settle();
  assert.equal(hosted.clients.at(-1).url, hostedUrl);
  assert.equal(hosted.element('count').textContent, 'Could not load your sheets: Failed to fetch');
});
