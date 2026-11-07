// L43: the page #welcome (mockup docs/audit-design/mockups/p7-signup.html, states welcome*): one test per state and per
// detection. Never shown as done what the app does not know. The app runs in the vm of tests/harness.cjs, so these
// tests also hold the guards: no landing.js, no matchMedia, no navigator.share, no navigator.clipboard, no getUser.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {app, hostedUrl, ownUrl, ownKey} = require('./harness.cjs');

const ROOT = path.join(__dirname, '..');
const landingJs = fs.readFileSync(path.join(ROOT, 'app/landing.js'), 'utf8');
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve)); };

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAC = IPAD;
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const phone = {userAgent: IPHONE, maxTouchPoints: 5};
const computer = {userAgent: MAC, maxTouchPoints: 0};
const standalone = {matchMedia: q => ({matches: /display-mode: standalone/.test(q)})};

const fresh = () => new Date(Date.now() - 60 * 1000).toISOString();
const user = extra => ({id: 'u1', email: 'camille@example.com', created_at: fresh(), ...extra});
const SHEET = {slug: 'first-sheet', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'First sheet', summary: 'A move.', exercises: []};
const tablesWith = (sheets = [], requests = []) => ({user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}], sheets, sessions: [], requests});
const open = async ({as = user(), sheets = [], requests = [], nav = phone, ...options} = {}) => {
  const page = await app({remembered: {mode: 'hosted'}, sessions: {[hostedUrl]: as}, tables: options.tables || tablesWith(sheets, requests), hash: '#welcome', nav, ...options});
  await settle();
  return page;
};
const stepsOf = page => page.element('w-steps').innerHTML.split('<li ').slice(1);
const classOf = step => step.match(/^class="([^"]*)"/)[1];
const chipOf = step => step.match(/<span class="chip">([^<]*)</)[1];
const clickW = async (page, what) => {
  const btn = {dataset: {w: what}, textContent: ''};
  await page.element('welcome').listeners.click({target: {closest: s => s === '[data-w]' ? btn : null}});
  await settle();
  return btn;
};
const tick = async page => { await page.element('welcome').listeners.change({target: {id: 'w-tick', checked: true}}); await settle(); };
const rbl = (language = 'en-GB', saved = null) => {
  const window = {localStorage: {getItem: k => k === 'rb.lang' ? saved : null, setItem() {}}, navigator: {language}};
  vm.runInNewContext(landingJs, {window, console});
  return window.RBL;
};

// ---------- the states of the mockup ----------

test('welcome: a brand-new account on a phone, first arrival: the banner, three steps, the computer step first', async () => {
  const page = await open();
  assert.equal(page.element('welcome').hidden, false);
  assert.equal(page.element('w-flash').hidden, false);
  assert.equal(page.element('w-flash').innerHTML, 'Account created for <b>camille@example.com</b>.');
  assert.equal(page.element('w-h1').textContent, 'Three more steps. You only do this once.');
  const [s1, s2, s3] = stepsOf(page);
  assert.equal(classOf(s1), 'now'); assert.equal(classOf(s2), ''); assert.equal(classOf(s3), '');
  assert.ok([s1, s2, s3].every(s => chipOf(s) === 'To do'));
  assert.match(s1, /can’t be done on a phone/, 'it says why');
  assert.match(s1, /data-w="send"[^>]*>Send myself the line</);
  assert.match(s1, /README|what-you-need/, 'the prerequisites are linked');
  assert.doesNotMatch(s1, /<pre|curl|data-w="copy"|data-w="os"/, 'on a phone: neither line nor system');
  assert.match(s2, /class="btn ghost sm"[^>]*data-w="shortcut"/, 'not the main action yet');
  assert.match(s2, /id="w-tick"/);
  assert.match(s3, /<b>\+ Add a video<\/b>/);
  assert.equal(page.element('w-done').className, 'btn ghost');
});

