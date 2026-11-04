// L29: the app side of the quotas — the usage line of Settings (my_quota) and the quota message of « Add a video ».
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const reel = 'https://www.instagram.com/reel/DeGBCfjsbTt/';
const usage = {requests_today: 4, max_requests_per_day: 10, sheets: 120, max_sheets: 300, storage_bytes: 80 * 1048576, max_storage_mb: 200};

const openSettings = async (rpc) => {
  const page = await app(signedIn);
  await settle();
  const client = page.clients.at(-1), asked = [];
  if (rpc) client.rpc = async (name, args) => { asked.push(name); return rpc(name, args); };
  page.go('#settings');
  await settle();
  assert.equal(page.element('settings').hidden, false);
  return {page, asked};
};

test('Settings shows the usage line when the backend has my_quota()', async () => {
  const {page, asked} = await openSettings(async () => ({data: usage, error: null}));
  assert.deepEqual(asked, ['my_quota']);
  assert.equal(page.element('s-usage').hidden, false);
  assert.equal(page.element('s-usage').textContent, 'Usage: 4/10 links today · 120/300 sheets · 80/200 MB');
});

test('small photo totals keep one decimal, an empty account reads 0', async () => {
  let answer = {...usage, storage_bytes: 0.42 * 1048576};
  const {page} = await openSettings(async () => ({data: answer, error: null}));
  assert.match(page.element('s-usage').textContent, / · 0\.4\/200 MB$/);
  answer = {...usage, requests_today: 0, sheets: 0, storage_bytes: 0};
  page.go('#'); await settle(); page.go('#settings'); await settle();
  assert.equal(page.element('s-usage').textContent, 'Usage: 0/10 links today · 0/300 sheets · 0/200 MB');
});

test('the usage line stays hidden on a backend without my_quota (no rpc, PGRST202, a thrown error, no data)', async () => {
  for (const rpc of [null,
    async () => ({data: null, status: 404, error: {code: 'PGRST202', message: 'Could not find the function public.my_quota'}}),
    async () => { throw new Error('offline'); },
    async () => ({data: null, error: null})]) {
    const {page} = await openSettings(rpc);
    assert.equal(page.element('s-usage').hidden, true);
    assert.equal(page.element('s-user').textContent, 'user@example.test', 'the rest of Settings renders');
  }
});

const refusing = (page, message) => {
  const client = page.clients.at(-1), from = client.from;
  client.from = table => table === 'requests' ? {insert: async row => { client.calls.push(['insert', table, row]); return {data: null, error: {code: 'P0001', message, details: null, hint: 'The count starts again at midnight UTC.'}}; }} : from(table);
};

test('a link refused by the daily quota shows the quota message, and the link stays in the field', async () => {
  const page = await app(signedIn);
  await settle();
  refusing(page, 'quota: 10 links per day');
  await page.fire('add-video-fab');
  page.element('f-url').value = reel;
  await page.fire('sheet-new', 'submit');
  await settle();
  assert.equal(page.element('f-err').hidden, false);
  assert.equal(page.element('f-err').textContent, 'Limit reached: 10 links per day on this backend. You can add more tomorrow (the count starts again at midnight UTC).');
  assert.equal(page.element('f-url').value, reel, 'nothing lost');
  assert.equal(page.element('sheet-new').hidden, false);
});

test('any other error keeps the generic message', async () => {
  const page = await app(signedIn);
  await settle();
  refusing(page, 'new row violates row-level security policy for table "requests"');
  await page.fire('add-video-fab');
  page.element('f-url').value = reel;
  await page.fire('sheet-new', 'submit');
  await settle();
  assert.equal(page.element('f-err').textContent, 'Could not save it right now. Try again in a moment.');
});

test('« Queue it before leaving » shows the quota message too', async () => {
  const page = await app({...signedIn, stored: {'rb.draft': reel}});
  await settle();
  refusing(page, 'quota: 3 links per day');
  await page.fire('add-video-fab');
  await page.fire('pd-queue');
  await settle();
  assert.equal(page.element('pd-err').hidden, false);
  assert.match(page.element('pd-err').textContent, /^Limit reached: 3 links per day on this backend\./);
});
