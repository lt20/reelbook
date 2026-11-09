// P8 R5 (docs/audit-design/lots/R5.md): the player reads a single sheet's dose, shows one cue, « Done set » then
// « Next » after a rest; Finish logs one practice_log row per exercise with a checked set (and the session's), Session
// done says « Logged · Undo » and rewards the rhythm (the week's ordinal, 7 dots, dose progress), nothing for an
// empty week. The pure helpers are in app/sessions.js and app/sheet.js.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const RS = require('../app/sessions.js');
const SH = require('../app/sheet.js');
const {parse} = require('./mini-dom.cjs');
const {app, html, ownUrl, ownKey} = require('./harness.cjs');

const ROOT = path.join(__dirname, '..');
const template = name => fs.readFileSync(path.join(ROOT, 'templates', name), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const plain = v => JSON.parse(JSON.stringify(v)); // values made in the app's realm
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'u1@example.test'}}};
const tables = (items, practice_log = []) => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: ['a', 'b', 'c'].map((slug, i) => ({slug, kind: 'sheet', theme: 'strength', title: 'Exercise ' + (i + 1), html: '<a href="#">Home</a>'})),
  sessions: [{slug: 'legs', theme: 'strength', title: 'Legs', format: '', items}], notes: [], requests: [], practice_log
});
const inserts = page => page.clients.at(-1).calls.filter(c => c[0] === 'insert' && c[1] === 'practice_log');
const deletes = page => page.clients.at(-1).calls.filter(c => c[0] === 'delete' && c[1] === 'practice_log');
const end = page => page.element('view').innerHTML;
const player = page => page.element('player').innerHTML;
const fire = async (page, id, type) => { await page.fire(id, type); await settle(); };
// the sheet page as the player reads it (the harness has no full DOMParser): the template, through app/sheet.js
const withSheet = (doc = template('sheet.html')) => ({
  win: {RBSheet: SH},
  source: s => s.replace('const readPage = async slug => {', 'const readPage = async slug => { if (window.__page) return {html: \'\', page: window.__page(slug)};'),
  globals: {}, docPage: doc
});
const localIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return localIso(new Date(y, m - 1, d + n)); };

test('R5 single-sheet dose: the dose block of a sheet read as sets, reps, rest (template and fixtures)', () => {
  const pairs = SH.doseOf(parse(template('sheet.html')));
  assert.deepEqual(pairs, [['2–3', 'sets'], ['6–8', 'reps per set'], ['60 s', 'rest']]);
  const it = RS.sheetItem({slug: 's'}, pairs);
  assert.equal(RS.doseLabel(it), '3 × 6-8');
  assert.equal(RS.setCount(it), 3);
  assert.equal(it.rest_s, 60);
  const read = p => { const x = RS.sheetItem({}, p); return [RS.doseLabel(x), RS.setCount(x), x.rest_s]; };
  assert.deepEqual(read([['3', 'séries'], ['10', 'par jambe'], ['45 s', 'repos']]), ['3 × 10 / side', 3, 45]);
  assert.deepEqual(read([['3', 'rounds'], ['2 min', 'par round'], ['1 min', 'repos']]), ['3 × 2 min', 3, 60]);
  assert.deepEqual(read([['4', 'sets'], ['30 s', 'hold']]), ['4 × 30 s', 4, null]);
  assert.deepEqual(read([['3 × 10', '']]), ['3 × 10', 3, null]);
  // nothing it can read: the free text, one « Done » box, the default rest
  const free = RS.sheetItem({}, [['5', 'respirations'], ['libre', 'repos']]);
  assert.deepEqual([RS.doseLabel(free), free.dose, RS.setCount(free), free.rest_s], ['', '5 respirations · libre repos', 1, null]);
  assert.deepEqual(SH.doseOf(parse('<p>No dose</p>')), []);
  assert.equal(RS.doseLabel(RS.sheetItem({}, [])), '');
});

