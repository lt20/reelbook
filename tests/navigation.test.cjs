// L17 (design audit E7): the sticky bar and its « ⋯ » menu, beyond the acceptance tests in tests/acceptance/l17
// (written by Codex). The harness has no history, IntersectionObserver or confirm: Back, the scroll memory and
// « Discard your changes? » are checked in a browser (scratchpad Playwright run, see the PR).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const url = 'https://www.instagram.com/reel/abc/';
const tables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: [
    {slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Hammer curl', summary: '', html: '<h1>Hammer curl</h1>', exercises: [], source: {url}},
    {slug: 'row', kind: 'sheet', theme: 'strength', group: 'Back', title: 'Row', summary: '', html: '<h1>Row</h1>', exercises: []}
  ],
  sessions: [{slug: 'routine', theme: 'strength', title: 'Routine', origin: 'user', items: [{slug: 'curl', dose: ''}, {slug: 'row', dose: ''}]}],
  requests: [], notes: []
});
const open = async hash => { const page = await app({...signedIn, tables: tables(), hash, dom: true}); await settle(); return page; };
const clickIn = (page, id, selector) => page.element(id).listeners.click({target: {closest: s => s === selector ? {dataset: {}} : null}});

test('L17: a sheet with a source video can be reported from the menu; one without says why it cannot', async () => {
  const page = await open('#curl');
  const menu = () => page.element('nav-actions').innerHTML;
  assert.match(menu(), /<h2 id="nav-actions-h">Hammer curl<\/h2>/);
  assert.match(menu(), /id="nav-report">Something wrong\?<\/button>/);
  assert.match(page.element('view').innerHTML, /id="report-open"/, 'the link under the notes stays (L7)');
  await page.fire('nav-more');
  clickIn(page, 'nav-actions', '#nav-report');
  assert.equal(page.element('nav-actions').open, false);
  assert.equal(page.element('report-dlg').open, true);
  page.go('#row'); await settle();
  assert.match(menu(), /id="nav-report" disabled>Something wrong\?<small>No source video<\/small>/);
  assert.doesNotMatch(menu(), /id="ed-open"|id="ses-delete"/);
});

test('L17: a session menu has Edit and Delete session, no Add to session; editing hides « ⋯ »', async () => {
  const page = await open('#session/routine');
  const menu = page.element('nav-actions').innerHTML;
  assert.match(menu, /id="ed-open">Edit</);
  assert.match(menu, /id="mv-open">Move</);
  assert.match(menu, /class="nav-it danger" id="ses-delete">Delete session</);
  assert.doesNotMatch(menu, /id="as-open"|id="sd-open"/);
  assert.equal(page.element('nav-more').hidden, false);
  await page.fire('nav-more');
  clickIn(page, 'nav-actions', '#ses-delete');
  assert.equal(page.element('del-dlg').open, true);
  assert.equal(page.element('del-name').textContent, 'Routine');
  clickIn(page, 'nav-actions', '#ed-open');
  assert.match(page.element('view').innerHTML, /id="ed-title"/);
  assert.equal(page.element('nav-more').hidden, true, 'no menu while editing');
  assert.equal(page.element('nav-actions').innerHTML, '');
});

test('L17: an exercise opened from a session goes back to it; a group grid goes back to its notebook; the menu closes on another page', async () => {
  const page = await open('#session/routine/2');
  assert.equal(page.element('nav-back').textContent, '‹ Routine');
  assert.equal(page.element('nav-title').textContent, 'Row');
  assert.equal(page.element('add-video-fab').hidden, true);
  await page.fire('nav-more');
  assert.equal(page.element('nav-actions').open, true);
  page.go('#strength~Arms'); await settle();
  assert.equal(page.element('nav-actions').open, false);
  assert.equal(page.element('nav-title').textContent, 'Arms');
  assert.equal(page.element('nav-back').textContent, '‹ Strength');
  assert.equal(page.element('nav-more').hidden, true, 'a notebook page has no menu');
  page.go('#'); await settle();
  assert.equal(page.element('nav-bar').hidden, true);
});

test('L17: « + Add a video » says which notebook the link goes to', async () => {
  const page = await open('#strength');
  await page.fire('add-video-fab');
  assert.match(page.element('f-hint').innerHTML, /^It goes to Strength; the group is decided when the video is analysed\./);
  assert.equal(page.element('add-video-fab').hidden, false);
  await page.fire('f-cancel');
  page.go('#'); await settle();
  await page.fire('add-video-fab');
  assert.match(page.element('f-hint').innerHTML, /^Notebook and group are decided when the video is analysed\./);
});
