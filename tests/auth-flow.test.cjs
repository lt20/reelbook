const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'the app script exists');
new vm.Script(script);

const hostedUrl = 'https://hosted.example.test';
const ownUrl = 'https://personal.example.test';
const ownKey = 'a-public-anon-key-long-enough';

async function app({remembered, sessions = {}, stored = {}} = {}) {
  const elements = new Map();
  const storage = new Map([...(remembered ? [['rb.backend', JSON.stringify(remembered)]] : []), ...Object.entries(stored)]);
  const clients = [];
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
    setTimeout() {},
    location: {href: 'https://app.example.test/', hash: ''},
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    window: {
      REELBOOK: {
        library: [{id: 'strength', title: 'Strength', groups: []}],
        hosted: {name: 'Reelbook hosted', url: hostedUrl, anonKey: ownKey, blurb: 'Free for now.'},
        repo: 'https://github.com/lt20/reelbook'
      },
      scrollTo() {}, addEventListener() {}
    },
    document: {
      getElementById: element,
      body: {insertAdjacentHTML() {}},
      addEventListener() {},
      title: 'Reelbook'
    },
    navigator: {},
    supabase: {
      createClient(url, key, options) {
        const client = {url, key, options, calls: [], from: table => ({
          async insert(row) { client.calls.push(['insert', table, row]); return {error: null}; }
        }), auth: {
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
  vm.runInNewContext(script, context);
  await Promise.resolve();
  return {
    element, clients, storage,
    async fire(id, type = 'click') {
      const listener = element(id).listeners[type];
      assert.ok(listener, `${id} handles ${type}`);
      await listener({preventDefault() {}});
      await Promise.resolve();
    }
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
