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
const openQueue = async page => {
  await page.fire('queue-toggle');
  assert.match(page.element('queue-summary').innerHTML, /aria-expanded="true"/);
};
const clickRow = async (page, attribute, id) => {
  await page.element('queue').listeners.click({target: {closest: selector =>
    selector === `[data-${attribute}]` ? {dataset: {[attribute]: id}, disabled: false} : null}});
  await settle();
};
const writes = page => JSON.parse(JSON.stringify(page.clients.at(-1).calls.filter(call =>
  ['insert', 'update', 'delete', 'upsert'].includes(call[0]))));

test('Q6 — queued, processing and error have distinct Waiting, Processing and Failed states', async () => {
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
  assert.match(rows, /Waiting/);
  assert.match(rows, /Processing/);
  assert.match(rows, /since \d\d:\d\d/);
  assert.match(rows, /Failed/);
  assert.match(rows, /Video unavailable/);
  assert.match(rows, /Retry/);
  assert.match(rows, /Remove/);
  assert.match(rows, /class="[^"]*why[^"]*"[^>]*>Video unavailable/);
});

test('Q6 — a queued request older than seven days shows waiting N days', async () => {
  const tables = baseTables();
  tables.requests = [request('old', 'queued', {created_at: new Date(Date.now() - 9 * 86400000).toISOString()})];
  const page = await app({...signedIn, tables});
  await settle();
  await openQueue(page);
  assert.match(page.element('queue').innerHTML, /waiting 9 days/);
});

test('Q6 — the queue is collapsed by default, summarizes failures, remembers expansion, and has no row when empty', async () => {
  const tables = baseTables();
  tables.requests = [request('a', 'queued'), request('b', 'processing'), request('c', 'error')];
  const page = await app({...signedIn, tables});
  await settle();
  assert.equal(page.element('queue-sec').hidden, false);
  assert.match(page.element('queue-summary').innerHTML, /3 in the queue · 1 failed/);
  assert.match(page.element('queue-summary').innerHTML, /aria-expanded="false"/);
  assert.equal(page.element('queue').hidden, true);
  await openQueue(page);
  assert.equal(page.storage.get('rb.queueOpen'), 'true');
  assert.equal(page.element('queue').hidden, false);
  const reopened = await app({...signedIn, tables, stored: {'rb.queueOpen': 'true'}});
  await settle();
  assert.match(reopened.element('queue-summary').innerHTML, /aria-expanded="true"/);
  const empty = await app({...signedIn, tables: baseTables()});
  await settle();
  assert.equal(empty.element('queue-sec').hidden, true);
});

test('Q6 — Retry resets the failed row and shows Waiting after a successful update', async () => {
  const tables = baseTables();
  tables.requests = [request('failed', 'error', {note: 'Video unavailable', processed_at: new Date().toISOString()})];
  const page = await app({...signedIn, tables});
  await settle();
  await openQueue(page);
  await clickRow(page, 'retry', 'failed');
  assert.deepEqual(writes(page), [['update', 'requests', {status: 'queued', note: null, processed_at: null}, [['id', 'failed']]]]);
  assert.match(page.element('queue').innerHTML, /Waiting/);
  assert.doesNotMatch(page.element('queue').innerHTML, /Video unavailable/);
});

test('Q6 — a failed Retry shows an inline error and leaves the row unchanged', async () => {
  const tables = baseTables();
  tables.requests = [request('failed', 'error', {note: 'Video unavailable'})];
  const page = await app({...signedIn, tables, writes: {requests: {data: null, error: {message: 'permission denied'}}}});
  await settle();
  await openQueue(page);
  await clickRow(page, 'retry', 'failed');
  const row = page.element('queue').innerHTML;
  assert.match(row, /Failed/);
  assert.match(row, /Video unavailable/);
  assert.match(row, /permission denied/);
});

test('Q6 — an expanded queue explains when no computer has ever processed a video', async () => {
  const tables = baseTables();
  tables.requests = [request('waiting', 'queued')];
  const page = await app({...signedIn, tables});
  await settle();
  await openQueue(page);
  assert.match(page.element('queue').innerHTML, /No computer has processed a video yet\./);
  assert.match(page.element('queue').innerHTML, /<a[^>]*href="#welcome"[^>]*>Set up your computer<\/a>/);
});

test('Q7 — removing a queue item offers Removed · Undo before sending a delete', async () => {
  const tables = baseTables();
  tables.requests = [request('waiting', 'queued')];
  const page = await app({...signedIn, tables});
  await settle();
  await openQueue(page);
  await clickRow(page, 'del', 'waiting');
  assert.doesNotMatch(page.element('queue').innerHTML, /reel\/waiting/);
  assert.match(page.element('queue-toast').innerHTML, /Removed · Undo/);
  assert.equal(writes(page).length, 0);
  await page.fire('queue-undo');
  assert.match(page.element('queue').innerHTML, /reel\/waiting/);
  assert.equal(writes(page).length, 0);
});
