// P9 Q: captures of the videos on the way of a notebook page (sheet-shaped cards, their anchored menu, its Move
// sub-menu, the menu above a card near the bottom, right-aligned for a card at the right edge in 02), the band's logos, the list opened from the band (its rows' logos) and the
// « Removed · Undo » toast on the notebook page (docs/audit-design/captures/p9/Q), WebKit iPhone 14, light and dark.
// The synthetic fixtures get three more requests in Strength (a Being made TikTok, a Needs you Instagram, a Not started
// Facebook) before the fake backend reads them. Also checks the focus: into the menu, the arrows, Escape back to the
// card (« focus » in the report).
// Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8813.
// usage: node tools/preview/p9-q-captures.mjs <shots dir> <port>
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT] = process.argv; mkdirSync(OUT, {recursive: true});
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const MORE = [
  {id: 'req-p', url: 'https://www.tiktok.com/@coach.lea/video/7400000000000000201', status: 'processing', theme: 'strength', note: null, created_at: '2026-11-01T10:00:00Z'},
  {id: 'req-f', url: 'https://www.instagram.com/reel/PREVIEW0202/', status: 'error', reason: 'signin_required', theme: 'strength', note: 'Instagram asked to sign in', created_at: '2026-10-31T09:00:00Z', processed_at: '2026-11-01T09:00:00Z'},
  {id: 'req-b', url: 'https://www.facebook.com/watch/?v=1203', status: 'queued', theme: 'strength', note: null, created_at: '2026-11-03T09:00:00Z'}
];
const nb = async p => {
  await p.evaluate(() => { location.hash = 'strength'; }); await p.waitForSelector('#otw-ghosts:not([hidden]) .gcard');
  await p.evaluate(() => { const r = document.getElementById('otw-gh').getBoundingClientRect(); scrollBy(0, r.top - 120); }); await p.waitForTimeout(400);
};
const menu = id => async p => { await nb(p); await p.click(`#otw-g-${id}`); await p.waitForSelector('#otw-menu[open] .otw-cm .it'); await p.waitForTimeout(300); };
const S = {
  '01-notebook-ghosts': {run: nb},
  '02-menu-not-started': {run: menu('req-1')},
  '03-menu-being-made': {run: menu('req-p')},
  '04-menu-needs-you': {run: menu('req-f')},
  '05-move-submenu': {run: async p => { await menu('req-1')(p); await p.click('#otw-cm [data-cm="move"]'); await p.waitForTimeout(300); }},
  '06-menu-above-near-bottom': {run: async p => {
    await nb(p); await p.evaluate(() => { const r = document.getElementById('otw-g-req-1').getBoundingClientRect(); scrollBy(0, r.bottom - innerHeight + 24); }); await p.waitForTimeout(300);
    await p.click('#otw-g-req-1'); await p.waitForSelector('#otw-menu[open] .otw-cm .it'); await p.waitForTimeout(300); }},
  '07-list-from-band': {run: async p => { await p.click('#otw-band'); await p.waitForSelector('#otw-dlg[open] .qrow'); await p.waitForTimeout(500); }}, // its rows: the logos too
  '08-band': {run: async p => { await p.waitForSelector('#otw-band:not([hidden])'); await p.waitForTimeout(400); }},
  '09-removed-undo': {run: async p => { await menu('req-b')(p); await p.click('#otw-cm [data-cm="rm"]'); await p.waitForSelector('#queue-undo:not([hidden])'); await p.waitForTimeout(300); }},
  '10-fix-from-menu': {run: async p => { await menu('req-f')(p); await p.click('#otw-cm [data-cm="fix"]'); await p.waitForSelector('#otw-dlg[open] #otw-row:not([hidden])'); await p.waitForTimeout(500); }}
};
const focusCheck = async p => {
  await nb(p); await p.focus('#otw-g-req-1'); await p.keyboard.press('Enter'); await p.waitForSelector('#otw-menu[open] .otw-cm .it');
  const at = () => p.evaluate(() => { const a = document.activeElement; return a ? (a.id || (a.dataset && a.dataset.cm) || a.tagName) : ''; });
  const out = [await at()];
  await p.keyboard.press('ArrowDown'); out.push(await at());
  await p.keyboard.press('ArrowUp'); out.push(await at());
  await p.keyboard.press('ArrowUp'); out.push(await at());
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  out.push(await at(), await p.evaluate(() => document.getElementById('otw-menu').open));
  return out.join(' > ');
};
const inView = p => p.evaluate(() => {
  const m = document.querySelector('#otw-menu[open] .otw-cm'); if (!m) return null;
  const r = m.getBoundingClientRect(), fab = document.elementFromPoint(innerWidth - 30, innerHeight - 30);
  return {inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, overFab: fab && fab.id, focus: document.activeElement && (document.activeElement.id || document.activeElement.dataset.cm)};
});
const b = await webkit.launch(); const report = [];
for (const [name, s] of Object.entries({...S, 'focus': {run: focusCheck, noshot: true}})) for (const scheme of ['light', 'dark']) {
  if (s.noshot && scheme === 'dark') continue;
  const c = await b.newContext({...devices['iPhone 14'], deviceScaleFactor: 1.5, colorScheme: scheme});
  await c.route(/supabase\.co/, r => r.abort());
  await c.addInitScript(more => {
    let v; Object.defineProperty(window, '__FAKE', {configurable: true, get: () => v, set: x => { v = x; if (x && Array.isArray(x.requests)) x.requests.push(...more); }});
  }, MORE);
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE); await p.waitForSelector('#otw-band:not([hidden])');
  const r = await s.run(p);
  if (!s.noshot) await p.screenshot({path: join(OUT, `${name}-${scheme}.png`)});
  report.push({name, scheme, errs, menuInView: await inView(p), ...(r ? {focus: r} : {})});
  await c.close();
}
await b.close(); console.log(JSON.stringify(report));
