// P9 lot Q: videos on the way (docs/audit-design/lots/P9-Q.md, decisions 2, 6, 7 of P9-refonte.md). A ghost card has
// the shape of a sheet card (its notebook's tint, the platform logo, its state bottom left); a tap opens an anchored
// menu, not the sheet: a state line, What to do (Needs you), Open the video, Move to notebook (Not started), a gap,
// Remove in red. The menu's actions are the row's own (its fix, its move, its removal with « Removed · Undo »).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const now = () => new Date().toISOString();
const req = (id, status, extra = {}) => ({id, status, url: `https://www.instagram.com/reel/${id}/`, theme: 'strength', slug: null, note: null, created_at: now(), processed_at: null, ...extra});
const fail = (id, reason, extra = {}) => req(id, 'error', {reason, note: 'detail from the run', processed_at: now(), ...extra});
const themes = [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}, {id: 'mma', title: 'MMA', groups: [], builtin: true, position: 1}];
const sheet = (slug, extra = {}) => ({slug, kind: 'sheet', theme: 'strength', group: 'Arms', title: `Title ${slug}`, summary: '', exercises: [], source: {}, added_at: '2026-10-01T00:00:00Z', ...extra});
const tables = (requests = []) => ({user_themes: themes, sheets: [sheet('curl')], sessions: [], notes: [], requests});
const open = async (requests, opts = {}) => { const page = await app({...signedIn, stored: {'rb.welcome.u1': '1'}, hash: '#strength', tables: tables(requests), ...opts}); await settle(); return page; };
const tap = (page, id, sel, dataset = {}) => page.element(id).listeners.click({target: {closest: s => s === sel ? {dataset, disabled: false} : null}});
const menuOf = async (page, id) => { await tap(page, 'otw-ghosts', '[data-ghost]', {ghost: id}); return page.element('otw-cm').innerHTML; };
const items = m => [...m.matchAll(/data-cm="(\w+)"/g)].map(x => x[1]);
const key = (page, k) => page.element('otw-menu').listeners.keydown({key: k, preventDefault() {}});
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];

test('P9 Q: a ghost card shows its platform logo and its state, each with an icon and its words', async () => {
  const page = await open([req('q', 'queued', {url: 'https://www.tiktok.com/@coach/video/1'}), req('p', 'processing', {url: 'https://www.youtube.com/shorts/x1'}),
    fail('f', 'signin_required'), req('b', 'queued', {url: 'https://www.facebook.com/watch/?v=1'})]);
  const g = page.element('otw-ghosts').innerHTML, card = id => g.split(`data-ghost="${id}"`)[1].split('</button>')[0];
  assert.match(card('q'), /<span class="gst"><svg[^>]*><circle cx="12" cy="12" r="8.5"\/>[^]*?<\/svg>Not started<\/span>/, 'a clock');
  assert.match(card('p'), /<span class="gst proc"><svg class="otw-spin"[^]*?<\/svg>Being made<\/span>/, 'a ring that turns');
  assert.match(card('f'), /<span class="gst fail"><span class="bang" aria-hidden="true">!<\/span>Needs you<\/span>/);
  assert.match(card('q'), /<path d="M14 3.5v11a3.75/, 'TikTok');
  assert.match(card('p'), /<rect x="2.5" y="5.5" width="19" height="13" rx="4"\/>/, 'YouTube');
  assert.match(card('f'), /<rect x="3.5" y="3.5" width="17" height="17" rx="5"\/>/, 'Instagram');
  assert.match(card('b'), /<circle cx="12" cy="12" r="9"\/>/, 'Facebook');
  assert.match(card('b'), /<span class="gh-t">Facebook video<\/span><span class="gh-m">Added today<\/span>/);
  assert.ok(g.indexOf('data-ghost="f"') < g.indexOf('data-ghost="p"') && g.indexOf('data-ghost="p"') < g.indexOf('data-ghost="q"'), 'Needs you, Being made, Not started');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.otw-spin\{animation:none\}\}/, 'still with reduced motion');
  assert.match(css, /\.gcard \.gimg\{[^}]*aspect-ratio:4\/5;[^}]*background:color-mix\(in srgb,var\(--t,var\(--accent\)\) 13%,var\(--paper\)\)/, 'the 4:5 image area of a sheet card, tinted');
});

