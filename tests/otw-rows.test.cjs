// P8 R2: readable rows, a row's detail, ghost cards (docs/audit-design/lots/R2.md). A row of « On the way » shows
// its platform tile, « @handle » or the kind of video, « <Notebook> · added today | yesterday | 7 Nov » and its
// state, never the raw address. A tap opens its detail: Open the video, Move to notebook, Remove. A notebook page
// shows its videos on the way as ghost cards; a home notebook card says « 1 on the way » or « 1 needs you ».
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const now = () => new Date().toISOString();
const req = (id, status, extra = {}) => ({id, status, url: `https://www.instagram.com/reel/${id}/`, theme: null, slug: null, note: null, created_at: now(), processed_at: null, ...extra});
const themes = [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}, {id: 'mma', title: 'MMA', groups: [], builtin: true, position: 1}];
const sheet = (slug, extra = {}) => ({slug, kind: 'sheet', theme: 'strength', group: 'Arms', title: `Title ${slug}`, summary: '', exercises: [], source: {}, added_at: '2026-10-01T00:00:00Z', ...extra});
const tables = (requests = [], sheets = [sheet('curl')]) => ({user_themes: themes, sheets, sessions: [], notes: [], requests});
const open = async (opts = {}) => { const page = await app({...signedIn, stored: {'rb.welcome.u1': '1'}, ...opts}); await settle(); return page; };
// a tap inside a delegated container: closest answers the one selector given
const tap = (page, id, sel, dataset = {}) => page.element(id).listeners.click({target: {closest: s => s === sel ? {dataset, disabled: false} : null}});
const rowsOf = page => page.element('queue').innerHTML.split(/<button type="button" class="q qrow"|<div class="q fail">/).slice(1);

test('R2: a row names the video by its handle or its kind, never by its address', async () => {
  const urls = {
    tt: 'https://www.tiktok.com/@coach.ines/video/7312', yt: 'https://www.youtube.com/@MobilityLab/shorts', ys: 'https://www.youtube.com/shorts/aBcD1234',
    yb: 'https://youtu.be/aBcD1234', ig: 'https://www.instagram.com/reel/EXAMPLE0001/', fb: 'https://www.facebook.com/watch/?v=123', fw: 'https://fb.watch/abc/',
    vm: 'https://vm.tiktok.com/ZMabc/', odd: 'not a link'
  };
  const page = await open({tables: tables(Object.entries(urls).map(([id, url]) => req(id, 'queued', {url})))});
  const q = page.element('queue').innerHTML, name = id => (new RegExp(`data-row="${id}"[^]*?<span class="t1">([^<]*)</span>`).exec(q) || [])[1];
  assert.equal(name('tt'), '@coach.ines');
  assert.equal(name('yt'), '@MobilityLab');
  assert.equal(name('ys'), 'YouTube video');
  assert.equal(name('yb'), 'YouTube video');
  assert.equal(name('ig'), 'Instagram reel');
  assert.equal(name('fb'), 'Facebook video');
  assert.equal(name('fw'), 'Facebook video');
  assert.equal(name('vm'), 'TikTok video');
  assert.equal(name('odd'), 'Video link');
  assert.match(q, /data-row="tt"[^]*?<span class="pf lg" aria-hidden="true">TT<\/span>/, 'the platform tile');
  assert.match(q, /data-row="fb"[^]*?>FB<\/span>/);
  assert.doesNotMatch(q, /https?:\/\/|tiktok\.com|instagram\.com/, 'no address on a row that has not failed');
});

test('R2: a row says its notebook and « added today | yesterday | 7 Nov », its tile on the notebook colour', async () => {
  const d = new Date(), at = days => new Date(d.getFullYear(), d.getMonth(), d.getDate() - days, 12).toISOString();
  const page = await open({tables: tables([req('t', 'queued', {theme: 'strength', created_at: now()}), req('y', 'processing', {theme: 'mma', created_at: at(1)}),
    req('o', 'queued', {created_at: at(9)})])});
  const q = page.element('queue').innerHTML;
  assert.match(q, /data-row="t"[^]*?<small>Strength · added today<\/small>/);
  assert.match(q, /data-row="y"[^]*?<small>MMA · added yesterday<\/small>/);
  const old = new Date(at(9)).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'});
  assert.match(q, new RegExp(`data-row="o"[^]*?<small>Added ${old}</small>`), 'Auto: no notebook named');
  assert.match(q, /data-row="t"[^]*?<span class="pf lg" style="--t:var\(--p\d\)" aria-hidden="true">IG<\/span>/);
  assert.match(q, /data-row="y"[^]*?Being made<\/span>/);
  assert.doesNotMatch(q, /Waiting|\d+ ?min|hour/i, 'no « Waiting », no duration');
});

