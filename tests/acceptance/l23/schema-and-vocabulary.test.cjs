const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Tags — app/config.js exposes the fixed zone, gear, time and type vocabulary', () => {
  const context = {window: {}};
  vm.runInNewContext(read('app/config.js'), context);
  const facets = context.window.REELBOOK.facets;
  assert.ok(facets, 'facets are published in app config');
  const values = key => JSON.stringify(facets[key] || '');
  for (const value of ['shoulders', 'arms', 'chest', 'back', 'core', 'hips', 'legs', 'knees', 'ankles', 'neck', 'full body']) assert.match(values('zone'), new RegExp('"' + value + '"'));
  for (const value of ['none', 'mat', 'band', 'dumbbell', 'kettlebell', 'barbell', 'bar', 'rings', 'ball', 'foam roller', 'chair', 'wall', 'board', 'kite']) assert.match(values('gear'), new RegExp('"' + value + '"'));
  for (const value of ['strength', 'mobility', 'stretch', 'cardio', 'skill', 'drill', 'warm-up', 'routine']) assert.match(values('type'), new RegExp('"' + value + '"'));
  for (const value of ['< 5', '5–10', '10–20', '20+']) assert.ok(JSON.stringify(facets).includes(value), value);
});

test('Schema — sheets.tags is an additive, idempotent, non-null JSONB column with an empty default and a GIN index', () => {
  const schema = read('supabase/schema.sql');
  assert.match(schema, /alter\s+table\s+public\.sheets\s+add\s+column\s+if\s+not\s+exists\s+tags\s+jsonb\s+not\s+null\s+default\s+'\{\}'::jsonb\s*;/i);
  assert.match(schema, /create\s+index\s+if\s+not\s+exists\s+\w+\s+on\s+public\.sheets\s+using\s+gin\s*\(\s*tags\s*\)/i);
});

test('Skill — meta.json rules name each facet and require values from app/config.js', () => {
  const skill = read('skill/reelbook/SKILL.md');
  for (const facet of ['zone', 'gear', 'minutes', 'type']) assert.match(skill, new RegExp('(?:^|\\n)[^\\n]*' + facet + '[^\\n]*', 'i'));
  assert.match(skill, /meta\.json[\s\S]*tags/);
  assert.match(skill, /app\/config\.js[\s\S]*facets|facets[\s\S]*app\/config\.js/);
});
