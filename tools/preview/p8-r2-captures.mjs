// P8 R2: captures of readable rows, a row's detail, ghost cards and notebook chips on the fake backend
// (docs/audit-design/captures/p8/R2), WebKit iPhone 14, light and dark, reduced motion. The fixtures have no MMA
// notebook: « Fight techniques » stands in for it, its ghost card made by moving req-1 there through the detail.
// Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8792.
// usage: node tools/preview/p8-r2-captures.mjs <shots dir> <port>
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT] = process.argv; mkdirSync(OUT, {recursive: true});
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const home = async p => { await p.waitForSelector('#otw-band:not([hidden])'); await p.waitForTimeout(400); };
const otw = async p => { await home(p); await p.click('#otw-band'); await p.waitForSelector('#otw-dlg[open] #queue .q'); await p.waitForTimeout(400); };
const detail = async p => { await otw(p); await p.click('#queue [data-row="req-1"]'); await p.waitForSelector('#otw-row:not([hidden]) .mlist'); await p.waitForTimeout(300); };
const moved = async p => {
  await detail(p); await p.click('#otw-row [data-move]'); await p.click('#otw-row [data-pick="fight"]');
  await p.waitForSelector('#otw-row >> text=Moved to Fight techniques.'); await p.click('#otw-row [data-rback]'); await p.click('#otw-close');
};
const S = {
  '01-on-the-way-rows': {run: otw},
  '02-row-detail': {run: detail},
  '03-move-picker': {run: async p => { await detail(p); await p.click('#otw-row [data-move]'); await p.waitForTimeout(300); }},
  '04-notebook-ghost': {run: async p => {
    await moved(p); await p.evaluate(() => { location.hash = 'fight'; }); await p.waitForSelector('#otw-ghosts:not([hidden]) .gcard');
    await p.evaluate(() => document.getElementById('otw-ghosts').scrollIntoView({block: 'center'})); await p.waitForTimeout(400); }},
  '05-home-chips': {run: async p => { await moved(p); await p.evaluate(() => document.getElementById('portal').scrollIntoView({block: 'start'})); await p.waitForTimeout(400); }},
};
const b = await webkit.launch(); const report = [];
for (const [name, s] of Object.entries(S)) for (const scheme of ['light', 'dark']) {
  const c = await b.newContext({...devices['iPhone 14'], deviceScaleFactor: 1.5, colorScheme: scheme, reducedMotion: 'reduce'});
  await c.route(/supabase\.co/, r => r.abort());
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE); await s.run(p);
  await p.screenshot({path: join(OUT, `${name}-${scheme}.png`)});
  report.push({name, scheme, errs, hash: await p.evaluate(() => location.hash)});
  await c.close();
}
await b.close(); console.log(JSON.stringify(report, null, 1));
