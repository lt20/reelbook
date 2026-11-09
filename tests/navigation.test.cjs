// L17 (design audit E7): the sticky bar and its « ⋯ » menu, beyond the acceptance tests in tests/acceptance/l17
// (written by Codex). The harness has no history, IntersectionObserver or confirm: Back, the scroll memory and
// « Discard your changes? » are checked in a browser (scratchpad Playwright run, see the PR).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const url = 'https://www.instagram.com/reel/abc/';
// P8 R1: a link already a sheet (curl's source is `url`) is not added twice: the tests add a new one
const fresh = 'https://www.instagram.com/reel/fresh/';
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

test('L17: Back with a link still in « Add a video » asks first, and the queued link keeps its notebook', async () => {
  const page = await open('#strength');
  await page.fire('add-video-fab');
  page.element('f-url').value = fresh;
  await page.fire('nav-back');
  assert.equal(page.element('pending-dlg').open, true);
  assert.equal(page.element('home').hidden, false);
  assert.equal(page.element('nav-title').textContent, 'Strength', 'still on the notebook while it asks');
  await page.fire('pd-queue'); await settle();
  const insert = page.clients.at(-1).calls.find(call => call[0] === 'insert' && call[1] === 'requests');
  assert.equal(insert[2].theme, 'strength');
  assert.equal(page.element('nav-bar').hidden, true, 'then Back goes on, to home');
});

// P8 R1: the notebook chip of the add sheet says it (« Notebook: Strength », else « Notebook: Auto »)
test('L17: « + Add a video » says which notebook the link goes to', async () => {
  const page = await open('#strength');
  await page.fire('add-video-fab');
  assert.equal(page.element('f-nb').value, 'strength');
  assert.match(page.element('f-nb').innerHTML, /^<option value="">Auto<\/option><option value="strength" selected>Strength<\/option>/);
  assert.equal(page.element('add-video-fab').hidden, false);
  await page.fire('f-cancel');
  page.go('#'); await settle();
  await page.fire('add-video-fab');
  assert.equal(page.element('f-nb').value, '');
});

test('L17: the form left open from a notebook to home names no notebook any more, and none is sent', async () => {
  const page = await open('#strength');
  await page.fire('add-video-fab');
  page.go('#'); await settle();
  assert.equal(page.element('sheet-new').hidden, false, 'the form stays open');
  assert.equal(page.element('f-nb').value, '', 'Auto: the chip follows the page');
  page.element('f-url').value = fresh;
  await page.fire('sheet-new', 'submit'); await settle();
  const insert = page.clients.at(-1).calls.find(call => call[0] === 'insert' && call[1] === 'requests');
  assert.equal(insert[2].theme, undefined);
  page.go('#strength'); await settle();
  assert.equal(page.element('f-nb').value, 'strength');
});

// Codex on PR #105: Auto picked in the chip is a choice, kept from one notebook to the next until the sheet closes
test('R1: Auto picked in the chip stays Auto on another notebook, and no notebook is sent', async () => {
  const t = tables(); t.user_themes.push({id: 'mobility', title: 'Mobility', groups: [], builtin: true, position: 1});
  const page = await app({...signedIn, tables: t, hash: '#strength', dom: true}); await settle();
  await page.fire('add-video-fab');
  assert.equal(page.element('f-nb').value, 'strength');
  page.element('f-nb').value = ''; await page.fire('f-nb', 'change');
  page.go('#mobility'); await settle();
  assert.equal(page.element('sheet-new').hidden, false, 'the sheet stays open');
  assert.equal(page.element('f-nb').value, '', 'still Auto on the notebook reached');
  page.element('f-url').value = fresh;
  await page.fire('sheet-new', 'submit'); await settle();
  const insert = page.clients.at(-1).calls.find(call => call[0] === 'insert' && call[1] === 'requests');
  assert.equal(insert[2].theme, undefined);
  // closed and opened again, the chip follows the page again
  await page.fire('add-video-fab');
  assert.equal(page.element('f-nb').value, 'mobility');
});

// Codex on PR #105 (pass 2): a link kept in rb.draft reopens the add sheet only once the routing is decided, and
// the sheet never stays in front of another page (#welcome, the sign-in screen); the link is kept.
test('R1: a kept link on an account with no sheet and no link waits for #welcome, then comes back on home', async () => {
  const empty = {user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}], sheets: [], sessions: [], requests: [], notes: []};
  const page = await app({...signedIn, tables: empty, stored: {'rb.draft': fresh}, dom: true}); await settle();
  assert.equal(page.location.hash, '#welcome');
  assert.equal(page.element('welcome').hidden, false);
  assert.equal(page.element('add-dlg').open, false, 'no sheet in front of the guide');
  assert.equal(page.element('sheet-new').hidden, true);
  assert.equal(page.storage.get('rb.draft'), fresh, 'the link is kept');
  page.go('#'); await settle();
  assert.equal(page.element('home').hidden, false);
  assert.equal(page.element('add-dlg').open, true, 'back on home, the kept link in its sheet');
  assert.equal(page.element('f-url').value, fresh);
});

test('R1: a session revoked while a link is typed closes the add sheet in front of the sign-in screen', async () => {
  const page = await open('#strength');
  await page.fire('add-video-fab');
  page.element('f-url').value = fresh; await page.fire('f-url', 'input');
  assert.equal(page.element('add-dlg').open, true);
  page.clients.at(-1).authListener('SIGNED_OUT', null); await settle();
  assert.equal(page.element('auth').hidden, false);
  assert.equal(page.element('add-dlg').open, false, 'no sheet in front of the sign-in screen');
  assert.equal(page.element('sheet-new').hidden, true);
  assert.equal(page.element('f-url').value, fresh, 'the link stays in the field');
});
