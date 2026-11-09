// P8 R1: the queue is visible again (docs/audit-design/lots/R1.md). The « On the way » band right under the home
// page's bar, never folded; the sheet that lists the videos by state; « + Add a video » as a bottom sheet whose
// confirmation is the band's +1; the queue read again on every move inside the app; no #welcome for an account with
// links sent, which gets its first steps on the home page; a failed read that says so.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const now = () => new Date().toISOString();
const req = (id, status, extra = {}) => ({id, status, url: `https://www.instagram.com/reel/${id}/`, theme: null, slug: null, note: null, created_at: now(), processed_at: null, ...extra});
const themes = [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}];
const sheet = (slug, extra = {}) => ({slug, kind: 'sheet', theme: 'strength', group: 'Arms', title: `Title ${slug}`, summary: '', exercises: [], source: {}, added_at: '2026-10-01T00:00:00Z', ...extra});
const tables = (requests = [], sheets = [sheet('curl')]) => ({user_themes: themes, sheets, sessions: [], notes: [], requests});
const open = async (opts = {}) => { const page = await app({...signedIn, stored: {'rb.welcome.u1': '1'}, ...opts}); await settle(); return page; };
const requestReads = page => page.clients.at(-1).selects.filter(([t, c]) => t === 'requests' && /^id,url,status/.test(c)).length;
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];

test('R1: a pending link shows the band right under the bar, with what needs you in red, never folded', async () => {
  const page = await open({tables: tables([req('a', 'queued'), req('b', 'processing', {theme: 'strength'}), req('c', 'error'), req('d', 'queued')])});
  const band = page.element('otw-band');
  assert.equal(band.hidden, false);
  assert.match(band.innerHTML, /<span class="cnt">4 on the way<\/span><span class="sep" aria-hidden="true">·<\/span><span class="red">1 needs you<\/span>/);
  assert.equal((band.innerHTML.match(/class="pf"/g) || []).length, 3, 'three platform tiles at most');
  // P9 Q: the platform's logo (Instagram's rounded square), not « IG »
  assert.match(band.innerHTML, /<span class="pf" style="--t:var\(--p\d\)"><svg width="16" height="16" viewBox="0 0 24 24"[^>]*aria-hidden="true" focusable="false"><rect x="3.5" y="3.5" width="17" height="17" rx="5"\/>/, 'a tile in the colour of the notebook asked for');
  assert.doesNotMatch(band.innerHTML, />(IG|TT|YT|FB)</);
  // markup: a button, right after the brand bar, before everything else of the home page
  const home = html.split('<div id="home"')[1];
  assert.ok(home.indexOf('id="otw-band"') > home.indexOf('</header>') && home.indexOf('id="otw-band"') < home.indexOf('id="count"'));
  assert.match(html, /<button type="button" class="otw-band" id="otw-band" aria-haspopup="dialog" aria-controls="otw-dlg" hidden><\/button>/);
  assert.doesNotMatch(html, /rb\.queueOpen|queue-toggle|queue-summary/, 'no fold left');
});

test('R1: the band is absent when nothing is on the way, and on a notebook page', async () => {
  const none = await open({tables: tables([req('done1', 'done', {processed_at: now()})])});
  assert.equal(none.element('otw-band').hidden, true);
  const nb = await open({tables: tables([req('a', 'queued')]), hash: '#strength'});
  assert.equal(nb.element('home').hidden, false);
  assert.equal(nb.element('otw-band').hidden, true);
  nb.go(''); await settle();
  assert.equal(nb.element('otw-band').hidden, false);
});

