// L27: the demo notebook (#demo) — regression tests written with the lot (the acceptance tests are in
// tests/acceptance/l27/). The demo reads only app/demo/ files, creates no Supabase client and writes nothing.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {app, hostedUrl} = require('./harness.cjs');

const demoDir = path.join(__dirname, '../app/demo');
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve)); };
// A fetch serving app/demo/ (or `over`: path -> body), journalling every URL asked.
const files = (over = {}) => {
  const asked = [];
  const fetch = async url => {
    asked.push(url);
    const rel = String(url).replace(/^demo\//, '');
    const body = rel in over ? over[rel] : (() => { try { return fs.readFileSync(path.join(demoDir, rel), 'utf8'); } catch { return null; } })();
    return body === null ? {ok: false, status: 404} : {ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body};
  };
  return {fetch, asked};
};
const click = (page, id) => page.element('demo').listeners.click({preventDefault() {}, target: {closest: sel => sel === '#' + id ? {} : null}});

test('L27 — the demo home lists the sheets and the session from catalogue.json, all inside the demo', async () => {
  const {fetch, asked} = files(), posted = [];
  const serviceWorker = {register: async () => ({}), ready: Promise.resolve({active: {postMessage: m => posted.push(m)}})};
  const page = await app({hash: '#demo', tables: {}, fetch, nav: {serviceWorker}});
  await settle();
  const html = page.element('demo').innerHTML;
  const cat = JSON.parse(fs.readFileSync(path.join(demoDir, 'catalogue.json'), 'utf8'));
  // L38: the home page shows the notebooks (.tcard) and the session; each sheet is on its notebook's page
  for (const t of cat.notebooks) assert.match(html, new RegExp(`class="tcard" href="#demo/notebook/${t.id}"`), t.id);
  for (const s of cat.sessions) assert.match(html, new RegExp(`href="#demo/session/${s.slug}"`), s.slug);
  for (const t of cat.notebooks) {
    page.go(`#demo/notebook/${t.id}`); await settle();
    for (const e of cat.sheets.filter(x => x.notebook === t.id)) assert.match(page.element('demo').innerHTML, new RegExp(`href="#demo/${e.slug}"`), e.slug);
  }
  assert.match(html, /src="demo\/goblet-squat\/img\/thumb\.svg"/);
  assert.ok(asked.length > 1 && asked.every(u => u.startsWith('demo/')), 'only the demo files are fetched');
  // the first visit hands the service worker every demo file to keep (sw.js, KEEP_DEMO), absolute URLs
  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, 'KEEP_DEMO');
  const base = 'https://app.example.test/reelbook/demo/';
  assert.ok(posted[0].urls.includes(base + 'catalogue.json'));
  for (const e of cat.sheets) assert.ok(posted[0].urls.includes(`${base}${e.slug}/index.html`), e.slug);
  assert.ok(posted[0].urls.includes(base + 'water-start/img/04-pulled.svg'));
  assert.ok(posted[0].urls.every(u => u.startsWith(base)));
  assert.equal(page.clients.length, 0);
});

test('L27 — browsing the demo writes nothing to localStorage and creates no client', async () => {
  const {fetch} = files();
  const stored = {'rb.backend': JSON.stringify({mode: 'hosted'}), 'rb.seen.u1': '["a"]', 'rb.wake': '1'};
  const page = await app({hash: '#demo', tables: {}, fetch, stored});
  await settle();
  const before = JSON.stringify([...page.storage]);
  for (const h of ['#demo/session/ten-minute-circuit', '#demo/goblet-squat', '#demo/nope', '#demo']) { page.go(h); await settle(); }
  assert.equal(JSON.stringify([...page.storage]), before);
  assert.equal(page.clients.length, 0);
});

test('L27 — the demo session lists its exercises with their dose, in order', async () => {
  const {fetch} = files();
  const page = await app({hash: '#demo/session/ten-minute-circuit', tables: {}, fetch});
  await settle();
  const html = page.element('demo').innerHTML;
  assert.match(html, /Ten-minute circuit/);
  assert.match(html, /Demo · read only · Create an account/);
  // L38: each exercise opens at its place in the session (#demo/session/<slug>/<n>), as in the app
  const order = [...html.matchAll(/href="#demo\/session\/ten-minute-circuit\/(\d+)"[\s\S]*?<h3>([^<]+)<\/h3>/g)].map(m => m[1] + ' ' + m[2]);
  assert.deepEqual(order, ['1 Goblet squat', '2 Push-up', '3 Dead bug']);
  assert.match(html, />10 reps</);
  assert.match(html, /href="#demo">‹ Demo</);
});

