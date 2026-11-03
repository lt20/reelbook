const {test} = require('node:test');
const assert = require('node:assert/strict');
const RS = require('../../../app/sessions.js');

const fields = value => Object.fromEntries(['sets', 'reps', 'seconds', 'perSide', 'raw'].map(key => [key, value[key]]));
const expected = (raw, sets = null, reps = null, seconds = null, perSide = null) => ({sets, reps, seconds, perSide, raw});

test('Parser — parseDose reads the specified French and English sets, reps, time, ranges, sides and rounds', () => {
  const cases = [
    ['  3×10  ', expected('3×10', 3, 10)],
    ['3 x 10', expected('3 x 10', 3, 10)],
    ['3 × 8-12', expected('3 × 8-12', 3, 12)],
    ['30 s', expected('30 s', null, null, 30)],
    ['40 sec', expected('40 sec', null, null, 40)],
    ['1 min', expected('1 min', null, null, 60)],
    ['1 min 30', expected('1 min 30', null, null, 90)],
    ["2'30", expected("2'30", null, null, 150)],
    ['3 × 30 s', expected('3 × 30 s', 3, null, 30)],
    ['10 de chaque côté', expected('10 de chaque côté', null, 10, null, true)],
    ['10 each side', expected('10 each side', null, 10, null, true)],
    ['10 par côté', expected('10 par côté', null, 10, null, true)],
    ['10 per side', expected('10 per side', null, 10, null, true)],
    ['5 rounds', expected('5 rounds', 5)]
  ];
  for (const [input, want] of cases) assert.deepEqual(fields(RS.parseDose(input)), want, input);
  assert.equal(RS.parseDose('3 × 8-12').repsMin, 8);
});

test('Parser — parseDose keeps empty and unrecognised doses, with absent fields null, and never throws', () => {
  for (const input of ['', '  ', 'unrecognised dose', null, undefined, 42]) {
    assert.doesNotThrow(() => RS.parseDose(input));
    const result = RS.parseDose(input);
    assert.equal(result.sets, null);
    assert.equal(result.reps, null);
    assert.equal(result.seconds, null);
    assert.equal(result.perSide, null);
  }
  assert.deepEqual(fields(RS.parseDose('  unrecognised dose  ')), expected('unrecognised dose'));
  assert.equal(RS.parseDose('  ').raw, '');
});

test('Parser — parseRest reads the specified upper bound, minutes, seconds and explicit zero rest', () => {
  for (const [format, seconds] of [
    ['60 à 90 s de repos', 90],
    ['repos 1 min', 60],
    ['20 s rest', 20],
    ['no rest', 0],
    ['sans repos', 0]
  ]) assert.equal(RS.parseRest(format), seconds, format);
});

test('Parser — every fixture and Laurent session dose is retained and the unambiguous doses are parsed', () => {
  // Distinct strings copied from tests/fixtures/preview/data.json and work/session-*/meta.json.
  // This corpus has 22 distinct doses, 21 nonempty. The assertions below require numeric
  // parsing for 18 of the 21 nonempty strings; see notes for the three composite/unclear ones.
  const doses = [
    '', '1 min', '1 min de chaque côté', '10 par côté', '10 répétitions',
    '3 × 10', '3 × 12', '3 × 45 s', '3 × 5', '3 × 8',
    '3 × 8 · 3–4 s ↓', '3 × 8 · 4 s ↓', '30 s', '30 s, 2 à 3 fois par jour',
    '3×10', '3×20 s', '3×8-10', '4 × 10',
    'avant la séance · suggestion : 30 s par position et par côté',
    'finition · suggestion : 30 s par côté',
    'suggestion : 3 × 5 à 10 pompes, puis 3 × 20 s au mur',
    'à-coups de 10'
  ];
  for (const dose of doses) {
    assert.doesNotThrow(() => RS.parseDose(dose), dose);
    assert.equal(RS.parseDose(dose).raw, dose, dose);
  }
  const numeric = [
    ['1 min', {seconds: 60}], ['1 min de chaque côté', {seconds: 60, perSide: true}],
    ['10 par côté', {reps: 10, perSide: true}], ['10 répétitions', {reps: 10}],
    ['3 × 10', {sets: 3, reps: 10}], ['3 × 12', {sets: 3, reps: 12}],
    ['3 × 45 s', {sets: 3, seconds: 45}], ['3 × 5', {sets: 3, reps: 5}],
    ['3 × 8', {sets: 3, reps: 8}], ['3 × 8 · 3–4 s ↓', {sets: 3, reps: 8}],
    ['3 × 8 · 4 s ↓', {sets: 3, reps: 8}], ['30 s', {seconds: 30}],
    ['30 s, 2 à 3 fois par jour', {seconds: 30}], ['3×10', {sets: 3, reps: 10}],
    ['3×20 s', {sets: 3, seconds: 20}], ['3×8-10', {sets: 3, reps: 10, repsMin: 8}],
    ['4 × 10', {sets: 4, reps: 10}],
    ['finition · suggestion : 30 s par côté', {seconds: 30, perSide: true}]
  ];
  for (const [dose, want] of numeric) for (const [key, value] of Object.entries(want))
    assert.equal(RS.parseDose(dose)[key], value, `${dose}: ${key}`);
  assert.equal(numeric.length, 18, '18/21 distinct nonempty corpus doses have an unambiguous numeric expectation');
});

