const {test} = require('node:test');
const assert = require('node:assert/strict');
const RS = require('../../../app/sessions.js');

test('L22 — session text decides its language: three distinct common French words give fr; otherwise en', () => {
  assert.equal(RS.sessionLang({title: 'Routine', why: 'Le mouvement est dans la séance.', key_points: [], format: ''}), 'fr');
  assert.equal(RS.sessionLang({title: 'Le le le mouvement', why: '', key_points: [], format: ''}), 'en');
  assert.equal(RS.sessionLang({title: 'Shoulder routine', why: 'Move slowly.', key_points: ['Breathe'], format: '3 rounds'}), 'en');
  assert.equal(RS.sessionLang({title: 'Pour les épaules', why: '', key_points: [], format: ''}), 'en');
  assert.equal(RS.sessionLang({title: 'Routine', why: '', key_points: ['Avec contrôle', 'Pour les épaules'], format: ''}), 'fr');
  assert.equal(RS.sessionLang({title: 'Routine', why: '', key_points: [], format: 'Avec les bras dans le dos'}), 'fr');
  assert.equal(RS.sessionLang({title: '', why: '', key_points: [], format: ''}), 'en');
});

test('L22 — unknown language uses English session headings', () => {
  for (const heading of ['Why', 'Key points', 'Format', 'Exercises', 'Dose', 'Rest', 'Sets']) {
    assert.equal(RS.sessionHeading(heading, 'unknown'), heading);
    assert.equal(RS.sessionHeading(heading, 'en'), heading);
  }
  assert.deepEqual(
    ['Why', 'Key points', 'Format', 'Exercises', 'Dose', 'Rest', 'Sets'].map(heading => RS.sessionHeading(heading, 'fr')),
    ['Pourquoi', 'Points clés', 'Format', 'Exercices', 'Dose', 'Repos', 'Séries']
  );
});