test('L27 — Create an account from the demo opens sign-up; leaving starts the remembered backend', async () => {
  const {fetch} = files();
  const page = await app({hash: '#demo', tables: {}, fetch});
  await settle();
  click(page, 'demo-signup');
  await settle();
  assert.equal(page.element('demo').hidden, true);
  assert.equal(page.element('setup').hidden, false);
  assert.equal(page.clients.length, 1, 'outside the demo, the backend starts as usual');
});

test('L25 + L27 — demo, Create an account, then « Sign in » opens the sign-in form, not the presentation', async () => {
  const {fetch} = files();
  const page = await app({hash: '#demo', tables: {}, fetch});
  await settle();
  click(page, 'demo-signup');
  await settle();
  assert.equal(page.element('setup').hidden, false);
  await page.fire('setup-signin');
  await settle();
  assert.equal(page.element('auth').hidden, false);
  assert.equal(page.element('intro').hidden, true);
  assert.equal(page.element('auth-form').hidden, false);
  assert.equal(page.element('auth-title').textContent, 'Sign in');
});

test('L27 — with an account kept on this device, the banner leads back to its notebooks', async () => {
  const {fetch} = files();
  const stored = {['rb.auth.' + hostedUrl.replace(/\W/g, '')]: JSON.stringify({user: {id: 'u1'}}), 'rb.backend': JSON.stringify({mode: 'hosted'})};
  const page = await app({hash: '#demo', tables: {}, fetch, stored, sessions: {[hostedUrl]: {id: 'u1'}}});
  await settle();
  assert.match(page.element('demo').innerHTML, /Demo · read only · Back to my notebooks/);
  assert.equal(page.element('demo').hidden, false);
  // the account's own backend starts as without the demo; the demo itself writes nothing to it
  assert.equal(page.clients.length, 1);
  assert.equal(page.clients[0].calls.length, 0);
  click(page, 'demo-signup');
  await settle();
  // the account's home page, already loaded behind the demo
  for (const v of ['demo', 'auth', 'setup']) assert.equal(page.element(v).hidden, true, v);
  assert.equal(page.element('home').hidden, false);
  assert.equal(page.clients.length, 1);
});

test('L27 — an account\'s own sheet « demo » keeps #demo; the other demo pages stay the demo', async () => {
  const {fetch} = files();
  const tables = {
    user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
    sheets: [{slug: 'demo', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Demo', summary: '', html: '<h1>Demo</h1>', exercises: []}],
    sessions: [], requests: [], notes: []
  };
  const stored = {['rb.auth.' + hostedUrl.replace(/\W/g, '')]: JSON.stringify({user: {id: 'u1'}}), 'rb.backend': JSON.stringify({mode: 'hosted'})};
  const page = await app({hash: '#demo', tables, fetch, stored, sessions: {[hostedUrl]: {id: 'u1'}}, dom: true});
  await settle();
  assert.equal(page.element('demo').hidden, true);
  assert.equal(page.element('view').hidden, false);
  assert.match(page.element('view').innerHTML, /<h1>Demo<\/h1>/);
  page.go('#demo/session/ten-minute-circuit'); await settle();
  assert.equal(page.element('demo').hidden, false);
  page.go('#demo'); await settle();
  assert.equal(page.element('demo').hidden, true);
});

test('L27 — a missing catalogue says so; bad entries and markup in it are left out or escaped', async () => {
  let page = await app({hash: '#demo', tables: {}, fetch: files({'catalogue.json': null}).fetch});
  await settle();
  assert.match(page.element('demo').innerHTML, /The demo could not be loaded/);
  assert.match(page.element('demo').innerHTML, /Demo · read only · Create an account/);
  const cat = {title: '<img src=x onerror=alert(1)>', sheets: [
    {slug: '../secret', title: 'Escape'}, {slug: 'ok-one', title: 'Fine <b>', thumbnail: '../../x.svg', notebook: 'strength'}
  ], sessions: [{slug: 's', title: 'S', items: [{slug: 'ghost'}, {slug: 'ok-one', dose: '5'}]}]};
  page = await app({hash: '#demo', tables: {}, fetch: files({'catalogue.json': JSON.stringify(cat)}).fetch});
  await settle();
  const html = page.element('demo').innerHTML;
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /secret/);
  page.go('#demo/notebook/strength'); await settle();
  assert.match(page.element('demo').innerHTML, /Fine &lt;b&gt;/);
  assert.doesNotMatch(html, /\.\.\/\.\.\/x\.svg/);
  assert.match(html, /1 exercise\b/);
});
