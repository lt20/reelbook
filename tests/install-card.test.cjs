// L24: the Chromium path of the install invitation, end to end in the harness (Codex review of #54, pass 1).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const open = async (options = {}) => {
  const page = await app({
    remembered: {mode: 'own', url: ownUrl, key: ownKey},
    sessions: {[ownUrl]: {id: 'user-a', email: 'a@example.test'}},
    tables: {
      user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
      sheets: [{slug: 'first-sheet', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'First sheet', summary: 'A move.', exercises: []}],
      sessions: []
    },
    nav: {userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'},
    ...options
  });
  await settle();
  return page;
};
const promptEvent = () => {
  const ev = {prevented: 0, prompted: 0, preventDefault() { this.prevented++; }};
  ev.prompt = async () => { ev.prompted++; };
  ev.userChoice = Promise.resolve({outcome: 'dismissed'});
  return ev;
};

test('Chromium: beforeinstallprompt shows Install; a tap calls prompt() once, then the card goes', async () => {
  const page = await open();
  const card = page.element('install-card');
  assert.equal(card.hidden, true);
  const ev = promptEvent();
  await page.win('beforeinstallprompt', ev);
  assert.equal(ev.prevented, 1, 'the mini-infobar is held back');
  assert.equal(card.hidden, false);
  assert.match(card.innerHTML, /id="install-go"[^>]*>Install</);
  assert.match(card.innerHTML, /id="install-not-now"[^>]*>Not now</);
  await page.fire('install-go');
  await settle();
  assert.equal(ev.prompted, 1);
  assert.equal(card.hidden, true);
  await page.fire('install-go');
  await settle();
  assert.equal(ev.prompted, 1, 'a prompt event is used once');
});

test('Chromium: appinstalled hides the card; Not now hides it for 30 days even with a prompt waiting', async () => {
  const page = await open();
  await page.win('beforeinstallprompt', promptEvent());
  assert.equal(page.element('install-card').hidden, false);
  await page.win('appinstalled');
  assert.equal(page.element('install-card').hidden, true);

  const later = await open();
  await later.win('beforeinstallprompt', promptEvent());
  await later.fire('install-not-now');
  assert.equal(later.element('install-card').hidden, true);
  assert.ok(Number.isFinite(Date.parse(later.storage.get('rb.install.dismissed'))));
});

test('Chromium: a refused prompt() keeps the card and points to the browser menu (Codex pass 2)', async () => {
  const page = await open();
  const ev = promptEvent();
  ev.prompt = async () => { ev.prompted++; throw new Error('NotAllowedError'); };
  await page.win('beforeinstallprompt', ev);
  await page.fire('install-go');
  await settle();
  const card = page.element('install-card');
  assert.equal(ev.prompted, 1);
  assert.equal(card.hidden, false);
  assert.match(card.innerHTML, /The install window did not open\. Install Reelbook from your browser menu instead\./);
  assert.doesNotMatch(card.innerHTML, /id="install-go"/);
  await page.win('beforeinstallprompt', promptEvent()); // the browser offers again: Install is back
  assert.match(card.innerHTML, /id="install-go"/);
});

test('Not now hides the card for this page even when localStorage refuses the write (Codex pass 3)', async () => {
  const ios = {userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'};
  const page = await open({nav: ios});
  assert.equal(page.element('install-card').hidden, false);
  page.storage.set = () => { throw new Error('QuotaExceededError'); }; // Safari with storage off / full
  await page.fire('install-not-now');
  assert.equal(page.element('install-card').hidden, true);
  assert.equal(page.storage.get('rb.install.dismissed'), undefined, 'nothing could be stored');
  page.go('#strength');
  await settle();
  page.go('#home');
  await settle();
  assert.equal(page.element('install-card').hidden, true, 'still hidden back on the home page');
});

test('A notebook page does not show the invitation (Codex pass 2)', async () => {
  const ios = {userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'};
  const home = await open({nav: ios});
  assert.equal(home.element('install-card').hidden, false);
  const notebook = await open({nav: ios, hash: '#strength'});
  assert.equal(notebook.element('home').hidden, false);
  assert.equal(notebook.element('install-card').hidden, true);
  home.go('#strength');
  await settle();
  assert.equal(home.element('install-card').hidden, true);
});
