// L3 (sheet in use): gesture-first order of a sheet at display time (app/sheet.js), and the « Keep screen on »
// toggle of the sheet and session pages, guarded when the Screen Wake Lock API is missing.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SH = require('../app/sheet.js');
const {parse} = require('./mini-dom.cjs');
const {app, ownUrl, ownKey} = require('./harness.cjs');

const template = name => fs.readFileSync(path.join(__dirname, '../templates', name), 'utf8');
const sheetHtml = template('sheet.html');
const exerciseHtml = template('exercise.html');
// The sheet template with 6 key points (3 shown, « +3 more »).
const sixKeys = sheetHtml.replace('<li><b>Third cue.</b> One sentence.</li>',
  '<li><b>Third cue.</b> One sentence.</li><li><b>Fourth cue.</b> Four.</li><li><b>Fifth cue.</b> Five.</li><li><b>Sixth cue.</b> Six.</li>');

// Every element of the sheet except the .wrap / .wide boxes and what arrange adds (data-rb), with its own text:
// the same before and after, whatever the order.
const content = doc => doc.querySelectorAll('*')
  .filter(el => !el.hasAttribute('data-rb') && !(el.parentNode === doc.body && el.tagName === 'DIV'))
  .map(el => `${el.tagName}|${el.childNodes.filter(n => n.nodeType === 3).map(n => n.data).join('').replace(/\s+/g, ' ').trim()}`).sort();
// The landmarks of the page in document order: header, h2 headings (with « why » when inside the collapsed
// why), the key points shown, the « +N more » summary and its points, footer.
const landmarks = doc => doc.querySelectorAll('header, h2, ol.keys li, details.rb-more summary, footer').map(el => {
  if (el.tagName === 'H2') return (el.closest('details.rb-why') ? 'why:' : 'h2:') + el.textContent.replace(/\s+/g, ' ').trim();
  if (el.tagName === 'LI') return (el.closest('details.rb-more') ? 'more:' : 'key:') + el.querySelector('b').textContent;
  if (el.tagName === 'SUMMARY') return 'summary:' + el.textContent;
  return el.tagName.toLowerCase();
});
const arranged = html => { const doc = parse(html), before = content(doc); const changed = SH.arrange(doc); return {doc, before, changed}; };

test('a sheet (templates/sheet.html) shows the gesture first: sequence, dose, key points, then why, then the rest', () => {
  const {doc, before, changed} = arranged(sixKeys);
  assert.equal(changed, true);
  assert.deepEqual(landmarks(doc), ['header', 'h2:Steps', 'h2:Dose suggestion, not in the reel',
    'h2:Key points', 'key:Short bold cue.', 'key:Second cue.', 'key:Third cue.', 'summary:+3 more',
    'more:Fourth cue.', 'more:Fifth cue.', 'more:Sixth cue.', 'why:Why', 'h2:Common mistakes', 'h2:Easier / harder', 'footer']);
  assert.deepEqual(content(doc), before, 'every block kept');
  // header, lead and kit stay together in the first box, the first photo of the movement right after
  const [first, second] = doc.body.children;
  assert.deepEqual(first.children.map(el => el.tagName + (el.getAttribute('class') ? '.' + el.getAttribute('class') : '')), ['HEADER', 'P.lead', 'DIV.kit']);
  assert.equal(first.getAttribute('class'), 'wrap fiche');
  assert.equal(second.getAttribute('class'), 'wide');
  assert.ok(second.querySelector('.steps img'));
  // the dose keeps its note; the why keeps its quote, collapsed under its own heading
  const dose = doc.querySelector('.dose');
  assert.equal(dose.nextSibling.nextSibling.getAttribute('class'), 'note');
  const why = doc.querySelector('details.rb-why');
  assert.equal(why.hasAttribute('open'), false);
  assert.equal(why.querySelector('summary').textContent.trim(), 'Why');
  assert.ok(why.querySelector('blockquote'));
  // the hidden key points go on numbering from 4
  const more = doc.querySelector('details.rb-more ol.keys');
  assert.equal(more.getAttribute('start'), '4');
  assert.match(more.getAttribute('style'), /counter-reset:k 3/);
  // no box is left empty, no « fiche » copied
  for (const box of doc.body.children) assert.ok(box.children.length, box.outerHTML.slice(0, 60));
  assert.equal(doc.querySelectorAll('.fiche').length, 1);
});