// P8 R3: a failed row says what happened and opens its fix (tests/otw-fix.test.cjs); no button inside the row.
test('R2: a failed row keeps its reason, and the whole row opens its fix', async () => {
  const page = await open({tables: tables([req('e', 'error', {note: 'Video unavailable', theme: 'strength'})])});
  const [row] = rowsOf(page);
  assert.match(row, /^ data-row="e" aria-haspopup="dialog">[^]*?<span class="t1">Instagram reel<\/span>/);
  assert.match(row, /<small class="why">Video unavailable<\/small>/);
  assert.doesNotMatch(row, /data-retry|data-del|<a /, 'no Retry, Remove nor link inside the row');
});

test('R2: a tap on a row opens its detail: its state in one line, Open the video, Move to notebook (Not started only), Remove; Cancel goes back', async () => {
  const page = await open({tables: tables([req('a', 'queued', {theme: 'strength', url: 'https://www.tiktok.com/@coach/video/1'}), req('b', 'processing')])});
  await page.fire('otw-band');
  await tap(page, 'queue', '[data-row]', {row: 'a'});
  const pane = page.element('otw-row');
  assert.equal(pane.hidden, false); assert.equal(page.element('queue').hidden, true); assert.equal(page.element('otw-top').hidden, true);
  assert.match(pane.innerHTML, /<h2 id="otw-rh">@coach<\/h2><p>Strength · added today<\/p><\/div><span class="st">/);
  assert.match(pane.innerHTML, /<p class="rd-why">Nobody has started on it yet\.<\/p>/);
  assert.match(pane.innerHTML, /<a class="mi" href="https:\/\/www\.tiktok\.com\/@coach\/video\/1" target="_blank" rel="noopener">[^]*?Open the video/);
  assert.match(pane.innerHTML, /data-move>[^]*?Move to notebook<\/span><span class="v">Strength<\/span>/);
  assert.match(pane.innerHTML, /class="mi red" data-rdel>[^]*?Remove/);
  assert.match(pane.innerHTML, /data-rback>Cancel/);
  await tap(page, 'otw-row', '[data-rback]');
  assert.equal(pane.hidden, true); assert.equal(page.element('queue').hidden, false); assert.equal(page.element('otw-dlg').open, true, 'back to the list');
  await tap(page, 'queue', '[data-row]', {row: 'b'});
  assert.match(pane.innerHTML, /<h2 id="otw-rh">Instagram reel<\/h2><p>Added today<\/p>/);
  assert.match(pane.innerHTML, /Being made into a sheet\./);
  assert.doesNotMatch(pane.innerHTML, /data-move|Move to notebook/, 'being made: the computer may have read its notebook already, no Move');
  assert.match(pane.innerHTML, /Open the video[^]*?data-rdel/);
});

test('R2: Move to notebook lists the notebooks and writes requests.theme; the row follows at once', async () => {
  const page = await open({tables: tables([req('a', 'queued', {theme: 'strength'})])});
  await page.fire('otw-band');
  await tap(page, 'queue', '[data-row]', {row: 'a'});
  await tap(page, 'otw-row', '[data-move]');
  const pane = page.element('otw-row');
  assert.match(pane.innerHTML, /<h2 id="otw-rh">Move to notebook<\/h2>/);
  assert.match(pane.innerHTML, /data-pick="strength" aria-pressed="true"[^]*?Strength/);
  assert.match(pane.innerHTML, /data-pick="mma" aria-pressed="false"[^]*?MMA/);
  await tap(page, 'otw-row', '[data-pick]', {pick: 'mma'}); await settle();
  const c = page.clients.at(-1), up = c.calls.find(x => x[0] === 'update' && x[1] === 'requests');
  assert.deepEqual(JSON.parse(JSON.stringify(up)), ['update', 'requests', {theme: 'mma'}, [['id', 'a']]]);
  assert.deepEqual(JSON.parse(JSON.stringify(c.ins.find(x => x[0] === 'requests'))), ['requests', 'status', ['queued']], 'only a video not started yet moves');
  assert.match(pane.innerHTML, /<p>MMA · added today<\/p>/);
  assert.match(pane.innerHTML, /<p class="rd-msg" role="status">Moved to MMA\.<\/p>/);
  assert.match(page.element('queue').innerHTML, /<small>MMA · added today<\/small>/);
});

