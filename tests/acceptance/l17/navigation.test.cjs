const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, ownUrl, ownKey} = require('../../harness.cjs');

const signedIn = {
  remembered: {mode: 'own', url: ownUrl, key: ownKey},
  sessions: {[ownUrl]: {id: 'u1', email: 'reader@example.test'}}
};
const tables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: [{slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Hammer curl', summary: '', html: '<a href="#strength">Strength</a>', exercises: []}],
  sessions: [{slug: 'routine', theme: 'strength', title: 'Routine', origin: 'user', items: [{slug: 'curl', dose: ''}]}],
  requests: []
});
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const open = async (hash, options = {}) => {
  const page = await app({...signedIn, tables: tables(), hash, dom: true, ...options});
  await settle();
  return page;
};
const rule = selector => {
  const start = html.indexOf(selector + '{');
  assert.notEqual(start, -1, `${selector} has a CSS rule`);
  return html.slice(start + selector.length + 1, html.indexOf('}', start));
};

test('L17 — a sticky top bar appears on every page except home and the player, with a 44 px safe-area height and 44 px controls', async () => {
  const page = await open('');
  assert.equal(page.element('nav-bar').hidden, true);
  for (const [hash, title, parent] of [
    ['#strength', 'Strength', 'Reelbook'],
    ['#curl', 'Hammer curl', 'Strength'],
    ['#session/routine', 'Routine', 'Strength'],
    ['#settings', 'Settings', 'Reelbook']
  ]) {
    page.go(hash); await settle();
    assert.equal(page.element('nav-bar').hidden, false, hash);
    assert.equal(page.element('nav-title').textContent, title, hash);
    assert.equal(page.element('nav-back').textContent.trim(), `‹ ${parent}`, hash);
    assert.equal(page.element('nav-more').textContent.trim(), '⋯', hash);
  }
  page.go('#session/routine/play'); await settle();
  assert.equal(page.element('nav-bar').hidden, true);
  assert.match(rule('#nav-bar'), /position:\s*sticky/);
  assert.match(rule('#nav-bar'), /env\(safe-area-inset-top/);
  assert.match(rule('#nav-back'), /min-(?:width|height):\s*44px/);
  assert.match(rule('#nav-more'), /min-(?:width|height):\s*44px/);
});

test('L17 — ⋯ opens the page-actions menu, including the actions available on a sheet', async () => {
  const page = await open('#curl');
  await page.fire('nav-more');
  const menu = page.element('nav-actions');
  assert.equal(menu.open, true);
  assert.match(menu.innerHTML, /Move/);
  assert.match(menu.innerHTML, /Add to session/);
  assert.match(menu.innerHTML, /Keep screen on/);
  assert.match(menu.innerHTML, /Something wrong\?/);
  assert.match(menu.innerHTML, /Delete/);
  page.go('#session/routine'); await settle();
  await page.fire('nav-more');
  assert.match(page.element('nav-actions').innerHTML, /Edit/);
});

test('L17 — the floating + Add a video button is on home and notebook pages, and the old header button is gone', async () => {
  const page = await open('');
  assert.equal(page.element('add-video-fab').hidden, false);
  assert.equal(page.element('add-video-fab').textContent.trim(), '+ Add a video');
  assert.doesNotMatch(html.match(/<header id="brand-bar">[\s\S]*?<\/header>/)?.[0] || '', /id="btn-new"/);
  page.go('#strength'); await settle();
  assert.equal(page.element('add-video-fab').hidden, false);
  page.go('#curl'); await settle();
  assert.equal(page.element('add-video-fab').hidden, true);
  assert.match(rule('#add-video-fab'), /position:\s*fixed/);
  assert.match(rule('#add-video-fab'), /(?:width|height):\s*56px/);
  assert.match(rule('#add-video-fab'), /env\(safe-area-inset-bottom/);
});

test('L17 — + Add a video from a notebook pre-selects that notebook when the link is queued', async () => {
  const page = await open('#strength');
  await page.fire('add-video-fab');
  assert.equal(page.element('sheet-new').hidden, false);
  page.element('f-url').value = 'https://www.instagram.com/reel/example/';
  await page.fire('sheet-new', 'submit'); await settle();
  const insert = page.clients.at(-1).calls.find(call => call[0] === 'insert' && call[1] === 'requests');
  assert.ok(insert, 'the video is queued');
  assert.equal(insert[2].theme, 'strength');
});

test('L17 — an empty notebook, a missing sessions table and an offline catalogue still provide navigation', async () => {
  for (const options of [
    {tables: {...tables(), sheets: [], sessions: []}},
    {failing: {sessions: {error: {code: 'PGRST205', message: 'Could not find the table'}, status: 404}}},
    {failing: {sheets: {error: {message: 'Failed to fetch'}, status: 0}}}
  ]) {
    const page = await open('#strength', options);
    assert.equal(page.element('nav-bar').hidden, false);
    assert.equal(page.element('nav-back').textContent.trim(), '‹ Reelbook');
    assert.equal(page.element('add-video-fab').hidden, false);
  }
});

test('L17 — no bottom tab bar appears', async () => {
  const page = await open('');
  for (const hash of ['', '#strength', '#curl', '#session/routine', '#settings']) {
    page.go(hash); await settle();
    assert.equal(page.element('bottom-tabs').hidden, true, hash);
  }
  assert.doesNotMatch(html, /role="tablist"|aria-label="Bottom navigation"/);
});