test('three key points or fewer: no « more »', () => {
  const {doc, before} = arranged(sheetHtml);
  assert.equal(doc.querySelector('details.rb-more'), null);
  assert.deepEqual(landmarks(doc).filter(l => l.startsWith('key:')), ['key:Short bold cue.', 'key:Second cue.', 'key:Third cue.']);
  assert.deepEqual(content(doc), before);
});

test('an exercise sheet (templates/exercise.html): header, steps, key points, common mistakes, easier / harder, source', () => {
  const {doc, before} = arranged(exerciseHtml);
  assert.deepEqual(landmarks(doc), ['header', 'h2:Steps', 'h2:Key points', 'key:Short bold cue.', 'key:Second cue.',
    'h2:Common mistakes', 'h2:Easier / harder', 'footer']);
  assert.deepEqual(content(doc), before);
  assert.equal(doc.querySelector('details'), null);
  assert.deepEqual(doc.body.children.map(b => b.getAttribute('class')), ['wrap fiche', 'wide', 'wrap', 'wide', 'wrap']);
});

// L15 (skill writing rules): one label per function, the wrong movement in « Common mistakes » (.step.bad) after the
// numbered steps, never in them. A French sheet built from the template, with 8 key points (the maximum).
test('a sheet written with the L15 template in French: steps first, mistakes after, never in the sequence', () => {
  const fr = sheetHtml.replace('<h2>Why</h2>', '<h2>Pourquoi</h2>').replace('<h2>Dose <small>suggestion, not in the reel</small></h2>', '<h2>Dose <small>suggestion</small></h2>')
    .replace('<h2>Key points</h2>', '<h2>Points clés</h2>').replace('<h2>Steps</h2>', '<h2>Étapes</h2>')
    .replace('<h2>Common mistakes</h2>', '<h2>Erreurs fréquentes</h2>').replace('<h2>Easier / harder</h2>', '<h2>Plus facile / plus dur</h2>')
    .replace('<li><b>Third cue.</b> One sentence.</li>', ['Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'].map(w => `<li><b>${w} cue.</b> x</li>`).join(''));
  const {doc, before, changed} = arranged(fr);
  assert.equal(changed, true);
  assert.deepEqual(landmarks(doc), ['header', 'h2:Étapes', 'h2:Dose suggestion', 'h2:Points clés',
    'key:Short bold cue.', 'key:Second cue.', 'key:Third cue.', 'summary:+5 more',
    'more:Fourth cue.', 'more:Fifth cue.', 'more:Sixth cue.', 'more:Seventh cue.', 'more:Eighth cue.',
    'why:Pourquoi', 'h2:Erreurs fréquentes', 'h2:Plus facile / plus dur', 'footer']);
  assert.deepEqual(content(doc), before, 'every block kept');
  // the numbered steps right after the header hold no mistake; the mistake keeps its class, without a number
  const seq = doc.body.children[1];
  assert.equal(seq.querySelector('h2').textContent, 'Étapes');
  assert.equal(seq.querySelectorAll('.step').length, 3);
  assert.equal(seq.querySelector('.step.bad'), null);
  const bad = doc.querySelectorAll('.step.bad');
  assert.equal(bad.length, 1);
  assert.equal(bad[0].querySelector('.k'), null);
  const h2s = doc.querySelectorAll('h2').map(h => h.textContent.trim());
  assert.ok(h2s.indexOf('Erreurs fréquentes') > h2s.indexOf('Étapes'));
  // the production note sits in the footer, not under the why
  assert.equal(doc.querySelector('details.rb-why').textContent.includes('Production notes'), false);
  assert.match(doc.querySelector('footer').textContent, /Production notes/);
});

test('a sheet without « Common mistakes » (an older sheet) is arranged as before', () => {
  const old = sheetHtml.replace(/<h2>Common mistakes<\/h2>\s*<div class="steps">[\s\S]*?<\/div>\s*<\/div>\s*/, '');
  assert.equal(old.includes('step bad'), false);
  const {doc, before} = arranged(old);
  assert.deepEqual(landmarks(doc).filter(l => l.startsWith('h2:') || l.startsWith('why:')),
    ['h2:Steps', 'h2:Dose suggestion, not in the reel', 'h2:Key points', 'why:Why', 'h2:Easier / harder']);
  assert.deepEqual(content(doc), before);
});

