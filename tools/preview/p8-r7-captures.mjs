// P8 R7: the story card on the fake backend (docs/audit-design/captures/p8/R7), WebKit iPhone 14, light and dark.
// Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8797.
// usage: node tools/preview/p8-r7-captures.mjs <shots dir> <port> [name…]
// Screenshots: Session done with the card, folded (« Share your session »), the image full screen, the session's
// Share sheet with « Story image ». Sample cards (1080 × 1920 PNG, drawn by app/card.js in the page, fonts loaded):
// card-1 the Session done of a fixture session, card-2 a fixture session from its Share sheet, card-3 12 fixture
// sheets under a long title, without credits. Prints, per capture, the filled buttons in view and any page error.
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync, writeFileSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT, ...ONLY] = process.argv; mkdirSync(OUT, {recursive: true});
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const home = async p => { await p.waitForSelector('#portal .tcard'); await p.waitForTimeout(500); };
// the first session of home, played to the end (every filled action until Finish)
const played = async p => {
  await home(p); await p.click('#sess-sec .scard-o'); await p.waitForSelector('#view #play-start'); await p.click('#play-start'); await p.waitForSelector('#play-done-set');
  for (let i = 0; i < 80; i++) {
    const next = await p.evaluate(() => ['play-rest-next', 'play-done-set', 'play-finish', 'play-next'].find(id => { const e = document.getElementById(id); return e && e.offsetParent && !e.classList.contains('ghost'); }));
    if (!next) break;
    await p.click('#' + next); await p.waitForTimeout(120);
    if (next === 'play-finish') break;
  }
  await p.waitForSelector('#end-done'); await p.waitForTimeout(400);
};
const withCard = async p => { await played(p); await p.waitForSelector('#end-card canvas', {timeout: 8000}); await p.waitForTimeout(300); };
const png = async (p, js) => Buffer.from(await p.evaluate(js), 'base64');
const blobB64 = `async b => { const r = new FileReader(); return await new Promise(ok => { r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(b); }); }`;
const S = {
  '01-session-done-card': {run: async p => { await withCard(p); await p.evaluate(() => document.getElementById('end-story').scrollIntoView({block: 'center'})); await p.waitForTimeout(200); },
    sample: ['card-1-session-done', p => png(p, `(() => document.querySelector('#end-card canvas').toDataURL('image/png').split(',')[1])()`)]},
  // the second Session done of the week (the first one, just before, showed the card): folded
  '02-session-done-folded': {run: async p => {
    await withCard(p); await p.click('#end-close'); await p.waitForTimeout(300);
    await p.goto(BASE); await played(p); await p.evaluate(() => document.getElementById('end-story').scrollIntoView({block: 'center'})); await p.waitForTimeout(200);
  }},
  // a browser that cannot share files (canShare missing): the image full screen, « Save the image » filled
  '03-story-full-screen': {before: c => c.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'canShare', {value: undefined, configurable: true}); } catch {} }), run: async p => { await withCard(p); await p.click('#end-share-s'); await p.waitForSelector('#story-dlg[open] #story-img'); await p.waitForTimeout(400); }},
  '04-share-sheet-story-row': {run: async p => {
    await home(p); await p.click('#sess-sec .scard-o'); await p.waitForSelector('#view #play-start'); await p.click('#nav-more'); await p.click('#nav-share');
    await p.waitForSelector('#share-dlg[open] #share-story'); await p.waitForTimeout(300); },
  sample: ['card-2-share-sheet', async p => { await p.click('#share-story'); await p.waitForSelector('#story-dlg[open] #story-img');
    return png(p, `(async () => { const b = await (await fetch(document.getElementById('story-img').src)).blob(); return (${blobB64})(b); })()`); }]},
  '05-card-12-exercises': {shotless: true, run: home,
    sample: ['card-3-twelve-no-credit', p => png(p, `(async () => {
      const C = window.RBCard || await new Promise(ok => { const s = document.createElement('script'); s.src = 'card.js?v=2'; s.onload = () => ok(window.RBCard); document.head.appendChild(s); });
      const data = window.__FAKE;
      const sheets = (data && data.sheets || []).slice(0, 12);
      const doses = ['3 × 10', '3 × 30 s', '3 × 12 par côté', '4 × 8', '2 min', '3 × 15'];
      const card = {title: 'Renforcement complet du haut du corps et gainage pour la semaine', over: 'Strength', colour: 0, lang: 'fr', today: true, sets: 31,
        items: sheets.map((s, i) => ({title: s.title, dose: doses[i % doses.length]})), authors: []};
      const {blob} = await C.render(card, document); return (${blobB64})(blob); })()`)]}
};
const b = await webkit.launch(); const report = [];
for (const [name, s] of Object.entries(S)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  for (const scheme of s.shotless ? ['light'] : ['light', 'dark']) {
    const c = await b.newContext({...devices['iPhone 14'], deviceScaleFactor: 1.5, colorScheme: scheme, reducedMotion: 'reduce'});
    await c.route(/supabase\.co/, r => r.abort());
    if (s.before) await s.before(c);
    const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE); await s.run(p);
    const filled = await p.evaluate(() => [...document.querySelectorAll('.btn:not(.ghost)')].filter(e => e.offsetParent).map(e => e.textContent.trim()));
    if (!s.shotless) await p.screenshot({path: join(OUT, `${name}-${scheme}.png`)});
    if (s.sample && scheme === 'light') writeFileSync(join(OUT, `${s.sample[0]}.png`), await s.sample[1](p));
    report.push({name, scheme, filled, errs});
    await c.close();
  }
}
await b.close(); console.log(JSON.stringify(report, null, 1));
