// L8, « To try »: the pure choice of the shelf (RS.toTry), seeded by the local date.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const RS = require('../app/sessions.js');

// added_at as the app gets it (an ISO timestamp), for a local calendar day of Nov 2026 at noon
const on = (day, hour = 12) => new Date(2026, 10, day, hour).toISOString();
const sheet = (slug, day = 1) => ({slug, title: slug, added_at: on(day)});
const slugs = list => list.map(s => s.slug);
const many = Array.from({length: 12}, (_, i) => sheet('s' + String(i).padStart(2, '0')));

test('L8 toTry: only sheets added more than 3 calendar days before today, never practised, not dismissed', () => {
  const rows = [sheet('old', 1), sheet('day4', 5), sheet('day3', 6), sheet('today', 9), sheet('done', 1), sheet('nope', 1),
    {slug: 'nodate', title: 'x'}, {slug: 'bad', added_at: 'not a date'}];
  const got = RS.toTry(rows, {today: '2026-11-09', practised: new Map([['done', '2026-11-02']]), dismissed: ['nope'], n: 10});
  assert.deepEqual(slugs(got).sort(), ['day4', 'old']);
  // late evening on day 5 is still 4 calendar days before the 9th
  assert.deepEqual(slugs(RS.toTry([{slug: 'late', added_at: on(5, 23)}], {today: '2026-11-09'})), ['late']);
});

test('L8 toTry: at most 3, the same on the same day whatever the catalogue order, another choice on another day', () => {
  const a = RS.toTry(many, {today: '2026-11-20'});
  assert.equal(a.length, 3);
  assert.equal(new Set(slugs(a)).size, 3);
  assert.deepEqual(slugs(RS.toTry([...many].reverse(), {today: '2026-11-20'})), slugs(a));
  const b = RS.toTry(many, {today: '2026-11-21'});
  assert.equal(b.length, 3);
  assert.notDeepEqual(slugs(b), slugs(a));
});

test('L8 toTry: with the last shelf shown, never the same sheets two days running when more qualify', () => {
  const day = k => new Date(Date.UTC(2026, 10, 20 + k)).toISOString().slice(0, 10);
  for (let m = 4; m <= 12; m++) {
    const rows = many.slice(0, m);
    let last = null;
    for (let k = 0; k < 40; k++) {
      const got = slugs(RS.toTry(rows, {today: day(k), last}));
      assert.equal(got.length, 3);
      if (last) assert.notDeepEqual([...got].sort(), [...last.slugs].sort(), `${m} sheets, ${day(k)}`);
      last = {day: day(k), slugs: got};
      // the same day, the choice stays
      assert.deepEqual(slugs(RS.toTry([...rows].reverse(), {today: day(k), last})), got);
    }
  }
  // three or fewer: all of them, every day
  assert.deepEqual(slugs(RS.toTry(many.slice(0, 2), {today: '2026-11-20', last: {day: '2026-11-19', slugs: ['s00']}})).sort(), ['s00', 's01']);
});

test('L8 toTry: « Not for me » (or a practice) replaces that sheet only, the others stay in place', () => {
  const today = '2026-11-03';
  const shown = slugs(RS.toTry(many, {today}));
  const last = {day: today, slugs: shown};
  const after = slugs(RS.toTry(many, {today, last, dismissed: [shown[0]]}));
  assert.deepEqual(after.slice(0, 2), shown.slice(1));
  assert.ok(!shown.includes(after[2]));
  const practised = slugs(RS.toTry(many, {today, last, practised: new Map([[shown[1], today]])}));
  assert.deepEqual([practised[0], practised[1]], [shown[0], shown[2]]);
  for (let k = 20; k < 30; k++) assert.ok(!slugs(RS.toTry(many, {today: `2026-11-${k}`, dismissed: [shown[0]]})).includes(shown[0]));
});

test('L8 toTry: no valid date, nothing to show', () => {
  assert.deepEqual(RS.toTry(many, {today: ''}), []);
  assert.deepEqual(RS.toTry(null, {today: '2026-11-20'}), []);
});
