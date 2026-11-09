// P8 R14 (docs/audit-design/lots/R14.md, P8-refonte.md decision 6): the technique family. A notebook is repetition or
// technique (user_themes.family, else app/config.js's default, else repetition); a technique notebook's sheets carry a
// level (notes.level), its page says « n of N learned » with a gauge, its sheets are practised step by step and end on
// « How did it go? »; a first « Got it » opens « New move ». A backend without the columns: no level, all repetition.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const RS = require('../app/sessions.js');
const SH = require('../app/sheet.js');
const {parse} = require('./mini-dom.cjs');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const loadConfig = () => { const window = {}; vm.runInNewContext(read('app/config.js'), {window}); return JSON.parse(JSON.stringify(window.REELBOOK)); };
const CFG = loadConfig();
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const plain = v => JSON.parse(JSON.stringify(v));
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'u1@example.test'}}};
const theme = (id, title, extra = {}) => ({id, title, description: '', groups: [], builtin: true, position: 0, family: null, ...extra});
const sheet = (slug, theme, title) => ({slug, kind: 'sheet', theme, group: 'Basics', title, summary: '', html: '<a href="#">Home</a>'});
const tables = ({themes = [theme('kitesurf', 'Kitesurf'), theme('strength', 'Strength', {position: 1})], levels = {}, practice_log = [], sessions = [], extra = []} = {}) => ({
  user_themes: themes,
  sheets: [sheet('k1', 'kitesurf', 'Water start'), sheet('k2', 'kitesurf', 'Jibe'), sheet('k3', 'kitesurf', 'Pop'), sheet('s1', 'strength', 'Squat'), ...extra],
  notes: Object.entries(levels).map(([slug, level]) => ({slug, body: '', level})),
  sessions, requests: [], practice_log
});
// the sheet page as the practice reads it (the harness has no full DOMParser): the technique template, through sheet.js
const techPage = {win: {RBSheet: SH, __page: () => parse(read('templates/technique.html'))},
  source: s => s.replace('const readPage = async slug => {', 'const readPage = async slug => { if (window.__page) return {html: \'\', page: window.__page(slug)};')};
const open = async (hash, opt = {}) => {
  const page = await app({...signedIn, tables: tables(opt), hash, dom: true, library: CFG.library, ...techPage, ...(opt.app || {})});
  await settle();
  return page;
};
const player = page => page.element('player').innerHTML;
const view = page => page.element('view').innerHTML;
const calls = (page, method, table) => page.clients.at(-1).calls.filter(c => c[0] === method && c[1] === table);
const fire = async (page, id, type) => { await page.fire(id, type); await settle(); };
const clickIn = (page, id, selector) => page.element(id).listeners.click({target: {closest: s => s === selector ? {dataset: {}} : null}});

const TECH = ['kitesurf', 'kitefoil', 'wingfoil', 'wakeboard', 'surf', 'climb', 'snow', 'ride', 'pole', 'fight', 'dance', 'cook', 'crafts', 'racket', 'golf'];
const REP = ['strength', 'yoga', 'swim', 'run', 'bike', 'hike', 'pilates', 'barre', 'mobility', 'prenatal', 'floor', 'breath', 'nutrition', 'beauty'];

test('R14 defaults per built-in: technique for the technique profiles plus fight, dance, cook, crafts, racket, golf; repetition for the others', () => {
  const fam = Object.fromEntries(CFG.library.map(t => [t.id, t.family]));
  assert.deepEqual(Object.keys(fam).sort(), [...TECH, ...REP].sort(), 'every built-in notebook has an explicit family');
  for (const id of TECH) assert.equal(fam[id], 'technique', id);
  for (const id of REP) assert.equal(fam[id], 'repetition', id);
  for (const t of CFG.library) if (t.profile === 'technique') assert.equal(t.family, 'technique', `${t.id}: a technique profile is a technique notebook`);
  // the profile is untouched: it picks the sheet template (fight stays « partner », dance and cook stay « gym »)
  assert.deepEqual(['fight', 'dance', 'cook', 'golf'].map(id => CFG.library.find(t => t.id === id).profile), ['partner', 'gym', 'gym', 'gym']);
});

