// L18: every dialog.dlg opens and closes through openSheet / closeSheet (a bottom sheet under 600 px wide).
// The harness dialogs are plain objects: showModal / close set `open`; listeners are kept one per type.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, ownUrl, ownKey} = require('./harness.cjs');

const signedIn = {remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const url = 'https://www.instagram.com/reel/example/';
const tables = () => ({
  user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
  sheets: [{slug: 'curl', kind: 'sheet', theme: 'strength', group: 'Arms', title: 'Curl marteau', summary: '', html: '<a href="https://example.test">Video</a>', source: {url}, exercises: []}],
  sessions: [{slug: 'backroll', theme: 'strength', title: 'Backroll', origin: 'user', source: {}, items: [{slug: 'curl', dose: ''}]}],
  requests: []
});
const clickView = (page, selector) => page.element('view').listeners.click({target: {closest: wanted => wanted === selector ? {} : null}});
const clickIn = (page, id, selector) => page.element(id).listeners.click({target: {closest: s => s === selector ? {dataset: {}} : null}});
const sheetPage = async () => { const page = await app({...signedIn, tables: tables(), hash: '#curl', dom: true}); await settle(); return page; };

test('openSheet falls back to the open attribute when the dialog has no showModal / close (old browser, harness)', async () => {
  const page = await sheetPage();
  const dlg = page.element('report-dlg'), attrs = new Map();
  delete dlg.showModal; delete dlg.close;
  dlg.setAttribute = (k, v) => attrs.set(k, v); dlg.removeAttribute = k => attrs.delete(k);
  assert.doesNotThrow(() => clickView(page, '#report-open'));
  assert.equal(dlg.open, true);
  assert.equal(attrs.get('open'), '');
  await page.fire('report-cancel');
  assert.equal(dlg.open, false);
  assert.equal(attrs.has('open'), false);
});

test('a tap on the backdrop closes a sheet, unless something was typed or picked in it since it opened', async () => {
  const page = await sheetPage();
  const dlg = page.element('move-dlg');
  clickView(page, '#mv-open');
  assert.equal(dlg.open, true);
  dlg.listeners.click({target: {}});
  assert.equal(dlg.open, true, 'a click inside the sheet keeps it');
  dlg.listeners.click({target: dlg});
  assert.equal(dlg.open, false, 'the backdrop closes it');

  clickView(page, '#mv-open');
  dlg.listeners.input({target: page.element('mv-theme')});
  dlg.listeners.click({target: dlg});
  assert.equal(dlg.open, true, 'a changed field keeps it open');
  await page.fire('mv-cancel');
  assert.equal(dlg.open, false);

  clickView(page, '#mv-open');
  dlg.listeners.click({target: dlg});
  assert.equal(dlg.open, false, 'opened again, it starts clean');
});

test('a click on the sheet\'s own padding is not a backdrop tap', async () => {
  const page = await sheetPage();
  const dlg = page.element('move-dlg');
  dlg.getBoundingClientRect = () => ({left: 0, right: 390, top: 400, bottom: 844});
  clickView(page, '#mv-open');
  dlg.listeners.click({target: dlg, clientX: 10, clientY: 420});
  assert.equal(dlg.open, true, 'inside its box');
  dlg.listeners.click({target: dlg, clientX: 200, clientY: 120});
  assert.equal(dlg.open, false, 'above it, on the backdrop');
});

test('« Something wrong? » opens without focusing the text field; once sent, the backdrop closes it again', async () => {
  const page = await sheetPage();
  let focused = false;
  page.element('report-note').focus = () => { focused = true; };
  clickView(page, '#report-open');
  const dlg = page.element('report-dlg');
  assert.equal(dlg.open, true);
  assert.equal(focused, false, 'no keyboard pops up over the sheet');
  assert.match(dlg.innerHTML, /^<div class="sh-h"><button class="btn ghost sh-no" type="button" id="report-cancel">Cancel<\/button><h2 id="report-h">Something wrong\?<\/h2><button class="btn sh-ok" type="button" id="report-send" disabled>Send<\/button><\/div>/);
  page.element('report-note').value = 'The hand position is reversed.';
  dlg.listeners.input({target: page.element('report-note')});
  dlg.listeners.click({target: dlg});
  assert.equal(dlg.open, true, 'typed text is not lost to a stray tap');
  await page.fire('report-send'); await settle();
  assert.match(page.element('report-status').textContent, /^Sent\./);
  dlg.listeners.click({target: dlg});
  assert.equal(dlg.open, false);
});

test('a sheet stays open while its write runs (no backdrop, no Escape), so its error shows in it', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const hold = (table, ops) => table === 'sessions' && ops.some(o => o[0] === 'delete') ? gate.then(() => ({data: null, error: {message: 'offline'}})) : null;
  const page = await app({...signedIn, tables: tables(), hash: '#session/backroll', hold}); await settle();
  const dlg = page.element('del-dlg');
  clickView(page, '#ed-open');
  clickView(page, '#ed-delete');
  assert.equal(dlg.open, true);
  const running = page.element('del-ok').listeners.click();
  await settle();
  dlg.listeners.click({target: dlg});
  assert.equal(dlg.open, true, 'a tap outside waits for the delete');
  let prevented = false;
  dlg.listeners.cancel({preventDefault: () => { prevented = true; }});
  assert.equal(prevented, true, 'Escape waits too');
  release(); await running; await settle();
  assert.equal(dlg.open, true);
  assert.equal(page.element('del-err').hidden, false);
  dlg.listeners.click({target: dlg});
  assert.equal(dlg.open, false, 'once it failed, the backdrop closes it again');
});

