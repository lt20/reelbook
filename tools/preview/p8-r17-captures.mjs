// R17: captures of Settings › Reelbook (Contact us, Ask for a feature, Report a problem) and of the « Report a
// problem » sheet, on the fake backend (docs/audit-design/captures/p8/R17), WebKit iPhone 14, light and dark,
// reduced motion. Before: tools/preview/build.sh <out>, then tools/preview/serve.sh <out> 8817.
// usage: node tools/preview/p8-r17-captures.mjs <shots dir> <port>
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT] = process.argv; mkdirSync(OUT, {recursive: true});
const settings = async p => {
  await p.evaluate(() => { location.hash = '#settings'; });
  await p.waitForSelector('#settings:not([hidden])');
  await p.evaluate(() => document.getElementById('s-reelbook').scrollIntoView({block: 'end'}));
  await p.waitForTimeout(300);
};
const S = {
  '01-settings-reelbook': settings,
  '02-report-a-problem': async p => { await settings(p); await p.click('#s-report'); await p.waitForSelector('#prob-dlg[open]'); await p.waitForTimeout(300); }
};
const b = await webkit.launch(); const report = [];
for (const [name, run] of Object.entries(S)) for (const scheme of ['light', 'dark']) {
  const c = await b.newContext({...devices['iPhone 14'], deviceScaleFactor: 1.5, colorScheme: scheme, reducedMotion: 'reduce'});
  await c.route(/supabase\.co/, r => r.abort());
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(`http://127.0.0.1:${PORT}/index.html`); await p.waitForTimeout(600); await run(p);
  const hrefs = await p.evaluate(() => ['s-contact', 's-idea', 'prob-mail', 'prob-issue'].map(id => { const a = document.getElementById(id); return [id, a.hidden, decodeURIComponent(a.href)]; }));
  await p.screenshot({path: join(OUT, `${name}-${scheme}.png`)});
  report.push({name, scheme, hrefs: name.startsWith('02') ? hrefs : undefined, errs});
  await c.close();
}
await b.close(); console.log(JSON.stringify(report, null, 1));