test('R2: a Move the backend refuses puts the notebook back and says so', async () => {
  const page = await open({tables: tables([req('a', 'queued', {theme: 'strength'})]), writes: {requests: {data: null, error: {message: 'permission denied'}}}});
  await page.fire('otw-band');
  await tap(page, 'queue', '[data-row]', {row: 'a'});
  await tap(page, 'otw-row', '[data-move]');
  await tap(page, 'otw-row', '[data-pick]', {pick: 'mma'}); await settle();
  const pane = page.element('otw-row');
  assert.match(pane.innerHTML, /<p>Strength · added today<\/p>/);
  assert.match(pane.innerHTML, /<p class="rd-msg bad" role="status">Could not move it: permission denied<\/p>/);
});

test('R2: Remove in the detail is the list\'s removal, with its Undo', async () => {
  const page = await open({tables: tables([req('a', 'queued'), req('b', 'queued')])});
  await page.fire('otw-band');
  await tap(page, 'queue', '[data-row]', {row: 'a'});
  await tap(page, 'otw-row', '[data-rdel]');
  assert.equal(page.element('otw-row').hidden, true, 'back to the list');
  assert.doesNotMatch(page.element('queue').innerHTML, /data-row="a"/);
  assert.equal(page.element('queue-undo').hidden, false);
  assert.match(page.element('queue-toast').innerHTML, /Removed · Undo/);
  assert.equal(page.clients.at(-1).calls.filter(x => x[0] === 'delete').length, 0, 'nothing sent before the toast ends');
  await page.fire('queue-undo');
  assert.match(page.element('queue').innerHTML, /data-row="a"/);
});

test('R2: a notebook page shows « On the way » ghost cards before its sheets, for its own videos only', async () => {
  const t = tables([req('s1', 'queued', {theme: 'strength', url: 'https://www.tiktok.com/@coach/video/1'}), req('s2', 'error', {theme: 'strength'}),
    req('m1', 'processing', {theme: 'mma'}), req('auto', 'queued')]);
  const page = await open({tables: t, hash: '#strength'});
  const g = page.element('otw-ghosts');
  assert.equal(g.hidden, false);
  assert.match(g.innerHTML, /^<h2 id="otw-gh">On the way <span class="n">2<\/span><\/h2><div class="group-row gcards">/);
  assert.ok(g.innerHTML.indexOf('data-ghost="s2"') < g.innerHTML.indexOf('data-ghost="s1"'), 'Needs you first');
  assert.match(g.innerHTML, /<button type="button" class="gcard" data-ghost="s1" aria-haspopup="dialog" aria-label="@coach, Not started"><span class="pf lg" style="--t:var\(--p\d\)" aria-hidden="true">TT<\/span><span class="gh-t">@coach<\/span><span class="gh-m">Added today<\/span><span class="sp"><\/span><span class="st">/);
  assert.match(g.innerHTML, /data-ghost="s2"[^]*?Needs you/);
  assert.doesNotMatch(g.innerHTML, /data-ghost="m1"|data-ghost="auto"/, 'another notebook\'s video, or one sent with Auto, is not here');
  const home = require('./harness.cjs').html.split('<div id="home"')[1];
  assert.ok(home.indexOf('id="otw-ghosts"') < home.indexOf('id="groups"'), 'before the sheets');
  page.go('#mma'); await settle();
  assert.match(g.innerHTML, /data-ghost="m1"/); assert.doesNotMatch(g.innerHTML, /data-ghost="s1"|data-ghost="auto"/);
  page.go(''); await settle();
  assert.equal(g.hidden, true, 'not on the home page');
  assert.equal(g.innerHTML, '');
});

