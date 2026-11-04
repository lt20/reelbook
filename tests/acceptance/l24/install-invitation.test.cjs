const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('../../harness.cjs');

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const signedIn = (id = 'user-a') => ({
  remembered: {mode: 'own', url: ownUrl, key: ownKey},
  sessions: {[ownUrl]: {id, email: `${id}@example.test`}}
});
const sheet = {slug: 'first-sheet', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'First sheet', summary: 'A move.', exercises: []};
const tables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: [sheet], sessions: []
});
const ios = {userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'};
const card = page => page.element('install-card');
const cardText = page => card(page).textContent + ' ' + card(page).innerHTML;
const open = async (options = {}) => {
  const page = await app({...signedIn(), tables: tables(), nav: ios, ...options});
  await settle();
  return page;
};

test('iOS Safari: a signed-in user with at least one sheet sees the quiet home card, exact install text and inline Share glyph', async () => {
  const page = await open();
  assert.equal(page.element('home').hidden, false);
  assert.equal(card(page).hidden, false);
  assert.match(cardText(page), /Install Reelbook: tap Share, then Add to Home Screen/);
  assert.match(card(page).innerHTML, /<svg\b[\s\S]*?<\/svg>/i);
});

test('At least one sheet: an empty catalogue does not show the invitation', async () => {
  const page = await open({tables: {...tables(), sheets: []}, hash: '#home'});
  assert.equal(page.element('home').hidden, false);
  assert.equal(card(page).hidden, true);
});

test('Other browsers: no installation invitation appears without an install prompt', async () => {
  const page = await open({nav: {userAgent: 'ExampleBrowser/1.0'}});
  assert.equal(card(page).hidden, true);
});

test('Installed app: navigator.standalone true hides the invitation', async () => {
  const page = await open({nav: {...ios, standalone: true}});
  assert.equal(card(page).hidden, true);
});

test('Not now: dismissal is stored on this device and hides the invitation for 30 days, across users', async () => {
  const page = await open();
  const before = Date.now();
  await page.fire('install-not-now');
  assert.equal(card(page).hidden, true);
  const saved = page.storage.get('rb.install.dismissed');
  assert.ok(saved, 'dismissal is saved under the specified device key');
  assert.ok(Number.isFinite(Date.parse(saved)), 'dismissal is a date');
  assert.ok(Date.parse(saved) >= before - 1000 && Date.parse(saved) <= Date.now() + 1000);
  const otherUser = await open({...signedIn('user-b'), stored: {'rb.install.dismissed': saved}});
  assert.equal(card(otherUser).hidden, true);
  const day = 24 * 60 * 60 * 1000;
  const within = await open({stored: {'rb.install.dismissed': new Date(Date.now() - 29 * day).toISOString()}});
  assert.equal(card(within).hidden, true);
  const expired = await open({stored: {'rb.install.dismissed': new Date(Date.now() - 31 * day).toISOString()}});
  assert.equal(card(expired).hidden, false);
});

test('Never on the auth screen, a sheet, or the session player', async () => {
  const auth = await app({nav: ios});
  await settle();
  assert.equal(auth.element('auth').hidden, false);
  assert.equal(card(auth).hidden, true);
  const sheetPage = await open({hash: '#first-sheet', dom: true});
  assert.equal(sheetPage.element('view').hidden, false);
  assert.equal(card(sheetPage).hidden, true);
  const player = await open({hash: '#first-sheet/play', dom: true});
  assert.equal(player.element('player').hidden, false);
  assert.equal(card(player).hidden, true);
});

test('A backend without the sessions table still offers installation when a sheet loads', async () => {
  const page = await open({failing: {sessions: {error: {code: 'PGRST205', message: 'Could not find the table'}, status: 404}}});
  assert.equal(page.element('home').hidden, false);
  assert.equal(card(page).hidden, false);
});

test('A failed sheet catalogue does not claim the user has a sheet', async () => {
  const page = await open({failing: {sheets: {error: {code: '42501', message: 'permission denied'}, status: 403}}});
  assert.equal(card(page).hidden, true);
});

test('Chromium: the invitation stays hidden until beforeinstallprompt is received', async () => {
  const page = await open({nav: {userAgent: 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36'}});
  assert.equal(card(page).hidden, true);
});
