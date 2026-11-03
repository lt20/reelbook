// L9 (S2): the structured dose. RS.parseDose / RS.parseRest on every dose and format of the preview fixtures and of
// Laurent's own sessions (strings copied from tests/fixtures/preview/data.json and work/session-*/meta.json on
// 3 Nov 2026), and how resolveItems / cleanItems handle the structured fields /reelbook may write on an item.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const RS = require('../app/sessions.js');

const D = (sets, reps, seconds, perSide = null, repsMin = null) => ({sets, reps, repsMin, seconds, perSide});
const pick = r => ({sets: r.sets, reps: r.reps, repsMin: r.repsMin, seconds: r.seconds, perSide: r.perSide});

// 26 distinct doses, 25 nonempty: 23 read, 2 left as text (two set schemes in one dose; « à-coups de 10 »).
const DOSES = [
  ['', D(null, null, null)],
  ['1 min', D(null, null, 60)],
  ['1 min de chaque côté', D(null, null, 60, true)],
  ['10 par côté', D(null, 10, null, true)],
  ['10 répétitions', D(null, 10, null)],
  ['2 min', D(null, null, 120)],
  ['3 × 1 min', D(3, null, 60)],
  ['3 × 10', D(3, 10, null)],
  ['3 × 12', D(3, 12, null)],
  ['3 × 20 s par côté', D(3, null, 20, true)],
  ['3 × 30 s', D(3, null, 30)],
  ['3 × 45 s', D(3, null, 45)],
  ['3 × 5', D(3, 5, null)],
  ['3 × 8', D(3, 8, null)],
  ['3 × 8 · 3–4 s ↓', D(3, 8, null)], // the tempo after « · » is not read as a time
  ['3 × 8 · 4 s ↓', D(3, 8, null)],
  ['30 s', D(null, null, 30)],
  ['30 s, 2 à 3 fois par jour', D(null, null, 30)],
  ['3×10', D(3, 10, null)],
  ['3×20 s', D(3, null, 20)],
  ['3×8-10', D(3, 10, null, null, 8)],
  ['4 × 10', D(4, 10, null)],
  ['avant la séance · suggestion : 30 s par position et par côté', D(null, null, 30, true)],
  ['finition · suggestion : 30 s par côté', D(null, null, 30, true)],
  ['suggestion : 3 × 5 à 10 pompes, puis 3 × 20 s au mur', D(null, null, null)],
  ['à-coups de 10', D(null, null, null)]
];

// 13 distinct formats: 7 state a rest and are read, 6 state none (null).
const FORMATS = [
  ["10 répétitions par mouvement (par côté pour la fente et le world's greatest stretch), presque tous les jours · suggestion : 1 tour", null],
  ["15 min de vélo pour s'échauffer, puis 11 blocs de mobilité et de soins, chaque soir · suggestion : 6 à 10 répétitions lentes par mouvement, 30 à 45 s pour les étirements", null],
  ['2 exercices · rounds de 2 min · 1 min de repos', 60],
  ['3 exercices en circuit, 40 s de travail et 20 s de transition · 3 tours · 30 s de repos entre les tours ; le dernier tour au tempo lent, 3 s par répétition', 30],
  ['3 séries par exercice : 8 à 12 reps, 45 s pour la planche Copenhague ; suggestion : 60 à 90 s de repos, et toutes les séries de chaque côté pour les exercices à une jambe', 90],
  ['3 × 8 reps avec 3 à 4 s de descente (3 × 5 pour les jump squats) ; suggestion : 60 à 90 s de repos, et les 8 reps de chaque côté pour les exercices à une jambe', 90],
  ['30 s par rotation (externe puis interne), 1 min pour le pallof press, la rétraction scapulaire et le Z press · ≈ 4 à 5 min en tout', null],
  ["4 exercices, l'un après l'autre, avec 2 haltères · suggestion : 3 séries de 8 à 12 répétitions par exercice (par bras pour le rowing et le tirage bûcheron), 60 à 90 s de repos", 90],
  ['5 tours · 30 s par exercice sans pause · 60 s de repos entre les tours (≈ 22 min) ; suggestion : commence à 3 tours', 60],
  ['8 exercices à la suite, 3 séries chacun (doses affichées dans la vidéo) · repos : suggestion 30 s entre les séries', 30],
  ['Doses du reel : 4 × 10 (rotations, tractions scapulaires), 30 s de planche inversée 2 à 3 fois par jour, à-coups de 10 ; suggestion pour le reste : 3 × 5 à 10 pompes puis 3 × 20 s au mur, 30 s par étirement', null],
  ['suggestion : 1 à 2 tours, 10 à 12 répétitions lentes par exercice et par bras, charge très légère', null],
  ['suggestion : 15 mouvements, 4 à 6 répétitions lentes par côté, 1 à 2 tours (pour une première fois : 4 répétitions, un seul tour)', null]
];

