const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('../../harness.cjs');

const signedIn = {
  remembered: {mode: 'own', url: ownUrl, key: ownKey},
  sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}
};
const baseTables = () => ({user_themes: [], sheets: [], sessions: [], notes: [], requests: []});
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const request = (id, status, extra = {}) => ({
  id, status, url: `https://www.instagram.com/reel/${id}/`, theme: null,
  note: null, created_at: new Date().toISOString(), processed_at: null, ...extra
});
// P8 R1: the queue is the « On the way » sheet, opened by the band (no fold any more)
const openQueue = async page => {
  await page.fire('otw-band');
  assert.equal(page.element('otw-dlg').open, true);
};
const clickRow = async (page, attribute, id) => {
  await page.element('queue').listeners.click({target: {closest: selector =>
    selector === `[data-${attribute}]` ? {dataset: {[attribute]: id}, disabled: false} : null}});
  await settle();
};
// P8 R3: a failed row opens its fix, where « Try again » and « Remove it from your list » are
const fixAction = async (page, sel) => {
  await page.element('otw-row').listeners.click({target: {closest: s => s === sel ? {dataset: {}, disabled: false} : null}});
  await settle();
};
const writes = page => JSON.parse(JSON.stringify(page.clients.at(-1).calls.filter(call =>
  ['insert', 'update', 'delete', 'upsert'].includes(call[0]))));

// P8 R1: the states are Not started, Being made and Needs you (never « Waiting »); no hour of processing is shown
test('Q6 — queued, processing and error have distinct Not started, Being made and Needs you states', async () => {
  const tables = baseTables();
  tables.requests = [
    request('waiting', 'queued'),
    request('working', 'processing', {processed_at: new Date().toISOString()}),
    request('failed', 'error', {note: 'Video unavailable'})
  ];
  const page = await app({...signedIn, tables});
  await settle();
  await openQueue(page);
  const rows = page.element('queue').innerHTML;
  assert.match(rows, /Not started/);
  assert.match(rows, /Being made/);
  assert.doesNotMatch(rows, /since \d\d:\d\d/);
  assert.match(rows, /Needs you/);
  assert.doesNotMatch(rows, /Waiting|Processing|Failed/);
  assert.match(rows, /Video unavailable/);
  assert.match(rows, /class="[^"]*why[^"]*"[^>]*>Video unavailable/);
  // P8 R3: Retry and Remove are in the failed row's fix (no reason: « other »)
  await clickRow(page, 'row', 'failed');
  const fix = page.element('otw-row').innerHTML;
  assert.match(fix, /data-fixdone>Try again</);
  assert.match(fix, /data-rdel>Remove it from your list</);
});

// P8 R1: no « waiting N days » (never « Waiting », no duration): the date it was added stays
test('Q6 — a queued request older than seven days shows when it was added, not waiting N days', async () => {
  const tables = baseTables();
  tables.requests = [request('old', 'queued', {created_at: new Date(Date.now() - 9 * 86400000).toISOString()})];
  const page = await app({...signedIn, tables});
  await settle();
  await openQueue(page);
  assert.doesNotMatch(page.element('queue').innerHTML, /waiting/i);
  assert.match(page.element('queue').innerHTML, /<small>Added \d+ \w+<\/small>/); // P8 R2: no notebook (Auto): « Added 30 Oct »
});

// P8 R1: the band is never folded (rb.queueOpen is gone): it counts what is on the way and what needs you
test('Q6 — the band summarizes the queue and what needs you, is never folded, and is absent when empty', async () => {
  const tables = baseTables();
  tables.requests = [request('a', 'queued'), request('b', 'processing'), request('c', 'error')];
  const page = await app({...signedIn, tables, stored: {'rb.queueOpen': 'false'}});
  await settle();
  assert.equal(page.element('otw-band').hidden, false);
  assert.match(page.element('otw-band').innerHTML, /3 on the way<\/span><span class="sep" aria-hidden="true">·<\/span><span class="red">1 needs you/);
  await openQueue(page);
  assert.equal(page.storage.get('rb.queueOpen'), 'false', 'nothing remembers a fold');
  const empty = await app({...signedIn, tables: baseTables()});
  await settle();
  assert.equal(empty.element('otw-band').hidden, true);
});

test('Q6 — Retry resets the failed row and shows Not started after a successful update', async () => {
  const tables = baseTables();
  tables.requests = [request('failed', 'error', {note: 'Video unavailable', processed_at: new Date().toISOString()})];
  const page = await app({...signedIn, tables});
  await settle();
  await openQueue(page);
  await clickRow(page, 'row', 'failed'); await fixAction(page, '[data-fixdone]'); // P8 R3: from its fix
  assert.deepEqual(writes(page), [['update', 'requests', {status: 'queued', note: null, processed_at: null}, [['id', 'failed']]]]);
  assert.match(page.element('queue').innerHTML, /Not started/);
  assert.doesNotMatch(page.element('queue').innerHTML, /Video unavailable/);
});

test('Q6 — a failed Retry shows an inline error and leaves the row unchanged', async () => {
  const tables = baseTables();
  tables.requests = [request('failed', 'error', {note: 'Video unavailable'})];
  const page = await app({...signedIn, tables, writes: {requests: {data: null, error: {message: 'permission denied'}}}});
  await settle();
  await openQueue(page);
  await clickRow(page, 'row', 'failed'); await fixAction(page, '[data-fixdone]'); // P8 R3: from its fix, which says why
  const row = page.element('queue').innerHTML;
  assert.match(row, /Needs you/);
  assert.match(row, /Video unavailable/);
  assert.match(page.element('otw-row').innerHTML, /Retry failed: permission denied/);
});

// P8 R1: the one line that names the processing is the sheet's footer, picked by the mode (no « Last run » date)
test('Q6 — the open queue says who picks the videos up, in one line', async () => {
  const tables = baseTables();
  tables.requests = [request('waiting', 'queued')];
  const page = await app({...signedIn, tables});
  await settle();
  await openQueue(page);
  assert.equal(page.element('otw-mode').textContent, 'Your computer picks these up on its next run.');
  assert.doesNotMatch(page.element('queue').innerHTML, /Last run/);
});

test('Q7 — removing a queue item offers Removed · Undo before sending a delete', async () => {
  const tables = baseTables();
  tables.requests = [request('waiting', 'queued')];
  const page = await app({...signedIn, tables});
  await settle();
  await openQueue(page);
  await clickRow(page, 'del', 'waiting');
  assert.doesNotMatch(page.element('queue').innerHTML, /data-row="waiting"/);
  assert.match(page.element('queue-toast').innerHTML, /Removed · Undo/);
  assert.equal(writes(page).length, 0);
  await page.fire('queue-undo');
  assert.match(page.element('queue').innerHTML, /data-row="waiting"/);
  assert.equal(writes(page).length, 0);
});