test('R2: a ghost card opens its detail; Cancel closes the sheet back to the notebook; a failed one opens its fix (R3)', async () => {
  const page = await open({tables: tables([req('s1', 'queued', {theme: 'strength'}), req('s2', 'error', {theme: 'strength'})]), hash: '#strength'});
  await tap(page, 'otw-ghosts', '[data-ghost]', {ghost: 's1'});
  assert.equal(page.element('otw-dlg').open, true);
  assert.equal(page.element('otw-row').hidden, false);
  assert.match(page.element('otw-row').innerHTML, /<p>Strength · added today<\/p>/);
  await tap(page, 'otw-row', '[data-rback]');
  assert.equal(page.element('otw-dlg').open, false);
  await tap(page, 'otw-ghosts', '[data-ghost]', {ghost: 's2'});
  assert.equal(page.element('otw-dlg').open, true);
  assert.equal(page.element('otw-row').hidden, false, 'P8 R3: its fix, directly');
  assert.match(page.element('otw-row').innerHTML, /data-fixdone>Try again</);
});

test('R2: a home notebook card with videos on the way says « 1 on the way » or « 1 needs you », instead of « Nothing yet »', async () => {
  const page = await open({tables: tables([req('s1', 'queued', {theme: 'strength'}), req('m1', 'queued', {theme: 'mma'}), req('m2', 'error', {theme: 'mma'}), req('auto', 'queued')])});
  const cards = page.element('portal').innerHTML.split('<a class="tcard"').slice(1);
  const strength = cards.find(c => /<h2>Strength<\/h2>/.test(c)), mma = cards.find(c => /<h2>MMA<\/h2>/.test(c));
  assert.match(strength, /<p class="nbqs"><span class="nbq"><svg[^]*?<\/svg>1 on the way<\/span><\/p>/);
  assert.match(strength, /aria-label="Strength, 1 sheet, 1 on the way"/);
  assert.match(mma, /<span class="nbq bad"><svg[^]*?<\/svg>1 needs you<\/span>/, 'what needs you comes first');
  assert.doesNotMatch(mma, /Nothing yet/, 'the chip stands in for « Nothing yet »');
  // nothing on the way: no chip, « Nothing yet » is back
  const none = await open({tables: tables([req('auto', 'queued')])});
  const m = none.element('portal').innerHTML.split('<a class="tcard"').slice(1).find(c => /<h2>MMA<\/h2>/.test(c));
  assert.doesNotMatch(none.element('portal').innerHTML, /class="nbq/);
  assert.match(m, /Nothing yet/);
});

test('R2: an Add from a notebook page shows its ghost card at once, before the read that follows', async () => {
  let held = false;
  const hold = (table, ops) => held && table === 'requests' && !ops.some(o => o[0] === 'insert') ? new Promise(() => {}) : null;
  const page = await open({tables: tables([]), hash: '#strength', hold});
  assert.equal(page.element('otw-ghosts').hidden, true);
  await page.fire('add-video-fab');
  page.element('f-url').value = 'https://www.tiktok.com/@coach/video/9';
  held = true;
  await page.fire('sheet-new', 'submit'); await settle();
  const g = page.element('otw-ghosts');
  assert.equal(g.hidden, false);
  assert.match(g.innerHTML, /<span class="gh-t">@coach<\/span>/);
  assert.match(g.innerHTML, /On the way <span class="n">1<\/span>/);
});

test('R2: once done, the ghost card goes and its sheet shows in New', async () => {
  const t = tables([req('a', 'queued', {theme: 'strength', url: 'https://www.tiktok.com/@coach/video/5'})]);
  const page = await open({tables: t, hash: '#strength'});
  assert.match(page.element('otw-ghosts').innerHTML, /data-ghost="a"/);
  // the computer turned it into a sheet meanwhile
  Object.assign(t.requests[0], {status: 'done', slug: 'kick', processed_at: now()});
  t.sheets.push(sheet('kick', {title: 'Front kick', added_at: now(), source: {url: 'https://www.tiktok.com/@coach/video/5'}}));
  await page.doc('visibilitychange', {visibilityState: 'visible'}); await settle();
  assert.equal(page.element('otw-ghosts').hidden, true);
  assert.equal(page.element('otw-ghosts').innerHTML, '');
  page.go(''); await settle();
  assert.equal(page.element('new-sec').hidden, false);
  assert.match(page.element('new-cards').innerHTML, /Front kick/);
  assert.equal(page.element('otw-band').hidden, true, 'nothing on the way any more');
});

// Codex, PR #109: a Move waits for its answer before another can start (two PATCHes could land in the other order).
const holdMove = () => {
  const gate = {wait: null, release: null, sent: []}; // sent: every update asked, held or not (calls has them once answered)
  gate.hold = (table, ops) => {
    const u = table === 'requests' && ops.find(o => o[0] === 'update'); if (!u) return null;
    gate.sent.push(u[1]); return gate.wait;
  };
  gate.arm = () => { gate.wait = new Promise(resolve => { gate.release = v => { gate.wait = null; resolve(v); }; }); };
  return gate;
};

// the backend's rows as a read gives them: copies (the app's optimistic change does not reach the table)
const copied = rows => { const t = tables([]); Object.defineProperty(t, 'requests', {get: () => rows.map(r => ({...r}))}); return t; };

test('R2: one Move at a time per video: while its write is on its way, Move says « Moving… » and does nothing', async () => {
  const gate = holdMove();
  const page = await open({tables: tables([req('a', 'queued', {theme: 'strength'})]), hold: gate.hold});
  await page.fire('otw-band');
  await tap(page, 'queue', '[data-row]', {row: 'a'});
  gate.arm();
  await tap(page, 'otw-row', '[data-move]');
  await tap(page, 'otw-row', '[data-pick]', {pick: 'mma'}); await settle();
  const pane = page.element('otw-row');
  assert.match(pane.innerHTML, /data-move disabled aria-disabled="true">[^]*?<span>Moving…<\/span><span class="v">MMA<\/span>/);
  await tap(page, 'otw-row', '[data-move]');
  assert.doesNotMatch(pane.innerHTML, /Move to notebook<\/h2>/, 'no picker while the first Move waits');
  await tap(page, 'otw-row', '[data-pick]', {pick: 'strength'}); await settle();
  assert.equal(gate.sent.length, 1, 'no second write before the first answers');
  gate.release(null); await settle();
  assert.match(pane.innerHTML, /data-move>[^]*?Move to notebook<\/span><span class="v">MMA<\/span>/, 'Move is back once it answered');
  await tap(page, 'otw-row', '[data-move]');
  await tap(page, 'otw-row', '[data-pick]', {pick: 'strength'}); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(gate.sent)), [{theme: 'mma'}, {theme: 'strength'}], 'one after the other, in the order asked');
});