test('welcome: an empty account arriving at the bare address lands here, with the banner', async () => {
  const page = await open({hash: ''});
  assert.equal(page.location.hash, '#welcome');
  assert.equal(page.element('welcome').hidden, false);
  assert.equal(page.element('w-flash').hidden, false);
});

test('welcome: the banner comes once, only for an account just made, and leaves with the first step done', async () => {
  // second arrival
  let page = await open({stored: {'rb.welcome.seen.u1': '1'}});
  assert.equal(page.element('w-flash').hidden, true);
  // the first arrival writes it, and a way back to the page in the same visit does not show it again
  page = await open();
  assert.equal(page.storage.get('rb.welcome.seen.u1'), '1');
  page.go('#settings'); await settle();
  page.go('#welcome'); await settle();
  assert.equal(page.element('w-flash').hidden, true);
  // a device that already went through the old page
  page = await open({stored: {'rb.welcome.u1': '1'}});
  assert.equal(page.element('w-flash').hidden, true);
  // an old account on a new device, an account without a date: nothing is claimed
  page = await open({as: user({created_at: '2026-01-01T00:00:00Z'})});
  assert.equal(page.element('w-flash').hidden, true);
  page = await open({as: {id: 'u1', email: 'a@example.test'}});
  assert.equal(page.element('w-flash').hidden, true);
  // an account with a sheet was not just made
  page = await open({sheets: [SHEET]});
  assert.equal(page.element('w-flash').hidden, true);
  // the address is escaped
  page = await open({as: user({email: 'a<b@example.test'})});
  assert.match(page.element('w-flash').innerHTML, /a&lt;b@example\.test/);
});

test('welcome-sent: the share sheet takes the line, step 1 waits for the computer, the main action moves to the phone', async () => {
  const shared = [];
  const page = await open({nav: {...phone, share: async d => { shared.push(d); }}});
  await clickW(page, 'send');
  assert.equal(shared.length, 1);
  assert.match(shared[0].text, /curl -fsSL .*install\.sh/);
  assert.match(shared[0].text, /install\.ps1/);
  const [s1, s2] = stepsOf(page);
  assert.equal(classOf(s1), '', 'not done: only rb.py login proves it');
  assert.equal(chipOf(s1), 'Sent');
  assert.match(s1, /Line sent\. Paste it into Terminal.*this step will tick itself.*<b>Settings<\/b>/);
  assert.doesNotMatch(s1, /camille@/, 'the app does not know who the line went to');
  assert.equal(classOf(s2), 'now');
  assert.match(s2, /class="btn"[^>]*data-w="shortcut"/, 'the main action');
  assert.equal(page.element('w-h1').textContent, 'Three more steps. You only do this once.');
  assert.equal(page.storage.get('rb.welcome.sent.u1'), 'shared');
});

test('welcome-sent: closing the share sheet changes nothing', async () => {
  const page = await open({nav: {...phone, share: async () => { throw Object.assign(new Error('closed'), {name: 'AbortError'}); }, clipboard: {writeText: async () => assert.fail('no copy after a closed share')}}});
  await clickW(page, 'send');
  assert.equal(classOf(stepsOf(page)[0]), 'now');
  assert.equal(page.storage.get('rb.welcome.sent.u1'), undefined);
});

test('welcome-sent: without a share sheet the text is copied, and said so', async () => {
  let copied = '';
  const page = await open({nav: {...phone, clipboard: {writeText: async t => { copied = t; }}}});
  await clickW(page, 'send');
  assert.match(copied, /install\.sh/);
  const [s1, s2] = stepsOf(page);
  assert.equal(chipOf(s1), 'Copied');
  assert.match(s1, /Line copied\. Send it to yourself/);
  assert.equal(classOf(s2), 'now');
});