test('R5 single sheet: the player reads its dose, shows one cue, and « Done set » then Next after the rest', async () => {
  const opt = withSheet();
  const page = await app({...signedIn, tables: tables([]), hash: '#a/play', dom: true, win: {...opt.win, __page: () => parse(opt.docPage)}, source: opt.source});
  await settle();
  const h = player(page);
  assert.match(h, /<p class="pl-dose">3 × 6-8<\/p>/);
  assert.match(h, /Set 1 of 3/);
  assert.equal((h.match(/class="play-set"/g) || []).length, 3);
  // one cue: key point no. 1, the others behind a tap
  assert.match(h, /<span class="c1"><b>Short bold cue\.<\/b> One sentence that explains it\.<\/span><span class="c2">Key point 1 of 3 · tap for the others/);
  assert.doesNotMatch(h, /Second cue/);
  await fire(page, 'play-cue');
  assert.match(player(page), /<ol class="pl-keys" start="2">[\s\S]*Second cue[\s\S]*Third cue/);
  // a set: « Done set » filled, Finish outlined; no Previous / Next on a single sheet
  assert.match(player(page), /class="btn ghost" id="play-finish">Finish<[\s\S]*class="btn pl-doneset" id="play-done-set">Done set</);
  assert.doesNotMatch(player(page), /← Previous|Next →/);
  await fire(page, 'play-done-set');
  const rest = player(page);
  assert.match(rest, /id="play-rest"[^>]*>1:00</, 'the rest of the sheet\'s dose block');
  assert.match(rest, /<b>Next: set 2<\/b> · <span>Short bold cue\.<\/span>/);
  assert.doesNotMatch(rest, /class="c1"/, 'one cue during the rest');
  assert.match(rest, /class="btn ghost" id="play-rest-skip"[^>]*>Skip<\/button><button type="button" class="btn" id="play-rest-next">Next</);
  await fire(page, 'play-rest-next');
  assert.doesNotMatch(player(page), /id="play-rest"/);
  assert.match(player(page), /Set 2 of 3/);
  assert.match(player(page), /id="play-set-1" checked/);
  // Finish: one row for the sheet, with what was done; the Done screen
  await fire(page, 'play-finish');
  assert.equal(inserts(page).length, 1);
  assert.deepEqual(plain(inserts(page)[0][2]).map(r => [r.slug, r.text]), [['a', '1 × 6-8']]);
  assert.match(end(page), /id="end-done"[^>]*>Done<\/p><h1>Exercise 1<\/h1><p class="end-sum">1 set<\/p>/);
  assert.match(end(page), /Logged[\s\S]*id="end-undo"/);
  assert.doesNotMatch(end(page), /session this week|end-promo/, 'a single sheet is not a session');
  // P8 R18: a sheet's Done has no Share (a sheet is not sent as text) and no story card; Done is the one filled action
  assert.doesNotMatch(end(page), /end-share-s|>Share<|end-story/);
  assert.match(end(page), /<p class="actions end-acts"><span class="end-cl" id="end-cl"><button type="button" class="btn" id="end-close">Done<\/button>/);
});

test('R5 opening a sheet or starting the player never logs; Finish with nothing checked logs nothing', async () => {
  const items = [{slug: 'a', dose: '3 × 10'}, {slug: 'b', dose: '40 s'}];
  const page = await app({...signedIn, tables: tables(items), hash: '#a', dom: true});
  await settle();
  page.go('#a/play'); await settle();
  page.go('#session/legs/play'); await settle();
  page.go('#session/legs/play/2'); await settle();
  assert.equal(inserts(page).length, 0);
  await fire(page, 'play-finish');
  assert.equal(inserts(page).length, 0);
  assert.match(end(page), /Session done[\s\S]*0 exercises · 0 sets[\s\S]*Not logged[\s\S]*id="end-log">Log it</);
});

test('R5 one practice_log row per exercise with at least one checked set, and the session\'s', async () => {
  const items = [{slug: 'a', dose: '3 × 10', rest_s: 0}, {slug: 'b', dose: '2 × 30 s'}, {slug: 'c', dose: 'Light band'}];
  const page = await app({...signedIn, tables: tables(items), hash: '#session/legs/play', dom: true});
  await settle();
  await fire(page, 'play-done-set'); await fire(page, 'play-done-set'); await fire(page, 'play-done-set');
  assert.match(player(page), /class="btn" id="play-next">Next →</, 'its sets all checked: Next is the filled action');
  assert.doesNotMatch(player(page), /play-done-set/);
  await fire(page, 'play-next'); await fire(page, 'play-next'); // b: nothing checked
  await fire(page, 'play-set-1', 'change'); // c: its one « Done » box
  await fire(page, 'play-finish');
  assert.equal(inserts(page).length, 1);
  const rows = plain(inserts(page)[0][2]);
  assert.deepEqual(rows.map(r => [r.slug, r.text]), [['session/legs', '2 exercises · 4 sets'], ['a', '3 × 10'], ['c', 'Light band']]);
  assert.ok(rows.every(r => /^[0-9a-f-]{36}$/.test(r.id) && r.done_on === localIso(new Date())));
  assert.match(end(page), /2 exercises · 4 sets/);
});