test('P9 Q: the menu of a video not started: its state line, Open the video, Move to notebook, a gap, Remove', async () => {
  const page = await open([req('q', 'queued')]);
  const m = await menuOf(page, 'q');
  assert.equal(page.element('otw-menu').open, true);
  assert.notEqual(page.element('otw-dlg').open, true, 'not the sheet');
  assert.match(m, /^<p class="cst" id="otw-cst" role="none">Not started · added today<\/p>/);
  assert.match(m, /<a class="it" role="menuitem" data-cm="open" href="https:\/\/www\.instagram\.com\/reel\/q\/" target="_blank" rel="noopener"><span class="l">Open the video<\/span>/);
  assert.match(m, /data-cm="move"><span class="l">Move to notebook<small>Strength<\/small><\/span>/);
  assert.match(m, /<div class="gap" role="separator"><\/div><button type="button" class="it red" role="menuitem" data-cm="rm"><span class="l">Remove<\/span>/);
  assert.deepEqual(items(m), ['open', 'move', 'rm']);
});

test('P9 Q: being made: no Move; Needs you: What to do first, its state line in red; nothing to read: its reason', async () => {
  const page = await open([req('p', 'processing'), fail('f', 'signin_required'), fail('x', 'private'), fail('o', 'other', {note: 'ffmpeg failed'})]);
  let m = await menuOf(page, 'p');
  assert.match(m, /^<p class="cst" id="otw-cst" role="none">Being made · added today<\/p>/);
  assert.deepEqual(items(m), ['open', 'rm']);
  key(page, 'Escape');
  m = await menuOf(page, 'f');
  assert.match(m, /^<p class="cst bad" id="otw-cst" role="none"><span class="bang" aria-hidden="true">!<\/span><span>Needs you · Sign in to Instagram again<\/span><\/p>/);
  assert.deepEqual(items(m), ['fix', 'open', 'rm']);
  assert.match(m, /data-cm="fix"><span class="l">What to do<\/span>/);
  key(page, 'Escape');
  m = await menuOf(page, 'x');
  assert.match(m, /Needs you · This video is private/);
  key(page, 'Escape');
  m = await menuOf(page, 'o');
  assert.match(m, /Needs you · This video could not be made/);
  await tap(page, 'otw-menu', '[data-cm]', {cm: 'fix'});
  assert.equal(page.element('otw-menu').open, false);
  assert.equal(page.element('otw-dlg').open, true, 'its fix, in the sheet');
  assert.match(page.element('otw-row').innerHTML, /<p class="fx-why">ffmpeg failed<\/p>/);
});

test('P9 Q: Move to notebook opens its notebooks in place, a check on the current one; a pick moves it and closes the menu', async () => {
  const page = await open([req('q', 'queued')], {timerCap: 1000}); // the toast's 4 s stay
  await menuOf(page, 'q');
  await tap(page, 'otw-menu', '[data-cm]', {cm: 'move'});
  const m = page.element('otw-cm').innerHTML;
  assert.match(m, /<button type="button" class="it hd" role="menuitem" data-cm="back"><svg[^]*?<\/svg><span class="l">Move to notebook<\/span><\/button>/);
  assert.match(m, /role="menuitemradio" aria-checked="true" data-cm="pick" data-pick="strength" style="--t:var\(--p\d\)"><span class="ck"><svg[^]*?<\/svg><\/span><span class="l">Strength<\/span>/);
  assert.match(m, /aria-checked="false" data-cm="pick" data-pick="mma"[^>]*><span class="ck"><\/span><span class="l">MMA<\/span>/);
  assert.doesNotMatch(m, /data-cm="rm"/);
  // back, then the current notebook again: nothing sent
  await tap(page, 'otw-menu', '[data-cm]', {cm: 'back'});
  assert.deepEqual(items(page.element('otw-cm').innerHTML), ['open', 'move', 'rm']);
  await tap(page, 'otw-menu', '[data-cm]', {cm: 'move'});
  await tap(page, 'otw-menu', '[data-cm]', {cm: 'pick', pick: 'strength'}); await settle();
  assert.equal(page.element('otw-menu').open, false);
  assert.equal(page.clients.at(-1).calls.filter(x => x[0] === 'update').length, 0);
  // another notebook: the row's own move
  await menuOf(page, 'q');
  await tap(page, 'otw-menu', '[data-cm]', {cm: 'move'});
  await tap(page, 'otw-menu', '[data-cm]', {cm: 'pick', pick: 'mma'}); await settle();
  assert.equal(page.element('otw-menu').open, false);
  const up = page.clients.at(-1).calls.find(x => x[0] === 'update' && x[1] === 'requests');
  assert.deepEqual(JSON.parse(JSON.stringify(up)), ['update', 'requests', {theme: 'mma'}, [['id', 'q']]]);
  assert.equal(page.element('otw-said').textContent, 'Moved to MMA');
  assert.equal(page.element('otw-said').hidden, false);
  assert.equal(page.element('otw-ghosts').hidden, true, 'it left this notebook');
});