test('welcome-sent: a share that fails falls back on the copy; neither: the text on screen, step 1 stays the main one', async () => {
  let copied = '';
  let page = await open({nav: {...phone, share: async () => { throw new Error('not allowed'); }, clipboard: {writeText: async t => { copied = t; }}}});
  await clickW(page, 'send');
  assert.match(copied, /install\.sh/);
  page = await open({nav: {...phone}});
  await clickW(page, 'send');
  const [s1] = stepsOf(page);
  assert.equal(classOf(s1), 'now');
  assert.match(s1, /<pre id="w-line">[^<]*install\.sh/);
  assert.match(s1, /role="alert">Sharing and copying did not work/);
});

test('welcome-sent is kept per user: another account on this phone starts over', async () => {
  let page = await open({stored: {'rb.welcome.sent.u1': 'shared'}});
  assert.equal(chipOf(stepsOf(page)[0]), 'Sent');
  page = await open({as: user({id: 'u2'}), stored: {'rb.welcome.sent.u1': 'shared'}});
  assert.equal(chipOf(stepsOf(page)[0]), 'To do');
});

test('welcome-desk: on a computer the line to copy, the system detected, the other system, the phone step without a send', async () => {
  const page = await open({nav: computer, href: 'https://lt20.github.io/reelbook/#welcome'});
  const [s1, s2] = stepsOf(page);
  assert.equal(classOf(s1), 'now');
  assert.match(s1, /Paste this line into Terminal/);
  assert.match(s1, /class="sys">macOS detected</);
  assert.match(s1, /<pre id="w-line">curl -fsSL https:\/\/lt20\.github\.io\/reelbook\/install\.sh \| bash<\/pre>/);
  assert.match(s1, /data-w="copy"[^>]*>Copy the line</);
  assert.match(s1, /data-w="os"[^>]*>On Windows\? PowerShell</);
  assert.match(s1, /blob\/main\/app\/install\.sh[^>]*>Read the script first/);
  assert.match(s1, /#what-you-need[^>]*>What you need/);
  assert.doesNotMatch(s1, /data-w="send"/);
  assert.doesNotMatch(s2, /data-w="shortcut"/, 'the mockup: no shortcut button on a computer');
  assert.match(s2, /Open Reelbook on your phone/);
  assert.match(s2, /id="w-tick"/);
});

test('welcome-desk: the other system on a tap; Windows and Linux detected; a system not recognised claims none', async () => {
  let page = await open({nav: computer});
  await clickW(page, 'os');
  let s1 = stepsOf(page)[0];
  assert.match(s1, /Paste this line into PowerShell/);
  assert.match(s1, /<pre id="w-line">[^<]*install\.ps1/);
  assert.match(s1, /data-w="os"[^>]*>On a Mac or Linux\? Terminal</);
  assert.match(s1, /blob\/main\/app\/install\.ps1/);
  assert.doesNotMatch(s1, /class="sys"/, 'the system shown is not the one detected');
  await clickW(page, 'os');
  assert.match(stepsOf(page)[0], /macOS detected/);

  page = await open({nav: {userAgent: WINDOWS}});
  s1 = stepsOf(page)[0];
  assert.match(s1, /class="sys">Windows detected</);
  assert.match(s1, /PowerShell: it installs/);
  assert.match(s1, /<pre id="w-line">[^<]*install\.ps1/);

  page = await open({nav: {userAgent: LINUX}});
  assert.match(stepsOf(page)[0], /class="sys">Linux detected</);

  page = await open({nav: {userAgent: 'SomeBrowser/1.0'}});
  s1 = stepsOf(page)[0];
  assert.doesNotMatch(s1, /class="sys"/);
  assert.match(s1, /<pre id="w-line">/);

  page = await open({nav: {userAgentData: {platform: 'Windows', mobile: false}, userAgent: LINUX}});
  assert.match(stepsOf(page)[0], /Windows detected/, 'userAgentData first');
});

test('welcome: a phone or a tablet has no terminal (iPad asking for the desktop site, Android tablet, userAgentData)', async () => {
  for (const nav of [{userAgent: IPAD, maxTouchPoints: 5}, {userAgent: ANDROID_TABLET}, {userAgentData: {mobile: true, platform: 'Android'}, userAgent: LINUX}]) {
    const page = await open({nav});
    const s1 = stepsOf(page)[0];
    assert.match(s1, /data-w="send"/);
    assert.doesNotMatch(s1, /<pre/);
  }
});

test('welcome-desk: « Copy the line » copies the line; refused, it says to copy by hand', async () => {
  let copied = '';
  let page = await open({nav: {...computer, clipboard: {writeText: async t => { copied = t; }}}});
  page.element('w-line').textContent = 'the line';
  let btn = await clickW(page, 'copy');
  assert.equal(copied, 'the line');
  assert.equal(btn.textContent, 'Copy the line', 'the label comes back');
  page = await open({nav: computer});
  await clickW(page, 'copy');
  assert.equal(page.element('w-copymsg').hidden, false);
  assert.match(page.element('w-copymsg').textContent, /copy it by hand/);
});

test('welcome-desk: the QR only on the hosted address, a file of the shell; elsewhere the address in text alone', async () => {
  let s2 = stepsOf(await open({nav: computer, href: 'https://lt20.github.io/reelbook/#welcome'}))[1];
  assert.match(s2, /<img src="icons\/welcome-qr\.svg"[^>]*alt="QR: lt20\.github\.io\/reelbook"/);
  assert.match(s2, /<span>lt20\.github\.io\/reelbook<\/span>/);
  s2 = stepsOf(await open({nav: computer}))[1];
  assert.doesNotMatch(s2, /<img/);
  assert.match(s2, /<span>app\.example\.test\/reelbook<\/span>/);
  const sw = fs.readFileSync(path.join(ROOT, 'app/sw.js'), 'utf8');
  assert.ok(sw.includes("'./icons/welcome-qr.svg'"), 'in SHELL');
  const svg = fs.readFileSync(path.join(ROOT, 'app/icons/welcome-qr.svg'), 'utf8');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 29 29"/);
});

test('welcome-desk: on an own Supabase the line carries its url and key', async () => {
  const page = await app({remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: user()}, tables: tablesWith(), hash: '#welcome', nav: computer});
  await settle();
  assert.match(stepsOf(page)[0], new RegExp(`install\\.sh \\| bash -s -- --url ${ownUrl} --key ${ownKey}`));
});

