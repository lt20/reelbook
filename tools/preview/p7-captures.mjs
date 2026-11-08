// L34: captures of the P7 flow on the fake backend (docs/audit-design/captures/p7), WebKit iPhone 14 (the computer:
// Desktop Safari, 880 px), FR and EN, light. Before: tools/preview/build.sh <out>, then in <out>/config.js set
// mailReady: true (else « Forgot your password? » is not offered), then tools/preview/serve.sh <out> <port>.
// usage: node tools/preview/p7-captures.mjs <shots dir> <port> [phone dpr, 1.5] [only,names]   (each PNG < 150 KB)
import {createRequire} from 'node:module'; import {homedir} from 'node:os'; import {join} from 'node:path'; import {mkdirSync} from 'node:fs';
const {webkit, devices} = createRequire(import.meta.url)(join(homedir(), '.cache/reelbook-e2e/node_modules/playwright'));
const [,, OUT, PORT, DPR = '1.5', ONLY = ''] = process.argv;
mkdirSync(OUT, {recursive: true});
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const E = 'camille@example.com', PW = 'correct-horse-1';
const fill = async (p, em = E, pw = PW) => { await p.fill('#a-email', em); if (pw) await p.fill('#a-pass', pw); };
const toUp = async p => { await p.click('#intro-signup'); await p.waitForSelector('#auth-form:not([hidden])'); };
const toIn = async p => { await p.click('#intro-signin'); await p.waitForSelector('#auth-form:not([hidden])'); };
const toCode = async p => { await toUp(p); await fill(p); await p.click('#a-submit'); await p.waitForSelector('#a-code-row:not([hidden])'); };
const toReset = async p => { await toIn(p); await p.fill('#a-email', E); await p.click('#a-forgot'); await p.click('#a-submit'); await p.waitForSelector('#a-code-row:not([hidden])'); };
const toSetup = async p => { await toIn(p); await p.click('#a-toggle'); await p.waitForSelector('#setup:not([hidden])'); await p.waitForTimeout(200); };
const hosted = {'rb.backend': JSON.stringify({mode: 'hosted'})};
const S = {
  '01-setup': {q: '?noauth&seats=12', ls: {}, run: toSetup},
  '02-signup': {q: '?noauth', run: async p => { await toUp(p); await fill(p); }},
  '03-exists': {q: '?noauth', run: async p => { await toUp(p); await fill(p, 'exists@example.com'); await p.click('#a-submit'); await p.waitForTimeout(300); }},
  '04-code': {q: '?noauth', run: toCode},
  '05-code-wrong': {q: '?noauth', run: async p => { await toCode(p); await p.fill('#a-code', '111111'); await p.waitForSelector('#a-err:not([hidden])'); }},
  '06-set-password': {q: '?noauth', pending: 240000, run: async p => { await p.waitForSelector('#a-code-row:not([hidden])'); await p.fill('#a-code', '123456'); await p.waitForFunction(() => !document.getElementById('a-pass-row').hidden && document.getElementById('a-code-row').hidden); }},
  '07-signin': {q: '?noauth', run: async p => { await toIn(p); await fill(p); }},
  '08-forgot': {q: '?noauth', run: async p => { await toIn(p); await p.fill('#a-email', E); await p.click('#a-forgot'); }},
  '09-reset': {q: '?noauth', run: toReset},
  '10-beta-full': {q: '?noauth&seats=50', ls: {}, run: async p => { await toSetup(p); await p.waitForSelector('#s-wl-first:visible'); }},
  '11-waitlist-joined': {q: '?noauth&seats=50', ls: {}, run: async p => { await toSetup(p); await p.waitForSelector('#s-wl-first:visible'); await p.fill('#s-wl-first', 'Camille'); await p.fill('#s-wl-email', E); await p.check('#s-wl-consent'); await p.click('#s-wl-go'); await p.waitForSelector('#s-wl-done:not([hidden])'); }},
  '12-beta-closed': {q: '?noauth&seats=closed', ls: {}, run: toSetup},
  '13-welcome-phone-new': {q: '?new&empty=sheets,sessions,requests#welcome', run: async p => { await p.waitForSelector('#welcome:not([hidden])'); }},
  '14-welcome-phone-done': {q: '?cli#welcome', ls: {...hosted, 'rb.welcome.phone.u1': '1'}, run: async p => { await p.waitForSelector('#welcome:not([hidden])'); }},
  '15-welcome-computer-new': {q: '?new&empty=sheets,sessions,requests#welcome', pc: 1, run: async p => { await p.waitForSelector('#welcome:not([hidden])'); }},
  '16-welcome-computer-done': {q: '?cli#welcome', pc: 1, ls: {...hosted, 'rb.welcome.phone.u1': '1'}, run: async p => { await p.waitForSelector('#welcome:not([hidden])'); }},
};
const only = ONLY.split(',').filter(Boolean);
const b = await webkit.launch();
let bad = 0;
for (const [name, s] of Object.entries(S)) {
  if (only.length && !only.includes(name)) continue;
  for (const lang of ['fr', 'en']) {
    const dev = s.pc ? {...devices['Desktop Safari'], viewport: {width: 880, height: 900}} : devices['iPhone 14'];
    const c = await b.newContext({...dev, deviceScaleFactor: s.pc ? 1 : Number(DPR), colorScheme: 'light', locale: lang === 'fr' ? 'fr-FR' : 'en-US'});
    await c.route(/supabase\.co/, r => r.abort()); // never a real backend
    const store = s.ls || (s.pending || s.q.includes('#welcome') ? hosted : {});
    await c.addInitScript(({lang, store, pend, E}) => { try {
      if (sessionStorage.getItem('l34.init')) return; sessionStorage.setItem('l34.init', '1');
      localStorage.setItem('rb.lang', lang); for (const [k, v] of Object.entries(store)) localStorage.setItem(k, v);
      if (pend) localStorage.setItem('rb.pending', JSON.stringify({email: E, type: 'signup', at: Date.now() - pend, from: 'signup', url: window.REELBOOK ? window.REELBOOK.hosted.url : 'https://xgarsygrkfnfyvxkcxdm.supabase.co'}));
    } catch {} }, {lang, store, pend: s.pending || 0, E});
    const p = await c.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    try {
      await p.goto(BASE + s.q); await p.waitForTimeout(400);
      await s.run(p); await p.waitForTimeout(250);
      await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
      const file = `${OUT}/${name}-${lang}.png`;
      await p.screenshot({path: file, fullPage: true});
      const r = await p.evaluate(() => ({over: document.documentElement.scrollWidth - innerWidth, view: ['setup', 'auth', 'welcome', 'home'].filter(v => !document.getElementById(v).hidden).join(','), lang: document.documentElement.lang, h1: [...document.querySelectorAll('#auth-title, #w-h1, #setup h1')].filter(e => e.offsetParent).map(e => e.textContent).join('|')}));
      console.log(name, lang, r.view, r.lang, JSON.stringify(r.h1), errs[0] || '');
      if (errs.length || r.over > 0) { console.log('  PROBLEM', errs[0] || '', 'overflow', r.over); bad++; }
    } catch (e) { console.log('FAIL', name, lang, String(e.message).split('\n')[0].slice(0, 170)); bad++; }
    await c.close();
  }
}
await b.close();
console.log('done, problems:', bad);
if (bad) process.exitCode = 1;
