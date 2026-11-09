// P8 R19: captures of « Share my progress » and the proud story card on the fake backend
// (docs/audit-design/captures/p8/R19), WebKit iPhone 14, light and dark, reduced motion.
// Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8819.
// usage: node tools/preview/p8-r19-captures.mjs <shots dir> <port> [name…]
// Screenshots: Session done with the button, the message once tapped (« Link copied… »), New move with the button.
// Cards (1080 × 1920 PNG, drawn by app/card.js in the page, fonts loaded; an image does not follow the theme, so one
// of each): card-1 repetition FR, card-2 repetition EN, card-3 technique, card-4 low numbers (title and « done ✓ »
// only), card-5 the one Session done downloads (a browser without file share: the real path). The fixtures are left
// as they are: a few session rows (this week, the three weeks before) are added to practice_log before the app reads
// them, and two Fight techniques sheets are at « Got it », so the third learned there is « 3 of 3 ».
// Prints, per capture, the filled and outlined buttons in view, the message and any page error.
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync, writeFileSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT, ...ONLY] = process.argv; mkdirSync(OUT, {recursive: true});
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const seed = () => {
  let fake;
  const day = n => { const d = new Date(); d.setDate(d.getDate() - n); const p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  Object.defineProperty(window, '__FAKE', {configurable: true, get: () => fake, set: v => {
    for (const t of v.user_themes || []) if (!('family' in t)) t.family = null;
    v.notes = [...(v.notes || []), {slug: 'jab-cross', body: '', level: 'got'}, {slug: 'session-shadow-garde', body: '', level: 'got'}];
    v.practice_log = [...(v.practice_log || []), ...[0, 7, 9, 14, 16, 21].map((n, i) => ({id: 'r19-' + i, slug: 'session/r19-' + i, done_on: day(n), text: '', created_at: new Date().toISOString()}))];
    fake = v;
  }});
  // no file share (a desktop browser): the image is downloaded, and caught here
  try { Object.defineProperty(Navigator.prototype, 'canShare', {value: undefined, configurable: true}); } catch {}
};
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
  await p.waitForSelector('#proud-go'); await p.waitForTimeout(600);
};
const learned = async p => {
  await p.goto(BASE + '#session-shadow-esquives/practice'); await p.waitForSelector('#tech-next:not([disabled])'); await p.waitForTimeout(400);
  for (let i = 0; i < 12 && await p.$('#tech-next'); i++) { await p.click('#tech-next'); await p.waitForTimeout(120); }
  await p.click('#tech-lv-got'); await p.click('#tech-save'); await p.waitForSelector('#proud-go'); await p.waitForTimeout(500);
};
const blobB64 = `async b => { const r = new FileReader(); return await new Promise(ok => { r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(b); }); }`;
const drawn = card => `(async () => {
  const C = window.RBCard || await new Promise(ok => { const s = document.createElement('script'); s.src = 'card.js?v=3'; s.onload = () => ok(window.RBCard); document.head.appendChild(s); });
  const {blob} = await C.render(${JSON.stringify(card)}, document); return (${blobB64})(blob); })()`;
const CARDS = {
  'card-1-repetition-fr': {kind: 'repetition', title: 'Routine du cou', lang: 'fr', colour: 3, stats: {week: 3, month: 11, monthIndex: 10, weeks: 4}},
  'card-2-repetition-en': {kind: 'repetition', title: 'Neck routine', lang: 'en', colour: 3, stats: {week: 3, month: 11, monthIndex: 10, weeks: 4}},
  'card-3-technique': {kind: 'technique', title: 'Jab-cross', lang: 'fr', colour: 2, notebook: 'Fight techniques', learned: 5, total: 9},
  'card-4-low-numbers': {kind: 'repetition', title: 'Neck routine', lang: 'en', colour: 0, stats: {week: 1, month: 1, monthIndex: 10, weeks: 1}}
};
const S = {
  '01-session-done': {run: played},
  '02-link-copied': {run: async p => {
    await played(p);
    const dl = p.waitForEvent('download', {timeout: 8000});
    await p.click('#proud-go');
    const d = await dl; if (p.__sample) await d.saveAs(join(OUT, 'card-5-session-done.png'));
    await p.waitForSelector('#proud-said:not([hidden])'); await p.waitForTimeout(300);
  }},
  '03-new-move': {run: learned},
  '04-cards': {shotless: true, run: async p => { await home(p); for (const [name, card] of Object.entries(CARDS)) writeFileSync(join(OUT, name + '.png'), Buffer.from(await p.evaluate(drawn(card)), 'base64')); }}
};
const b = await webkit.launch(); const report = [];
for (const [name, s] of Object.entries(S)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  for (const scheme of s.shotless ? ['light'] : ['light', 'dark']) {
    const c = await b.newContext({...devices['iPhone 14'], deviceScaleFactor: 1.5, colorScheme: scheme, reducedMotion: 'reduce', acceptDownloads: true});
    await c.route(/supabase\.co/, r => r.abort());
    await c.addInitScript(seed);
    const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    p.__sample = scheme === 'light';
    await p.goto(BASE); await s.run(p);
    const buttons = await p.evaluate(() => [...document.querySelectorAll('.btn')].filter(e => e.offsetParent).map(e => (e.classList.contains('ghost') ? 'outlined: ' : 'filled: ') + e.textContent.trim()));
    const said = await p.evaluate(() => { const e = document.getElementById('proud-said'); return e && !e.hidden ? e.textContent : ''; });
    if (!s.shotless) await p.screenshot({path: join(OUT, `${name}-${scheme}.png`)});
    report.push({name, scheme, buttons, said, errs});
    await c.close();
  }
}
await b.close(); console.log(JSON.stringify(report, null, 1));
