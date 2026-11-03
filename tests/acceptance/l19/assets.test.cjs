const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {html} = require('../../harness.cjs');

const appDir = path.join(__dirname, '../../../app');
const sw = fs.readFileSync(path.join(appDir, 'sw.js'), 'utf8');

test('L19 — the shell includes index.html and keeps versioned module URLs with a bumped VERSION', () => {
  assert.match(sw, /const VERSION\s*=\s*['"]rb-shell-(\d+)['"]/);
  assert.ok(Number(sw.match(/rb-shell-(\d+)/)[1]) > 24);
  assert.match(sw, /['"]\.\/index\.html['"]/);
  for (const moduleName of ['config.js', 'sessions.js', 'sheet.js', 'vendor/supabase.js']) {
    const version = html.match(new RegExp(`<script src="${moduleName.replace(/\./g, '\\.') }\\?v=(\\d+)"`))?.[1];
    assert.ok(version, `${moduleName} has a versioned URL in index.html`);
    assert.ok(sw.includes(`./${moduleName}?v=${version}`), `${moduleName} has the same version in the shell`);
  }
});

test('L19 — both font families are self-hosted as WOFF2 latin assets, included in the shell, with OFL licences', () => {
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  const faces = [...html.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(match => match[1]);
  for (const family of ['Barlow Condensed', 'Source Sans 3']) {
    const matching = faces.filter(face => face.includes(`font-family:"${family}"`) || face.includes(`font-family:'${family}'`));
    assert.ok(matching.length, `${family} has a local font face`);
    assert.ok(matching.some(face => /unicode-range/i.test(face)), `${family} declares a latin subset`);
    for (const face of matching) {
      const fontPath = face.match(/url\(['"]?(fonts\/[^)'" ]+\.woff2)/)?.[1];
      assert.ok(fontPath, `${family} references a local WOFF2 file`);
      const file = path.join(appDir, fontPath);
      assert.equal(fs.readFileSync(file).subarray(0, 4).toString('ascii'), 'wOF2');
      assert.ok(sw.includes('./' + fontPath), `${fontPath} is in the shell`);
    }
  }
  const licences = fs.readdirSync(path.join(appDir, 'fonts')).filter(name => /ofl|licen[cs]e/i.test(name));
  assert.ok(licences.length >= 2, 'licence files for both families are present');
  assert.ok(licences.some(name => /barlow/i.test(name)));
  assert.ok(licences.some(name => /source/i.test(name)));
});