test('R14 notebook page: « n of N learned » and the gauge under the cover; each practised sheet carries its level pill', async () => {
  const page = await open('#kitesurf', {levels: {k1: 'got', k2: 'getting'}});
  const box = page.element('nb-learned');
  assert.equal(box.hidden, false);
  assert.match(box.innerHTML, /^<p>1 of 3 learned<\/p><span class="gauge" role="img" aria-label="1 of 3 moves learned">/);
  assert.equal((box.innerHTML.match(/<i class="on"><\/i>/g) || []).length, 1);
  assert.equal((box.innerHTML.match(/<i class=""><\/i>/g) || []).length, 2);
  const cards = page.element('groups').innerHTML;
  const cardOf = title => cards.split('<a class="card').find(c => c.includes(`<h3>${title}</h3>`));
  assert.match(cardOf('Water start'), /<p class="lvp"><span class="lv lv-got"><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>Got it<\/span><\/p>/);
  assert.match(cardOf('Jibe'), /<span class="lv lv-getting">[\s\S]*Getting it<\/span>/);
  assert.doesNotMatch(cardOf('Pop'), /class="lvp"|class="lv /, 'a sheet never practised shows no pill');
  // a repetition notebook: no gauge, no pill
  page.go('#strength'); await settle();
  assert.equal(page.element('nb-learned').hidden, true);
  assert.doesNotMatch(page.element('groups').innerHTML, /class="lvp"/);
});

test('R14 gauge counts: every sheet of the notebook, « Got it » only; one bar past 24 sheets; none for an empty notebook', async () => {
  const many = Array.from({length: 27}, (_, i) => sheet('m' + i, 'snow', 'Move ' + i));
  const levels = Object.fromEntries(many.slice(0, 9).map(e => [e.slug, 'got']).concat([['m9', 'getting'], ['m10', 'learning']]));
  const page = await open('#snow', {themes: [theme('snow', 'Ski & snowboard'), theme('climb', 'Climbing')], extra: many, levels});
  assert.match(page.element('nb-learned').innerHTML, /<p>9 of 27 learned<\/p><span class="gauge bar" role="img" aria-label="9 of 27 moves learned"><i class="on" style="width:33%"><\/i><\/span>/);
  page.go('#climb'); await settle();
  assert.equal(page.element('nb-learned').hidden, true, 'no sheet: no gauge');
});

test('R14 override: the account\'s family wins over the default, both ways; a custom notebook is repetition', async () => {
  const themes = [theme('kitesurf', 'Kitesurf', {family: 'repetition'}), theme('strength', 'Strength', {family: 'technique'}),
    theme('custom-tricks', 'Tricks', {builtin: false})];
  const page = await open('#kitesurf', {themes, levels: {k1: 'got', s1: 'getting', c1: 'got'}, extra: [sheet('c1', 'custom-tricks', 'Kickflip')]});
  assert.equal(page.element('nb-learned').hidden, true, 'kitesurf set to repetition');
  page.go('#strength'); await settle();
  assert.match(page.element('nb-learned').innerHTML, /0 of 1 learned/);
  assert.match(page.element('groups').innerHTML, /lv-getting/);
  page.go('#custom-tricks'); await settle();
  assert.equal(page.element('nb-learned').hidden, true, 'a custom notebook defaults to repetition');
});

test('R14 Notebook ⋯ › Kind of practice: Repetition / Technique with one sentence each; a tap saves user_themes.family', async () => {
  const page = await open('#strength');
  await page.fire('nav-more');
  assert.match(page.element('nav-actions').innerHTML, /<div class="nav-list"><button type="button" class="nav-it" id="nav-kind">Kind of practice<small>Repetition<\/small>/);
  clickIn(page, 'nav-actions', '#nav-kind'); await settle();
  const dlg = page.element('kind-dlg');
  assert.equal(dlg.open, true);
  assert.match(dlg.innerHTML, /id="kind-repetition" aria-pressed="true"><b>Repetition<\/b><span>Do it again to keep a rhythm<\/span>/);
  assert.match(dlg.innerHTML, /id="kind-technique" aria-pressed="false"><b>Technique<\/b><span>Learn the move until you’ve got it<\/span>/);
  await fire(page, 'kind-technique');
  assert.deepEqual(plain(calls(page, 'update', 'user_themes')).map(c => [c[2], c[3]]), [[{family: 'technique'}, [['user_id', 'u1'], ['id', 'strength']]]], 'the owner\'s row only (Codex pass 3)');
  assert.equal(dlg.open, false);
  assert.match(page.element('nb-learned').innerHTML, /0 of 1 learned/, 'the notebook is technique at once');
  // a refused write (no update grant yet): said in place, nothing changes
  const page2 = await open('#strength', {app: {writes: {user_themes: {data: null, error: {code: '42501', message: 'permission denied'}}}}});
  await page2.fire('nav-more'); clickIn(page2, 'nav-actions', '#nav-kind'); await settle();
  await fire(page2, 'kind-technique');
  assert.equal(page2.element('kind-dlg').open, true);
  assert.match(page2.element('kind-dlg').innerHTML, /role="alert">Not saved\. Try again\./);
  assert.equal(page2.element('nb-learned').hidden, true);
});

test('R14 Codex pass 1: « Kind of practice » open for A, then B signed in on the same client: the dialog closes, a tap writes nothing', async () => {
  const page = await open('#strength');
  await page.fire('nav-more'); clickIn(page, 'nav-actions', '#nav-kind'); await settle();
  const dlg = page.element('kind-dlg');
  assert.equal(dlg.open, true);
  page.clients.at(-1).authListener('SIGNED_IN', {user: {id: 'u2', email: 'u2@example.test'}, access_token: 't'}); await settle();
  assert.equal(dlg.open, false, 'another account closes the dialog');
  await fire(page, 'kind-technique'); // the button A saw, tapped anyway
  for (const c of page.clients) assert.deepEqual(c.calls.filter(x => x[0] === 'update' && x[1] === 'user_themes'), [], 'B\'s notebook untouched');
});

test('R14 backend without the columns: no error, no level, every notebook repetition, Start not Practice, no Kind of practice', async () => {
  const page = await open('#kitesurf', {levels: {k1: 'got'}, app: {missing: ['user_themes.family', 'notes.level']}});
  const sel = page.clients.at(-1).selects.filter(s => s[0] === 'user_themes').map(s => s[1]);
  assert.deepEqual(sel, ['id,title,description,groups,builtin,position,family', 'id,title,description,groups,builtin,position'], 'read again without the column');
  assert.equal(page.element('nb-learned').hidden, true);
  assert.doesNotMatch(page.element('groups').innerHTML, /class="lvp"/);
  assert.match(page.element('groups').innerHTML, /Water start/, 'the notebook still shows its sheets');
  await page.fire('nav-more');
  assert.doesNotMatch(page.element('nav-actions').innerHTML, /nav-kind/);
  page.go('#k1'); await settle();
  assert.match(view(page), /id="play-start">Start</);
  page.go('#k1/practice'); await settle();
  assert.doesNotMatch(player(page), /tech-|How did it go/, 'the practice route plays the sheet as Start does');
  // only the level column missing: still all repetition
  const page2 = await open('#kitesurf', {levels: {k1: 'got'}, app: {missing: ['notes.level']}});
  assert.equal(page2.element('nb-learned').hidden, true);
});

test('R14 practice: Practice filled on a technique sheet, one step per screen (photo, step, key point no. 1, Next step, dots), then How did it go', async () => {
  const page = await open('#k1');
  assert.match(view(page), /<p class="pl-start"><button type="button" class="btn" id="play-start">Practice<\/button><\/p>/);
  await fire(page, 'play-start');
  assert.equal(page.location.hash, '#k1/practice');
  await settle();
  let h = player(page);
  assert.match(h, /<p class="pl-n">Step 1 of 3<\/p><h1 class="pl-t" id="tech-title" tabindex="-1">Water start<\/h1>/);
  assert.match(h, /<div class="tp-photo"><img src="img\/01-approach\.jpg" alt="Describe the position: body, board, kite"><\/div>/);
  assert.match(h, /<p class="tp-t">Approach<\/p><p class="tp-c">Speed, edge and kite position before the move\.<\/p>/);
  assert.match(h, /<p class="tp-key"><b>Key point:<\/b> /);
  assert.match(h, /<p class="pl-dots" aria-hidden="true"><span class="on"><\/span><span><\/span><span><\/span><\/p>/);
  assert.match(h, /class="btn ghost" id="tech-prev" disabled>Previous<\/button><button type="button" class="btn" id="tech-next">Next step<\/button>/);
  assert.doesNotMatch(h, /Opening too early/, 'mistakes are not steps');
  const key = h.match(/<b>Key point:<\/b> ([^<]*)</)[1];
  await fire(page, 'tech-next');
  h = player(page);
  assert.match(h, /Step 2 of 3[\s\S]*<p class="tp-t">Pop<\/p>/);
  assert.match(h, new RegExp(`<b>Key point:</b> ${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`), 'key point no. 1 on every step');
  await fire(page, 'tech-prev');
  assert.match(player(page), /Step 1 of 3/);
  await fire(page, 'tech-next'); await fire(page, 'tech-next');
  assert.match(player(page), /Step 3 of 3[\s\S]*id="tech-next">Finish</);
  await fire(page, 'tech-next');
  h = player(page);
  assert.match(h, /<p class="tp-over">Water start<\/p><h1 id="tech-title" tabindex="-1">How did it go\?<\/h1>/);
  assert.match(h, /id="tech-lv-learning" aria-pressed="true">[\s\S]*Learning[\s\S]*id="tech-lv-getting" aria-pressed="false">[\s\S]*id="tech-lv-got" aria-pressed="false">/);
  assert.doesNotMatch(h, /Before today/, 'never practised');
  assert.equal(calls(page, 'upsert', 'notes').length + calls(page, 'insert', 'practice_log').length, 0, 'nothing written before Save');
  assert.doesNotMatch(h + view(page), /session this week/, 'a technique sheet never shows the week');
});

test('R14 level save and preselect: the current level is chosen; Save writes the level and one practice_log row, then Practice saved', async () => {
  const page = await open('#k2/practice', {levels: {k2: 'getting'}, practice_log: []});
  for (let i = 0; i < 3; i++) await fire(page, 'tech-next');
  let h = player(page);
  assert.match(h, /<p class="tp-before">Before today: Getting it<\/p>/);
  assert.match(h, /id="tech-lv-getting" aria-pressed="true"/);
  assert.match(h, /id="tech-lv-learning" aria-pressed="false"/);
  await fire(page, 'tech-lv-learning');
  assert.match(player(page), /id="tech-lv-learning" aria-pressed="true"/);
  await fire(page, 'tech-save');
  assert.deepEqual(plain(calls(page, 'upsert', 'notes')).map(c => c[2]), [{user_id: 'u1', slug: 'k2', level: 'learning'}], 'the owner, slug and level only: the note text is untouched');
  const logs = plain(calls(page, 'insert', 'practice_log')).map(c => c[2]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].slug, 'k2'); assert.equal(logs[0].user_id, 'u1'); assert.equal(logs[0].text, '', 'the row records the practice; the level lives in notes.level'); assert.match(logs[0].id, /^[0-9a-f-]{36}$/);
  h = player(page);
  assert.match(h, /id="tech-title" tabindex="-1">Practice saved<\/p><h1>Jibe<\/h1><p class="tp-lv">Your level: <span class="lv lv-learning">/);
  assert.match(h, /Next time, focus on/);
  assert.doesNotMatch(h, /New move/);
  // the notebook shows it, and the next practice preselects it
  await fire(page, 'tech-done');
  assert.equal(page.location.hash, '#k2');
  page.go('#kitesurf'); await settle();
  assert.match(page.element('groups').innerHTML.split('<a class="card').find(c => c.includes('<h3>Jibe</h3>')), /lv-learning/);
  page.go('#k2/practice'); await settle();
  for (let i = 0; i < 3; i++) await fire(page, 'tech-next');
  assert.match(player(page), /Before today: Learning[\s\S]*id="tech-lv-learning" aria-pressed="true"/);
});