test('a part that is not found stays where it is, nothing is dropped', () => {
  // no dose, the sequence in the first box, an extra section and a loose top-level element
  const html = `<div class="wrap fiche"><header><h1>T</h1></header><p class="lead">L</p>
    <h2>Pourquoi</h2><p>Parce que.</p><p class="note">Note.</p>
    <h2>Conditions</h2><ul class="keys"><li>Vent</li></ul>
    <h2>Points clés</h2><ol class="keys"><li><b>A</b></li><li><b>B</b></li><li><b>C</b></li><li><b>D</b></li></ol>
    <h2>La séquence</h2><div class="steps"><div class="step"><figure><img src="img/1.jpg"></figure><h3>Un</h3><p>x</p></div></div></div>
    <p class="loose">Loose</p><div class="wrap"><footer>Src</footer></div>`;
  const {doc, before} = arranged(html);
  assert.deepEqual(landmarks(doc), ['header', 'h2:La séquence', 'h2:Points clés', 'key:A', 'key:B', 'key:C', 'summary:+1 more', 'more:D', 'why:Pourquoi', 'h2:Conditions', 'footer']);
  assert.deepEqual(content(doc), before);
  assert.ok(doc.querySelector('details.rb-why p.note'), 'the note of the why goes with it');
  assert.ok(doc.querySelector('p.loose'));
});

test('a section before the dose that is not « Why » stays open where it is', () => {
  const html = sheetHtml.replace('<h2>Why</h2>', '<h2>Safety</h2>');
  const {doc, before} = arranged(html);
  assert.equal(doc.querySelector('details.rb-why'), null);
  assert.deepEqual(landmarks(doc), ['header', 'h2:Steps', 'h2:Dose suggestion, not in the reel', 'h2:Key points',
    'key:Short bold cue.', 'key:Second cue.', 'key:Third cue.', 'h2:Safety', 'h2:Common mistakes', 'h2:Easier / harder', 'footer']);
  assert.deepEqual(content(doc), before);
  // the why is told by its heading in the sheet's language, a small note next to it included
  for (const h of ['Pourquoi', 'Pourquoi ?', 'WHY', 'Warum', 'Por qué <small>en bref</small>']) {
    const d = arranged(sheetHtml.replace('<h2>Why</h2>', `<h2>${h}</h2>`)).doc;
    assert.ok(d.querySelector('details.rb-why summary h2'), h);
  }
});

test('a page that is not built from the templates is left as is', () => {
  for (const html of ['<p>Just text</p>', '<div class="wrap"><h2>A</h2><p>B</p></div>', '<div class="wrap fiche"><header><h1>T</h1></header><p>Only a header.</p></div>']) {
    const doc = parse(html), was = doc.body.innerHTML;
    assert.equal(SH.arrange(doc), false, html);
    assert.equal(doc.body.innerHTML, was);
  }
});

test('step photos become buttons of the viewer, with their step caption', () => {
  const doc = parse(sheetHtml);
  SH.arrange(doc);
  assert.equal(SH.markPhotos(doc), 5);
  const header = doc.querySelector('header img');
  assert.equal(header.hasAttribute('data-ph'), false, 'the header photo is not a step');
  // the sheet page's viewer (mistakes: true) shows the mistake too, flagged and titled « ✕ … »
  const photos = SH.photosOf(doc, true);
  assert.deepEqual(photos.map(p => [p.src, p.title, p.caption, p.bad]), [['img/01-start.jpg', 'Start', 'What to set up before moving.', false],
    ['img/02-middle.jpg', 'Middle', 'The move itself.', false], ['img/03-end.jpg', 'End', 'Where it finishes and how to come back.', false],
    ['img/04-mistake.jpg', '✕ Lower back arched', 'What goes wrong, and the fix.', true],
    ['img/05-variation.jpg', 'Easier', 'One variation shown or named in the reel.', false]]);
  // by default (the session player) the mistake is left out
  assert.deepEqual(SH.photosOf(doc).map(p => p.src), ['img/01-start.jpg', 'img/02-middle.jpg', 'img/03-end.jpg', 'img/05-variation.jpg']);
  for (const p of photos) { assert.equal(p.img.getAttribute('role'), 'button'); assert.equal(p.img.getAttribute('tabindex'), '0'); }
});

// ---------- L16: the technique template (board sports, fighting) ----------
const techniqueHtml = template('technique.html');
// profile « technique »: the partner-only sections (Roles, Control / tap) dropped, as the skill does
const soloHtml = techniqueHtml.replace(/\n<h2>Roles<\/h2>\n<div class="roles">[\s\S]*?\n<\/div>\n/, '\n')
  .replace(/\n<h2>Control \/ tap<\/h2>\n<div class="safety tap">[\s\S]*?\n<\/div>\n/, '\n');