test('R1: the band opens « On the way »: Needs you, Being made, Not started, Ready, then the mode line', async () => {
  const t = tables([req('q', 'queued'), req('p', 'processing'), req('e', 'error', {note: 'Video unavailable'}),
    req('r', 'done', {slug: 'curl', processed_at: now()})]);
  const page = await open({tables: t});
  await page.fire('otw-band');
  assert.equal(page.element('otw-dlg').open, true);
  const q = page.element('queue').innerHTML;
  const at = s => q.indexOf(s);
  for (const s of ['>Needs you <span class="n">1</span>', '>Being made <span class="n">1</span>', '>Not started <span class="n">1</span>', '>Ready <span class="n">1</span>']) assert.ok(at(s) >= 0, s);
  assert.ok(at('>Needs you <') < at('>Being made <') && at('>Being made <') < at('>Not started <') && at('>Not started <') < at('>Ready <'));
  assert.match(q, /<h3 class="otw-sec needs">Needs you/, 'only Needs you is red');
  assert.match(q, /<a href="#curl">Title curl<\/a>/, 'Ready links to its sheet');
  assert.doesNotMatch(q, /Waiting/);
  assert.equal(page.element('otw-mode').textContent, 'Your computer picks these up on its next run.');
  assert.match(html, /hosted: 'Reelbook is preparing these\.'/, 'the hosted wording is one constant');
  // an opened sheet is not Ready any more
  const seen = await open({tables: t, stored: {'rb.welcome.u1': '1', 'rb.seen.u1': '["curl"]'}});
  await seen.fire('otw-band');
  assert.doesNotMatch(seen.element('queue').innerHTML, />Ready </);
  // a move inside the app closes the sheet
  page.go('#curl'); await settle();
  assert.equal(page.element('otw-dlg').open, false);
});

