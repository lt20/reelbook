// P8 R3: failures sorted by who can act (docs/audit-design/lots/R3.md, P8-refonte.md « Failure reason column »).
// requests.reason: a failure the user can fix opens its fix (title, why, 3 steps, one filled action, then the quiet
// « Remove it from your list »); a video nobody can read says why and offers Remove only; a failure Reelbook or the
// computer tries again is « Not started » (computer) or « We're retrying » (hosted), with no red. A backend without
// the column reads every failure as « other ».
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const now = () => new Date().toISOString();
const req = (id, status, extra = {}) => ({id, status, url: `https://www.instagram.com/reel/${id}/`, theme: null, slug: null, note: null, reason: null, created_at: now(), processed_at: null, ...extra});
const fail = (id, reason, extra = {}) => req(id, 'error', {reason, note: 'detail from the run', processed_at: now(), ...extra});
const themes = [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}];
const tables = requests => ({user_themes: themes, sheets: [{slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Curl', summary: '', exercises: [], source: {}, added_at: '2026-10-01T00:00:00Z'}], sessions: [], notes: [], requests});
const open = async (opts = {}) => { const page = await app({...signedIn, stored: {'rb.welcome.u1': '1'}, timerCap: 4000, ...opts}); await settle(); return page; };
const hosted = s => s.replace("const OTW_MODE = 'computer'", "const OTW_MODE = 'hosted'");
const tap = async (page, id, sel, dataset = {}) => { await page.element(id).listeners.click({target: {closest: s => s === sel ? {dataset, disabled: false} : null}}); await settle(); };
const openRowOf = async (page, id) => { await page.fire('otw-band'); await tap(page, 'queue', '[data-row]', {row: id}); return page.element('otw-row').innerHTML; };
const rowOf = (page, id) => (page.element('queue').innerHTML.split('<button type="button" class="q qrow"').find(r => r.startsWith(` data-row="${id}"`)) || '');
const updates = page => JSON.parse(JSON.stringify(page.clients.at(-1).calls.filter(c => c[0] === 'update')));
const sectionOf = (page, id) => { const q = page.element('queue').innerHTML, at = q.indexOf(`data-row="${id}"`); return (/<h3 class="otw-sec[^"]*">([^<]+?) <span/g.exec(q.slice(0, at).split('<h3').slice(-1).map(h => '<h3' + h)[0]) || [])[1]; };

test('R3: signin_required opens its fix: title from the platform, why, 3 steps, « I signed in, try again », then the quiet Remove; nothing else', async () => {
  const page = await open({tables: tables([fail('ig', 'signin_required', {theme: 'strength'}), fail('tt', 'signin_required', {url: 'https://www.tiktok.com/@coach/video/1'})])});
  await page.fire('otw-band');
  assert.match(rowOf(page, 'ig'), /<small class="why">Instagram asked your computer to sign in again\.<\/small>[^]*Needs you/);
  assert.equal(sectionOf(page, 'ig'), 'Needs you');
  await tap(page, 'queue', '[data-row]', {row: 'ig'});
  const pane = page.element('otw-row');
  assert.equal(pane.hidden, false); assert.equal(page.element('queue').hidden, true);
  const fix = pane.innerHTML;
  assert.match(fix, /<h2 id="otw-rh">Sign in to Instagram again<\/h2>/);
  assert.match(fix, /<p class="fx-why">Your computer watches the video in Chrome\. Instagram signed it out, so it can&#39;t see this reel\.<\/p>|<p class="fx-why">Your computer watches the video in Chrome\. Instagram signed it out, so it can't see this reel\.<\/p>/);
  const steps = [...fix.matchAll(/<li><span class="k" aria-hidden="true">(\d)<\/span><span>([^<]+)<\/span><\/li>/g)].map(m => m[1] + ' ' + m[2]);
  assert.deepEqual(steps, ['1 On your computer, open Chrome.', '2 Go to instagram.com and sign in with your account.', '3 Come back here and tap the button below.']);
  assert.match(fix, /<button type="button" class="btn fx-go" data-fixdone>I signed in, try again<\/button>/);
  assert.match(fix, /<div class="fx-sep"><p>Can(&#39;|')t sign in, or don(&#39;|')t need this video any more\?<\/p><button type="button" class="btn ghost fx-rm" data-rdel>Remove it from your list<\/button><\/div>/);
  assert.ok(fix.indexOf('data-fixdone') < fix.indexOf('fx-sep'), 'Remove comes after, separated');
  assert.doesNotMatch(fix, /Open the video|data-move|Move to notebook|instagram\.com\/reel|Report this/, 'no Open, no Move');
  assert.equal((fix.match(/class="btn fx-go"/g) || []).length, 1, 'one filled action');
  await tap(page, 'otw-row', '[data-rback]');
  await tap(page, 'queue', '[data-row]', {row: 'tt'});
  assert.match(page.element('otw-row').innerHTML, /Sign in to TikTok again[^]*?can(&#39;|')t see this video\.[^]*?Go to tiktok\.com and sign in/);
});

test('R3: « I signed in, try again » puts it back in Not started: reason cleared, Redo line kept, « Back in line » toast', async () => {
  const t = tables([fail('a', 'signin_required', {note: 'Redo: the hands are reversed\nLogin wall in Chrome'})]);
  const page = await open({tables: t});
  await openRowOf(page, 'a');
  await tap(page, 'otw-row', '[data-fixdone]');
  assert.deepEqual(updates(page), [['update', 'requests', {status: 'queued', note: 'Redo: the hands are reversed', processed_at: null, reason: null}, [['id', 'a']]]]);
  assert.deepEqual(JSON.parse(JSON.stringify(page.clients.at(-1).ins.filter(i => i[0] === 'requests'))), [['requests', 'status', ['error']]], 'only a request still in error');
  assert.equal(page.element('otw-row').hidden, true, 'back to the list');
  assert.equal(sectionOf(page, 'a'), 'Fixes requested', 'R20: a fix back in line waits with the fixes, not with the videos');
  assert.doesNotMatch(page.element('otw-band').innerHTML, /needs you/);
  assert.equal(page.element('otw-said').hidden, false);
  assert.equal(page.element('otw-said').textContent, 'Back in line · your computer tries it on its next run');
});

test('R3: hosted, the toast says « Back in line »', async () => {
  const page = await open({tables: tables([fail('a', 'signin_required')]), source: hosted});
  await openRowOf(page, 'a'); await tap(page, 'otw-row', '[data-fixdone]');
  assert.equal(page.element('otw-said').textContent, 'Back in line');
});

test('R3: the fix\'s Remove is the list\'s removal, with its Undo', async () => {
  const page = await open({tables: tables([fail('a', 'signin_required')])});
  await openRowOf(page, 'a');
  await tap(page, 'otw-row', '[data-rdel]');
  assert.equal(page.element('otw-row').hidden, true);
  assert.doesNotMatch(page.element('queue').innerHTML, /data-row="a"/);
  assert.match(page.element('queue-toast').innerHTML, /Removed · Undo/);
  assert.equal(page.clients.at(-1).calls.filter(c => c[0] === 'delete').length, 0, 'sent when the toast ends');
});

test('R3: quota and needs_computer open their fix with their own action', async () => {
  const page = await open({tables: tables([fail('q', 'quota', {note: 'quota reached on this backend: 300 sheets for this account.'}), fail('d', 'quota', {note: 'quota reached on this backend: 10 links per day for this account.'}),
    fail('n', 'needs_computer')])});
  let fix = await openRowOf(page, 'q');
  assert.match(fix, /<h2 id="otw-rh">Make room for new sheets<\/h2>[^]*Tap ⋯, then Delete sheet\.[^]*data-fixdone>I made room, try again</);
  assert.equal((fix.match(/<li>/g) || []).length, 3);
  await tap(page, 'otw-row', '[data-rback]');
  await tap(page, 'queue', '[data-row]', {row: 'd'});
  fix = page.element('otw-row').innerHTML;
  assert.match(fix, /Wait for tomorrow[^]*midnight UTC[^]*data-fixdone>Try again</);
  await tap(page, 'otw-row', '[data-rback]');
  await tap(page, 'queue', '[data-row]', {row: 'n'});
  fix = page.element('otw-row').innerHTML;
  assert.match(fix, /Make it on your computer[^]*data-fixdone>Do it on my computer</);
  assert.equal((fix.match(/<li>/g) || []).length, 3);
  assert.match(page.element('otw-band').innerHTML, /3 needs you/);
});

test('R3: « other », no reason or an unknown one: the error\'s first line, « Try again » and « Report this »', async () => {
  const page = await open({cfg: {contact: 'contact@reelbook.si'}, tables: tables([fail('o', 'other', {note: 'Video unavailable\nsecond line'}), fail('n', null, {note: 'Redo: hands\nffmpeg crashed'}), fail('x', 'something_new', {note: ''})])});
  let fix = await openRowOf(page, 'o');
  assert.match(fix, /<h2 id="otw-rh">This video could not be made<\/h2>/);
  assert.match(fix, /<p class="fx-why">Video unavailable<\/p>/, 'the first line only');
  assert.doesNotMatch(fix, /<ol/, 'no steps known for it');
  // R17: « Report this » opens the same choice as Settings › Report a problem (email or GitHub issue)
  assert.match(fix, /data-fixdone>Try again<\/button><button type="button" class="btn ghost fx-report" data-freport aria-haspopup="dialog">Report this<\/button>/);
  assert.doesNotMatch(fix, /github\.com/, 'no issue link written in the row');
  await tap(page, 'otw-row', '[data-freport]');
  assert.equal(page.element('prob-dlg').open, true, 'the report choice opens');
  for (const id of ['prob-mail', 'prob-issue']) assert.doesNotMatch(decodeURIComponent(page.element(id).href), /instagram|reel\/o|Video unavailable|example\.test/, 'nothing of the video nor the account');
  assert.match(page.element('prob-issue').href, /^https:\/\/github\.com\/lt20\/reelbook\/issues\/new\?body=/);
  page.element('prob-dlg').open = false;
  fix = page.element('otw-row').innerHTML;
  assert.match(fix, /data-rdel>Remove it from your list</);
  await tap(page, 'otw-row', '[data-rback]');
  await tap(page, 'queue', '[data-row]', {row: 'n'});
  assert.match(page.element('otw-row').innerHTML, /<p class="fx-why">ffmpeg crashed<\/p>/, 'not the « Redo: » line');
  await tap(page, 'otw-row', '[data-rback]');
  await tap(page, 'queue', '[data-row]', {row: 'x'});
  assert.match(page.element('otw-row').innerHTML, /<p class="fx-why">Something went wrong while making its sheet\.<\/p>[^]*Try again/);
});

test('R3: a video nobody can read says why in plain words and offers Remove only', async () => {
  const words = {private: 'This video is private', removed: 'This video was removed', restricted: 'Instagram limits who can see this video', not_video: 'This link is not a video'};
  const page = await open({tables: tables(Object.keys(words).map(r => fail(r, r, {theme: 'strength'})))});
  await page.fire('otw-band');
  assert.match(page.element('otw-band').innerHTML, /4 needs you/);
  for (const [r, w] of Object.entries(words)) {
    assert.match(rowOf(page, r), new RegExp(`<small class="why">${w}\\.</small>[^]*Needs you`), r);
    await tap(page, 'queue', '[data-row]', {row: r});
    const d = page.element('otw-row').innerHTML;
    assert.match(d, new RegExp(`<p class="rd-why fx-r">${w}</p><p class="fx-sub">Nobody can turn it into a sheet now\\.</p>`), r);
    assert.match(d, /<button type="button" class="btn fx-go" data-rdel><svg[^]*?<\/svg>Remove<\/button>/, r);
    assert.doesNotMatch(d, /data-fixdone|Open the video|data-move|try again|Report this/i, r);
    await tap(page, 'otw-row', '[data-rback]');
  }
  await tap(page, 'queue', '[data-row]', {row: 'private'});
  await tap(page, 'otw-row', '[data-rdel]');
  assert.match(page.element('queue-toast').innerHTML, /Removed · Undo/);
});

test('R3 (Codex): computer mode: a retry reason put back in the queue is Not started; one left in error (an older rb.py) needs you, with the « other » fix', async () => {
  // rb.py (R3) puts a retry reason back as queued, the reason kept as its mark; an rb.py older than R3 that fails that
  // try writes status error and keeps the reason. `rb.py queue` lists queued only: in error, nothing would pick it up.
  const t = tables([req('q', 'queued', {reason: 'processing_failed', theme: 'strength'}), fail('f', 'fetch_blocked', {theme: 'strength', note: 'Instagram refused the fetch'}), fail('p', 'processing_failed', {note: 'Redo: hands reversed\nffmpeg failed'}), fail('c', 'daily_cap'), fail('s', 'signin_required')]);
  const page = await open({tables: t, hash: '#strength'});
  assert.match(page.element('otw-ghosts').innerHTML, /data-ghost="q"[^]*?Not started/);
  assert.match(page.element('otw-ghosts').innerHTML, /data-ghost="f"[^]*?Needs you/);
  page.go(''); await settle();
  assert.match(page.element('otw-band').innerHTML, /4 on the way<\/span><span class="sep" aria-hidden="true">·<\/span><span class="red">4 needs you/, 'R20: the fix is not a video on the way');
  await page.fire('otw-band');
  assert.equal(sectionOf(page, 'q'), 'Not started');
  assert.doesNotMatch(rowOf(page, 'q'), /class="why"|Needs you/);
  for (const id of ['f', 'p', 'c']) assert.equal(sectionOf(page, id), 'Needs you', id);
  assert.match(rowOf(page, 'f'), /<small class="why">Instagram refused the fetch<\/small>/, 'its error, as « other »');
  assert.doesNotMatch(page.element('queue').innerHTML, /We(&#39;|')re retrying/);
  // Not started is only ever a queued request: its R2 detail, with Move
  await tap(page, 'queue', '[data-row]', {row: 'q'});
  assert.match(page.element('otw-row').innerHTML, /Nobody has started on it yet\.[^]*data-move/);
  await tap(page, 'otw-row', '[data-rback]');
  await tap(page, 'queue', '[data-row]', {row: 'p'});
  const fix = page.element('otw-row').innerHTML;
  assert.match(fix, /This video could not be made[^]*<p class="fx-why">ffmpeg failed<\/p>[^]*data-fixdone>Try again<[^]*Report this[^]*data-rdel/);
  assert.doesNotMatch(fix, /data-move|Open the video|We(&#39;|')ll try again/);
  // « Try again » requeues it: status queued, its Redo line, reason cleared (rb.py may then retry it once more)
  await tap(page, 'otw-row', '[data-fixdone]');
  assert.deepEqual(updates(page), [['update', 'requests', {status: 'queued', note: 'Redo: hands reversed', processed_at: null, reason: null}, [['id', 'p']]]]);
  assert.deepEqual(JSON.parse(JSON.stringify(page.clients.at(-1).ins.filter(i => i[0] === 'requests'))), [['requests', 'status', ['error']]]);
  assert.equal(sectionOf(page, 'p'), 'Fixes requested');
  assert.equal(page.element('otw-said').textContent, 'Back in line · your computer tries it on its next run');
});

test('R3: hosted mode: the retries are « We\'re retrying », with no action and no red', async () => {
  const page = await open({tables: tables([fail('f', 'fetch_blocked', {theme: 'strength'}), fail('p', 'processing_failed'), req('q', 'queued', {reason: 'daily_cap'})]), source: hosted});
  assert.match(page.element('otw-band').innerHTML, /3 on the way<\/span><\/span>/);
  assert.doesNotMatch(page.element('otw-band').innerHTML, /needs you/);
  await page.fire('otw-band');
  const q = page.element('queue').innerHTML;
  assert.match(q, /<h3 class="otw-sec">We(&#39;|')re retrying <span class="n">2<\/span><\/h3>/);
  assert.equal(sectionOf(page, 'q'), 'Not started', 'Not started is a queued request, in either mode');
  assert.doesNotMatch(q, /otw-sec needs|class="st fail"/, 'no red');
  assert.match(rowOf(page, 'f'), /<small class="why">Instagram didn(&#39;|')t let us in this time\. We(&#39;|')ll try again: nothing to do on your side\.<\/small>/);
  assert.match(page.element('otw-mode').textContent, /Reelbook is preparing these\./);
  await tap(page, 'queue', '[data-row]', {row: 'f'});
  const d = page.element('otw-row').innerHTML;
  assert.match(d, /We(&#39;|')re retrying/);
  assert.doesNotMatch(d, /data-fixdone|data-rdel|data-move|Open the video/, 'no action');
  assert.match(d, /data-rback>Cancel</);
});

test('R3: a backend without requests.reason: the list is read again without it, no error, every failure is « other »', async () => {
  const requests = [{id: 'a', status: 'error', url: 'https://www.instagram.com/reel/a/', theme: null, note: 'Login wall', created_at: now(), processed_at: now()}];
  const page = await open({tables: tables(requests), missing: ['requests.reason']});
  const lists = page.clients.at(-1).selects.filter(([t, c]) => t === 'requests' && /created_at/.test(c)).map(([, c]) => c);
  assert.deepEqual(lists.slice(0, 2), ['id,url,status,theme,slug,note,reason,created_at,processed_at', 'id,url,status,theme,slug,note,created_at,processed_at']);
  assert.ok(lists.slice(2).every(c => !/reason/.test(c)), 'not asked again on this backend');
  assert.doesNotMatch(page.element('otw-band').innerHTML, /Couldn't load/);
  assert.match(page.element('otw-band').innerHTML, /1 needs you/);
  const fix = await openRowOf(page, 'a');
  assert.match(fix, /This video could not be made[^]*<p class="fx-why">Login wall<\/p>[^]*Try again/);
  await tap(page, 'otw-row', '[data-fixdone]');
  assert.deepEqual(updates(page).map(u => u[2]), [{status: 'queued', note: null, processed_at: null}], 'no reason written');
});

test('R3: an Add on a backend without the column, before the list knows it, is sent again without it', async () => {
  let first = true;
  // the first list read never answers: the add's select still names reason
  const hold = (table, ops) => table === 'requests' && first && ops.some(o => o[0] === 'neq') ? (first = false, new Promise(() => {})) : null;
  const t = tables([]), page = await open({tables: t, missing: ['requests.reason'], hold});
  await page.fire('add-video-fab');
  page.element('f-url').value = 'https://www.tiktok.com/@coach/video/1';
  t.requests.unshift({id: 'b', status: 'queued', url: 'https://www.tiktok.com/@coach/video/1', theme: null, note: null, created_at: now(), processed_at: null}); // what the insert writes
  await page.fire('sheet-new', 'submit'); await settle();
  const sel = page.clients.at(-1).selects.filter(([t]) => t === 'requests').map(([, c]) => c);
  assert.ok(sel.includes('id,url,status,theme,slug,note,reason,created_at,processed_at') && sel.includes('id,url,status,theme,slug,note,created_at,processed_at'));
  assert.equal(page.clients.at(-1).calls.filter(c => c[0] === 'insert').length, 1, 'one row written (the refused statement wrote nothing)');
  assert.equal(page.element('f-err').hidden, true);
  assert.match(page.element('otw-band').innerHTML, /1 on the way/);
});

for (const listFirst of [true, false]) test(`R3 (Codex pass 2): a backend without the column, an Add sent during the first list read, the ${listFirst ? 'read' : 'insert'}'s 42703 answering first: both fall back`, async () => {
  // each request decides its fallback from the columns it sent: the first 42703 switches queueCols, the second still retries
  let openList, openInsert; const listHeld = new Promise(r => { openList = r; }), insertHeld = new Promise(r => { openInsert = r; });
  let lists = 0, inserts = 0; // held calls are not recorded in calls: counted here
  const hold = (table, ops) => {
    if (table !== 'requests') return null;
    if (ops.some(o => o[0] === 'neq') && !lists++) return listHeld;
    if (ops.some(o => o[0] === 'insert') && !inserts++) return insertHeld;
    return null;
  };
  const t = tables([]), page = await open({tables: t, missing: ['requests.reason'], hold});
  await page.fire('add-video-fab');
  page.element('f-url').value = 'https://www.tiktok.com/@coach/video/1';
  t.requests.unshift({id: 'b', status: 'queued', url: 'https://www.tiktok.com/@coach/video/1', theme: null, note: null, created_at: now(), processed_at: null}); // what the insert writes
  await page.fire('sheet-new', 'submit'); await settle();
  assert.equal(inserts, 1, 'the Add is on its way, its select naming reason');
  // undefined: the harness answers the held call itself, 42703 for a select that names reason
  if (listFirst) { openList(); await settle(); openInsert(); } else { openInsert(); await settle(); openList(); }
  await settle();
  const c = page.clients.at(-1), sel = c.selects.filter(([tb]) => tb === 'requests').map(([, cols]) => cols);
  assert.equal(inserts, 2, 'the insert sent again without the column');
  assert.equal(c.calls.filter(x => x[0] === 'insert').length, 1, 'one row written');
  assert.ok(sel.includes('id,url,status,theme,slug,note,created_at,processed_at'));
  assert.equal(page.element('f-err').hidden, true, 'no « Could not save it »');
  assert.doesNotMatch(page.element('otw-band').innerHTML, /Couldn't load/);
  assert.match(page.element('otw-band').innerHTML, /1 on the way/);
});

test('R3: a fix whose write is refused for the column is sent again without it', async () => {
  const hold = (table, ops) => {
    const u = ops.find(o => o[0] === 'update');
    return table === 'requests' && u && 'reason' in u[1] ? Promise.resolve({data: null, error: {code: 'PGRST204', message: "Could not find the 'reason' column of 'requests' in the schema cache"}}) : null;
  };
  const page = await open({tables: tables([fail('a', 'signin_required')]), hold});
  await openRowOf(page, 'a'); await tap(page, 'otw-row', '[data-fixdone]');
  assert.deepEqual(updates(page).map(u => u[2]), [{status: 'queued', note: null, processed_at: null}]);
  assert.equal(sectionOf(page, 'a'), 'Not started');
});

test('R3: one fix at a time per video; a refused one says why in the fix', async () => {
  let release; const held = new Promise(r => { release = r; });
  let asked = 0;
  const hold = (table, ops) => table === 'requests' && ops.some(o => o[0] === 'update') ? (asked++, held) : null;
  const page = await open({tables: tables([fail('a', 'signin_required')]), hold});
  await openRowOf(page, 'a');
  await tap(page, 'otw-row', '[data-fixdone]');
  assert.match(page.element('otw-row').innerHTML, /data-fixdone disabled aria-disabled="true">Sending…</);
  assert.match(page.element('otw-row').innerHTML, /data-rdel disabled/, 'no Remove while it is on its way');
  await tap(page, 'otw-row', '[data-fixdone]');
  await tap(page, 'otw-row', '[data-rdel]');
  assert.equal(asked, 1);
  assert.equal(page.element('otw-row').hidden, false);
  release({data: null, error: {message: 'permission denied'}}); await settle();
  const fix = page.element('otw-row').innerHTML;
  assert.match(fix, /<p class="rd-msg bad" role="status">Retry failed: permission denied<\/p>/);
  assert.match(fix, /data-fixdone>I signed in, try again</);
});

test('R3 (Codex): « Try again » refused after the same fix was closed and opened again: said in the fix open now', async () => {
  let release; const held = new Promise(r => { release = r; });
  const hold = (table, ops) => table === 'requests' && ops.some(o => o[0] === 'update') ? held : null;
  const page = await open({tables: tables([fail('a', 'signin_required')]), hold});
  await openRowOf(page, 'a');
  await tap(page, 'otw-row', '[data-fixdone]');
  await tap(page, 'otw-row', '[data-rback]');
  assert.equal(page.element('otw-row').hidden, true, 'the list');
  await tap(page, 'queue', '[data-row]', {row: 'a'}); // another rowView, the same video
  assert.match(page.element('otw-row').innerHTML, /data-fixdone disabled aria-disabled="true">Sending…</);
  release({data: null, error: {message: 'permission denied'}}); await settle();
  const fix = page.element('otw-row').innerHTML;
  assert.match(fix, /<p class="rd-msg bad" role="status">Retry failed: permission denied<\/p>/);
  assert.match(fix, /data-fixdone>I signed in, try again</);
  assert.doesNotMatch(page.element('queue').innerHTML, /class="qerr"/, 'said once, in the fix');
});

test('R3 (Codex): a refused « Try again » with the fix closed is said on its row', async () => {
  let release; const held = new Promise(r => { release = r; });
  const hold = (table, ops) => table === 'requests' && ops.some(o => o[0] === 'update') ? held : null;
  const page = await open({tables: tables([fail('a', 'signin_required'), fail('b', 'quota')]), hold});
  await openRowOf(page, 'a');
  await tap(page, 'otw-row', '[data-fixdone]');
  await tap(page, 'otw-row', '[data-rback]');
  await tap(page, 'queue', '[data-row]', {row: 'b'}); // another video's fix open
  release({data: null, error: {message: 'permission denied'}}); await settle();
  assert.doesNotMatch(page.element('otw-row').innerHTML, /Retry failed/, 'not in another video\'s fix');
  assert.match(rowOf(page, 'a'), /<small class="qerr" role="alert">Retry failed: permission denied<\/small>/);
});

test('R3 (Codex): an Add whose 42703 answers after a switch of account sends nothing again and touches nothing', async () => {
  let release; const held = new Promise(r => { release = r; });
  let asked = 0; // a held write is not recorded in calls: the first insert is held, any other one answers (recorded)
  const hold = (table, ops) => table === 'requests' && ops.some(o => o[0] === 'insert') && !asked++ ? held : null;
  const t = tables([]), page = await open({tables: t, hold, stored: {'rb.welcome.u1': '1', 'rb.welcome.u2': '1'}});
  await page.fire('add-video-fab');
  page.element('f-url').value = 'https://www.tiktok.com/@coach/video/1';
  await page.fire('sheet-new', 'submit'); await settle();
  assert.equal(asked, 1, 'on its way');
  page.clients.at(-1).authListener('SIGNED_IN', {user: {id: 'u2', email: 'b@example.test'}}); await settle();
  release({data: null, error: {code: '42703', message: 'column requests.reason does not exist'}}); await settle();
  const c = page.clients.at(-1);
  assert.equal(asked, 1, 'no fallback insert for the new account');
  assert.equal(c.calls.filter(x => x[0] === 'insert').length, 0);
  assert.ok(c.selects.filter(([tb, cols]) => tb === 'requests' && /created_at/.test(cols)).every(([, cols]) => /reason/.test(cols)), 'the new account still reads reason');
  assert.equal(page.element('f-err').hidden, true, 'no error said');
  assert.doesNotMatch(page.element('otw-band').innerHTML, /[1-9] on the way/, 'nothing put in the new account\'s list');
});

test('R3 (Codex): an Add whose 42703 answers after a switch of backend sends nothing to the new one', async () => {
  let release; const held = new Promise(r => { release = r; });
  let asked = 0; // a held write is not recorded in calls: the first insert is held, any other one answers (recorded)
  const hold = (table, ops) => table === 'requests' && ops.some(o => o[0] === 'insert') && !asked++ ? held : null;
  const page = await open({tables: tables([]), hold});
  await page.fire('add-video-fab');
  page.element('f-url').value = 'https://www.tiktok.com/@coach/video/1';
  await page.fire('sheet-new', 'submit'); await settle();
  assert.equal(asked, 1, 'on its way');
  page.clients.at(-1).authListener('SIGNED_OUT', null); await settle(); // the client is dropped (sb = null)
  release({data: null, error: {code: '42703', message: 'column requests.reason does not exist'}}); await settle();
  assert.equal(asked, 1, 'not sent again, on any client');
  assert.ok(page.clients.every(cl => !cl.calls.some(x => x[0] === 'insert')));
  assert.equal(page.element('f-err').hidden, true);
});

test('R3: one list of reasons: the column\'s check (schema.sql, additive and idempotent), the app and tools/rb.py', () => {
  const fs = require('node:fs'), path = require('node:path'), root = path.join(__dirname, '..');
  const sql = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'), app = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
  const rb = fs.readFileSync(path.join(root, 'tools/rb.py'), 'utf8');
  const list = text => [...text.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  const check = sql.split('add constraint requests_reason_check')[1].split(';')[0];
  const expected = ['signin_required', 'quota', 'needs_computer', 'private', 'removed', 'restricted', 'not_video', 'fetch_blocked', 'processing_failed', 'daily_cap', 'other'];
  assert.deepEqual(list(check), expected);
  assert.deepEqual(list(/const REASONS = \[([^\]]+)\]/.exec(app)[1]), expected);
  assert.deepEqual([...(/REASONS = \(([^)]+)\)/.exec(rb)[1]).matchAll(/"([a-z_]+)"/g)].map(m => m[1]), expected);
  assert.match(sql, /alter table public\.requests add column if not exists reason text;\nalter table public\.requests drop constraint if exists requests_reason_check;\nalter table public\.requests add constraint requests_reason_check/);
  assert.doesNotMatch(check, /not null/, 'nullable: null until the video fails');
});