test('welcome-pc: the computer is known, the title and the main action move on', async () => {
  const page = await open({as: user({user_metadata: {reelbook_cli_at: '2026-11-07T10:00:00Z'}})});
  assert.equal(page.element('w-flash').hidden, true);
  assert.equal(page.element('w-h1').textContent, 'Two steps left');
  const [s1, s2, s3] = stepsOf(page);
  assert.equal(classOf(s1), 'done');
  assert.equal(chipOf(s1), 'Done');
  assert.match(s1, /<span class="n">✓</);
  assert.match(s1, /Linked\. The install line stays in <b>Settings<\/b>\./);
  assert.equal(classOf(s2), 'now'); assert.equal(classOf(s3), '');
  assert.match(s2, /class="btn"[^>]*data-w="shortcut"/);
});

test('welcome-last: the phone ticked too, one step left', async () => {
  const page = await open({as: user({user_metadata: {reelbook_cli_at: '2026-11-07T10:00:00Z'}})});
  await tick(page);
  assert.equal(page.storage.get('rb.welcome.phone.u1'), '1');
  assert.equal(page.element('w-h1').textContent, 'One step left');
  const [, s2, s3] = stepsOf(page);
  assert.equal(classOf(s2), 'done');
  assert.match(s2, /Done on this phone\./);
  assert.equal(classOf(s3), 'now');
});