test('R5 Undo removes exactly the rows just logged; Log it logs new ones; the page\'s Log gets « Logged · Undo » too', async () => {
  const items = [{slug: 'a', dose: '2 × 10'}, {slug: 'b', dose: '40 s'}];
  const page = await app({...signedIn, tables: tables(items), hash: '#session/legs/play/2', dom: true});
  await settle();
  await fire(page, 'play-set-1', 'change');
  await fire(page, 'play-finish');
  const ids = plain(inserts(page)[0][2]).map(r => r.id);
  assert.equal(ids.length, 2); // session/legs and b
  await fire(page, 'end-undo');
  assert.equal(deletes(page).length, 1);
  assert.deepEqual(plain(page.clients.at(-1).ins.filter(x => x[0] === 'practice_log')), [['practice_log', 'id', ids]]);
  assert.match(end(page), /Not logged[\s\S]*id="end-log">Log it</);
  await fire(page, 'end-log');
  const again = plain(inserts(page)[1][2]).map(r => r.id);
  assert.equal(again.length, 2);
  assert.ok(again.every(id => !ids.includes(id)), 'new rows');
  assert.match(end(page), /Logged[\s\S]*id="end-undo"/);
  // Undo refused (a backend without the delete grant yet): the rows stay logged, « Not undone. Try again. »
  const refuse = (table, ops) => table === 'practice_log' && ops.some(o => o[0] === 'delete') ? Promise.resolve({data: null, error: {code: '42501', message: 'permission denied for table practice_log'}}) : null;
  const refused = await app({...signedIn, tables: tables(items), hash: '#session/legs/play/2', dom: true, hold: refuse});
  await settle();
  await fire(refused, 'play-set-1', 'change');
  await fire(refused, 'play-finish');
  await fire(refused, 'end-undo');
  assert.match(end(refused), /Logged[\s\S]*id="end-undo"[^>]*>Undo<\/button><span class="err" role="alert">Not undone\. Try again\.</);
  // the page's own Log: Save, then « Logged · Undo » under it; Undo removes that row
  const own = await app({...signedIn, tables: tables(items), hash: '#session/legs', dom: true});
  await settle();
  const click = async id => { await own.element('view').listeners.click({target: {closest: sel => sel === `#${id}` ? {id} : null}}); await settle(); };
  await click('practice-done');
  await click('practice-save');
  assert.match(end(own), /id="practice-done"[^>]*>Logged ✓<[\s\S]*class="pr-undo"[^>]*>Logged<span aria-hidden="true"> · <\/span><button[^>]*id="practice-undo"/);
  const row = plain(inserts(own)[0][2]);
  await click('practice-undo');
  assert.deepEqual(plain(own.clients.at(-1).ins.filter(x => x[0] === 'practice_log')), [['practice_log', 'id', [row.id]]]);
  assert.match(end(own), /id="practice-done"[^>]*>Log</);
  assert.doesNotMatch(end(own), /practice-undo/);
});

test('R5 week: the ordinal and the 7 dots count this ISO week\'s sessions only (Monday to Sunday)', () => {
  assert.equal(RS.weekStart('2026-11-15'), '2026-11-09'); // a Sunday: its Monday
  assert.equal(RS.weekStart('2026-11-16'), '2026-11-16');
  assert.equal(RS.weekStart('2027-01-01'), '2026-12-28'); // across the year
  assert.equal(RS.weekStart('nope'), '');
  const rows = [{slug: 'session/a', done_on: '2026-11-15'}, {slug: 'session/a', done_on: '2026-11-16'}, {slug: 'session/b', done_on: '2026-11-16'},
    {slug: 'session/c', done_on: '2026-11-18'}, {slug: 'a', done_on: '2026-11-17'}, {slug: 'session/d', done_on: '2026-11-23'}, {slug: 'session/e', done_on: '2026-11-20'}];
  const w = RS.weekRhythm(rows, '2026-11-18'); // Wednesday: last Sunday, a sheet's row, next week and Friday are out
  assert.deepEqual(plain(w), {count: 3, days: [true, false, true, false, false, false, false], today: 2});
  assert.deepEqual(plain(RS.weekRhythm(rows, '2026-11-15')), {count: 1, days: [false, false, false, false, false, false, true], today: 6});
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 112].map(RS.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '112th']);
});

