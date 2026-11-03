const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, ownUrl, ownKey} = require('../../harness.cjs');

const DAY = 24 * 60 * 60 * 1000;
const signedIn = {
  remembered: {mode: 'own', url: ownUrl, key: ownKey},
  sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}
};
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
};
const ago = days => new Date(Date.now() - days * DAY).toISOString();
const sheet = (slug, days = 5) => ({
  slug, kind: 'sheet', theme: 'strength', group: 'General',
  title: `Title ${slug}`, summary: `Summary ${slug}`, added_at: ago(days)
});
const tables = (sheets, practice_log = []) => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets,
  sessions: [],
  practice_log,
  notes: []
});
const open = async (rows, options = {}) => {
  const page = await app({...signedIn, tables: tables(rows), ...options});
  await settle();
  return page;
};
const shelf = page => page.element('to-try');
const hrefs = page => [...shelf(page).innerHTML.matchAll(/href="#([^"]+)"/g)].map(match => match[1]);

test('L8 Home « To try »: up to 3 sheets added more than 3 days ago and never practised', async () => {
  const old = ['a', 'b', 'c', 'd', 'e'].map(slug => sheet(slug));
  const rows = [...old, sheet('recent', 2), sheet('boundary', 3),
    {...sheet('old-session'), kind: 'session'}];
  const page = await open(rows, {tables: tables(rows, [{slug: 'e', done_on: '2026-10-01'}])});
  assert.equal(page.element('home').hidden, false);
  assert.equal(shelf(page).hidden, false);
  assert.match(shelf(page).innerHTML, /To try/);
  const chosen = hrefs(page);
  assert.ok(chosen.length > 0 && chosen.length <= 3, chosen.join(', '));
  assert.equal(new Set(chosen).size, chosen.length);
  assert.ok(chosen.every(slug => ['a', 'b', 'c', 'd'].includes(slug)), chosen.join(', '));
  for (const slug of chosen) {
    assert.match(shelf(page).innerHTML, new RegExp(`Title ${slug}`));
    assert.match(shelf(page).innerHTML, new RegExp(`data-dismiss="${slug}"`));
  }
  assert.doesNotMatch(shelf(page).innerHTML, /Title (recent|boundary|e|old-session)/);
  assert.ok(page.clients.at(-1).calls.every(call => call[1] !== 'practice_log'), 'the shelf only reads practice history');
});

test('L8 choice seeded by the date: it remains stable within the same day', async () => {
  const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(slug => sheet(slug));
  const first = await open(rows);
  const selected = hrefs(first);
  assert.equal(selected.length, 3);
  first.go('#strength');
  await settle();
  first.go('');
  await settle();
  assert.deepEqual(hrefs(first), selected, 'navigating away and back keeps the choice');
  const reopened = await open(rows);
  assert.deepEqual(hrefs(reopened), selected, 'reloading on the same day keeps the choice');
});

test('L8 each card has « Not for me »: dismissal lasts on this device', async () => {
  const rows = ['a', 'b', 'c', 'd'].map(slug => sheet(slug));
  const page = await open(rows);
  const dismissed = hrefs(page)[0];
  assert.ok(dismissed);
  assert.match(shelf(page).innerHTML, /Not for me/);
  const listener = shelf(page).listeners.click;
  assert.equal(typeof listener, 'function');
  await listener({target: {closest: selector => selector === '[data-dismiss]'
    ? {dataset: {dismiss: dismissed}} : null}});
  await settle();
  assert.ok(!hrefs(page).includes(dismissed), 'the card leaves immediately');
  assert.ok(page.storage.has('rb.dismissed.u1'));
  const reopened = await open(rows, {stored: {'rb.dismissed.u1': page.storage.get('rb.dismissed.u1')}});
  assert.ok(!hrefs(reopened).includes(dismissed), 'the card stays dismissed after reload');
  assert.equal(reopened.element('home').hidden, false);
});

test('L8 « To try » is hidden when no sheet qualifies', async () => {
  for (const [label, rows, practice] of [
    ['empty catalogue', [], []],
    ['only recent sheets', [sheet('recent', 2)], []],
    ['all old sheets practised', [sheet('done')], [{slug: 'done', done_on: '2026-10-01'}]],
    ['all old sheets dismissed', [sheet('dismissed')], []]
  ]) {
    const stored = label === 'all old sheets dismissed' ? {'rb.dismissed.u1': '["dismissed"]'} : {};
    const page = await open(rows, {tables: tables(rows, practice), stored});
    assert.equal(shelf(page).hidden, true, label);
    assert.equal(page.element('home').hidden, false, label);
  }
});

test('L8 « To try » is hidden when the practice table is missing', async () => {
  const page = await open([sheet('old')], {
    failing: {practice_log: {error: {code: 'PGRST205', message: 'Could not find the table'}, status: 404}}
  });
  assert.equal(shelf(page).hidden, true);
  assert.equal(page.element('home').hidden, false);
  assert.match(page.element('portal').innerHTML, /Strength/);
});

test('L8 practice read error and offline: Home remains usable without a misleading « To try » shelf', async () => {
  for (const [label, response] of [
    ['permission error', {error: {code: '42501', message: 'permission denied'}, status: 403}],
    ['offline', {error: {message: 'Failed to fetch'}, status: 0}]
  ]) {
    const page = await open([sheet('old')], {failing: {practice_log: response}});
    assert.equal(page.element('home').hidden, false, label);
    assert.match(page.element('portal').innerHTML, /Strength/, label);
    assert.equal(shelf(page).hidden, true, label);
  }
});

test('L8 no streak, reminder or notification appears with « To try »', async () => {
  const page = await open([sheet('old')]);
  assert.equal(shelf(page).hidden, false);
  assert.doesNotMatch(shelf(page).innerHTML, /streak|reminder|notification/i);
});