const boxes = doc => doc.body.children.map(b => `${b.getAttribute('class')}: ${b.children.map(el => el.tagName === 'H2' ? 'h2:' + el.childNodes.filter(n => n.nodeType === 3).map(n => n.data).join('').trim() : el.tagName + (el.getAttribute('class') ? '.' + el.getAttribute('class') : '')).join(' ')}`);

test('a technique sheet (templates/technique.html, partner): header → go / no-go → steps → the rest in its order, nothing lost', () => {
  const {doc, before, changed} = arranged(techniqueHtml);
  assert.equal(changed, true);
  assert.deepEqual(landmarks(doc), ['header', 'h2:Go / no-go', 'h2:Steps', 'h2:Prerequisites', 'h2:Conditions', 'h2:Roles',
    'h2:Common mistakes', 'h2:Key points', 'key:Short bold cue.', 'key:Second cue.', 'h2:Try plan suggestion, not in the video',
    'h2:Safety general advice, not in the video', 'h2:Control / tap', 'footer']);
  assert.deepEqual(content(doc), before, 'every block kept');
  // go / no-go stays in the header's box, the photos of the movement come right after it; no mistake in the sequence
  assert.deepEqual(boxes(doc), [
    'wrap fiche: HEADER P.lead DIV.kit h2:Go / no-go DIV.gonogo',
    'wide: h2:Steps DIV.steps',
    'wrap: h2:Prerequisites UL.prereq h2:Conditions DIV.cond h2:Roles DIV.roles',
    'wide: h2:Common mistakes DIV.steps',
    'wrap: h2:Key points OL.keys h2:Try plan DIV.dose P.note h2:Safety DIV.safety h2:Control / tap DIV.safety tap FOOTER']);
  assert.equal(doc.body.children[1].querySelector('.step.bad'), null);
  assert.equal(doc.querySelectorAll('.fiche').length, 1);
  assert.equal(doc.querySelector('details.rb-why'), null);
});

test('a technique sheet (profile technique, French, 5 key points): same order, « +2 more », the viewer and the player read it', () => {
  const fr = soloHtml.replace('<h2>Prerequisites</h2>', '<h2>Prérequis</h2>')
    .replace('<h2>Steps</h2>', '<h2>Étapes</h2>').replace('<h2>Common mistakes</h2>', '<h2>Erreurs fréquentes</h2>')
    .replace('<h2>Key points</h2>', '<h2>Points clés</h2>')
    .replace('<h2>Try plan <small>suggestion, not in the video</small></h2>', '<h2>Plan d\'essais <small>suggestion, absente de la vidéo</small></h2>')
    .replace('<h2>Safety <small>general advice, not in the video</small></h2>', '<h2>Sécurité <small>conseil général, absent de la vidéo</small></h2>')
    .replace('<li><b>Second cue.</b> One sentence.</li>', ['Second', 'Third', 'Fourth', 'Fifth'].map(w => `<li><b>${w} cue.</b> x</li>`).join(''));
  assert.equal(fr.includes('class="roles"'), false);
  assert.equal(fr.includes('safety tap'), false);
  const {doc, before} = arranged(fr);
  assert.deepEqual(landmarks(doc), ['header', 'h2:Go / no-go', 'h2:Étapes', 'h2:Prérequis', 'h2:Conditions', 'h2:Erreurs fréquentes',
    'h2:Points clés', 'key:Short bold cue.', 'key:Second cue.', 'key:Third cue.', 'summary:+2 more', 'more:Fourth cue.', 'more:Fifth cue.',
    'h2:Plan d\'essais suggestion, absente de la vidéo', 'h2:Sécurité conseil général, absent de la vidéo', 'footer']);
  assert.deepEqual(content(doc), before, 'every block kept');
  // the try plan is not pulled up like a gym dose: it stays after the key points
  const h2s = doc.querySelectorAll('h2').map(h => h.childNodes.filter(n => n.nodeType === 3).map(n => n.data).join('').trim());
  assert.ok(h2s.indexOf('Plan d\'essais') > h2s.indexOf('Points clés'));
  // the photo viewer and the session player (L10) find the steps and the cues
  assert.equal(SH.markPhotos(doc), 4);
  assert.deepEqual(SH.photosOf(doc).map(p => p.title), ['Approach', 'Pop', 'Landing']);
  assert.deepEqual(SH.photosOf(doc, true).map(p => p.title), ['Approach', 'Pop', 'Landing', '✕ Opening too early']);
  assert.deepEqual(SH.keyPoints(doc).map(k => k.cue), ['Short bold cue.', 'Second cue.', 'Third cue.']);
});