test('R2: a read landing while a Move waits keeps the notebook moved to; the answer settles it (written, or put back)', async () => {
  const gate = holdMove(), rows = [req('a', 'queued', {theme: 'strength'})];
  const page = await open({tables: copied(rows), hold: gate.hold});
  await page.fire('otw-band');
  await tap(page, 'queue', '[data-row]', {row: 'a'});
  gate.arm();
  await tap(page, 'otw-row', '[data-move]');
  await tap(page, 'otw-row', '[data-pick]', {pick: 'mma'}); await settle();
  // back in Safari while the PATCH waits: the read still has the old notebook
  await page.doc('visibilitychange', {visibilityState: 'visible'}); await settle();
  assert.match(page.element('queue').innerHTML, /<small>MMA · added today<\/small>/, 'the read does not put Strength back');
  assert.match(page.element('otw-row').innerHTML, /<p>MMA · added today<\/p>/);
  rows[0].theme = 'mma'; gate.release(null); await settle(); // the backend wrote it
  await page.doc('visibilitychange', {visibilityState: 'visible'}); await settle();
  assert.match(page.element('queue').innerHTML, /<small>MMA · added today<\/small>/);
  page.go('mma'); await settle();
  assert.match(page.element('otw-ghosts').innerHTML, /data-ghost="a"/, 'the ghost is in MMA');
  page.go('strength'); await settle();
  assert.equal(page.element('otw-ghosts').hidden, true, 'and not in Strength');

  // refused: the notebook goes back, with the reason, even after a read landed meanwhile
  const g2 = holdMove();
  const p2 = await open({tables: copied([req('b', 'queued', {theme: 'strength'})]), hold: g2.hold});
  await p2.fire('otw-band');
  await tap(p2, 'queue', '[data-row]', {row: 'b'});
  g2.arm();
  await tap(p2, 'otw-row', '[data-move]');
  await tap(p2, 'otw-row', '[data-pick]', {pick: 'mma'}); await settle();
  await p2.doc('visibilitychange', {visibilityState: 'visible'}); await settle();
  assert.match(p2.element('queue').innerHTML, /<small>MMA · added today<\/small>/);
  g2.release({data: null, error: {message: 'permission denied'}}); await settle();
  assert.match(p2.element('otw-row').innerHTML, /<p>Strength · added today<\/p>/);
  assert.match(p2.element('otw-row').innerHTML, /<p class="rd-msg bad" role="status">Could not move it: permission denied<\/p>/);
  await p2.doc('visibilitychange', {visibilityState: 'visible'}); await settle();
  assert.match(p2.element('queue').innerHTML, /<small>Strength · added today<\/small>/, 'no move laid over the reads any more');
});

