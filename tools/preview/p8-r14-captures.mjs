// P8 R14: captures of the technique family on the fake backend (docs/audit-design/captures/p8/R14), WebKit iPhone 14,
// light and dark, reduced motion: a technique notebook (« n of N learned », the gauge, the level pills), a practice
// step, « How did it go? » and « New move ». The fixtures (tests/fixtures/preview) are left as they are: the backend
// of a pushed R14 schema is played here by giving each user_themes row its family key (null: the default) and two
// sheets a level, before the app reads them.
// Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8804.
// usage: node tools/preview/p8-r14-captures.mjs <shots dir> <port> [name…]
// Prints, per capture, the filled buttons in view and any page error.
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT, ...ONLY] = process.argv; mkdirSync(OUT, {recursive: true});
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const schema = () => {
  let fake;
  Object.defineProperty(window, '__FAKE', {configurable: true, get: () => fake, set: v => {
    for (const t of v.user_themes || []) if (!('family' in t)) t.family = null;
    v.notes = [...(v.notes || []), {slug: 'jab-cross', body: '', level: 'got'}, {slug: 'session-shadow-garde', body: '', level: 'getting'}];
    fake = v;
  }});
};
const steps = async p => { await p.goto(BASE + '#backroll/practice'); await p.waitForSelector('#tech-next:not([disabled])'); await p.waitForTimeout(600); };
const ask = async p => { await steps(p); for (let i = 0; i < 12 && await p.$('#tech-next'); i++) { await p.click('#tech-next'); await p.waitForTimeout(120); } await p.waitForSelector('#tech-save'); await p.waitForTimeout(300); };
const S = {
  '01-notebook': {run: async p => { await p.goto(BASE + '#fight'); await p.waitForSelector('#nb-learned:not([hidden]) .gauge'); await p.waitForTimeout(600); }},
  '02-practice-step': {run: steps},
  '03-how-did-it-go': {run: async p => { await ask(p); await p.click('#tech-lv-getting'); await p.waitForTimeout(200); }},
  '04-new-move': {run: async p => { await ask(p); await p.click('#tech-lv-got'); await p.click('#tech-save'); await p.waitForSelector('#tech-share'); await p.waitForTimeout(400); }}
};
const b = await webkit.launch(); const report = [];
for (const [name, s] of Object.entries(S)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  for (const scheme of ['light', 'dark']) {
    const c = await b.newContext({...devices['iPhone 14'], deviceScaleFactor: 1.5, colorScheme: scheme, reducedMotion: 'reduce'});
    await c.route(/supabase\.co/, r => r.abort());
    await c.addInitScript(schema);
    const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE); await p.waitForSelector('#portal .tcard'); await s.run(p);
    const filled = await p.evaluate(() => [...document.querySelectorAll('.btn:not(.ghost)')].filter(e => e.offsetParent).map(e => e.textContent.trim()));
    await p.screenshot({path: join(OUT, `${name}-${scheme}.png`)});
    report.push({name, scheme, filled, errs, hash: await p.evaluate(() => location.hash)});
    await c.close();
  }
}
await b.close(); console.log(JSON.stringify(report, null, 1));