test('P9 Q: a Move refused says why in the toast, and the video comes back', async () => {
  const hold = (table, ops) => table === 'requests' && ops.some(o => o[0] === 'update') ? Promise.resolve({data: null, error: {message: 'permission denied'}}) : null;
  const page = await open([req('q', 'queued')], {hold, timerCap: 1000});
  await menuOf(page, 'q');
  await tap(page, 'otw-menu', '[data-cm]', {cm: 'move'});
  await tap(page, 'otw-menu', '[data-cm]', {cm: 'pick', pick: 'mma'}); await settle();
  assert.equal(page.element('otw-said').textContent, 'Could not move it: permission denied');
  assert.match(page.element('otw-ghosts').innerHTML, /data-ghost="q"/, 'back in Strength');
});

test('P9 Q: Remove takes it off at once, with « Removed · Undo »; Undo puts it back; nothing sent before the toast ends', async () => {
  const page = await open([req('q', 'queued'), req('r', 'queued')]);
  await menuOf(page, 'q');
  await tap(page, 'otw-menu', '[data-cm]', {cm: 'rm'});
  assert.equal(page.element('otw-menu').open, false);
  assert.doesNotMatch(page.element('otw-ghosts').innerHTML, /data-ghost="q"/);
  assert.equal(page.element('queue-undo').hidden, false);
  assert.match(page.element('queue-toast').innerHTML, /^Removed · Undo/);
  assert.equal(page.clients.at(-1).calls.filter(x => x[0] === 'delete').length, 0);
  await page.fire('queue-undo');
  assert.match(page.element('otw-ghosts').innerHTML, /data-ghost="q"/);
  // removed again, the toast's bar ends: the delete goes
  await menuOf(page, 'q');
  await tap(page, 'otw-menu', '[data-cm]', {cm: 'rm'});
  await page.fire('queue-undo', 'animationend'); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(page.clients.at(-1).calls.find(x => x[0] === 'delete'))).slice(0, 2), ['delete', 'requests']);
});

test('P9 Q: the focus goes into the menu; Escape or a tap outside closes it and gives it back to the card; the arrows move in it', async () => {
  const page = await open([req('q', 'queued')]);
  await menuOf(page, 'q');
  assert.equal(page.focused.at(-1), 'otw-cm', 'into the menu');
  key(page, 'ArrowDown'); key(page, 'Home'); key(page, 'End'); // handled (no item to move to in the harness), no error
  key(page, 'Escape');
  assert.equal(page.element('otw-menu').open, false);
  assert.equal(page.focused.at(-1), 'otw-g-q', 'back to the card');
  await menuOf(page, 'q');
  await tap(page, 'otw-menu', 'the veil');
  assert.equal(page.element('otw-menu').open, false);
  assert.equal(page.focused.at(-1), 'otw-g-q');
  // an action does not send the focus back to the card
  await menuOf(page, 'q');
  const n = page.focused.length;
  await tap(page, 'otw-menu', '[data-cm]', {cm: 'open'});
  assert.equal(page.element('otw-menu').open, false, 'Open the video closes it (the link opens the video)');
  assert.equal(page.focused.length, n);
  // the menu markup: a modal dialog labelled by its state line, a role="menu" that can take the focus
  assert.match(html, /<dialog class="otw-menu" id="otw-menu" aria-labelledby="otw-cst"><div class="otw-lift" id="otw-lift" aria-hidden="true" inert><\/div><div class="otw-cm" id="otw-cm" role="menu" aria-labelledby="otw-cst" tabindex="-1"><\/div><\/dialog>/);
});

