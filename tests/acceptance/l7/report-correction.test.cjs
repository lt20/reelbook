const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('../../harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const url = 'https://www.instagram.com/reel/example/';
const sheet = source => ({slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Curl marteau', summary: '', html: '<a href="https://example.test">Video</a>', source, exercises: []});
const session = source => ({slug: 'backroll', theme: 'strength', title: 'Backroll', origin: 'video', source, items: []});
const tables = (source = {url}) => ({user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}], sheets: [sheet(source)], sessions: [session(source)], requests: []});
const clickView = (page, selector) => page.element('view').listeners.click({target: {closest: wanted => wanted === selector ? {} : null}});
const insert = page => page.clients.at(-1).calls.find(call => call[0] === 'insert' && call[1] === 'requests');

test('B4 — At the bottom of a sheet, « Something wrong? » opens « What should Claude fix? » and « Send », then queues Redo and confirms it', async () => {
  const page = await app({...signedIn, tables: tables(), hash: '#curl', dom: true}); await settle();
  assert.match(page.element('view').innerHTML, /Something wrong\?/);
  assert.ok(page.element('view').innerHTML.indexOf('Something wrong?') > page.element('view').innerHTML.indexOf('My notes'));
  clickView(page, '#report-open');
  assert.equal(page.element('report-dlg').open, true);
  assert.match(page.element('report-dlg').innerHTML, /What should Claude fix\?/);
  assert.match(page.element('report-dlg').innerHTML, /Send/);
  page.element('report-note').value = 'The hand position is reversed.';
  await page.fire('report-send'); await settle();
  const call = insert(page);
  assert.ok(call, 'the request was inserted');
  assert.deepEqual(JSON.parse(JSON.stringify(call[2])), {url, theme: 'strength', note: 'Redo: The hand position is reversed.', slug: 'curl'});
  assert.match(page.element('report-status').textContent || page.element('view').innerHTML, /Sent\. Claude will redo this sheet on the next run\./);
});

test('B4 — A session page reports its source URL and current notebook', async () => {
  const page = await app({...signedIn, tables: tables(), hash: '#session/backroll'}); await settle();
  assert.match(page.element('view').innerHTML, /Something wrong\?/);
  clickView(page, '#report-open');
  page.element('report-note').value = 'Replace the second exercise.';
  await page.fire('report-send'); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(insert(page)[2])), {url, theme: 'strength', note: 'Redo: Replace the second exercise.', slug: 'session/backroll'});
});

test('B4 — « Something wrong? » is hidden when the sheet or session has no source URL', async () => {
  for (const hash of ['#curl', '#session/backroll']) {
    const page = await app({...signedIn, tables: tables({}), hash, dom: true}); await settle();
    assert.doesNotMatch(page.element('view').innerHTML, /Something wrong\?/);
    assert.equal(insert(page), undefined);
  }
});

test('B4 — A failed correction insert keeps the dialog open and does not claim it was sent', async () => {
  const page = await app({...signedIn, tables: tables(), hash: '#session/backroll', failing: {requests: {error: {message: 'Failed to fetch'}, status: 0}}}); await settle();
  clickView(page, '#report-open');
  page.element('report-note').value = 'Correct the dose.';
  await page.fire('report-send'); await settle();
  assert.equal(page.element('report-dlg').open, true);
  assert.doesNotMatch(page.element('report-status').textContent || '', /Sent\. Claude will redo this sheet on the next run\./);
});

// P8 R2: a row shows a readable name, not the URL: « Redo » comes before the name
test('B4 — Queue rows whose note starts with « Redo: » show « Redo » before the URL', async () => {
  const t = tables();
  t.requests = [
    {id: 1, url, status: 'queued', theme: 'strength', note: 'Redo: correct the angle', created_at: '2026-11-01T12:00:00Z'},
    {id: 2, url: 'https://www.youtube.com/shorts/ordinary', status: 'queued', theme: 'strength', note: 'Other reason', created_at: '2026-11-01T11:00:00Z'}
  ];
  const page = await app({...signedIn, tables: t}); await settle();
  const rows = page.element('queue').innerHTML.split('<button type="button" class="q qrow"').slice(1);
  assert.match(rows[0], /<span class="t1"><span class="redo">Redo<\/span>Instagram reel<\/span>/);
  assert.match(rows[1], /<span class="t1">YouTube video<\/span>/);
  assert.doesNotMatch(rows[1], /Redo/);
});
