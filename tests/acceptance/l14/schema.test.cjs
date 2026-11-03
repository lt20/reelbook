const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schema = fs.readFileSync(path.join(__dirname, '../../../supabase/schema.sql'), 'utf8');

test('Schema — append an idempotent, additive search_text column with an empty non-null default', () => {
  assert.match(schema, /alter\s+table\s+public\.sheets\s+add\s+column\s+if\s+not\s+exists\s+search_text\s+text\s+not\s+null\s+default\s+''\s*;/i);
});