test('P9 Q: a menu whose video is done or started meanwhile follows: it closes, or loses Move', async () => {
  const rows = [req('q', 'queued'), req('d', 'queued')];
  const page = await open(rows);
  await menuOf(page, 'q');
  rows[0].status = 'processing';
  await page.doc('visibilitychange', {visibilityState: 'visible'}); await settle();
  assert.equal(page.element('otw-menu').open, true);
  assert.deepEqual(items(page.element('otw-cm').innerHTML), ['open', 'rm'], 'no Move once being made');
  assert.match(page.element('otw-cm').innerHTML, /Being made · added today/);
  key(page, 'Escape');
  await menuOf(page, 'd');
  rows.splice(1, 1); // done: out of the list
  await page.doc('visibilitychange', {visibilityState: 'visible'}); await settle();
  assert.equal(page.element('otw-menu').open, false);
});

test('P9 Q: the fix guide says « Settings, then Set up your computer »; the welcome button keeps « Set up my computer »', async () => {
  const page = await open([fail('n', 'needs_computer')]);
  await menuOf(page, 'n');
  await tap(page, 'otw-menu', '[data-cm]', {cm: 'fix'});
  const f = page.element('otw-row').innerHTML;
  assert.match(f, /Set up your computer once: Settings, then Set up your computer\./);
  assert.doesNotMatch(f, /Set up my computer/);
  assert.match(html, /Set up my computer<\/a>/, 'where the user speaks, « my » stays');
});

// Codex pass 1 on PR #130: the menu belongs to the page and to the account it was opened for.
test('P9 Q: the menu closes and empties on a page change (Settings, Back) and on an account change (signed out in another tab)', async () => {
  const page = await open([req('q', 'queued')]);
  await menuOf(page, 'q');
  page.go('#settings'); await settle();
  assert.equal(page.element('otw-menu').open, false, 'Settings: closed');
  assert.equal(page.element('otw-cm').innerHTML, '', 'and emptied (no link to the video left)');
  page.go('#strength'); await settle();
  await menuOf(page, 'q');
  assert.equal(page.element('otw-menu').open, true);
  page.clients.at(-1).authListener('SIGNED_OUT', null); await settle();
  assert.equal(page.element('otw-menu').open, false, 'signed out: closed');
  assert.equal(page.element('otw-cm').innerHTML, '');
  assert.doesNotMatch(page.element('otw-cm').innerHTML + page.element('otw-lift').innerHTML, /instagram|Strength/);
});

test('P9 Q: another account signed in while the menu is open: the menu of the previous account is gone', async () => {
  const page = await open([req('q', 'queued')]);
  await menuOf(page, 'q');
  page.clients.at(-1).authListener('SIGNED_IN', {user: {id: 'u2', email: 'other@example.test'}}); await settle();
  assert.equal(page.element('otw-menu').open, false);
  assert.equal(page.element('otw-cm').innerHTML, '');
});

test('P9 Q: a Remove from the menu whose delete fails: the card comes back, the page says so, and its menu too', async () => {
  const hold = (table, ops) => table === 'requests' && ops.some(o => o[0] === 'delete') ? Promise.resolve({data: null, error: {message: 'network down'}}) : null;
  const page = await open([req('q', 'queued')], {hold, timerCap: 1000});
  await menuOf(page, 'q');
  await tap(page, 'otw-menu', '[data-cm]', {cm: 'rm'});
  assert.doesNotMatch(page.element('otw-ghosts').innerHTML, /data-ghost="q"/);
  await page.fire('queue-undo', 'animationend'); await settle(); // Undo expired: the delete goes, and fails
  assert.match(page.element('otw-ghosts').innerHTML, /data-ghost="q"/, 'the card is back');
  assert.equal(page.element('otw-said').textContent, 'Could not remove it. Try again.');
  assert.equal(page.element('otw-said').hidden, false, 'visible on the page (the list is closed)');
  const m = await menuOf(page, 'q');
  assert.match(m, /^<p class="cst" id="otw-cst" role="none">Not started · added today<\/p><p class="cst bad gerr" role="alert">Could not remove it: network down<\/p>/);
  assert.deepEqual(items(m), ['open', 'move', 'rm'], 'Remove can be tried again');
});