test('R2: a Move refused once its detail is closed says why on its row', async () => {
  const gate = holdMove();
  const page = await open({tables: tables([req('a', 'queued', {theme: 'strength'})]), hold: gate.hold});
  await page.fire('otw-band');
  await tap(page, 'queue', '[data-row]', {row: 'a'});
  gate.arm();
  await tap(page, 'otw-row', '[data-move]');
  await tap(page, 'otw-row', '[data-pick]', {pick: 'mma'}); await settle();
  await tap(page, 'otw-row', '[data-rback]'); // back to the list
  gate.release({data: null, error: {message: 'permission denied'}}); await settle();
  assert.match(page.element('queue').innerHTML, /data-row="a"[^]*?<small>Strength · added today<\/small><small class="qerr" role="alert">Could not move it: permission denied<\/small>/);
  await tap(page, 'queue', '[data-row]', {row: 'a'});
  await tap(page, 'otw-row', '[data-rback]');
  assert.doesNotMatch(page.element('queue').innerHTML, /qerr/, 'gone once its detail was seen');
});

test('R2: a catalogue read that fails once done is tried again by the next queue read; the sheet then shows in New', async () => {
  const t = tables([req('a', 'queued', {theme: 'strength', url: 'https://www.tiktok.com/@coach/video/5'})]), failing = {};
  const page = await open({tables: t, hash: '#strength', failing});
  Object.assign(t.requests[0], {status: 'done', slug: 'kick', processed_at: now()});
  t.sheets.push(sheet('kick', {title: 'Front kick', added_at: now(), source: {url: 'https://www.tiktok.com/@coach/video/5'}}));
  failing.sheets = {error: {message: 'network down'}, status: 0};
  const reads = () => page.clients.at(-1).selects.filter(s => s[0] === 'sheets').length, before = reads();
  await page.doc('visibilitychange', {visibilityState: 'visible'}); await settle();
  assert.equal(page.element('otw-ghosts').hidden, true, 'the ghost went');
  assert.equal(reads() - before, 1, 'one catalogue read, not a loop while it fails');
  page.go(''); await settle();
  assert.doesNotMatch(page.element('new-cards').innerHTML, /Front kick/, 'not read yet');
  delete failing.sheets;
  await page.doc('visibilitychange', {visibilityState: 'visible'}); await settle();
  assert.equal(page.element('new-sec').hidden, false);
  assert.match(page.element('new-cards').innerHTML, /Front kick/, 'the next queue read tried again');
  const n = reads();
  await page.doc('visibilitychange', {visibilityState: 'visible'}); await settle();
  assert.equal(reads(), n, 'once read, not read again');
});

