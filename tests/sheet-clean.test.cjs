// P8 R11, Codex #114 (blocking 1): a sheet's html is shown inside the app's own page and, since R11, can come from
// another account (a shared session). RBSheet.clean (app/sheet.js) keeps only what templates/ write, and loadSheet runs
// it on every sheet before anything else reads it, the ones kept on the device too. The server cleans a copy once more
// (supabase/functions/share/clean.ts, tests/share-function.test.cjs).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SH = require('../app/sheet.js');
const {parse} = require('./mini-dom.cjs');

const template = name => fs.readFileSync(path.join(__dirname, '../templates', name), 'utf8');
const all = doc => doc.querySelectorAll('*');
const shape = doc => all(doc).map(el => el.tagName + [...el.attrs].filter(([k]) => k !== 'loading').map(([k, v]) => ` ${k}=${v}`).join('')).join('|');

test('clean: a sheet with handlers, scripts, frames, forms, base / meta / link and javascript: or data: URLs is cut down', () => {
  const doc = parse('<div class="wrap fiche" onclick="steal()"><img src="img/01.jpg" onerror="fetch(1)" alt="a" ONLOAD="x()">'
    + '<p onmouseover="x()" style="position:fixed" id="view" name="sb" data-x="1">Hi</p>'
    + '<a href="javascript:alert(1)">j</a><a href=" JaVaScRiPt:alert(1)">k</a><a href="vbscript:x">v</a><a href="data:text/html,x">d</a>'
    + '<a href="#teep">ok</a><a href="https://www.instagram.com/reel/x/">src</a><a href="mailto:a@b.test">m</a>'
    + '<iframe src="https://x.test"></iframe><object data="x"><p>in object</p></object><embed src="x"><form action="https://x.test"><input name="p"><button>b</button></form>'
    + '<base href="https://x.test/"><meta http-equiv="refresh" content="0"><link rel="stylesheet" href="https://x.test/a.css">'
    + '<script>alert(1)</script><style>body{display:none}</style><svg onload="x()"><a href="javascript:1">s</a></svg><template><img src=x onerror=y()></template>'
    + '<img src="javascript:alert(1)"><img src="https://x.test/pixel.gif"><img src="//x.test/p.gif"><img src="data:image/svg+xml,x"><img src="data:image/png;base64,AAAA">'
    + '<font color="red">kept text</font><!-- a comment --></div>');
  SH.clean(doc);
  const html = doc.body.innerHTML;
  for (const bad of [/\son[a-z]+=/i, /javascript|vbscript/i, /<(iframe|object|embed|form|input|button|base|meta|link|script|style|svg|template|font)\b/i,
    /x\.test/, /svg\+xml|text\/html/, /\s(style|id|name|data-x)=/, /comment/])
    assert.doesNotMatch(html, bad, html);
  for (const good of ['<div class="wrap fiche">', '<img src="img/01.jpg" alt="a">', '<p>Hi</p>', '<a href="#teep">ok</a>', '<a href="https://www.instagram.com/reel/x/">src</a>',
    '<a href="mailto:a@b.test">m</a>', '<img src="data:image/png;base64,AAAA">', 'kept text', '<a>j</a>'])
    assert.ok(html.includes(good), `${good} in ${html}`);
  assert.doesNotMatch(html, /in object/, 'a dropped element goes with its content');
});

test('clean: what templates/ write is kept as is (tags, classes, sources, alts, links, text)', () => {
  for (const name of ['sheet.html', 'exercise.html', 'technique.html']) {
    const before = parse(template(name)), after = SH.clean(parse(template(name)));
    assert.equal(shape(after), shape(before), name);
    assert.equal(after.body.textContent.replace(/\s+/g, ' '), before.body.childNodes.filter(n => n.nodeType !== 8).map(n => n.textContent).join('').replace(/\s+/g, ' '), name);
  }
});

test('clean: a sheet kept on the device ({signed: true}) keeps its signed photo URLs, and only those', () => {
  const doc = SH.clean(parse('<div lang="fr"><img src="https://p.supabase.co/storage/v1/object/sign/sheets/u/a/img/1.jpg?token=t"><img src="javascript:x" onerror="y()"></div>'), {signed: true});
  assert.equal(doc.body.innerHTML, '<div lang="fr"><img src="https://p.supabase.co/storage/v1/object/sign/sheets/u/a/img/1.jpg?token=t"><img></div>');
});

test('loadSheet cleans every sheet first: the parsed document, and a sheet kept on the device; never shown without sheet.js', () => {
  const app = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
  const load = app.slice(app.indexOf('const loadSheet = async slug => {'), app.indexOf('const sheetLang = html => {'));
  assert.match(load, /const doc = cleanSheet\(new DOMParser\(\)\.parseFromString\(data\.html, 'text\/html'\)\);/);
  assert.ok(load.indexOf('cleanSheet(') < load.indexOf("querySelectorAll('img')"), 'cleaned before the photos are signed');
  assert.match(load, /if \(typeof kept === 'string'\) \{ const out = cleanKept\(kept\);/);
  assert.match(app, /const cleanSheet = \(doc, opts\) => \{ if \(!doc\.querySelectorAll\) return doc; if \(!SH \|\| !SH\.clean\) throw new Error\('no sanitizer'\); return SH\.clean\(doc, opts\); \};/);
  assert.match(app, /cleanSheet\(doc, \{signed: true\}\)/);
  assert.match(app, /<script src="sheet\.js\?v=10"><\/script>/);
  assert.match(fs.readFileSync(path.join(__dirname, '../app/sw.js'), 'utf8'), /'\.\/sheet\.js\?v=10'/);
});

test('Codex #114 pass 2: a sheet kept on the device keeps its 5 photo targets after cleaning (markPhotos again), as the online path does', () => {
  const app = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
  const piece = (from, to) => { const i = app.indexOf(from); assert.ok(i >= 0, from); return app.slice(i, app.indexOf(to, i)); };
  const src = piece('const cleanSheet = (doc, opts) =>', '\n') + '\n' + piece('const cleanKept = html => {', 'const loadSheet = async slug => {');
  const cleanKept = new Function('SH', 'DOMParser', src + '\nreturn cleanKept;')(SH, class { parseFromString(h) { return parse(h); } });
  const signed = n => `https://p.supabase.co/storage/v1/object/sign/sheets/u/a/img/0${n}.jpg?token=t`;
  // as loadSheet kept it (L19): signed photos, marked by markPhotos
  const kept = '<div class="steps">' + [1, 2, 3, 4, 5].map(n => `<div class="step"><figure><img src="${signed(n)}" alt="p${n}" tabindex="0" role="button" data-ph=""><span class="k">${n}</span></figure><h3>S${n}</h3><p>x</p></div>`).join('') + '</div>';
  const targets = h => (h.match(/<img [^>]*\sdata-ph(=""|\b)/g) || []).length;
  assert.equal(targets(kept), 5, 'before cleaning');
  const out = cleanKept(kept);
  assert.equal(targets(out), 5, 'after cleaning: ' + out);
  assert.equal((out.match(/tabindex="0"/g) || []).length, 5);
  for (let n = 1; n <= 5; n++) assert.ok(out.includes(signed(n)), 'the signed photo is kept');
  // the online path: cleaned first, then marked
  const load = piece('const loadSheet = async slug => {', 'const sheetLang = html => {');
  assert.ok(load.indexOf('cleanSheet(new DOMParser()') < load.indexOf('SH.markPhotos(doc)'), 'online: markPhotos after cleaning');
});