// Codex pass 2 on PR #130: a redraw keeps the focus by the action, not by its place in the menu. The harness has no
// DOM: the menu's items are read from its html (one object per action, so the focus can be followed).
const fakeItems = page => {
  const cm = page.element('otw-cm'), made = new Map(), got = [];
  cm.querySelectorAll = () => [...cm.innerHTML.matchAll(/<(?:button|a) ([^>]*class="it[^"]*"[^>]*)>/g)].filter(m => !/\sdisabled/.test(m[1])).map(m => {
    const cmv = (m[1].match(/data-cm="(\w+)"/) || [])[1], pick = (m[1].match(/data-pick="([\w-]+)"/) || [])[1], k = `${cmv}|${pick || ''}`;
    if (!made.has(k)) made.set(k, {dataset: {cm: cmv, ...(pick ? {pick} : {})}, getAttribute: () => null, focus() { got.push(k); }});
    return made.get(k);
  });
  return {item: k => made.get(k) || cm.querySelectorAll().find(x => `${x.dataset.cm}|${x.dataset.pick || ''}` === k), got};
};
test('P9 Q: focus on Move, the video starts meanwhile: Move goes, the focus goes to the menu, never to Remove', async () => {
  const rows = [req('q', 'queued')];
  const page = await open(rows);
  await menuOf(page, 'q');
  const f = fakeItems(page), move = f.item('move|');
  assert.ok(move, 'Move is there');
  rows[0].status = 'processing';
  const n = page.focused.length;
  await page.doc('visibilitychange', {visibilityState: 'visible', activeElement: move}); await settle();
  assert.deepEqual(items(page.element('otw-cm').innerHTML), ['open', 'rm'], 'no Move any more');
  assert.ok(!f.got.includes('rm|'), 'Remove never gets the focus (Enter would remove the video)');
  assert.deepEqual(page.focused.slice(n), ['otw-cm'], 'the menu itself');
});

test('P9 Q: a redraw keeps the focus on the same action (a failure appearing, the sub-menu left by a start)', async () => {
  const rows = [req('q', 'queued')];
  const page = await open(rows);
  await menuOf(page, 'q');
  let f = fakeItems(page);
  const openIt = f.item('open|');
  Object.assign(rows[0], {status: 'error', reason: 'signin_required', note: 'x', processed_at: now()});
  await page.doc('visibilitychange', {visibilityState: 'visible', activeElement: openIt}); await settle();
  assert.deepEqual(items(page.element('otw-cm').innerHTML), ['fix', 'open', 'rm'], 'What to do comes first');
  assert.deepEqual(f.got, ['open|'], 'still on Open the video, not on What to do');
  key(page, 'Escape');
  // in the sub-menu, focus on MMA; the video starts: the sub-menu goes, the focus to the menu
  Object.assign(rows[0], {status: 'queued', reason: null, note: null});
  await page.doc('visibilitychange', {visibilityState: 'visible', activeElement: null}); await settle();
  await menuOf(page, 'q');
  await tap(page, 'otw-menu', '[data-cm]', {cm: 'move'});
  f = fakeItems(page);
  const mma = f.item('pick|mma');
  assert.ok(mma);
  rows[0].status = 'processing';
  const n = page.focused.length;
  await page.doc('visibilitychange', {visibilityState: 'visible', activeElement: mma}); await settle();
  assert.deepEqual(items(page.element('otw-cm').innerHTML), ['open', 'rm']);
  assert.deepEqual(f.got, [], 'no action focused');
  assert.deepEqual(page.focused.slice(n), ['otw-cm']);
});