test('R14 a failed save says so and Try again sends the same row (its id), then only what is missing', async () => {
  let fail = true; const sent = [];
  const hold = (table, ops) => {
    const ins = table === 'practice_log' && ops.find(o => o[0] === 'insert'); if (!ins) return null;
    sent.push(plain(ins[1])); // a write answered by hold is not in client.calls
    return Promise.resolve(fail ? {data: null, error: {code: '08000', message: 'offline'}} : {data: [{}], error: null});
  };
  const page = await open('#k1/practice', {app: {hold}});
  for (let i = 0; i < 3; i++) await fire(page, 'tech-next');
  await fire(page, 'tech-lv-getting');
  await fire(page, 'tech-save');
  assert.match(player(page), /role="alert">Level saved · practice not logged[\s\S]*id="tech-save">Try again</);
  assert.doesNotMatch(player(page), /Practice saved/);
  fail = false;
  await fire(page, 'tech-save');
  assert.equal(calls(page, 'upsert', 'notes').length, 1, 'the level was saved by the first try: not sent again');
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0], 'the same row (id, day, text)');
  assert.equal(sent[0].text, '');
  assert.match(player(page), /Practice saved/);
});

test('R14 Codex pass 1: a partial save, then another level and Try again, keeps one practice (one practice_log row, its id)', async () => {
  // practice_log stored, notes refused: then Got it and Try again → the level only, never a second row
  const logs = [], levelsSent = [];
  let notesFail = true, logFail = false;
  const hold = (table, ops) => {
    const ins = table === 'practice_log' && ops.find(o => o[0] === 'insert');
    if (ins) { logs.push(plain(ins[1])); return Promise.resolve(logFail ? {data: null, error: {code: '08000', message: 'offline'}} : {data: [{}], error: null}); }
    const up = table === 'notes' && ops.find(o => o[0] === 'upsert');
    if (up) { levelsSent.push(plain(up[1]).level); return Promise.resolve(notesFail ? {data: null, error: {code: '08000', message: 'offline'}} : {data: [{}], error: null}); }
    return null;
  };
  const page = await open('#k1/practice', {app: {hold}});
  for (let i = 0; i < 3; i++) await fire(page, 'tech-next');
  await fire(page, 'tech-lv-getting');
  await fire(page, 'tech-save');
  assert.match(player(page), /role="alert">Not saved\. Try again\./);
  notesFail = false;
  await fire(page, 'tech-lv-got');
  await fire(page, 'tech-save');
  assert.deepEqual(levelsSent, ['getting', 'got']);
  assert.equal(logs.length, 1, 'one practice, one practice_log row');
  assert.match(player(page), /New move: Water start/);
  // the level stored, the row refused: another level then Try again → the level again, the same row (its id)
  logs.length = 0; levelsSent.length = 0; logFail = true;
  const page2 = await open('#k2/practice', {app: {hold}});
  for (let i = 0; i < 3; i++) await fire(page2, 'tech-next');
  await fire(page2, 'tech-lv-getting');
  await fire(page2, 'tech-save');
  assert.match(player(page2), /role="alert">Level saved · practice not logged/);
  logFail = false;
  await fire(page2, 'tech-lv-learning');
  await fire(page2, 'tech-save');
  assert.deepEqual(levelsSent, ['getting', 'learning']);
  assert.equal(logs.length, 2);
  assert.equal(logs[1].id, logs[0].id, 'the same attempt: its row keeps its id');
  assert.match(player(page2), /Practice saved/);
});

