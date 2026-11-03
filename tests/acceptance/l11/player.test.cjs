const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('../../harness.cjs');

const user = id => ({remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id, email: id + '@example.test'}}});
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const tables = (items, practice_log = []) => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: items.map((item, i) => ({slug: item.slug, kind: 'sheet', theme: 'strength', title: 'Exercise ' + (i + 1), html: '<a href="#">Home</a>'})),
  sessions: [{slug: 'routine', theme: 'strength', title: 'Routine', format: '30 s rest', items}],
  notes: [], requests: [], practice_log
});
const open = async (items, options = {}) => {
  const page = await app({...user('alice'), tables: tables(items), hash: '#session/routine/play', dom: true, ...options});
  await settle();
  return page;
};
const click = async (page, id, type = 'click') => { await page.fire(id, type); await settle(); };
const screen = page => page.element('player').innerHTML;
const boxes = html => [...html.matchAll(/<input\b[^>]*type="checkbox"[^>]*class="play-set"[^>]*>/g)].map(m => m[0]);
const writes = page => page.clients.at(-1).calls.filter(c => c[0] === 'insert' && c[1] === 'practice_log');

 test('Sets — one round check box per set; seconds or an unparsed dose gives one Done box', async () => {
  for (const [item, count, label] of [
    [{slug: 'first', dose: '3 × 10'}, 3, '3 × 10'],
    [{slug: 'first', dose: '40 s'}, 1, 'Done'],
    [{slug: 'first', dose: 'Light band'}, 1, 'Done']
  ]) {
    const page = await open([item]);
    assert.equal(page.element('player').hidden, false);
    assert.equal(boxes(screen(page)).length, count);
    assert.match(screen(page), new RegExp(label.replace('×', '×')));
  }
});

 test('Sets — checks persist for this user, session and exercise, then Start over clears them', async () => {
  const items = [{slug: 'first', dose: '3 × 10'}, {slug: 'second', dose: '40 s'}];
  const page = await open(items);
  await click(page, 'play-set-1', 'change');
  assert.match(boxes(screen(page))[0], /\bchecked\b/);
  await click(page, 'play-next');
  assert.doesNotMatch(boxes(screen(page))[0], /\bchecked\b/);
  const stored = Object.fromEntries(page.storage);
  const sameUser = await open(items, {stored});
  sameUser.go('#session/routine/play/1'); await settle();
  assert.match(boxes(screen(sameUser))[0], /\bchecked\b/);
  const otherUser = await open(items, {...user('bob'), stored});
  assert.doesNotMatch(boxes(screen(otherUser))[0], /\bchecked\b/);
  sameUser.go('#session/routine'); await settle();
  sameUser.go('#session/routine/play'); await settle();
  assert.match(screen(sameUser), /Start over/);
  await click(sameUser, 'play-restart');
  assert.doesNotMatch(boxes(screen(sameUser))[0], /\bchecked\b/);
});

 test('Rest timer — checking a nonfinal set replaces the dose; rest_s, format, then 60 s set the duration, with −15 s, +15 s and Skip', async () => {
  const cases = [
    [{slug: 'first', dose: '2 × 10', rest_s: 45}, '0:45'],
    [{slug: 'first', dose: '2 × 10'}, '0:30'],
    [{slug: 'first', dose: '2 × 10'}, '1:00']
  ];
  for (const [item, expected] of cases) {
    const data = tables([item, {slug: 'second', dose: '40 s'}]);
    if (expected === '1:00') data.sessions[0].format = '';
    const page = await open(data.sessions[0].items, {tables: data});
    await click(page, 'play-set-1', 'change');
    assert.match(screen(page), /id="play-rest"/);
    assert.match(screen(page), new RegExp(expected));
    assert.doesNotMatch(screen(page), /<p class="pl-dose">2 × 10<\/p>/);
    assert.match(screen(page), /−15 s/);
    assert.match(screen(page), /\+15 s/);
    assert.match(screen(page), /Skip/);
    await click(page, 'play-rest-plus');
    assert.notEqual(screen(page).match(/id="play-rest"[^>]*>([^<]+)/)?.[1], expected);
    await click(page, 'play-rest-minus');
    assert.match(screen(page), new RegExp(expected));
    await click(page, 'play-rest-skip');
    assert.doesNotMatch(screen(page), /id="play-rest"/);
  }
});

 test('Rest timer — the final set of the final exercise starts no rest', async () => {
  const page = await open([{slug: 'first', dose: '40 s'}]);
  await click(page, 'play-set-1', 'change');
  assert.doesNotMatch(screen(page), /id="play-rest"/);
});

 test('End of session — Finish shows Session done, the checked counts and a prefilled practice field; Save to log writes session/<slug>', async () => {
  const page = await open([{slug: 'first', dose: '3 × 10'}, {slug: 'second', dose: '40 s'}]);
  await click(page, 'play-set-1', 'change');
  await click(page, 'play-rest-skip');
  await click(page, 'play-set-2', 'change');
  await click(page, 'play-rest-skip');
  await click(page, 'play-next');
  await click(page, 'play-set-1', 'change');
  await click(page, 'play-finish');
  const end = page.element('view').innerHTML;
  assert.match(end, /Session done/);
  assert.match(end, /2 exercises · 3 sets/);
  assert.match(end, /<input[^>]*id="end-log-text"[^>]*value="2 exercises · 3 sets"/);
  assert.match(end, /Save to log/);
  assert.match(end, /Close/);
  assert.equal(writes(page).length, 0);
  await click(page, 'end-save');
  assert.equal(writes(page).length, 1);
  assert.equal(writes(page)[0][2].slug, 'session/routine');
  assert.equal(writes(page)[0][2].text, '2 exercises · 3 sets');
});

 test('End of session — Close leaves without saving and clears checks for the next play', async () => {
  const page = await open([{slug: 'first', dose: '40 s'}]);
  await click(page, 'play-set-1', 'change');
  await click(page, 'play-finish');
  assert.match(page.element('view').innerHTML, /Session done/);
  await click(page, 'end-close');
  assert.equal(writes(page).length, 0);
  page.go('#session/routine/play'); await settle();
  assert.doesNotMatch(boxes(screen(page))[0], /\bchecked\b/);
});

 test('End of session — without the practice_log table, only the summary and Close appear', async () => {
  const failing = {practice_log: {error: {code: 'PGRST205', message: 'Could not find the table'}, status: 404}};
  const page = await open([{slug: 'first', dose: '40 s'}], {failing});
  await click(page, 'play-set-1', 'change');
  await click(page, 'play-finish');
  const end = page.element('view').innerHTML;
  assert.match(end, /Session done/);
  assert.match(end, /1 exercise · 1 set/);
  assert.match(end, /Close/);
  assert.doesNotMatch(end, /Save to log|id="end-log-text"/);
  assert.equal(writes(page).length, 0);
});

 test('End of session — an offline Save keeps the summary and reports the L6 save error', async () => {
  const writesResponse = {practice_log: {data: null, error: {message: 'Failed to fetch'}}};
  const page = await open([{slug: 'first', dose: '40 s'}], {writes: writesResponse});
  await click(page, 'play-set-1', 'change');
  await click(page, 'play-finish');
  await click(page, 'end-save');
  assert.equal(writes(page).length, 1);
  assert.match(page.element('view').innerHTML, /Session done/);
  assert.match(page.element('view').innerHTML, /Not saved\. Try again\./);
  assert.match(page.element('view').innerHTML, /Save to log/);
});