test('Parser — every fixture and Laurent session format is covered by parseRest', () => {
  // Distinct strings copied from tests/fixtures/preview/data.json and work/session-*/meta.json.
  const formats = [
    ['', null],
    ['3 exercices en circuit, 40 s de travail et 20 s de transition · 3 tours · 30 s de repos entre les tours ; le dernier tour au tempo lent, 3 s par répétition', 30],
    ['2 exercices · rounds de 2 min · 1 min de repos', 60],
    ['Doses du reel : 4 × 10 (rotations, tractions scapulaires), 30 s de planche inversée 2 à 3 fois par jour, à-coups de 10 ; suggestion pour le reste : 3 × 5 à 10 pompes puis 3 × 20 s au mur, 30 s par étirement', null],
    ['suggestion : 15 mouvements, 4 à 6 répétitions lentes par côté, 1 à 2 tours (pour une première fois : 4 répétitions, un seul tour)', null],
    ["4 exercices, l'un après l'autre, avec 2 haltères · suggestion : 3 séries de 8 à 12 répétitions par exercice (par bras pour le rowing et le tirage bûcheron), 60 à 90 s de repos", 90],
    ['5 tours · 30 s par exercice sans pause · 60 s de repos entre les tours (≈ 22 min) ; suggestion : commence à 3 tours', 60],
    ["10 répétitions par mouvement (par côté pour la fente et le world's greatest stretch), presque tous les jours · suggestion : 1 tour", null],
    ['suggestion : 1 à 2 tours, 10 à 12 répétitions lentes par exercice et par bras, charge très légère', null],
    ["15 min de vélo pour s'échauffer, puis 11 blocs de mobilité et de soins, chaque soir · suggestion : 6 à 10 répétitions lentes par mouvement, 30 à 45 s pour les étirements", null],
    ['30 s par rotation (externe puis interne), 1 min pour le pallof press, la rétraction scapulaire et le Z press · ≈ 4 à 5 min en tout', null],
    ['3 × 8 reps avec 3 à 4 s de descente (3 × 5 pour les jump squats) ; suggestion : 60 à 90 s de repos, et les 8 reps de chaque côté pour les exercices à une jambe', 90],
    ['8 exercices à la suite, 3 séries chacun (doses affichées dans la vidéo) · repos : suggestion 30 s entre les séries', 30],
    ['3 séries par exercice : 8 à 12 reps, 45 s pour la planche Copenhague ; suggestion : 60 à 90 s de repos, et toutes les séries de chaque côté pour les exercices à une jambe', 90]
  ];
  for (const [format, want] of formats) assert.equal(RS.parseRest(format), want, format);
  assert.equal(formats.length, 14);
  assert.equal(formats.filter(([, value]) => value !== null).length, 6, '6/13 nonempty corpus formats state a rest duration');
});