test('R14 Codex pass 2: a row stored but its answer lost, then another level and Try again: notes.level is the last choice, one row', async () => {
  const db = [], levelsSent = [];
  let lose = true;
  const hold = (table, ops) => {
    const ins = table === 'practice_log' && ops.find(o => o[0] === 'insert');
    if (ins) {
      const row = plain(ins[1]);
      if (db.some(r => r.id === row.id)) return Promise.resolve({data: null, error: {code: '23505', message: 'duplicate key'}});
      db.push(row);
      if (lose) { lose = false; return Promise.reject(new Error('network: answer lost')); } // stored, answer lost
      return Promise.resolve({data: [{}], error: null});
    }
    const up = table === 'notes' && ops.find(o => o[0] === 'upsert');
    if (up) { levelsSent.push(plain(up[1]).level); return Promise.resolve({data: [{}], error: null}); }
    return null;
  };
  const page = await open('#k1/practice', {app: {hold}});
  for (let i = 0; i < 3; i++) await fire(page, 'tech-next');
  await fire(page, 'tech-lv-getting');
  await fire(page, 'tech-save');
  assert.match(player(page), /role="alert">Level saved · practice not logged[\s\S]*id="tech-save">Try again</);
  await fire(page, 'tech-lv-got');
  await fire(page, 'tech-save');
  assert.equal(levelsSent.at(-1), 'got', 'notes.level is the final choice');
  assert.equal(db.length, 1, 'exactly one practice_log row');
  assert.equal(db[0].text, '', 'no level in the log: nothing to contradict notes.level');
  assert.match(player(page), /New move: Water start/);
});

