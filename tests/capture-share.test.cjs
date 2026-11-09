// R10: one-gesture capture. The manifest's share target and shortcut, the share route (./?text=… / ./?url=… /
// ./?add), the link kept through sign-in, the phone step of #welcome and the install card per platform, and the
// iPhone shortcut's iCloud link (SHORTCUT_ICLOUD_URL) both ways.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {app, script, hostedUrl, ownUrl, ownKey} = require('./harness.cjs');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app');
const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.webmanifest'), 'utf8'));
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve)); };

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const REEL = 'https://www.instagram.com/reel/EXAMPLE0001/';
const BASE = 'https://app.example.test/reelbook/';
const ICLOUD = 'https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef';

const fresh = () => new Date(Date.now() - 60 * 1000).toISOString();
const user = () => ({id: 'u1', email: 'camille@example.com', created_at: fresh()});
const SHEET = {slug: 'first-sheet', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'First sheet', summary: 'A move.', exercises: []};
const tables = (sheets = []) => ({user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}], sheets, sessions: [], notes: [], requests: [], capture_tokens: []});
// the app's own navigation journal (L17) also calls replaceState, without an address: only addresses are kept
const replaced = () => { const h = {state: null, calls: [], replaceState(state, title, url) { if (url !== undefined) h.calls.push(url); }}; return h; };
// A page opened by Android's Share menu (or the app shortcut): the query as the browser builds it.
const shared = async (query, {signedIn = true, sheets = [], ...options} = {}) => {
  const history = replaced();
  const page = await app({remembered: {mode: 'hosted'}, sessions: signedIn ? {[hostedUrl]: user()} : {}, tables: tables(sheets), href: BASE + '?' + query, history, nav: {userAgent: ANDROID}, ...options});
  await settle();
  return {page, history};
};
const q = o => new URLSearchParams(o).toString();

// ---------- the manifest ----------

test('manifest: a stable id, a GET share target on the app itself with title / text / url, inside the scope', () => {
  assert.equal(manifest.id, './', 'the id of an app installed before R10 (its start_url): no second install');
  const t = manifest.share_target;
  assert.equal(t.method, 'GET');
  assert.equal(t.enctype, undefined, 'GET carries no body');
  assert.deepEqual(t.params, {title: 'title', text: 'text', url: 'url'});
  const scope = new URL(manifest.scope, BASE).href;
  assert.ok(new URL(t.action, BASE).href.startsWith(scope), 'the action is inside the scope');
  assert.equal(new URL(t.action, BASE).href, new URL(manifest.start_url, BASE).href, 'the app itself: the route is the query');
});

test('manifest: the « Add a video » shortcut opens ./?add, with an icon that exists', () => {
  assert.equal(manifest.shortcuts.length, 1);
  const [s] = manifest.shortcuts;
  assert.equal(s.name, 'Add a video');
  assert.equal(s.url, './?add');
  for (const i of s.icons) assert.ok(fs.existsSync(path.join(APP, i.src)), i.src);
});