test('« New session » opens without focusing the title field', async () => {
  const page = await app({...signedIn, tables: tables(), hash: '#strength'}); await settle();
  let focused = false;
  page.element('ns-title').focus = () => { focused = true; };
  clickIn(page, 'groups', '#ns-open');
  assert.equal(page.element('ns-dlg').open, true);
  assert.equal(focused, false);
  page.element('ns-dlg').listeners.click({target: page.element('ns-dlg')});
  assert.equal(page.element('ns-dlg').open, false);
});

test('destructive confirmations are action sheets: the danger action first, the way out last and focused', async () => {
  for (const [id, ok, no] of [['del-dlg', 'del-ok', 'del-cancel'], ['sd-dlg', 'sd-ok', 'sd-cancel']]) {
    const m = html.match(new RegExp(`<dialog class="dlg act" id="${id}"[\\s\\S]*?</dialog>`));
    assert.ok(m, `${id} is an action sheet`);
    assert.match(m[0], new RegExp(`<div class="actions"><button class="btn danger" type="button" id="${ok}">[^<]+</button><button class="btn ghost" type="button" id="${no}" autofocus>`));
  }
  // « Not queued yet »: dropping the link is the danger action, on top; queuing it next; keeping on editing apart.
  assert.match(html, /<dialog class="dlg act" id="pending-dlg"[\s\S]*?<div class="actions"><button class="btn danger" type="button" id="pd-discard">Discard the link<\/button><button class="btn" type="button" id="pd-queue">[^<]+<\/button><button class="btn ghost" type="button" id="pd-stay" autofocus>Keep editing<\/button><\/div>/);
  const page = await sheetPage();
  clickView(page, '#sd-open');
  assert.equal(page.element('sd-dlg').open, true);
  page.element('sd-dlg').listeners.click({target: page.element('sd-dlg')});
  assert.equal(page.element('sd-dlg').open, false, 'a tap outside closes it, as « Keep it » does');
});

test('form dialogs carry a header « Cancel | title | action » and no bottom button pair', () => {
  for (const [dlg, no, title, ok, label] of [['move-dlg', 'mv-cancel', 'mv-title', 'mv-submit', 'Move'], ['ns-dlg', 'ns-cancel', 'ns-h', 'ns-submit', 'Create session'], ['as-dlg', 'as-cancel', 'as-h', 'as-submit', 'Add']]) {
    const m = html.match(new RegExp(`<dialog class="dlg[^"]*" id="${dlg}"[\\s\\S]*?</dialog>`));
    assert.ok(m, dlg);
    assert.match(m[0], new RegExp(`<form [^>]*>\\s*<div class="sh-h"><button class="btn ghost sh-no" type="button" id="${no}">Cancel</button><h2 id="${title}">[^<]+</h2><button class="btn sh-ok" type="submit" id="${ok}">${label}</button></div>`));
    assert.doesNotMatch(m[0], /class="actions"/);
  }
});

test('the sheet CSS: under 600 px, bottom-anchored, bounded by the visual viewport, safe area, motion only when allowed', () => {
  const block = html.slice(html.indexOf('/* ---- L18: bottom sheets'), html.indexOf('@keyframes sheet-fade'));
  assert.match(block, /@media \(max-width:599\.98px\)\{\s*dialog\.dlg,dialog\.pick-dlg\{position:fixed;inset:auto 0 0 0;margin:0 0 var\(--kb,0px\);width:100%/);
  assert.match(block, /max-height:calc\(var\(--vvh,100dvh\)/);
  assert.match(block, /border-radius:14px 14px 0 0/);
  assert.match(block, /env\(safe-area-inset-bottom,0px\)/);
  assert.match(block, /dialog\.pick-dlg \.picklist\{max-height:none;overflow:visible\}/, 'one scroll container per sheet');
  // the sticky header sits flush at the top edge: no top padding on a sheet with a header, top:0, no negative margin
  assert.match(block, /border-radius:14px 14px 0 0;padding:0 /);
  assert.match(block, /dialog\.dlg\.act\{padding-top:20px\}/);
  assert.match(block, /\.sh-h\{display:grid;[^}]*position:sticky;top:0;z-index:1;margin:0 -16px;/);
  assert.match(block, /@media \(max-width:599\.98px\) and \(prefers-reduced-motion:no-preference\)\{\s*dialog\.dlg\[open\]\{animation:sheet-up/);
  assert.doesNotMatch(html.replace(block, ''), /animation:sheet-up/, 'the slide-up runs nowhere else');
  // every dialog.dlg goes through the helper; the full-screen photo viewer and a ghost card's anchored menu (P9 Q, no
  // sheet) keep their own showModal
  const script = html.slice(html.indexOf('<script>\n'));
  assert.deepEqual([...script.matchAll(/(\w+)\.showModal\(\)/g)].map(m => m[1]), ['dlg', 'gmDlg', 'phDlg']);
});
