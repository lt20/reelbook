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
  assert.deepEqual(inserts(page).map(c => c[2]), [{slug: 'curl', done_on: localDay(), text: '12 kg, 3x10'}]);
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
