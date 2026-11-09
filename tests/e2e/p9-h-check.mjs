// P9 H (Codex pass 1): « Show n more » must not move the page. By hand, not in CI, against a preview with the fake
// backend: tools/preview/build.sh <out>; tools/preview/serve.sh <out> 8812; then
//   node tests/e2e/p9-h-check.mjs --base http://127.0.0.1:8812/index.html [--browser chromium]
// WebKit iPhone 14, `?more` (5 sessions): YOUR SESSIONS is scrolled so that the button sits at the bottom of the
// screen, tapped; scrollY must not change and the focus must be on the first card revealed (#sess-next). Control:
// focusing the button at the end of the unfolded list without preventScroll does move the page (the bug the check
// guards against), else the check proves nothing. Tapped again: folded, the button keeps the focus and is on screen.
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path';
const pw = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const BASE = arg('--base') || 'http://127.0.0.1:8812/index.html', engine = pw[arg('--browser') || 'webkit'];
const b = await engine.launch(); const fails = [], ok = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok' : 'FAIL'}  ${m}`); };
const c = await b.newContext({...pw.devices['iPhone 14'], reducedMotion: 'reduce'}); await c.route(/supabase\.co/, r => r.abort());
const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto(BASE + '?more'); await p.waitForSelector('[data-sess-more]'); await p.waitForTimeout(500);
await p.evaluate(() => { const r = document.getElementById('sess-more').getBoundingClientRect(); window.scrollTo(0, r.bottom + scrollY - innerHeight + 24); });
await p.waitForTimeout(300);
const y0 = await p.evaluate(() => scrollY);
await p.tap('#sess-more'); await p.waitForTimeout(400);
const after = await p.evaluate(() => ({y: scrollY, active: document.activeElement && document.activeElement.id, cards: document.querySelectorAll('#sess-list .scard').length, end: document.getElementById('sess-more').getBoundingClientRect().top > innerHeight}));
ok(after.cards === 5, `unfolded: ${after.cards} cards`);
ok(Math.abs(after.y - y0) <= 1, `unfold keeps the page where it was (scrollY ${y0} → ${after.y})`);
ok(after.active === 'sess-next', `focus on the first card revealed (${after.active})`);
ok(after.end, '« Show less » is below the screen (the list is longer than the screen)');
await p.evaluate(() => { document.activeElement.blur(); document.getElementById('sess-more').focus(); }); await p.waitForTimeout(400);
const ctl = await p.evaluate(y => { const d = scrollY - y; window.scrollTo(0, y); return d; }, after.y); await p.waitForTimeout(200);
ok(ctl > 0, `control: a plain focus on « Show less » would scroll by ${ctl}px`);
await p.evaluate(() => document.getElementById('sess-more').scrollIntoView({block: 'end'})); await p.waitForTimeout(300);
await p.tap('#sess-more'); await p.waitForTimeout(400);
const fold = await p.evaluate(() => { const r = document.getElementById('sess-more').getBoundingClientRect(); return {active: document.activeElement && document.activeElement.id, top: r.top, bottom: r.bottom, cards: document.querySelectorAll('#sess-list .scard').length}; });
const h = await p.evaluate(() => innerHeight);
ok(fold.cards === 3, `folded: ${fold.cards} cards`);
ok(fold.active === 'sess-more', `folded: focus on the button (${fold.active})`);
ok(fold.top >= 0 && fold.bottom <= h, `folded: the button is on screen (top ${Math.round(fold.top)})`);
ok(!errs.length, `no page error ${errs.join(' ')}`);
await b.close(); process.exit(fails.length ? 1 : 0);