test('R14 Codex pass 2: the log unreadable at start (practiceOk false): the insert is tried; refused, « Level saved · practice not logged », never Practice saved', async () => {
  let logFail = true; const logs = [];
  const hold = (table, ops) => {
    const ins = table === 'practice_log' && ops.find(o => o[0] === 'insert');
    if (ins) { logs.push(plain(ins[1])); return Promise.resolve(logFail ? {data: null, error: {code: '08000', message: 'offline'}} : {data: [{}], error: null}); }
    return null;
  };
  const page = await open('#k1/practice', {app: {hold, failing: {practice_log: {error: {code: '08000', message: 'offline'}, status: 503}}}});
  for (let i = 0; i < 3; i++) await fire(page, 'tech-next');
  await fire(page, 'tech-lv-getting');
  await fire(page, 'tech-save');
  assert.equal(logs.length, 1, 'the insert is tried although the log could not be read');
  assert.match(player(page), /role="alert">Level saved · practice not logged[\s\S]*id="tech-save">Try again</);
  assert.doesNotMatch(player(page), /Practice saved/);
  assert.deepEqual(plain(calls(page, 'upsert', 'notes')).map(c => c[2]), [{user_id: 'u1', slug: 'k1', level: 'getting'}], 'the level is kept');
  logFail = false;
  await fire(page, 'tech-save');
  assert.equal(logs.length, 2); assert.equal(logs[1].id, logs[0].id);
  assert.equal(calls(page, 'upsert', 'notes').length, 1, 'the level is not sent again');
  assert.match(player(page), /Practice saved/);
});

