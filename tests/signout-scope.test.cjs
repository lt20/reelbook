// F1: signing out of the app signs out this device only (scope 'local'). supabase-js's default ('global') revokes
// every session of the account, the computer's rb.py one too, and the overnight run then fails.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const remembered = {mode: 'own', url: ownUrl, key: ownKey};
const signedIn = {remembered, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const tables = () => ({user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}], sheets: [], sessions: [], notes: []});
// args copied out of the page realm (a vm context) for deepEqual
const spy = page => { const log = []; page.clients.at(-1).auth.signOut = async (...args) => { log.push(JSON.parse(JSON.stringify(args))); return {error: null}; }; return log; };

test('F1: Sign out passes scope local', async () => {
  const page = await app({...signedIn, tables: tables(), dom: true}); await settle();
  const log = spy(page);
  await page.fire('s-signout'); await settle();
  assert.deepEqual(log, [[{scope: 'local'}]]);
});

test('F1: « another backend » signed in passes scope local', async () => {
  const page = await app({...signedIn, tables: tables(), dom: true}); await settle();
  const log = spy(page);
  await page.fire('s-reset'); await settle();
  assert.deepEqual(log[0], [{scope: 'local'}]);
});

test('F1: « another backend » with no user signed in passes scope local too', async () => {
  const page = await app({remembered, tables: tables(), dom: true}); await settle();
  const log = spy(page);
  await page.fire('s-reset'); await settle();
  assert.deepEqual(log[0], [{scope: 'local'}]);
});