test('welcome-done: all set, « Open my notebooks » is the action left and leaves for the home page', async () => {
  const page = await open({as: user({user_metadata: {reelbook_cli_at: '2026-11-07T10:00:00Z'}}), sheets: [SHEET], stored: {'rb.welcome.phone.u1': '1'}});
  assert.equal(page.element('w-h1').textContent, 'All set');
  const steps = stepsOf(page);
  assert.ok(steps.every(s => classOf(s) === 'done'));
  assert.match(steps[2], /1 sheet in your notebooks\. From now on: <b>\+ Add a video<\/b> or the shortcut\./);
  assert.equal(page.element('w-done').className, 'btn');
  await page.fire('w-done'); await settle();
  assert.equal(page.storage.get('rb.welcome.u1'), '1');
  assert.equal(page.location.hash, '');
});

// ---------- the detections ----------

test('computer: getUser() on arrival reads reelbook_cli_at, never from inside the auth callback', async () => {
  let calls = 0, inCallback = false, during = 0;
  const getUser = async () => { calls++; if (inCallback) during++; return {data: {user: user({user_metadata: {reelbook_cli_at: '2026-11-07T10:00:00Z'}})}, error: null}; };
  const page = await open({getUser});
  assert.ok(calls >= 1);
  assert.equal(page.element('w-h1').textContent, 'Two steps left');
  // a later auth event, the page on #welcome: route() runs inside the callback, getUser only after it returned
  const client = page.clients.at(-1);
  inCallback = true;
  client.authListener('TOKEN_REFRESHED', {user: user()});
  client.authListener('INITIAL_SESSION', {user: user()});
  inCallback = false;
  await settle();
  assert.equal(during, 0, 'no Supabase call inside onAuthStateChange');
});

test('computer: back on the page (focus, visibility), the step ticks itself after rb.py login', async () => {
  let linked = false, calls = 0;
  const getUser = async () => { calls++; return {data: {user: user(linked ? {user_metadata: {reelbook_cli_at: '2026-11-07T10:00:00Z'}} : {})}, error: null}; };
  let page = await open({getUser, nav: computer});
  assert.equal(classOf(stepsOf(page)[0]), 'now');
  linked = true;
  await page.win('focus'); await settle();
  assert.equal(classOf(stepsOf(page)[0]), 'done');
  assert.equal(page.element('w-h1').textContent, 'Two steps left');

  linked = false;
  page = await open({getUser, nav: computer});
  linked = true;
  await page.doc('visibilitychange', {visibilityState: 'visible'}); await settle();
  assert.equal(classOf(stepsOf(page)[0]), 'done');
});

test('computer: the focus reads nothing away from #welcome, nor on a hidden page', async () => {
  let calls = 0;
  const getUser = async () => { calls++; return {data: {user: user()}, error: null}; };
  const page = await open({getUser, nav: computer});
  await page.doc('visibilitychange', {visibilityState: 'hidden'}); await settle();
  const before = calls;
  await page.win('focus'); await settle();
  assert.equal(calls, before, 'a hidden page');
  await page.doc('visibilitychange', {visibilityState: 'visible'}); await settle();
  page.go('#settings'); await settle();
  const away = calls;
  await page.win('focus'); await settle();
  assert.equal(calls, away, 'another page');
});

test('computer: a failed read changes nothing (offline, an error, no such API)', async () => {
  for (const getUser of [async () => { throw new Error('offline'); }, async () => ({data: {user: null}, error: {message: 'nope'}})]) {
    const page = await open({getUser, nav: computer});
    assert.equal(classOf(stepsOf(page)[0]), 'now');
    await page.win('focus'); await settle();
    assert.equal(classOf(stepsOf(page)[0]), 'now');
  }
  const page = await open({as: user({user_metadata: {reelbook_cli_at: '2026-11-07T10:00:00Z'}}), getUser: async () => { throw new Error('offline'); }});
  assert.equal(classOf(stepsOf(page)[0]), 'done', 'what the session knows stays');
});

test('computer: an answer for another account since is dropped', async () => {
  const page = await open({as: user({id: 'u1'}), getUser: async () => ({data: {user: {id: 'u9', user_metadata: {reelbook_cli_at: 'x'}}}, error: null})});
  assert.equal(classOf(stepsOf(page)[0]), 'now');
});

