// P9 H: captures of the denser home page on the fake backend (docs/audit-design/captures/p9/H), WebKit iPhone 14,
// light and dark, reduced motion. Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8812.
// usage: node tools/preview/p9-h-captures.mjs <shots dir> <port> [name…]
// Prints, per capture, the tiles fully visible once NOTEBOOKS is scrolled under the top bar, and any tile or
// session button whose content overflows its box (clipped text other than the name's ellipsis).
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT, ...ONLY] = process.argv; mkdirSync(OUT, {recursive: true});
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const home = async p => { await p.waitForSelector('#portal .nbt'); await p.waitForTimeout(500); };
const toSessions = async p => { await p.evaluate(() => { const h = document.getElementById('sess-h'); window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 64); }); await p.waitForTimeout(300); };
const toNotebooks = async p => { await p.evaluate(() => { const h = document.getElementById('nb-h'); window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 64); }); await p.waitForTimeout(300); };
const unfold = async p => { await p.click('[data-sess-more]'); await p.waitForTimeout(300); };
const large = async p => { await p.evaluate(() => { document.documentElement.style.fontSize = '23px'; }); await p.waitForTimeout(300); };
const S = {
  '01-sessions-folded': {q: '?more', run: async p => { await home(p); await toSessions(p); }},
  '02-sessions-unfolded': {q: '?more', run: async p => { await home(p); await unfold(p); await p.evaluate(() => { const b = document.querySelector('[data-sess-more]'); window.scrollTo(0, b.getBoundingClientRect().bottom + scrollY - innerHeight + 120); }); await p.waitForTimeout(300); }},
  '03-notebooks-badges': {q: '?more', run: async p => { await home(p); await toNotebooks(p); }},
  '04-one-notebook': {q: '?nbs=1', run: async p => { await home(p); await toNotebooks(p); }},
  '05-large-text-sessions': {q: '?more', run: async p => { await home(p); await large(p); await toSessions(p); }},
  '06-large-text-notebooks': {q: '?more', run: async p => { await home(p); await large(p); await toNotebooks(p); }},
  '07-home-full': {q: '?more', full: true, run: home},
};
const b = await webkit.launch(); const report = [];
for (const [name, s] of Object.entries(S)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  for (const scheme of ['light', 'dark']) {
    const c = await b.newContext({...devices['iPhone 14'], deviceScaleFactor: 1.5, colorScheme: scheme, reducedMotion: 'reduce'});
    await c.route(/supabase\.co/, r => r.abort());
    const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(BASE + s.q); await s.run(p);
    const info = await p.evaluate(() => {
      const tiles = [...document.querySelectorAll('#portal .nbt')];
      const seen = tiles.filter(t => { const r = t.getBoundingClientRect(); return r.top >= 56 && r.bottom <= innerHeight; }).length;
      const over = [...tiles, ...document.querySelectorAll('[data-sess-more]')].filter(t => t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1).map(t => t.getAttribute('aria-label') || t.textContent);
      const bdg = [...document.querySelectorAll('.nbt-bdg,.nbt-dot')].map(x => x.closest('.nbt').getAttribute('aria-label'));
      const h = tiles.map(t => Math.round(t.getBoundingClientRect().height));
      return {tiles: tiles.length, seen, over, bdg, h: [...new Set(h)], more: (document.querySelector('[data-sess-more]') || {}).textContent || ''};
    });
    await p.screenshot({path: join(OUT, `${name}-${scheme}.png`), fullPage: !!s.full});
    report.push({name, scheme, ...info, errs});
    await c.close();
  }
}
await b.close(); console.log(JSON.stringify(report));