test('R5 Session done: « 3rd session this week » and the dots, from practice_log, across the week boundary', async () => {
  const today = localIso(new Date()), monday = RS.weekStart(today), lastSunday = addDays(monday, -1);
  const log = [{id: 'x1', slug: 'session/legs', done_on: lastSunday, text: ''}, {id: 'x2', slug: 'session/other', done_on: monday, text: ''},
    {id: 'x3', slug: 'session/legs', done_on: today, text: ''}, {id: 'x4', slug: 'a', done_on: today, text: '3 × 10'}];
  const page = await app({...signedIn, tables: tables([{slug: 'a', dose: '40 s'}], log), hash: '#session/legs/play', dom: true});
  await settle();
  await fire(page, 'play-set-1', 'change');
  await fire(page, 'play-finish');
  const h = end(page), n = 3; // Monday's and today's rows, plus this one (last Sunday's is out, a sheet's row is not a session)
  assert.match(h, new RegExp(`<p class="rh-n">${RS.ordinal(n)} session this week</p>`));
  const days = [...h.matchAll(/<span class="rh-d([^"]*)"><i><\/i><b>([MTWFS])<\/b><\/span>/g)].map(m => m[1]);
  assert.equal(days.length, 7);
  const t = RS.weekRhythm([{slug: 'session/x', done_on: today}], today).today;
  days.forEach((cls, i) => assert.equal(/\bon\b/.test(cls), i === 0 || i === t, `day ${i}`));
  assert.match(days[t], /today/);
  assert.match(h, /role="img" aria-label="Sessions this week: Monday/);
  // Undo: this one is no longer counted (a count, not an ordinal)
  await fire(page, 'end-undo');
  assert.match(end(page), new RegExp(`<p class="rh-n">${n - 1} session${n - 1 === 1 ? '' : 's'} this week</p>`));
  assert.doesNotMatch(end(page), /streak|flame|badge|🔥/i);
});

test('R5 dose progress: « Last time: 3 × 8 → today: 3 × 10 » only when the dose went up since the previous log', async () => {
  for (const [before, now] of [['3 × 8', '3 × 10'], ['2 × 10', '3 × 10'], ['3 × 30 s', '3 × 40 s'], ['10 s', '1 min']]) assert.equal(RS.doseUp(before, now), true, `${before} → ${now}`);
  for (const [before, now] of [['3 × 10', '3 × 10'], ['3 × 10', '3 × 8'], ['4 × 8', '3 × 10'], ['3 × 10', '3 × 30 s'], ['12 kg, 3x10', '3 × 12'], ['', '3 × 10'], ['3 × 10 par côté', '3 × 12']]) assert.equal(RS.doseUp(before, now), false, `${before} → ${now}`);
  const yesterday = addDays(localIso(new Date()), -1);
  const log = [{id: 'p1', slug: 'a', done_on: addDays(yesterday, -3), text: '3 × 6', created_at: '2026-01-01T00:00:00Z'},
    {id: 'p2', slug: 'a', done_on: yesterday, text: '3 × 8', created_at: '2026-01-02T00:00:00Z'},
    {id: 'p3', slug: 'b', done_on: yesterday, text: '3 × 12', created_at: '2026-01-02T00:00:00Z'}];
  const items = [{slug: 'a', dose: '3 × 10', rest_s: 0}, {slug: 'b', dose: '3 × 10', rest_s: 0}];
  const page = await app({...signedIn, tables: tables(items, log), hash: '#session/legs/play', dom: true});
  await settle();
  for (let i = 0; i < 3; i++) await fire(page, 'play-done-set');
  await fire(page, 'play-next');
  for (let i = 0; i < 3; i++) await fire(page, 'play-done-set');
  await fire(page, 'play-finish');
  assert.match(end(page), /<p class="rh-up"><b>Exercise 1<\/b><span>Last time: 3 × 8 → today: 3 × 10<\/span><\/p>/);
  assert.doesNotMatch(end(page), /Exercise 2<\/b><span>Last time/, 'b went down: nothing said');
});

test('R5 empty week: no rhythm at all (no ordinal, no dots) when no session is logged this week', async () => {
  const lastWeek = addDays(RS.weekStart(localIso(new Date())), -2);
  const page = await app({...signedIn, tables: tables([{slug: 'a', dose: '40 s'}], [{id: 'o', slug: 'session/legs', done_on: lastWeek, text: ''}]), hash: '#session/legs/play', dom: true});
  await settle();
  await fire(page, 'play-finish'); // nothing checked: nothing logged
  assert.match(end(page), /Session done/);
  assert.doesNotMatch(end(page), /class="rhythm"|rh-week|session this week/);
  // logged, then undone: the week is empty again
  page.go('#session/legs/play'); await settle();
  await fire(page, 'play-set-1', 'change');
  await fire(page, 'play-finish');
  assert.match(end(page), /<p class="rh-n">1st session this week<\/p>/);
  await fire(page, 'end-undo');
  assert.doesNotMatch(end(page), /class="rhythm"|rh-week|session this week/);
});

// P8 R7: the story card's place now shows its card (the first Session done of the week); without card.js loaded (the
// harness), « Share » opens the session's Share sheet (P8 R18: to a training partner).
test('R5 Session done: Share filled (to a training partner), Done outlined, the story card place, R9\'s card still there', async () => {
  const page = await app({...signedIn, tables: tables([{slug: 'a', dose: '40 s'}]), hash: '#session/legs/play', dom: true, stored: {'rb.star.u1': '1'}});
  await settle();
  await fire(page, 'play-set-1', 'change');
  await fire(page, 'play-finish');
  const h = end(page);
  assert.match(h, /<div class="end-story" id="end-story">[\s\S]*?<!--\/end-story--><\/div>[\s\S]*<button type="button" class="btn" id="end-share-s">Share<\/button><span class="end-cl" id="end-cl"><button type="button" class="btn ghost" id="end-close">Done<\/button>/);
  assert.equal((h.match(/class="btn"(?! ghost)/g) || []).length, 1, 'one filled action');
  assert.match(h, /id="end-promo"><section class="end-promo"/);
  await fire(page, 'end-share-s');
  assert.match(page.element('share-dlg').innerHTML, /Send “Legs” to a training partner/);
});

test('R5 player: follows the theme (no forced dark), and the ⋯ menu\'s High contrast is kept on this device', async () => {
  assert.doesNotMatch(html, /:root:not\(\[data-theme="light"\]\) \.player\{/, 'the player is no longer dark by default');
  assert.match(html, /\.player\.hc\{--bg:#ffffff;--paper:#ffffff;--ink:#000000;[^}]*--line-strong:#000000/);
  assert.match(html, /\.player\.hc \.pl\.tint\{border-top-width:12px\}/);
  const page = await app({...signedIn, tables: tables([{slug: 'a', dose: '40 s'}]), hash: '#session/legs/play', dom: true});
  await settle();
  assert.match(player(page), /id="play-more" aria-label="More" aria-haspopup="true" aria-expanded="false">⋯</);
  await fire(page, 'play-more');
  assert.match(player(page), /role="menuitemcheckbox" aria-checked="false" class="pl-mi" id="play-hc">High contrast/);
  await fire(page, 'play-hc');
  assert.equal(page.storage.get('rb.contrast'), '1');
  assert.match(player(page), /aria-checked="true"[^>]*id="play-hc"/);
  await fire(page, 'play-hc');
  assert.equal(page.storage.get('rb.contrast'), undefined);
});

test('R5 landing and #welcome copy: « Log » (EN) and « Noter » (FR), no « Done today » left', () => {
  const landing = fs.readFileSync(path.join(ROOT, 'app/landing.js'), 'utf8');
  assert.doesNotMatch(landing + html.replace(/\/\/[^\n]*/g, ''), /Done today|Fait aujourd/);
  assert.match(landing, /"ui\.done": "Log"/);
  assert.match(landing, /"ui\.done": "Noter"/);
  assert.match(landing, /Tap “Log”\./);
  assert.match(landing, /Touche <b>Noter<\/b>\./);
});

test('R5 schema: practice_log grants delete (Undo), nothing else changes', () => {
  const schema = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8');
  assert.match(schema, /grant select, insert, delete on public\.practice_log to authenticated;/);
  assert.match(schema, /create policy "own practice log" on public\.practice_log\s+for all to authenticated using \(user_id = auth\.uid\(\)\) with check \(user_id = auth\.uid\(\)\);/);
});

// ---------- Codex pass 1 on #115: four regressions ----------
const sw = fs.readFileSync(path.join(ROOT, 'app', 'sw.js'), 'utf8');
const ver = (src, file) => Number((src.match(new RegExp(`${file.replace('.', '\\.')}\\?v=(\\d+)`)) || [])[1]);

test('R5 Codex 1: every module R5 changes has a new ?v= (index.html and the worker\'s shell alike) and the cache VERSION moved', () => {
  // p8 before R5: sessions.js?v=11 (13 after Codex pass 2, 14 after pass 3), sheet.js?v=4, landing.js?v=10, rb-shell-59
  for (const [file, min] of [['sessions.js', 14], ['sheet.js', 5], ['landing.js', 11], ['config.js', 13]]) {
    assert.ok(ver(html, file) >= min, `${file}?v= bumped in index.html`);
    assert.equal(ver(sw, file), ver(html, file), `${file}: the worker precaches the version index.html asks for`);
  }
  assert.ok(Number(sw.match(/const VERSION = 'rb-shell-(\d+)'/)[1]) >= 60, 'cache VERSION bumped');
});

// the previous sessions.js (p8 before R5) has none of R5's helpers: an installed app can pair it with this index.html
const staleModule = s => 'for (const k of ["sheetItem", "doneDose", "setHeading", "weekStart", "weekRhythm", "ordinal", "doseUp"]) delete window.RBSessions[k];\n' + s;

test('R5 Codex 1: with the previous sessions.js the sheet and session players still open, finish and log (no TypeError)', async () => {
  const opt = withSheet();
  const page = await app({...signedIn, tables: tables([{slug: 'a', dose: '2 × 10'}, {slug: 'b', dose: '40 s'}]), hash: '#a/play', dom: true, win: {...opt.win, __page: () => parse(opt.docPage)}, source: s => staleModule(opt.source(s))});
  await settle();
  const h = player(page);
  assert.match(h, /id="play-finish"/, 'the single-sheet player opened');
  assert.equal((h.match(/class="play-set"/g) || []).length, 1, 'as before R5: one « Done » box, the dose block not read');
  await fire(page, 'play-set-1', 'change');
  await fire(page, 'play-finish');
  assert.deepEqual(plain(inserts(page)[0][2]).map(r => r.slug), ['a']);
  assert.match(end(page), /Logged[\s\S]*id="end-undo"/);
  assert.doesNotMatch(end(page), /class="rhythm"/);
  page.go('#session/legs/play'); await settle();
  assert.match(player(page), /Set 1 of 2/, 'the set heading without RS.setHeading');
  await fire(page, 'play-done-set'); await fire(page, 'play-rest-next'); await fire(page, 'play-done-set');
  await fire(page, 'play-next'); await fire(page, 'play-set-1', 'change'); await fire(page, 'play-finish');
  assert.deepEqual(plain(inserts(page)[1][2]).map(r => [r.slug, r.text]), [['session/legs', '2 exercises · 3 sets'], ['a', '2 × 10'], ['b', '40 s']]);
});

test('R5 Codex 2: Next and Previous keep one listener each (the sheet loaded, the cue unfolded): one tap, one exercise', async () => {
  const opt = withSheet();
  const items = [{slug: 'a', dose: '2 × 10'}, {slug: 'b', dose: '2 × 10'}, {slug: 'c', dose: '40 s'}];
  const page = await app({...signedIn, tables: tables(items), hash: '#session/legs', dom: true, win: {...opt.win, __page: () => parse(opt.docPage)}, source: opt.source});
  await settle();
  // an EventTarget: every addEventListener adds one more listener, removeEventListener takes it out
  const all = new Map();
  const target = id => {
    const el = page.element(id), byType = {};
    el.addEventListener = (type, l) => { (byType[type] = byType[type] || []).push(l); el.listeners[type] = l; };
    el.removeEventListener = (type, l) => { const a = byType[type] || []; const i = a.indexOf(l); if (i >= 0) a.splice(i, 1); if (el.listeners[type] === l) el.listeners[type] = a.at(-1); };
    all.set(id, byType);
  };
  ['play-next', 'play-prev', 'play-cue', 'play-done-set', 'play-finish', 'play-set-1'].forEach(target);
  const count = (id, type = 'click') => (all.get(id)[type] || []).length;
  const tap = async id => { for (const l of [...(all.get(id).click || [])]) await l({preventDefault() {}}); await settle(); };
  page.go('#session/legs/play'); await settle();
  assert.match(player(page), /<p class="pl-n">1\/3<\/p>/);
  assert.match(player(page), /Short bold cue/, 'the sheet is loaded (playMedia wired the buttons again)');
  for (const id of ['play-next', 'play-prev', 'play-cue', 'play-done-set']) assert.equal(count(id), 1, `${id}: one click listener`);
  assert.equal(count('play-set-1', 'change'), 1);
  await tap('play-next');
  assert.match(player(page), /<p class="pl-n">2\/3<\/p>/, 'one tap on Next: exercise 2, not 3');
  await tap('play-cue'); await tap('play-cue'); // the cue unfolded and folded: wireAct twice more
  for (const id of ['play-next', 'play-prev']) assert.equal(count(id), 1, `${id}: still one after the cue`);
  await tap('play-prev');
  assert.match(player(page), /<p class="pl-n">1\/3<\/p>/);
});

test('R5 Codex 3: « Try again » after midnight sends the first try\'s rows (same ids, same day); Undo removes exactly them', async () => {
  let now = new Date(2026, 10, 9, 23, 59);
  const sent = [];
  const lost = (table, ops) => {
    const w = table === 'practice_log' && ops.find(o => o[0] === 'insert'); if (!w) return null;
    sent.push(plain(w[1]));
    return Promise.resolve(sent.length === 1 ? {data: null, error: {message: 'Failed to fetch'}} // stored, its answer lost
      : {data: null, error: {code: '23505', message: 'duplicate key value violates unique constraint'}});
  };
  const page = await app({...signedIn, tables: tables([{slug: 'a', dose: '2 × 10'}, {slug: 'b', dose: '40 s'}]), hash: '#session/legs/play/2', dom: true, hold: lost,
    win: {__now: () => new Date(now)}, source: s => s.replace('const todayIso = () => { const d = new Date()', 'const todayIso = () => { const d = window.__now ? window.__now() : new Date()')});
  await settle();
  await fire(page, 'play-set-1', 'change');
  await fire(page, 'play-finish');
  assert.match(end(page), /Not logged\.[\s\S]*id="end-log">Try again</);
  assert.deepEqual(sent[0].map(r => [r.slug, r.done_on]), [['session/legs', '2026-11-09'], ['b', '2026-11-09']]);
  now = new Date(2026, 10, 10, 0, 1); // past midnight
  await fire(page, 'end-log');
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0], 'the same rows: same ids, same done_on');
  assert.match(end(page), /Logged[\s\S]*id="end-undo"/);
  await fire(page, 'end-undo');
  assert.deepEqual(plain(page.clients.at(-1).ins.filter(x => x[0] === 'practice_log')), [['practice_log', 'id', sent[0].map(r => r.id)]]);
});

test('R5 Codex 4: Undo of the page\'s Log while the player\'s log of the same day stays: the page still says « Logged ✓ »', async () => {
  // practice_log as a table: inserts land, deletes remove, reads see what is left; the player's insert waits
  const db = [];
  let release, first = true;
  const held = new Promise(resolve => { release = resolve; });
  const store = (table, ops) => {
    if (table !== 'practice_log') return null;
    const ins = ops.find(o => o[0] === 'insert'), del = ops.find(o => o[0] === 'delete');
    if (ins) {
      const rows = plain([].concat(ins[1]));
      if (first && rows.length > 1) { first = false; return held.then(() => { db.push(...rows); return {data: rows.map(r => ({id: r.id})), error: null}; }); }
      db.push(...rows); return {data: rows, error: null};
    }
    if (del) { const ids = ops.find(o => o[0] === 'in')[2]; for (let i = db.length - 1; i >= 0; i--) if (ids.includes(db[i].id)) db.splice(i, 1); return {data: [], error: null}; }
    const eqs = ops.filter(o => o[0] === 'eq'), ins2 = ops.filter(o => o[0] === 'in');
    return {data: db.filter(r => eqs.every(([, c, v]) => r[c] === v) && ins2.every(([, c, v]) => v.includes(r[c]))), error: null};
  };
  const items = [{slug: 'a', dose: '2 × 10'}, {slug: 'b', dose: '40 s'}];
  const page = await app({...signedIn, tables: tables(items), hash: '#session/legs/play/2', dom: true, hold: store});
  await settle();
  await fire(page, 'play-set-1', 'change');
  await fire(page, 'play-finish'); // on its way
  assert.match(end(page), /Logging…/);
  page.go('#'); await settle(); page.go('#session/legs'); await settle(); // left another way (« Done » waits for the answer, Codex pass 3)
  const click = async id => { await page.element('view').listeners.click({target: {closest: sel => sel === `#${id}` ? {id} : null}}); await settle(); };
  await click('practice-done');
  await click('practice-save'); // the page's Log, the same session, the same day
  assert.match(end(page), /id="practice-undo"/);
  release(); await settle(); // the player's log is stored
  assert.deepEqual(db.map(r => r.slug).sort(), ['b', 'session/legs', 'session/legs']);
  await click('practice-undo');
  assert.deepEqual(db.map(r => r.slug).sort(), ['b', 'session/legs'], 'the page\'s row only');
  assert.match(end(page), /id="practice-done"[^>]*>Logged ✓</, 'a log of today is still there');
  assert.doesNotMatch(end(page), /practice-undo/);
  page.go('#'); await settle();
  page.go('#session/legs'); await settle();
  assert.match(end(page), /id="practice-done"[^>]*>Logged ✓</);
});

test('R5 Codex pass 2: a log read after Undo that lands once another account is signed in on the same client touches nothing (A\'s text never reaches B)', async () => {
  // practice_log as RLS shows it: each account sees its own rows; the read after A's Undo waits
  const yesterday = addDays(localIso(new Date()), -1);
  const db = [{id: 'a0', owner: 'u1', slug: 'session/legs', done_on: yesterday, text: 'A private: 12 kg', created_at: yesterday + 'T08:00:00Z'}];
  let who = 'u1', waiting = false, release;
  const held = new Promise(resolve => { release = resolve; });
  const store = (table, ops) => {
    if (table !== 'practice_log') return null;
    const ins = ops.find(o => o[0] === 'insert'), del = ops.find(o => o[0] === 'delete');
    if (ins) { const rows = plain([].concat(ins[1])).map(r => ({...r, owner: who})); db.push(...rows); return {data: rows, error: null}; }
    if (del) { const ids = ops.find(o => o[0] === 'in')[2]; for (let i = db.length - 1; i >= 0; i--) if (ids.includes(db[i].id) && db[i].owner === who) db.splice(i, 1); waiting = true; return {data: [], error: null}; }
    const eqs = ops.filter(o => o[0] === 'eq'), seen = db.filter(r => r.owner === who && eqs.every(([, c, v]) => r[c] === v));
    if (waiting) { waiting = false; return held.then(() => ({data: seen, error: null})); } // A's rows, answered late
    return {data: seen, error: null};
  };
  const page = await app({...signedIn, tables: tables([{slug: 'a', dose: '40 s'}]), hash: '#session/legs', dom: true, hold: store});
  await settle();
  const click = async id => { await page.element('view').listeners.click({target: {closest: sel => sel === `#${id}` ? {id} : null}}); await settle(); };
  await click('practice-done');
  assert.match(end(page), /A private: 12 kg/, 'A\'s own last text in A\'s field');
  await click('practice-save');
  await click('practice-undo'); // deleted; the read of what is left is on its way
  // B signs in on the same client and opens the same session
  who = 'u2';
  page.clients.at(-1).authListener('SIGNED_IN', {user: {id: 'u2', email: 'u2@example.test'}, access_token: 't'}); await settle();
  page.go('#'); await settle();
  page.go('#session/legs'); await settle();
  release(); await settle(); // A's read lands now
  assert.doesNotMatch(end(page), /A private|Logged ✓/);
  await click('practice-done');
  assert.doesNotMatch(end(page), /A private/, 'B\'s field is not filled with A\'s text');
  page.go('#'); await settle();
  assert.doesNotMatch(end(page) + page.element('home').innerHTML, /A private|done (?:today|yesterday|[A-Z])/i);
});

test('R5 Codex pass 2: « per side » anywhere in a dose cell is kept in the logged dose (EN and FR)', () => {
  const logged = pairs => { const it = RS.sheetItem({}, pairs); return RS.doneDose(it, RS.setCount(it)); };
  assert.equal(logged([['3', 'sets'], ['10', 'reps per side']]), '3 × 10 / side');
  assert.equal(logged([['3', 'séries'], ['10', 'répétitions par côté']]), '3 × 10 / side');
  assert.equal(logged([['3', 'sets'], ['30 s', 'hold per side']]), '3 × 30 s / side');
  assert.equal(logged([['3', 'sets'], ['10', 'reps each side']]), '3 × 10 / side');
  assert.equal(logged([['3', 'séries'], ['10', 'de chaque côté']]), '3 × 10 / side');
  assert.equal(logged([['3', 'séries'], ['30 s', 'gainage par côté']]), '3 × 30 s / side');
  assert.equal(logged([['3', 'séries'], ['10', 'par jambe']]), '3 × 10 / side');
  assert.equal(logged([['3 × 10 / side', '']]), '3 × 10 / side');
  // two of three sets checked: still per side
  assert.equal(RS.doneDose(RS.sheetItem({}, [['3', 'sets'], ['10', 'reps per side']]), 2), '2 × 10 / side');
  // no qualifier, or a word that only looks like one: nothing added
  assert.equal(logged([['3', 'sets'], ['10', 'reps']]), '3 × 10');
  assert.equal(logged([['3', 'sets'], ['10', 'reps, sides alternating']]), '3 × 10');
  assert.equal(logged([['3', 'sets'], ['10', 'reps'], ['60 s', 'rest per side']]), '3 × 10');
});

test('R5 Codex pass 3: « Done » is « Saving… » and disabled while Finish writes; a failed write keeps « Try again » there and the retry logs', async () => {
  let release, n = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const hold = (table, ops) => {
    if (table !== 'practice_log' || !ops.some(o => o[0] === 'insert')) return null;
    return ++n === 1 ? pending : null; // the first write waits, then fails; the retry is stored
  };
  const page = await app({...signedIn, tables: tables([{slug: 'a', dose: '2 × 10'}]), hash: '#session/legs/play', dom: true, hold});
  await settle();
  await fire(page, 'play-set-1', 'change');
  await fire(page, 'play-finish');
  assert.match(end(page), /Logging…[\s\S]*id="end-close" disabled>Saving…</);
  await fire(page, 'end-close');
  assert.match(end(page), /Session done/, 'Done does nothing while the write is on its way');
  release({data: null, error: {message: 'Failed to fetch'}}); await settle();
  assert.match(end(page), /Not logged\.[\s\S]*id="end-log">Try again<[\s\S]*id="end-close">Done</);
  await fire(page, 'end-log');
  assert.equal(n, 2);
  assert.deepEqual(plain(page.clients.at(-1).calls.filter(c => c[0] === 'insert' && c[1] === 'practice_log')[0][2]).map(r => r.slug), ['session/legs', 'a']);
  assert.match(end(page), /Logged[\s\S]*id="end-undo"/);
  await fire(page, 'end-close');
  assert.doesNotMatch(end(page), /Session done/);
  assert.match(end(page), /<h1>Legs<\/h1>/);
});

test('R5 Codex pass 3: a log that lands once the session page is open (left another way) shows « Logged ✓ » there', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const hold = (table, ops) => table === 'practice_log' && ops.some(o => o[0] === 'insert') ? pending : null;
  const page = await app({...signedIn, tables: tables([{slug: 'a', dose: '2 × 10'}]), hash: '#session/legs/play', dom: true, hold});
  await settle();
  await fire(page, 'play-set-1', 'change');
  await fire(page, 'play-finish');
  page.go('#'); await settle(); page.go('#session/legs'); await settle();
  assert.match(end(page), /id="practice-done"[^>]*>Log</);
  release(null); await settle(); // stored
  assert.match(end(page), /id="practice-done"[^>]*>Logged ✓</);
});

test('R5 Codex pass 3: a dose of sets only (« 3 sets ») logs the sets checked (« 1 set »)', async () => {
  const it = RS.sheetItem({}, [['3', 'sets']]);
  assert.deepEqual([RS.doneDose(it, 1), RS.doneDose(it, 2), RS.doneDose(it, 3)], ['1 set', '2 sets', '3 sets']);
  assert.equal(RS.doneDose({dose: 'Light band', sets: null}, 1), 'Light band', 'no sets: the free text');
  const page = await app({...signedIn, tables: tables([{slug: 'a', dose: '3 sets'}, {slug: 'b', dose: '2 × 10'}]), hash: '#session/legs/play', dom: true});
  await settle();
  await fire(page, 'play-done-set'); // 1 of 3
  await fire(page, 'play-rest-next');
  await fire(page, 'play-next'); await fire(page, 'play-set-1', 'change');
  await fire(page, 'play-finish');
  assert.deepEqual(plain(inserts(page)[0][2]).map(r => [r.slug, r.text]), [['session/legs', '2 exercises · 2 sets'], ['a', '1 set'], ['b', '1 × 10']]);
});