test('R1: Add closes the sheet and plays the band\'s +1, with no green flash', async () => {
  const t = tables([req('a', 'queued')]);
  const page = await open({tables: t});
  assert.match(page.element('otw-band').innerHTML, /<span class="cnt">1 on the way/);
  await page.fire('add-video-fab');
  assert.equal(page.element('add-dlg').open, true);
  assert.equal(page.element('sheet-new').hidden, false);
  page.element('f-url').value = 'https://www.tiktok.com/@coach/video/1';
  t.requests.unshift(req('b', 'queued', {url: 'https://www.tiktok.com/@coach/video/1'})); // what the insert writes
  await page.fire('sheet-new', 'submit'); await settle();
  const insert = page.clients.at(-1).calls.find(c => c[0] === 'insert');
  assert.deepEqual(JSON.parse(JSON.stringify(insert.slice(0, 3))), ['insert', 'requests', {url: 'https://www.tiktok.com/@coach/video/1'}]);
  assert.equal(page.element('add-dlg').open, false);
  assert.equal(page.element('sheet-new').hidden, true);
  assert.match(page.element('otw-band').innerHTML, /<span class="cnt bump">2 on the way/);
  assert.equal(page.element('flash').hidden, true, 'no flash');
  assert.equal(page.element('flash').textContent, '');
  // the +1 plays once, and only without reduced motion
  page.go('#strength'); await settle(); page.go(''); await settle();
  assert.match(page.element('otw-band').innerHTML, /<span class="cnt">2 on the way/);
  assert.match(css, /@media \(prefers-reduced-motion:no-preference\)\{\.otw-band \.cnt\.bump\{animation:otw-bump/);
  assert.match(css, /@keyframes otw-bump\{0%\{transform:scale\(1\)\}45%\{transform:scale\(1\.15\)\}100%\{transform:scale\(1\)\}\}/);
});

test('R1: the add sheet: Paste link first, the notebook chip, the filled Add; errors under the field', async () => {
  const sheetHtml = html.match(/<dialog class="dlg add-dlg" id="add-dlg"[\s\S]*?<\/dialog>/)[0];
  const at = s => sheetHtml.indexOf(s);
  assert.ok(at('id="paste-link"') < at('id="f-url"') && at('id="f-url"') < at('id="f-err"') && at('id="f-err"') < at('class="nbchip"') && at('class="nbchip"') < at('id="f-submit"'));
  assert.match(sheetHtml, /<label class="nbchip">Notebook: <select id="f-nb"><\/select><\/label>/);
  assert.match(sheetHtml, /<button class="btn" type="submit" id="f-submit">Add<\/button>/);
  assert.doesNotMatch(html, /It shows in the queue on the home page|Expect 10 to 15 minutes|minutes per sheet/);
  const page = await open({tables: tables([req('a', 'queued')], [sheet('curl', {source: {url: 'https://www.instagram.com/reel/made/'}})])});
  await page.fire('add-video-fab');
  assert.equal(page.element('f-nb').value, '', 'Auto on the home page');
  const tryUrl = async v => { page.element('f-url').value = v; await page.fire('sheet-new', 'submit'); await settle(); return page.element('f-err'); };
  assert.equal((await tryUrl('')).textContent, 'Paste a video link first.');
  assert.equal((await tryUrl('https://vimeo.com/1')).textContent, "This link isn't from Instagram, TikTok, YouTube or Facebook.");
  assert.equal((await tryUrl('not a link')).textContent, "This link isn't from Instagram, TikTok, YouTube or Facebook.");
  assert.equal((await tryUrl('https://www.instagram.com/reel/a/')).textContent, 'This video is already in your list. Find it under On the way.');
  assert.equal((await tryUrl('https://www.instagram.com/reel/made/')).textContent, 'You already have this video: “Title curl”.', 'P8 R20: already a sheet, by its title');
  assert.equal(page.element('f-err').hidden, false);
  assert.equal(page.element('add-dlg').open, true, 'the sheet stays open on an error');
  assert.equal(page.clients.at(-1).calls.filter(c => c[0] === 'insert').length, 0);
  // a notebook picked in the chip is sent
  page.element('f-nb').value = 'strength'; await page.fire('f-nb', 'change');
  await tryUrl('https://youtu.be/xyz');
  assert.deepEqual(JSON.parse(JSON.stringify(page.clients.at(-1).calls.find(c => c[0] === 'insert')[2])), {url: 'https://youtu.be/xyz', theme: 'strength'});
});

test('R1: the queue is read again on every move inside the app back to home or a notebook', async () => {
  const page = await open({tables: tables([req('a', 'queued')]), dom: true});
  const n0 = requestReads(page);
  page.go('#curl'); await settle();
  assert.equal(requestReads(page), n0, 'a sheet page reads no queue');
  page.go(''); await settle();
  assert.equal(requestReads(page), n0 + 1, 'back home: read');
  page.go('#strength'); await settle();
  assert.equal(requestReads(page), n0 + 2, 'a notebook: read');
});

test('R1: an account with links sent and no sheet stays on the home page, with its first steps and the band', async () => {
  const page = await app({...signedIn, tables: tables([req('a', 'queued'), req('b', 'queued')], [])}); await settle();
  assert.equal(page.location.hash, '', 'no redirect to #welcome');
  assert.equal(page.element('home').hidden, false);
  assert.equal(page.element('otw-band').hidden, false);
  const c = page.element('first-steps');
  assert.equal(c.hidden, false);
  assert.match(c.innerHTML, /<h2 id="first-h">Get your first sheet<\/h2><span class="meta">2 of 3 done<\/span>/);
  assert.match(c.innerHTML, /class="ck y"[\s\S]*?<div class="t1">Account<\/div>/);
  assert.match(c.innerHTML, /class="ck y"[\s\S]*?<div class="t1">2 videos sent<\/div>/);
  assert.match(c.innerHTML, /<span class="ck n" aria-hidden="true">3<\/span><div><div class="t1">Turn them into sheets<\/div>/);
  assert.match(c.innerHTML, /<a class="btn" href="#welcome"><svg[^>]*>[\s\S]*?<\/svg>Set up my computer<\/a>/);
  // the steps leave with the first sheet
  const made = await open({tables: tables([req('a', 'queued')])});
  assert.equal(made.element('first-steps').hidden, true);
  // #welcome stays reachable from Settings
  assert.match(html, /<div id="settings"[\s\S]*?<a href="#welcome">Full guide<\/a>/);
});

test('R1: the redirect to #welcome stays for an account with no sheet and no link', async () => {
  const page = await app({...signedIn, tables: tables([], [])}); await settle();
  assert.equal(page.location.hash, '#welcome');
  // a queue that cannot be read sends nowhere: the home page says it
  const failed = await app({...signedIn, tables: tables([], []), failing: {requests: {error: {message: 'offline'}, status: 0}}}); await settle();
  assert.equal(failed.location.hash, '');
  assert.match(failed.element('otw-band').innerHTML, /Couldn't load your videos/);
});

test('R1: a failed queue read shows « Couldn\'t load your videos · Retry », and the tap reads again', async () => {
  const failing = {requests: {error: {message: 'offline'}, status: 0}};
  const page = await open({tables: tables([req('a', 'queued')]), failing});
  const band = page.element('otw-band');
  assert.equal(band.hidden, false);
  assert.match(band.innerHTML, /Couldn't load your videos<span class="sep" aria-hidden="true">·<\/span><span class="act">Retry<\/span>/);
  const n0 = requestReads(page);
  delete failing.requests; // back online
  await page.fire('otw-band'); await settle();
  assert.equal(requestReads(page), n0 + 1);
  assert.notEqual(page.element('otw-dlg').open, true, 'Retry reads, it does not open the list');
  assert.match(band.innerHTML, /1 on the way/);
});

// Codex on PR #105 (pass 3): the row written is in the list at once, before the read that follows the insert
const added = 'https://www.tiktok.com/@coach/video/9';
const addTwice = async page => {
  const submit = async () => { await page.fire('add-video-fab'); page.element('f-url').value = added; await page.fire('sheet-new', 'submit'); await settle(); };
  await submit();
  const band = page.element('otw-band').innerHTML;
  await submit();
  return band;
};
const inserts = page => page.clients.at(-1).calls.filter(c => c[0] === 'insert').length;

test('R1: a read of the queue still on its way: the +1 plays at once and the same link is refused', async () => {
  const t = tables([req('a', 'queued')]), waiting = []; let stuck = false;
  const page = await open({tables: t, hold: (table, ops) => stuck && table === 'requests' && !ops.some(o => o[0] === 'insert') ? new Promise(r => waiting.push(r)) : null});
  stuck = true;
  assert.match(await addTwice(page), /<span class="cnt bump">2 on the way/, 'the +1, before the read lands');
  assert.equal(page.element('f-err').textContent, 'This video is already in your list. Find it under On the way.');
  assert.equal(inserts(page), 1, 'sent once');
  // the read lands with the row written: it replaces the list, the row is not counted twice
  stuck = false; t.requests.unshift(req('b', 'queued', {url: added}));
  for (const r of waiting) r(); await settle();
  assert.match(page.element('otw-band').innerHTML, /2 on the way/);
});

test('R1: a read of the queue that fails after an add keeps the row added; the same link is refused', async () => {
  const t = tables([req('a', 'queued')]); let down = false;
  const page = await open({tables: t, hold: (table, ops) => down && table === 'requests' && !ops.some(o => o[0] === 'insert') ? Promise.resolve({data: null, error: {message: 'offline'}, status: 0}) : null});
  down = true;
  assert.match(await addTwice(page), /<span class="cnt bump">2 on the way/, 'the +1 stays: no « Couldn\'t load » over it');
  assert.doesNotMatch(page.element('otw-band').innerHTML, /Couldn't load/);
  assert.equal(page.element('f-err').textContent, 'This video is already in your list. Find it under On the way.');
  assert.equal(inserts(page), 1, 'sent once');
  // the next read, still offline, says it; back online, the list read replaces the one kept
  page.go('#strength'); await settle(); page.go(''); await settle();
  assert.match(page.element('otw-band').innerHTML, /Couldn't load your videos/);
  down = false; t.requests.unshift(req('b', 'queued', {url: added}));
  await page.fire('otw-band'); await settle();
  assert.match(page.element('otw-band').innerHTML, /<span class="cnt">2 on the way/);
});
