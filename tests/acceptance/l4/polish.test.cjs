const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, ownUrl, ownKey} = require('../../harness.cjs');

const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
const signedIn = {
  remembered: {mode: 'own', url: ownUrl, key: ownKey},
  sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}
};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

test('Q7 — danger tokens use the specified light and dark colours, including delete dialogs', () => {
  assert.match(css, /:root\s*\{[^}]*--danger\s*:\s*#b42318/i);
  assert.match(css, /:root\s*\{[^}]*--danger-bg\s*:/);
  assert.match(css, /data-theme="dark"[^}]*\{[^}]*--danger\s*:\s*#f97066/i);
  assert.match(css, /\.btn\.danger\s*\{[^}]*var\(--danger\)/);
  assert.match(css, /(?:#del-dlg|#sd-dlg|dialog\.dlg)[^{]*\{[^}]*var\(--danger(?:-bg)?\)/);
});

test('Q7 — Delete sheet and Delete session are danger-coloured text buttons', () => {
  assert.match(html, /<button[^>]*id="sd-ok"[^>]*>Delete sheet<\/button>/);
  assert.match(html, /<button[^>]*id="del-ok"[^>]*>Delete session<\/button>/);
  assert.match(css, /(?:#sd-ok|#del-ok|\.btn\.danger)[^{]*\{[^}]*background\s*:\s*transparent/);
  assert.match(css, /(?:#sd-ok|#del-ok|\.btn\.danger)[^{]*\{[^}]*color\s*:\s*var\(--danger\)/);
});

test('Q7 — small buttons, move controls, navigation and queue Remove have 44 px tap targets', () => {
  for (const selector of ['.btn.sm', '.mv', '.topbar a', '.top a', '.sh2 .btn', '.q button']) {
    const rule = css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{]*\\{([^}]*)\\}'))?.[1] || '';
    assert.match(rule, /(?:min-height|height)\s*:\s*44px/, `${selector} needs a 44 px height`);
    assert.match(rule, /(?:min-width|width|padding)\s*:/, `${selector} needs a horizontal tap area`);
  }
});

test('Q7 — tappable controls suppress tap highlight and have a visible pressed state', () => {
  assert.match(css, /-webkit-tap-highlight-color\s*:\s*transparent/);
  assert.match(css, /:active[^{]*\{[^}]*(?:opacity\s*:\s*\.6|scale\s*:\s*\.97|transform\s*:\s*scale\(\.97\))/);
});

test('Q8 — a long session format is a plain two-line .card .fmt; pills remain single-line', async () => {
  const format = 'A long session format explaining the sequence, the timing, the rest periods and the repeated rounds, long enough to wrap over several lines on a narrow phone card.';
  const page = await app({...signedIn, hash: '#strength', tables: {
    user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}],
    sheets: [], notes: [], requests: [],
    sessions: [{slug: 'long-format', theme: 'strength', title: 'Long format', format, why: '', key_points: [], source: {}, thumbnail: '', origin: 'video', items: []}]
  }});
  await settle();
  const cards = page.element('groups').innerHTML;
  assert.match(cards, /class="fmt"[^>]*>A long session format/);
  assert.doesNotMatch(cards, /<span[^>]*>A long session format/);
  assert.match(css, /\.card \.fmt\s*\{[^}]*-webkit-line-clamp\s*:\s*2/);
  assert.match(css, /\.card \.m span[^{]*\{[^}]*white-space\s*:\s*nowrap/);
  assert.match(css, /\.card \.m span[^{]*\{[^}]*text-overflow\s*:\s*ellipsis/);
});