test('a technique sheet without go / no-go box is arranged like a sheet; the go / no-go box alone is enough to move', () => {
  // no .gonogo: the gym order, the try plan (.dose) pulled after the steps
  const noBox = soloHtml.replace(/\n<h2>Go \/ no-go<\/h2>\n<div class="gonogo">[\s\S]*?\n<\/div>\n/, '\n');
  assert.equal(noBox.includes('gonogo'), false);
  const a = arranged(noBox);
  assert.deepEqual(landmarks(a.doc).filter(l => l.startsWith('h2:')).slice(0, 3), ['h2:Steps', 'h2:Try plan suggestion, not in the video', 'h2:Key points']);
  assert.deepEqual(content(a.doc), a.before);
  // a go / no-go box and no photo sequence: header → go / no-go → the rest
  const b = arranged(`<div class="wrap fiche"><header><h1>T</h1></header><h2>Conditions</h2><p>Wind</p>
    <h2>Go / no-go</h2><div class="gonogo"><div class="go"><h3>Go</h3></div><div class="nogo"><h3>No-go</h3></div></div></div>
    <div class="wrap"><footer>Src</footer></div>`);
  assert.equal(b.changed, true);
  assert.deepEqual(landmarks(b.doc), ['header', 'h2:Go / no-go', 'h2:Conditions', 'footer']);
  assert.deepEqual(content(b.doc), b.before);
});

// ---------- « Keep screen on » ----------
const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'u@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const tables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: [{slug: 'angel', kind: 'sheet', theme: 'strength', group: 'Shoulders', title: 'Floor angel', summary: 'Face down.', duration: '', html: '<a href="#">Home</a>'}],
  sessions: [{slug: 'gsp', theme: 'strength', title: 'GSP', format: '', origin: 'user', items: [{slug: 'angel', dose: '30 s'}]}],
  notes: [], requests: []
});
const fakeWakeLock = () => {
  const log = [];
  return {log, wakeLock: {async request(type) { log.push('request:' + type); const lock = {released: false, addEventListener() {}, async release() { lock.released = true; log.push('release'); }}; return lock; }}};
};
const clickWake = page => page.element('view').listeners.click({target: {closest: s => s === '#wake' ? {} : null}});

test('without the Screen Wake Lock API there is no « Keep screen on » button, and nothing fails', async () => {
  for (const hash of ['#angel', '#session/gsp']) {
    const page = await app({...signedIn, tables: tables(), hash, dom: true, stored: {'rb.wake': '1'}});
    await settle();
    assert.equal(page.element('view').hidden, false, hash);
    assert.doesNotMatch(page.element('view').innerHTML, /id="wake"|Keep screen on/, hash);
    assert.match(page.element('view').innerHTML, /id="mv-open"/, hash);
  }
});

test('« Keep screen on » asks for the lock, is remembered, and lets go when leaving the page', async () => {
  const nav = fakeWakeLock();
  const page = await app({...signedIn, tables: tables(), hash: '#angel', dom: true, nav});
  await settle();
  assert.match(page.element('view').innerHTML, /<button type="button" class="mv wake" id="wake" aria-pressed="false">Keep screen on<\/button>/);
  assert.deepEqual(nav.log, [], 'off by default');
  clickWake(page); await settle();
  assert.equal(page.storage.get('rb.wake'), '1');
  assert.deepEqual(nav.log, ['request:screen']);
  page.go('#strength'); await settle();
  assert.equal(page.element('home').hidden, false);
  assert.deepEqual(nav.log, ['request:screen', 'release']);
  // remembered: the next sheet or session page asks again by itself, with the button pressed
  page.go('#session/gsp'); await settle();
  assert.match(page.element('view').innerHTML, /id="wake" aria-pressed="true"/);
  assert.deepEqual(nav.log, ['request:screen', 'release', 'request:screen']);
  // turned off: released and forgotten
  clickWake(page); await settle();
  assert.equal(page.storage.has('rb.wake'), false);
  assert.deepEqual(nav.log, ['request:screen', 'release', 'request:screen', 'release']);
});

test('a refused wake lock leaves the page working', async () => {
  const nav = {wakeLock: {request: async () => { throw new Error('NotAllowedError'); }}};
  const page = await app({...signedIn, tables: tables(), hash: '#angel', dom: true, nav, stored: {'rb.wake': '1'}});
  await settle();
  assert.equal(page.element('view').hidden, false);
  assert.match(page.element('view').innerHTML, /id="wake" aria-pressed="true"/);
});