test('R14 Codex pass 3: the token is B\'s before the writes are sent: both name A (user_id), RLS refuses them, nothing is written for B', async () => {
  let token = 'u1'; const payloads = [], forB = [];
  const hold = (table, ops) => {
    const w = ['notes', 'practice_log'].includes(table) && ops.find(o => o[0] === 'upsert' || o[0] === 'insert'); if (!w) return null;
    const row = plain(w[1]); payloads.push([table, row]);
    // RLS « with check (user_id = auth.uid()) », user_id defaulting to auth.uid(): the token decides
    if ((row.user_id || token) !== token) return Promise.resolve({data: null, error: {code: '42501', message: 'new row violates row-level security policy'}});
    if (token === 'u2') forB.push([table, row]);
    return Promise.resolve({data: [{}], error: null});
  };
  const page = await open('#k1/practice', {app: {hold}});
  for (let i = 0; i < 3; i++) await fire(page, 'tech-next');
  await fire(page, 'tech-lv-got');
  page.element('tech-save').listeners.click({}); // A's tap: the requests leave on the next microtask
  token = 'u2'; // meanwhile B signed in on this client (another tab): B's token goes with them
  await settle();
  assert.equal(payloads.length, 2);
  for (const [table, row] of payloads) assert.equal(row.user_id, 'u1', table);
  assert.deepEqual(forB, [], 'nothing written for B');
  assert.doesNotMatch(player(page), /New move|Practice saved/);
});