test('computer: a sheet proves it, without a date', async () => {
  const page = await open({sheets: [SHEET]});
  assert.equal(classOf(stepsOf(page)[0]), 'done');
});

test('computer: a processed request proves it; a video waiting does not', async () => {
  let page = await open({requests: [{id: 'r1', url: 'https://www.youtube.com/watch?v=x', status: 'done', processed_at: '2026-11-07T10:00:00Z', created_at: '2026-11-07T09:00:00Z'}]});
  assert.equal(classOf(stepsOf(page)[0]), 'done', 'done');
  page = await open({requests: [{id: 'r1', url: 'https://www.youtube.com/watch?v=x', status: 'error', note: 'failed', processed_at: '2026-11-07T10:00:00Z', created_at: '2026-11-07T09:00:00Z'}]});
  assert.equal(classOf(stepsOf(page)[0]), 'done', 'error: a computer tried it');
  page = await open({requests: [{id: 'r1', url: 'https://www.youtube.com/watch?v=x', status: 'queued', processed_at: null, created_at: '2026-11-07T09:00:00Z'}]});
  assert.equal(classOf(stepsOf(page)[0]), 'now', 'queued');
});

test('phone: home-screen mode on this phone counts; on a computer it does not (an app window on a Mac is not a phone)', async () => {
  let page = await open({win: standalone});
  let s2 = stepsOf(page)[1];
  assert.equal(classOf(s2), 'done');
  assert.match(s2, /Done on this phone\./);
  assert.equal(page.storage.get('rb.welcome.phone.u1'), undefined, 'known, not ticked');
  page = await open({nav: {userAgent: 'Mozilla/5.0 (iPhone)', standalone: true}});
  assert.equal(classOf(stepsOf(page)[1]), 'done', 'iOS: navigator.standalone');
  page = await open({win: standalone, nav: computer});
  assert.equal(classOf(stepsOf(page)[1]), '');
});

test('phone: not installed, no tick: not done, whatever the rest; the tick is per user (decision 8)', async () => {
  let page = await open({sheets: [SHEET], win: {matchMedia: () => ({matches: false})}});
  assert.equal(classOf(stepsOf(page)[1]), 'now');
  assert.equal(page.element('w-h1').textContent, 'One step left');
  page = await open({stored: {'rb.welcome.phone.u9': '1'}});
  assert.equal(classOf(stepsOf(page)[1]), '');
  page = await open({nav: computer});
  await tick(page);
  const s2 = stepsOf(page)[1];
  assert.equal(classOf(s2), 'done');
  assert.match(s2, /Done on your phone\./, 'on a computer: not « this phone »');
  page = await open({nav: computer});
  await page.element('welcome').listeners.change({target: {id: 'w-tick', checked: false}}); await settle();
  assert.equal(page.storage.get('rb.welcome.phone.u1'), undefined);
});

test('phone: the phone done first, the computer stays the main step', async () => {
  const page = await open({stored: {'rb.welcome.phone.u1': '1'}});
  const [s1, s2, s3] = stepsOf(page);
  assert.equal(classOf(s1), 'now'); assert.equal(classOf(s2), 'done'); assert.equal(classOf(s3), '');
  assert.equal(page.element('w-h1').textContent, 'Two steps left');
  assert.equal(page.element('w-flash').hidden, true);
});

test('first sheet: a sheet exists; none, not done; a sheet arriving while the page is open ticks it on focus', async () => {
  let page = await open({sheets: [SHEET, {...SHEET, slug: 'second'}]});
  const s3 = stepsOf(page)[2];
  assert.equal(classOf(s3), 'done');
  assert.match(s3, /2 sheets in your notebooks\./);
  const tables = tablesWith();
  page = await open({tables});
  assert.equal(classOf(stepsOf(page)[2]), '');
  tables.sheets.push(SHEET);
  await page.win('focus'); await settle();
  assert.equal(classOf(stepsOf(page)[2]), 'done');
  assert.equal(classOf(stepsOf(page)[0]), 'done', 'it proves the computer too');
});