test('R2: while a Move is on its way, Remove is disabled too (no Remove, refused Move, Undo out of order)', async () => {
  const gate = holdMove();
  const page = await open({tables: tables([req('a', 'queued', {theme: 'strength'})]), hold: gate.hold});
  await page.fire('otw-band');
  await tap(page, 'queue', '[data-row]', {row: 'a'});
  gate.arm();
  await tap(page, 'otw-row', '[data-move]');
  await tap(page, 'otw-row', '[data-pick]', {pick: 'mma'}); await settle();
  const pane = page.element('otw-row');
  assert.match(pane.innerHTML, /class="mi red" data-rdel disabled aria-disabled="true">/);
  await tap(page, 'otw-row', '[data-rdel]');
  assert.equal(pane.hidden, false, 'still on the detail');
  assert.equal(page.element('queue-undo').hidden, true, 'no removal started');
  gate.release({data: null, error: {message: 'permission denied'}}); await settle();
  assert.match(pane.innerHTML, /<p>Strength · added today<\/p>/);
  assert.match(pane.innerHTML, /class="mi red" data-rdel>/, 'Remove is back once the Move answered');
  await tap(page, 'otw-row', '[data-rdel]');
  assert.equal(page.element('queue-undo').hidden, false);
});

// Codex, PR #109, pass 2: the catalogue is read again because a video left the list, whatever the read of the
// requests done says; and another account starts with none of the previous one's state.
test('R2: the list read but not the requests done: the ghost goes and the sheet still shows in New', async () => {
  const t = tables([req('a', 'queued', {theme: 'strength', url: 'https://www.tiktok.com/@coach/video/5'})]);
  const doneFails = {on: false};
  const hold = (table, ops) => doneFails.on && table === 'requests' && ops.some(o => o[0] === 'eq' && o[1] === 'status' && o[2] === 'done')
    ? Promise.resolve({data: null, error: {message: 'network down'}}) : null;
  const page = await open({tables: t, hash: '#strength', hold});
  Object.assign(t.requests[0], {status: 'done', slug: 'kick', processed_at: now()});
  t.sheets.push(sheet('kick', {title: 'Front kick', added_at: now(), source: {url: 'https://www.tiktok.com/@coach/video/5'}}));
  doneFails.on = true;
  await page.doc('visibilitychange', {visibilityState: 'visible'}); await settle();
  assert.equal(page.element('otw-ghosts').hidden, true, 'the ghost went');
  page.go(''); await settle();
  assert.equal(page.element('new-sec').hidden, false);
  assert.match(page.element('new-cards').innerHTML, /Front kick/, 'read again although the requests done were not');
});

test('R2: another account signed in without a reload gets its own done sheet shown, even under a slug the first one had', async () => {
  const t = tables([req('a', 'queued', {theme: 'strength', url: 'https://www.tiktok.com/@coach/video/5'})]);
  const page = await open({tables: t, stored: {'rb.welcome.u1': '1', 'rb.welcome.u2': '1'}});
  Object.assign(t.requests[0], {status: 'done', slug: 'squat', processed_at: now()});
  t.sheets.push(sheet('squat', {title: 'Squat of A', added_at: now()}));
  await page.doc('visibilitychange', {visibilityState: 'visible'}); await settle();
  assert.match(page.element('new-cards').innerHTML, /Squat of A/);
  // account B on the same page: its own video on the way, then done under the same slug
  t.requests = [req('b', 'queued', {theme: 'strength', url: 'https://www.youtube.com/@lab/shorts'})]; t.sheets = [sheet('curl')];
  page.clients.at(-1).authListener('SIGNED_IN', {user: {id: 'u2', email: 'b@example.test'}}); await settle();
  assert.match(page.element('queue').innerHTML, /data-row="b"/);
  assert.equal(page.element('new-sec').hidden, true, 'nothing new for B yet'); // (the harness keeps #new-cards' last html)
  Object.assign(t.requests[0], {status: 'done', slug: 'squat', processed_at: now()});
  t.sheets.push(sheet('squat', {title: 'Squat of B', added_at: now()}));
  await page.doc('visibilitychange', {visibilityState: 'visible'}); await settle();
  assert.equal(page.element('new-sec').hidden, false);
  assert.match(page.element('new-cards').innerHTML, /Squat of B/, 'B\'s sheet shows in New');
});