test('R14 Codex pass 3: an own sheet with the slug « demo » opens its practice at #demo/practice, as #demo/play', async () => {
  // the account known at start (as on a device signed in before): the catalogue decides #demo at once
  const stored = {['rb.auth.' + ownUrl.replace(/\W/g, '')]: JSON.stringify({user: {id: 'u1'}})};
  const play = await open('#demo/play', {extra: [sheet('demo', 'kitesurf', 'Demo')], app: {stored}});
  assert.equal(play.element('demo').hidden, true, '#demo/play: the own sheet (before R14 already)');
  const page = await open('#demo/practice', {extra: [sheet('demo', 'kitesurf', 'Demo')], app: {stored}});
  assert.equal(page.element('demo').hidden, true, 'not the demo');
  assert.equal(page.element('player').hidden, false);
  assert.match(player(page), /Step 1 of/);
});

test('R14 first « Got it » only opens New move: « New move: <title> », « n of N moves learned », Back to the notebook (no Share since P8 R18; Share my progress since R19)', async () => {
  const page = await open('#k1/practice', {levels: {k1: 'getting', k2: 'got'}});
  for (let i = 0; i < 3; i++) await fire(page, 'tech-next');
  await fire(page, 'tech-lv-got');
  await fire(page, 'tech-save');
  const h = player(page);
  assert.match(h, /class="tp-star" id="tech-title" tabindex="-1">New move: Water start<\/h1>/);
  assert.match(h, /<p class="tp-n">2 of 3 moves learned<\/p><span class="gauge" role="img" aria-label="2 of 3 moves learned"><i class="on"><\/i><i class="on new"><\/i><i class=""><\/i><\/span>/);
  // P8 R19: « Share my progress » outlined next to Back, the one filled action
  assert.match(h, /<p class="actions end-acts"><button type="button" class="btn" id="tech-back">Back to Kitesurf<\/button><button type="button" class="btn ghost" id="proud-go">Share my progress<\/button><\/p>/);
  assert.doesNotMatch(h, /tech-share|>Share</, 'P8 R18: no text share of the sheet');
  assert.doesNotMatch(h, /session this week/);
  await fire(page, 'tech-back');
  assert.equal(page.location.hash, '#kitesurf');
  await settle();
  assert.match(page.element('nb-learned').innerHTML, /2 of 3 learned/);
  // « Got it » again on a sheet already at Got it: Practice saved, not New move
  page.go('#k2/practice'); await settle();
  for (let i = 0; i < 3; i++) await fire(page, 'tech-next');
  assert.match(player(page), /id="tech-lv-got" aria-pressed="true"/);
  await fire(page, 'tech-save');
  assert.match(player(page), /Practice saved/);
  assert.doesNotMatch(player(page), /New move/);
});