test('the steps are not redrawn when nothing changed (the focus keeps « Copied » and the keyboard’s place)', async () => {
  const page = await open({nav: computer, getUser: async () => ({data: {user: user()}, error: null})});
  page.element('w-steps').innerHTML = 'kept';
  await page.win('focus'); await settle();
  assert.equal(page.element('w-steps').innerHTML, 'kept');
});

test('« Add the shortcut » goes to Settings', async () => {
  const page = await open();
  await clickW(page, 'shortcut');
  assert.equal(page.location.hash, '#settings');
  assert.equal(page.element('settings').hidden, false);
});

// ---------- FR / EN ----------

test('welcome in French: every state from the dictionary, and the switch relabels the page', async () => {
  const RBL = rbl('fr-FR');
  const page = await open({win: {RBL}});
  assert.equal(page.element('w-flash').innerHTML, 'Compte créé pour <b>camille@example.com</b>.');
  assert.equal(page.element('w-h1').textContent, 'Plus que 3 étapes, à faire une seule fois');
  const steps = stepsOf(page);
  assert.match(steps[0], /Ton ordinateur/);
  assert.match(steps[0], /Cette étape ne se fait pas sur un téléphone/);
  assert.match(steps[0], /M’envoyer la ligne/);
  assert.match(steps[1], /Ton téléphone/);
  assert.match(steps[2], /Ta première fiche/);
  assert.equal(chipOf(steps[0]), 'À faire');
  RBL.setLang('en');
  assert.equal(page.element('w-h1').textContent, 'Three more steps. You only do this once.');
  assert.match(stepsOf(page)[0], /Your computer/);
});

test('the titles of the mockup, in both languages', () => {
  const {DICT} = rbl();
  assert.deepEqual(['w.left3', 'w.left2', 'w.left1', 'w.left0'].map(k => DICT.fr[k]), ['Plus que 3 étapes, à faire une seule fois', 'Plus que 2 étapes', 'Plus qu’une étape', 'Tout est en place']);
  assert.deepEqual(['w.left3', 'w.left2', 'w.left1', 'w.left0'].map(k => DICT.en[k]), ['Three more steps. You only do this once.', 'Two steps left', 'One step left', 'All set']);
});

test('the old keys of the page are gone, the new ones come in pairs, every key is used', () => {
  const {DICT} = rbl();
  const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
  for (const k of ['w.h1', 'w.1h', 'w.1p', 'w.2h', 'w.2p', 'w.3h', 'w.3p', 'w.3again', 'w.need', 'w.need1', 'w.need2', 'w.need3', 'w.run', 'w.run1', 'w.run2', 'w.run3', 'w.run4', 'w.copy']) {
    assert.equal(DICT.fr[k], undefined, `fr ${k}`); assert.equal(DICT.en[k], undefined, `en ${k}`);
  }
  const keys = Object.keys(DICT.en).filter(k => k.startsWith('w.'));
  assert.deepEqual(Object.keys(DICT.fr).filter(k => k.startsWith('w.')).sort(), [...keys].sort());
  for (const k of keys) assert.ok(html.includes(`'${k}'`) || html.includes(`"${k}"`), `${k} is used`);
});

test('the markup: « Open my notebooks » right under the steps, the guide closed, the landing’s switch; no duration in the guide', () => {
  const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
  const page = html.slice(html.indexOf('<div id="welcome"'), html.indexOf('<!-- ===== Settings ===== -->'));
  assert.ok(page.indexOf('id="w-steps"') < page.indexOf('id="w-done"') && page.indexOf('id="w-done"') < page.indexOf('<details class="guide"'));
  assert.doesNotMatch(page, /<details[^>]*\bopen\b/);
  assert.match(page, /class="lp-seg lp-lang"/);
  assert.match(landingJs, /all\('#welcome \.lp-lang button'\)/);
  assert.doesNotMatch(page.replace(/<[^>]*>/g, ' '), /minutes|every night at|\b\d{1,2}\s?h\b/);
});
