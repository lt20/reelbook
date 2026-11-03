// L6, practice log: regression tests of the agent (the acceptance tests are in tests/acceptance/l6/).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const tables = (practice_log = []) => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: ['Arms'], builtin: true, position: 0}],
  sheets: [{slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Hammer curl', summary: '', html: '', source: {}}],
  sessions: [], notes: [], requests: [], practice_log
});
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const click = async (page, id) => { await page.element('view').listeners.click({target: {closest: sel => sel === `#${id}` ? {id} : null}}); await settle(); };
const localDay = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const inserts = page => JSON.parse(JSON.stringify(page.clients.at(-1).calls.filter(c => c[0] === 'insert' && c[1] === 'practice_log'))); // objects of the vm realm

test('L6 — Save sends the local calendar day, not the server one (UTC), and the button reads ✓ that day', async () => {
  const page = await app({...signedIn, tables: tables(), dom: true, hash: '#curl'});
  await settle();
  await click(page, 'practice-done');
  page.element('practice-text').value = '  12 kg, 3x10  ';
  await click(page, 'practice-save');
  const sent = inserts(page).map(c => c[2]);
  assert.match(sent[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(sent.map(({id, ...r}) => r), [{slug: 'curl', done_on: localDay(), text: '12 kg, 3x10'}]);
  assert.match(page.element('view').innerHTML, /id="practice-done"[^>]*>Done today ✓</);
  assert.doesNotMatch(page.element('view').innerHTML, /id="practice-text"/, 'the field closes once saved');
  assert.match(page.element('view').innerHTML, /<h3>Log<\/h3><ol><li><time datetime="\d{4}-\d\d-\d\d">[^<]+<\/time>12 kg, 3x10<\/li><\/ol>/);
});

test('L6 — a failed Save keeps the typed text with « Not saved. Try again. »', async () => {
  const page = await app({...signedIn, tables: tables(), dom: true, hash: '#curl', writes: {practice_log: {data: null, error: {message: 'offline'}}}});
  await settle();
  await click(page, 'practice-done');
  page.element('practice-text').value = 'half done';
  await click(page, 'practice-save');
  const html = page.element('view').innerHTML;
  assert.match(html, /<input[^>]*id="practice-text"[^>]*value="half done"/);
  assert.match(html, /Not saved\. Try again\./);
  assert.match(html, /id="practice-done"[^>]*>Done today</);
  assert.doesNotMatch(html, /<h3>Log<\/h3>/);
});

test('L6 — a saved practice counts at once on the home page and on the card', async () => {
  const page = await app({...signedIn, tables: tables(), dom: true, hash: '#curl'});
  await settle();
  await click(page, 'practice-done');
  await click(page, 'practice-save');
  page.go('');
  await settle();
  assert.match(page.element('count').textContent, /^1 practised · 1 saved · 1 notebook$/);
  page.go('#strength');
  await settle();
  assert.match(page.element('groups').innerHTML, /href="#curl"[\s\S]*?<span class="done">done \d{1,2} [A-Z][a-z]{2}<\/span>/);
});

test('L6 — a day is read as a local date: 2026-10-28 shows « 28 Oct » whatever the time zone', async () => {
  const page = await app({...signedIn, tables: tables([{id: 'a', slug: 'curl', done_on: '2026-10-28', text: '', created_at: '2026-10-28T23:30:00Z'}]), dom: true, hash: '#curl'});
  await settle();
  assert.match(page.element('view').innerHTML, /Last time: 28 Oct</, 'no « — » after the date when the entry has no text');
});

test('L6 — after a failed Save, closing and reopening the field prefills the text not saved, until it is saved', async () => {
  const writes = {practice_log: {data: null, error: {message: 'offline'}}};
  const log = [{id: 'a', slug: 'curl', done_on: '2026-10-28', text: 'old entry', created_at: '2026-10-28T08:00:00Z'}];
  const page = await app({...signedIn, tables: tables(log), dom: true, hash: '#curl', writes});
  await settle();
  await click(page, 'practice-done');
  page.element('practice-text').value = 'typed, not saved';
  await click(page, 'practice-save');
  await click(page, 'practice-done'); // close
  await click(page, 'practice-done'); // open again
  assert.match(page.element('view').innerHTML, /<input[^>]*id="practice-text"[^>]*value="typed, not saved"/);
  writes.practice_log = undefined;
  page.element('practice-text').value = 'typed, not saved';
  await click(page, 'practice-save');
  await click(page, 'practice-done');
  assert.match(page.element('view').innerHTML, /<input[^>]*id="practice-text"[^>]*value="typed, not saved"/, 'saved: now the last entry');
  assert.match(page.element('view').innerHTML, /Last time: [^<]*— typed, not saved/);
});

test('L6 — the field is read-only while its save is on its way', async () => {
  const page = await app({...signedIn, tables: tables(), dom: true, hash: '#curl'});
  await settle();
  await click(page, 'practice-done');
  page.element('practice-text').value = '3x10';
  page.element('practice-text').readOnly = false;
  const pending = page.element('view').listeners.click({target: {closest: sel => sel === '#practice-save' ? {} : null}});
  assert.equal(page.element('practice-text').readOnly, true);
  assert.equal(page.element('practice-save').disabled, true);
  await pending; await settle();
});

test('L6 — Save again after a lost answer sends the same row; a duplicate key (23505) counts as saved, once', async () => {
  const writes = {practice_log: {data: null, error: {message: 'Failed to fetch'}}};
  const page = await app({...signedIn, tables: tables(), dom: true, hash: '#curl', writes});
  await settle();
  await click(page, 'practice-done');
  page.element('practice-text').value = '3x10';
  await click(page, 'practice-save');
  assert.match(page.element('view').innerHTML, /Not saved\. Try again\./);
  writes.practice_log = {data: null, error: {code: '23505', message: 'duplicate key value violates unique constraint "practice_log_pkey"'}};
  page.element('practice-text').value = '3x10';
  await click(page, 'practice-save');
  const sent = inserts(page).map(c => c[2]);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0], 'the same id, day and text');
  const html = page.element('view').innerHTML;
  assert.match(html, /Done today ✓/);
  assert.equal([...html.matchAll(/<li><time/g)].length, 1, 'one entry in the Log');
  // another text is another try: a new id
  writes.practice_log = undefined;
  await click(page, 'practice-done');
  page.element('practice-text').value = 'again';
  await click(page, 'practice-save');
  assert.notEqual(inserts(page).at(-1)[2].id, sent[0].id);
});