test('R14 a save answered once another account is signed in on the same client applies nothing (level, screen)', async () => {
  let release, waiting = true;
  const held = new Promise(resolve => { release = resolve; });
  const hold = (table, ops) => table === 'notes' && ops.some(o => o[0] === 'upsert') && waiting ? held.then(() => ({data: [{}], error: null})) : null;
  const page = await open('#k1/practice', {app: {hold}});
  for (let i = 0; i < 3; i++) await fire(page, 'tech-next');
  await fire(page, 'tech-lv-got');
  page.element('tech-save').listeners.click({}); await settle(); // its write waits
  assert.match(player(page), /Saving…/);
  page.clients.at(-1).authListener('SIGNED_IN', {user: {id: 'u2', email: 'u2@example.test'}, access_token: 't'}); await settle();
  waiting = false; release(); await settle();
  assert.doesNotMatch(player(page), /New move|Practice saved/);
  page.go('#kitesurf'); await settle();
  assert.doesNotMatch(page.element('groups').innerHTML + page.element('nb-learned').innerHTML, /lv-got|1 of 3 learned/, 'A\'s level never reaches B');
});

test('R14 MMA (fight, technique by default): its sheets carry levels, its sessions still end on R5\'s rhythm screen', async () => {
  const today = new Date(), iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const page = await open('#fight', {themes: [theme('fight', 'Fight techniques')], extra: [sheet('jab', 'fight', 'Jab'), sheet('kick', 'fight', 'Low kick')],
    levels: {jab: 'got'}, sessions: [{slug: 'kicks', theme: 'fight', title: 'Kicks', format: '', items: [{slug: 'jab', dose: '3 × 10'}, {slug: 'kick', dose: '40 s'}]}],
    practice_log: [{id: 'p0', slug: 'session/other', done_on: iso, text: ''}]});
  assert.match(page.element('nb-learned').innerHTML, /1 of 2 learned/);
  page.go('#jab'); await settle();
  assert.match(view(page), /id="play-start">Practice</, 'a fight sheet is practised step by step');
  page.go('#session/kicks/play'); await settle();
  await fire(page, 'play-done-set');
  await fire(page, 'play-finish');
  const h = view(page);
  assert.match(h, /id="end-done"[^>]*>Session done<\/p>/);
  assert.match(h, /<p class="rh-n">2nd session this week<\/p>/, 'the rhythm, as for a repetition notebook');
  assert.doesNotMatch(player(page) + h, /How did it go|New move/);
  // a sheet opened from the session keeps Start (it plays the session)
  page.go('#session/kicks/1'); await settle();
  assert.match(view(page), /id="play-start">Start</);
});

test('R14 schema: additive, idempotent section at the end; family and level checked; update granted on family only', () => {
  const sql = read('supabase/schema.sql'), at = sql.indexOf('-- Technique family (P8 R14)');
  assert.ok(at > sql.indexOf('requests_reason_check'), 'a new section after R3\'s');
  // R14's own section: up to the next lot's section (R12's invitations come after it).
  const next = sql.indexOf('-- Invitations (P8 R12)', at);
  const sec = sql.slice(at, next > at ? next : undefined);
  assert.match(sec, /alter table public\.user_themes add column if not exists family text;/);
  assert.match(sec, /drop constraint if exists user_themes_family_check;[\s\S]*check \(family in \('repetition','technique'\)\)/);
  assert.match(sec, /alter table public\.notes add column if not exists level text;/);
  assert.match(sec, /drop constraint if exists notes_level_check;[\s\S]*check \(level in \('learning','getting','got'\)\)/);
  assert.match(sec, /grant update \(family\) on public\.user_themes to authenticated;/);
  assert.match(sec, /drop trigger if exists notes_touch on public\.notes;\ncreate trigger notes_touch before update of body on public\.notes/);
  assert.doesNotMatch(sec, /\bdrop (table|column)\b|not null/i);
});

test('R14 versions: config.js has a new ?v= in index.html and the worker\'s shell, and the cache VERSION moved past R5\'s', () => {
  const html = read('app/index.html'), sw = read('app/sw.js');
  const v = (src, f) => Number((src.match(new RegExp(f.replace('.', '\\.') + '\\?v=(\\d+)')) || [])[1]);
  assert.ok(v(html, 'config.js') >= 14);
  assert.equal(v(sw, 'config.js'), v(html, 'config.js'));
  assert.ok(Number(sw.match(/const VERSION = 'rb-shell-(\d+)'/)[1]) >= 61);
});