test('every corpus dose: its numbers, and the text kept whole', () => {
  for (const [dose, want] of DOSES) {
    const r = RS.parseDose(dose);
    assert.deepEqual(pick(r), want, dose);
    assert.equal(r.raw, dose);
  }
  const nonempty = DOSES.filter(([d]) => d), read = nonempty.filter(([, w]) => w.sets !== null || w.reps !== null || w.seconds !== null);
  assert.deepEqual([read.length, nonempty.length], [23, 25]);
});

test('every corpus format: the rest it states, upper bound of a range, else null', () => {
  for (const [format, want] of FORMATS) assert.equal(RS.parseRest(format), want, format);
  assert.equal(FORMATS.filter(([, v]) => v !== null).length, 7);
});

test('parseDose: other spellings, English, and what it leaves alone', () => {
  for (const [dose, want] of [
    ['3 x 8 to 12', D(3, 12, null, null, 8)], ['3X10', D(3, 10, null)], ['3 × 8–12 reps', D(3, 12, null, null, 8)],
    ['30 secondes', D(null, null, 30)], ['2 minutes', D(null, null, 120)], ['1 min 30 s', D(null, null, 90)],
    ['2’30', D(null, null, 150)], ['30-45 s', D(null, null, 45)], ['3 sets', D(3, null, null)], ['4 tours', D(4, null, null)],
    ['12 reps each side', D(null, 12, null, true)], ['3 × 10 per side', D(3, 10, null, true)],
    ['suggestion : 3 × 10', D(3, 10, null)], ['10 squats', D(null, null, null)], ['as many as you can', D(null, null, null)],
    ['3 × slow', D(null, null, null)]
  ]) assert.deepEqual(pick(RS.parseDose(dose)), want, dose);
});

test('parseRest: English, minutes, explicit zero, and a pause that is not a rest', () => {
  for (const [format, want] of [
    ['90 s rest between rounds', 90], ['rest 2 min', 120], ['1 min 30 de repos', 90], ['1-2 min rest', 120],
    ['no rest between exercises, 90 s rest between rounds', 90], ['without rest', 0], ['sans repos', 0],
    ['30 s par exercice sans pause', null], ['the rest of the week', null], ['', null], [null, null], [42, null]
  ]) assert.equal(RS.parseRest(format), want, String(format));
});

const sheets = new Map([['a', {slug: 'a'}], ['b', {slug: 'b'}]]);

test('resolveItems: a structured field wins over the parsed dose, field by field; the rest falls back to the format', () => {
  const s = {format: '3 rounds · 60 à 90 s de repos', items: [
    {slug: 'a', dose: '3 × 8-12', reps: 10, rest_s: 45},
    {slug: 'b', dose: '30 s par côté'},
    {slug: 'a', dose: '3 × 10', sets: '4', reps: -1, seconds: 2.5, per_side: 'yes'} // not whole numbers / booleans: ignored
  ]};
  const r = RS.resolveItems(s, sheets).map(({sets, reps, seconds, rest_s, per_side, given}) => ({sets, reps, seconds, rest_s, per_side, given}));
  assert.deepEqual(r, [
    {sets: 3, reps: 10, seconds: null, rest_s: 45, per_side: null, given: {reps: 10, rest_s: 45}},
    {sets: null, reps: null, seconds: 30, rest_s: 90, per_side: true, given: {}},
    {sets: 3, reps: 10, seconds: null, rest_s: 90, per_side: null, given: {}}
  ]);
  assert.equal(RS.resolveItems({items: [{slug: 'a', dose: '3×10', per_side: false, rest_s: 0}]}, sheets)[0].per_side, false);
  assert.equal(RS.resolveItems({items: [{slug: 'a', dose: '3×10'}]}, sheets)[0].rest_s, null);
});

test('Edit save: an untouched dose keeps its structured fields, an edited dose drops them', () => {
  const draft = RS.resolveItems({items: [{slug: 'a', dose: '3×10', sets: 3, reps: 10, per_side: true}, {slug: 'b', dose: '30 s', seconds: 30}]}, sheets)
    .map(it => ({slug: it.sheet.slug, dose: it.dose, was: it.dose, given: it.given}));
  draft[1].dose = '45 s';
  assert.deepEqual(RS.cleanItems(draft), [{slug: 'a', dose: '3×10', sets: 3, reps: 10, per_side: true}, {slug: 'b', dose: '45 s'}]);
  assert.deepEqual(RS.cleanItems([{slug: 'a', dose: '3×10', given: {sets: 3}}]), [{slug: 'a', dose: '3×10'}], 'no `was`: a new item');
});

test('no regex lookbehind in the app modules: iOS Safari before 16.4 would fail to load the file', () => {
  const fs = require('node:fs'), path = require('node:path');
  for (const f of ['sessions.js', 'sheet.js']) assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../app', f), 'utf8'), /\(\?<[=!]/, f);
});