test('manifest: screenshots are synthetic captures in app/screens/, their declared size is the PNG\'s', () => {
  assert.ok(manifest.screenshots.length >= 2);
  assert.ok(manifest.screenshots.some(s => s.form_factor === 'narrow'), 'Android\'s richer install window shows narrow ones');
  for (const s of manifest.screenshots) {
    assert.match(s.src, /^screens\/[a-z0-9-]+\.png$/);
    assert.equal(s.type, 'image/png');
    assert.ok(s.label, `${s.src} has a label`);
    const png = fs.readFileSync(path.join(APP, s.src));
    assert.equal(png.toString('latin1', 1, 4), 'PNG');
    assert.equal(s.sizes, `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, s.src);
    assert.ok(png.length < 400 * 1024, `${s.src} stays light (${png.length} bytes)`);
  }
});

test('the service worker\'s shell holds the manifest, and its version moved with it', () => {
  const sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
  assert.match(sw, /'\.\/manifest\.webmanifest'/);
  assert.ok(Number(sw.match(/const VERSION = 'rb-shell-(\d+)'/)[1]) >= 55);
});

// ---------- the share route ----------

test('share: a text with the link inside opens R1\'s « Add a video » sheet prefilled, Add focused, the address cleaned', async () => {
  const {page, history} = await shared(q({title: 'Reel', text: `Check this out! ${REEL}?igsh=abc. So good`}));
  assert.equal(page.element('home').hidden, false);
  assert.equal(page.element('add-dlg').open, true, 'R1\'s bottom sheet, not an inline form');
  assert.equal(page.element('sheet-new').hidden, false);
  assert.equal(page.element('f-url').value, REEL + '?igsh=abc');
  assert.equal(page.storage.get('rb.draft'), REEL + '?igsh=abc', 'kept like a pasted link');
  assert.equal(page.element('f-err').hidden, true);
  assert.equal(page.focused.at(-1), 'f-submit');
  assert.deepEqual(history.calls, ['/reelbook/'], 'a reload does not share again');
  assert.equal(page.clients[0].calls.filter(c => c[1] === 'requests').length, 0, 'nothing is sent without the tap');
});

test('share: url only, and a link in the title when text and url hold none', async () => {
  const one = await shared(q({url: 'https://youtu.be/abc123'}));
  assert.equal(one.page.element('add-dlg').open, true);
  assert.equal(one.page.element('f-url').value, 'https://youtu.be/abc123');
  assert.equal(one.page.focused.at(-1), 'f-submit');
  const two = await shared(q({title: `Watch ${REEL}`, text: 'no link here', url: 'https://example.com/a'}));
  assert.equal(two.page.element('f-url').value, REEL, 'an unsupported url is skipped for the supported one');
});

test('share: no supported link says so, the field empty and focused; nothing saved', async () => {
  const {page, history} = await shared(q({text: 'A great article https://example.com/post'}));
  assert.equal(page.element('add-dlg').open, true);
  assert.equal(page.location.hash, '', 'a new account that shares stays home, not #welcome');
  assert.equal(page.element('sheet-new').hidden, false);
  assert.equal(page.element('f-url').value, '');
  assert.equal(page.element('f-err').hidden, false);
  assert.match(page.element('f-err').textContent, /holds no Instagram, TikTok, YouTube or Facebook link/);
  assert.equal(page.storage.get('rb.draft'), undefined);
  assert.equal(page.focused.at(-1), 'f-url');
  assert.deepEqual(history.calls, ['/reelbook/']);
});

test('share: Add sends the shared link as a typed one, the sheet closes and the band does +1', async () => {
  const t = tables();
  const {page} = await shared(q({text: REEL}), {tables: t});
  assert.equal(page.element('otw-band').hidden, true, 'nothing on the way before the tap');
  t.requests.unshift({id: 'r1', url: REEL, status: 'queued', note: null, created_at: fresh(), processed_at: null}); // what the insert writes
  await page.element('sheet-new').listeners.submit({preventDefault() {}});
  await settle();
  const inserts = page.clients[0].calls.filter(c => c[0] === 'insert' && c[1] === 'requests');
  assert.deepEqual(inserts.map(c => JSON.stringify(c[2])), [JSON.stringify({url: REEL})]);
  assert.equal(page.storage.get('rb.draft'), undefined);
  assert.equal(page.element('sheet-new').hidden, true);
  assert.equal(page.element('add-dlg').open, false, 'R1: the sheet closes');
  assert.equal(page.element('otw-band').hidden, false, 'R1: the band shows the shared link');
  assert.match(page.element('otw-band').innerHTML, /<span class="cnt bump">1 on the way/, 'the +1, as for any add');
});

test('share: no supported link replaces an older draft: the field empty, the draft cleared, Add sends nothing old', async () => {
  const {page} = await shared(q({text: 'A great article https://example.com/post'}), {stored: {'rb.draft': 'https://youtu.be/old'}});
  assert.equal(page.element('add-dlg').open, true);
  assert.equal(page.element('f-url').value, '', 'not the older link, under « holds no link »');
  assert.equal(page.storage.get('rb.draft'), undefined);
  assert.match(page.element('f-err').textContent, /holds no Instagram, TikTok, YouTube or Facebook link/);
  await page.element('sheet-new').listeners.submit({preventDefault() {}}); await settle();
  assert.equal(page.clients[0].calls.filter(c => c[0] === 'insert' && c[1] === 'requests').length, 0);
});

test('share: a link replaces an older draft', async () => {
  const {page} = await shared(q({url: REEL}), {stored: {'rb.draft': 'https://youtu.be/old'}});
  assert.equal(page.element('f-url').value, REEL);
  assert.equal(page.storage.get('rb.draft'), REEL);
  assert.equal(page.element('f-err').hidden, true, 'not « This link is not added yet. »');
  assert.equal(page.focused.at(-1), 'f-submit');
});

test('the app shortcut ./?add with an older draft opens the empty form it promises, the draft cleared', async () => {
  const {page} = await shared('add', {stored: {'rb.draft': 'https://youtu.be/old'}, tables: tables([SHEET])});
  assert.equal(page.element('add-dlg').open, true);
  assert.equal(page.element('f-url').value, '');
  assert.equal(page.storage.get('rb.draft'), undefined);
  assert.equal(page.element('f-err').hidden, true);
  assert.equal(page.focused.at(-1), 'f-url');
});

test('the app shortcut ./?add opens an empty « Add a video », the field focused', async () => {
  const {page, history} = await shared('add');
  assert.equal(page.element('add-dlg').open, true);
  assert.equal(page.location.hash, '', 'a new account that shares stays home, not #welcome');
  assert.equal(page.element('sheet-new').hidden, false);
  assert.equal(page.element('f-err').hidden, true);
  assert.equal(page.focused.at(-1), 'f-url');
  assert.deepEqual(history.calls, ['/reelbook/']);
});

test('no share query: the home page as before, the form closed', async () => {
  const page = await app({remembered: {mode: 'hosted'}, sessions: {[hostedUrl]: user()}, tables: tables([SHEET]), href: BASE + '?demo-less=1', nav: {userAgent: ANDROID}});
  await settle();
  assert.equal(page.element('sheet-new').hidden, true);
  assert.notEqual(page.element('add-dlg').open, true);
  assert.equal(page.focused.includes('f-submit'), false);
});

// ---------- signed out: the link waits for the sign-in ----------

test('signed out: the shared link is kept, and after sign-in the form opens with it, not #welcome', async () => {
  const {page} = await shared(q({text: `see ${REEL}`}), {signedIn: false});
  assert.equal(page.element('auth').hidden, false, 'the sign-in screen first');
  assert.equal(page.storage.get('rb.draft'), REEL);
  assert.equal(page.focused.includes('f-submit'), false, 'not focused behind the sign-in screen');
  assert.notEqual(page.element('add-dlg').open, true, 'no sheet in front of the sign-in screen');
  page.clients[0].authListener('SIGNED_IN', {user: user()});
  await settle();
  assert.equal(page.location.hash, '', 'a new account with no sheet stays home: its link is waiting');
  assert.equal(page.element('home').hidden, false);
  assert.equal(page.element('add-dlg').open, true);
  assert.equal(page.element('sheet-new').hidden, false);
  assert.equal(page.element('f-url').value, REEL);
  assert.equal(page.focused.at(-1), 'f-submit');
});

// A link kept from an earlier launch on an account with no sheet first waits for #welcome (R1's rule, tested in
// navigation.test.cjs); with a sheet, the home page opens its sheet at once.
test('signed out on a killed PWA: the next start finds the link (rb.draft), as for a typed one', async () => {
  const page = await app({remembered: {mode: 'hosted'}, sessions: {[hostedUrl]: user()}, stored: {'rb.draft': REEL}, tables: tables([SHEET]), nav: {userAgent: ANDROID}});
  await settle();
  assert.equal(page.location.hash, '');
  assert.equal(page.element('f-url').value, REEL);
  assert.equal(page.element('sheet-new').hidden, false);
  assert.equal(page.element('add-dlg').open, true);
});

// ---------- #welcome and the install card, per platform ----------

const welcome = async nav => {
  const page = await app({remembered: {mode: 'hosted'}, sessions: {[hostedUrl]: user()}, tables: tables(), hash: '#welcome', nav});
  await settle();
  return page.element('w-steps').innerHTML.split('<li ').slice(1)[1];
};

test('#welcome on Android: install, then share; no iPhone shortcut', async () => {
  const step = await welcome({userAgent: ANDROID, maxTouchPoints: 5});
  assert.match(step, /Install the app, then share any reel to Reelbook\./);
  assert.match(step, /Share › Reelbook/);
  assert.doesNotMatch(step, /shortcut|iPhone/i);
  assert.doesNotMatch(step, /data-w="shortcut"/);
});

test('#welcome on Android: Install the app once the browser offers it, and it calls prompt()', async () => {
  const page = await app({remembered: {mode: 'hosted'}, sessions: {[hostedUrl]: user()}, tables: tables(), hash: '#welcome', nav: {userAgent: ANDROID, maxTouchPoints: 5}});
  await settle();
  assert.doesNotMatch(page.element('w-steps').innerHTML, /data-w="install"/, 'no button before the browser offers it');
  const ev = {prompted: 0, preventDefault() {}, async prompt() { ev.prompted++; }, userChoice: Promise.resolve({outcome: 'accepted'})};
  await page.win('beforeinstallprompt', ev);
  assert.match(page.element('w-steps').innerHTML, /data-w="install"[^>]*>Install the app</);
  const btn = {dataset: {w: 'install'}};
  await page.element('welcome').listeners.click({target: {closest: s => s === '[data-w]' ? btn : null}});
  await settle();
  assert.equal(ev.prompted, 1);
  assert.doesNotMatch(page.element('w-steps').innerHTML, /data-w="install"/, 'a prompt is used once');
});

test('#welcome on an iPhone: the shortcut, and no Android line', async () => {
  const step = await welcome({userAgent: IPHONE, maxTouchPoints: 5});
  assert.match(step, /Add the “Add to Reelbook” shortcut to the iPhone Share menu\./);
  assert.match(step, /data-w="shortcut"/);
  assert.doesNotMatch(step, /Android/);
});

test('#welcome on a computer: it does not know the phone, both lines', async () => {
  const step = await welcome({userAgent: MAC, maxTouchPoints: 0});
  assert.match(step, /On an iPhone, add the “Add to Reelbook” shortcut/);
  assert.match(step, /On Android, install the app, then share any reel to Reelbook/);
});

test('#welcome, first sheet done: Android says share, the iPhone says the shortcut', async () => {
  const done = async ua => {
    const page = await app({remembered: {mode: 'hosted'}, sessions: {[hostedUrl]: user()}, tables: tables([SHEET]), hash: '#welcome', nav: {userAgent: ua, maxTouchPoints: 5}});
    await settle();
    return page.element('w-steps').innerHTML.split('<li ').slice(1)[2];
  };
  assert.match(await done(ANDROID), /or share a reel to Reelbook/);
  assert.match(await done(IPHONE), /or the shortcut/);
});

test('install card: Android says install, then share; a computer keeps its line', async () => {
  const card = async ua => {
    const page = await app({remembered: {mode: 'hosted'}, sessions: {[hostedUrl]: user()}, tables: tables([SHEET]), nav: {userAgent: ua}, stored: {'rb.seen.u1': '["first-sheet"]'}}); // P8 R4: a sheet was opened
    await settle();
    await page.win('beforeinstallprompt', {preventDefault() {}, async prompt() {}, userChoice: Promise.resolve({})});
    return page.element('install-card').innerHTML;
  };
  assert.match(await card(ANDROID), /<p>Install the app, then share any reel to Reelbook\.<\/p>/);
  const pc = await card('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');
  assert.match(pc, /Install Reelbook on this device: it opens full screen, like an app\./);
  assert.doesNotMatch(pc, /share any reel/);
});

// ---------- the iPhone shortcut's iCloud link ----------

// R9's harness convention: `source` changes the app's script before it runs.
const withIcloud = url => src => {
  const from = "const SHORTCUT_ICLOUD_URL = '';";
  assert.equal(src.split(from).length, 2, 'the constant is in the script once, empty');
  return src.replace(from, `const SHORTCUT_ICLOUD_URL = '${url}';`);
};
const settings = async ({source = null, remembered = {mode: 'hosted'}, url = hostedUrl, clipboard = null, globals = {}} = {}) => {
  const writes = [];
  const nav = {userAgent: IPHONE, maxTouchPoints: 5, clipboard: clipboard || {async writeText(t) { writes.push(t); }}};
  const page = await app({remembered, sessions: {[url]: user()}, tables: tables([SHEET]), hash: '#settings', nav, source, globals});
  await settle();
  return {page, writes};
};
const keyMade = page => page.clients[0].calls.filter(c => c[0] === 'insert' && c[1] === 'capture_tokens');

test('iCloud link empty (today): « Create a key », the steps open, no copy and no navigation', async () => {
  const {page, writes} = await settings();
  assert.equal(page.element('shortcut-section').hidden, false);
  assert.equal(page.element('shortcut-create').textContent, 'Create a key');
  assert.equal(page.element('shortcut-diy').open, true);
  assert.equal(page.element('shortcut-diy-sum').hidden, true, 'no « Build it yourself » fold');
  await page.fire('shortcut-create'); await settle();
  assert.equal(keyMade(page).length, 1);
  assert.match(page.element('shortcut-token').textContent, /^Bearer rb_[0-9a-f]{64}$/);
  assert.equal(page.element('shortcut-add').hidden, true);
  assert.deepEqual(writes, []);
  assert.equal(page.location.href, BASE);
});

test('iCloud link set: « Add the shortcut » makes the key, copies it, then opens the link; the steps fold', async () => {
  const {page, writes} = await settings({source: withIcloud(ICLOUD)});
  assert.equal(page.element('shortcut-create').textContent, 'Add the shortcut');
  assert.equal(page.element('shortcut-diy').open, false);
  assert.equal(page.element('shortcut-diy-sum').hidden, false);
  await page.fire('shortcut-create'); await settle();
  assert.equal(keyMade(page).length, 1);
  const key = page.element('shortcut-token').textContent;
  assert.match(key, /^Bearer rb_[0-9a-f]{64}$/);
  assert.deepEqual(writes, [key], 'the key, as the shortcut\'s header takes it');
  assert.equal(page.location.href, ICLOUD);
  assert.equal(page.element('shortcut-icloud').textContent, 'Key copied (it starts with « Bearer »). Paste it as copied when the shortcut asks for it.'); // R15
});

test('iCloud link set: the key on screen has its own « Add the shortcut » (copy, then open)', async () => {
  const {page, writes} = await settings({source: withIcloud(ICLOUD)});
  await page.fire('shortcut-create'); await settle();
  assert.equal(page.element('shortcut-add').hidden, false);
  page.location.href = BASE; writes.length = 0;
  await page.fire('shortcut-add'); await settle();
  assert.deepEqual(writes, [page.element('shortcut-token').textContent]);
  assert.equal(page.location.href, ICLOUD);
  assert.equal(keyMade(page).length, 1, 'no second key');
});

test('iCloud link set, the copy refused: no navigation, the key stays with the link to open by hand', async () => {
  const {page} = await settings({source: withIcloud(ICLOUD), clipboard: {async writeText() { throw new Error('NotAllowedError'); }}});
  await page.fire('shortcut-create'); await settle();
  assert.equal(page.location.href, BASE, 'the key is shown once: the page stays');
  assert.equal(page.element('shortcut-new').hidden, false);
  assert.match(page.element('shortcut-icloud').innerHTML, new RegExp(`^Copy the key above \\(it starts with « Bearer »\\), then <a href="${ICLOUD}" target="_blank" rel="noopener">open the shortcut ↗</a> and paste it as copied when it asks for the key\\.$`)); // R15
});

test('iCloud link set, the key not saved: nothing copied, no navigation', async () => {
  const {page, writes} = await settings({source: withIcloud(ICLOUD)});
  page.clients[0].from = () => { const q = new Proxy({}, {get: (_, k) => k === 'then' ? ok => ok({data: null, error: {code: '500'}}) : () => q}); return q; };
  await page.fire('shortcut-create'); await settle();
  assert.deepEqual(writes, []);
  assert.equal(page.location.href, BASE);
  assert.equal(page.element('shortcut-err').hidden, false);
});

// Safari: the copy starts inside the tap, with a ClipboardItem given a promise of the key (written once the insert
// answers). A fake ClipboardItem keeps what it was given; clipboard.write awaits it, as Safari does.
class SafariItem { constructor(data) { this.data = data; } }
const safari = ({refuse = false} = {}) => {
  const log = {items: [], copied: [], texts: []};
  return {log, clipboard: {
    async write(items) {
      log.items.push(items[0].data['text/plain']);
      const blob = await items[0].data['text/plain'];
      if (refuse) throw new Error('NotAllowedError');
      log.copied.push(await blob.text());
    },
    async writeText(t) { if (refuse) throw new Error('NotAllowedError'); log.texts.push(t); }
  }};
};
const SAFARI = {ClipboardItem: SafariItem, Blob};

test('iCloud link set, Safari: the copy starts in the tap with a promise of the key, then the link opens', async () => {
  const {log, clipboard} = safari();
  const {page} = await settings({source: withIcloud(ICLOUD), clipboard, globals: SAFARI});
  await page.fire('shortcut-create'); await settle();
  assert.equal(log.items.length, 1);
  assert.equal(typeof log.items[0].then, 'function', 'a promise, not the text: the write starts before the key exists');
  const key = page.element('shortcut-token').textContent;
  assert.match(key, /^Bearer rb_[0-9a-f]{64}$/);
  assert.deepEqual(log.copied, [key]);
  assert.deepEqual(log.texts, [], 'no second copy by writeText');
  assert.equal(keyMade(page).length, 1);
  assert.equal(page.location.href, ICLOUD);
});

test('iCloud link set, Safari, the key not saved: the write fails, nothing copied, no navigation', async () => {
  const {log, clipboard} = safari();
  const {page} = await settings({source: withIcloud(ICLOUD), clipboard, globals: SAFARI});
  page.clients[0].from = () => { const q = new Proxy({}, {get: (_, k) => k === 'then' ? ok => ok({data: null, error: {code: '500'}}) : () => q}); return q; };
  await page.fire('shortcut-create'); await settle();
  assert.equal(log.items.length, 1, 'the write was started in the tap');
  assert.deepEqual(log.copied, []);
  assert.deepEqual(log.texts, []);
  assert.equal(page.location.href, BASE);
  assert.equal(page.element('shortcut-err').hidden, false);
});

test('iCloud link set, Safari, the copy refused: no navigation, the key stays with the link to open by hand', async () => {
  const {log, clipboard} = safari({refuse: true});
  const {page} = await settings({source: withIcloud(ICLOUD), clipboard, globals: SAFARI});
  await page.fire('shortcut-create'); await settle();
  assert.deepEqual(log.copied, []);
  assert.equal(page.location.href, BASE, 'the key is shown once: the page stays');
  assert.match(page.element('shortcut-token').textContent, /^Bearer rb_/);
  assert.match(page.element('shortcut-icloud').innerHTML, /Copy the key above \(it starts with « Bearer »\), then <a href="[^"]+" target="_blank" rel="noopener">open the shortcut/);
});

test('iCloud link set, own Supabase: the published shortcut calls the hosted backend, so the steps stay', async () => {
  const {page} = await settings({source: withIcloud(ICLOUD), remembered: {mode: 'own', url: ownUrl, key: ownKey}, url: ownUrl});
  assert.equal(page.element('shortcut-create').textContent, 'Create a key');
  assert.equal(page.element('shortcut-diy').open, true);
  assert.equal(page.element('shortcut-diy-sum').hidden, true);
});
