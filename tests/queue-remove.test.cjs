// L4 — the deferred removal of a queue row, past the « Removed · Undo » toast (the acceptance tests in
// tests/acceptance/l4/ cover the toast and Undo). The toast ends on its bar's animationend.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {
  remembered: {mode: 'own', url: ownUrl, key: ownKey},
  sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}
};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const tables = () => ({user_themes: [], sheets: [], sessions: [], notes: [], requests: [
  {id: 'waiting', status: 'queued', url: 'https://www.instagram.com/reel/waiting/', theme: null, note: null, created_at: new Date().toISOString(), processed_at: null}
]});
const remove = async page => {
  await page.fire('queue-toggle');
  await page.element('queue').listeners.click({target: {closest: s => s === '[data-del]' ? {dataset: {del: 'waiting'}, disabled: false} : null}});
  await settle();
};
const deletes = page => page.clients.at(-1).calls.filter(c => c[0] === 'delete');

test('L4: the delete is sent when the toast ends, for that row only', async () => {
  const page = await app({...signedIn, tables: tables()});
  await settle();
  await remove(page);
  assert.equal(deletes(page).length, 0);
  await page.fire('queue-undo', 'animationend');
  await settle();
  assert.deepEqual(deletes(page).map(c => c[3]), [[['id', 'waiting']]]);
  assert.equal(page.element('queue-undo').hidden, true);
  assert.doesNotMatch(page.element('queue').innerHTML, /reel\/waiting/);
});

test('L4: a failed delete puts the row back with the reason', async () => {
  const page = await app({...signedIn, tables: tables(), writes: {requests: {data: null, error: {message: 'network down'}}}});
  await settle();
  await remove(page);
  await page.fire('queue-undo', 'animationend');
  await settle();
  assert.equal(deletes(page).length, 1);
  assert.equal(page.element('queue-sec').hidden, false);
  assert.match(page.element('queue').innerHTML, /reel\/waiting/);
  assert.match(page.element('queue').innerHTML, /Could not remove it: network down/);
});

test('L4: a queue that cannot be read shows no row and does not throw', async () => {
  const page = await app({...signedIn, tables: tables(), failing: {requests: {error: {message: 'offline'}, status: 0}}});
  await settle();
  assert.equal(page.element('queue-sec').hidden, true);
});
