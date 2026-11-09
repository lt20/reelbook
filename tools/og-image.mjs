// P8 R8: the link-preview picture (Open Graph / Twitter card), 1200 × 630, typographic.
// - No photo and no frame from any video: the wordmark, the line and three pills, on the
//   brand blue. Nothing here reads a network address: the fonts and the logo are the app's own files, inlined.
// - Two pictures: reelbook-og.png in French (the <head>'s og:locale is fr_FR, so it is the one og:image names) and
//   reelbook-og-en.png in English (ready for an English page; nothing names it yet).
// - Rendered by Playwright's Chromium (installed for the e2e screenshots: tools/e2e-setup.sh).
// usage: node tools/og-image.mjs [out dir, default app/assets/og]
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync, readFileSync, statSync} from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] || join(ROOT, 'app/assets/og'));
const W = 1200, H = 630;

// The copy, as in the <head> (og:title) and the landing hero (app/landing.js, keys h1 and hp.1–3).
export const COPY = {
  fr: {file: 'reelbook-og.png', line: 'Tes vidéos d’entraînement, en carnet qu’on suit vraiment', pills: ['Partage une vidéo', 'Elle devient une fiche', 'Entraîne-toi']},
  en: {file: 'reelbook-og-en.png', line: 'Your saved workout videos, turned into a training notebook', pills: ['Share a video', 'It becomes a sheet', 'Practise it']}
};

const font = f => 'data:font/woff2;base64,' + readFileSync(join(ROOT, 'app/fonts', f)).toString('base64');
// the logo's paths, recoloured for the blue ground: the R in white, its wedge stays coral; the word in white
const markPaths = readFileSync(join(ROOT, 'app/icons/reelbook-mark.svg'), 'utf8').match(/<path[^>]*\/>/g)
  .map(p => p.replace('fill="#1f4fa3"', 'fill="#ffffff"')).join('');
const wordSvg = readFileSync(join(ROOT, 'app/icons/reelbook-wordmark.svg'), 'utf8');
const wordBox = wordSvg.match(/viewBox="([^"]+)"/)[1];
const wordPaths = wordSvg.match(/<path[^>]*\/>/g).map(p => p.replace(/fill="#[0-9a-f]{6}"/i, 'fill="#ffffff"')).join('');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function page(lang) {
  const c = COPY[lang];
  const pills = c.pills.map((p, i) => (i ? '<span class="arr">→</span>' : '') + `<span class="pill"><b>${i + 1}</b>${esc(p)}</span>`).join('');
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
@font-face{font-family:"Barlow Condensed";font-weight:700;src:url(${font('barlow-condensed-700-latin.woff2')}) format("woff2")}
@font-face{font-family:"Source Sans 3";font-weight:400 700;src:url(${font('source-sans-3-latin.woff2')}) format("woff2")}
*{box-sizing:border-box;margin:0}
html,body{width:${W}px;height:${H}px;overflow:hidden}
body{background:#1f4fa3;color:#fff;font-family:"Source Sans 3",sans-serif;position:relative;padding:64px 72px 0}
.brand{display:flex;align-items:center;gap:18px}
.brand svg.m{width:68px;height:68px}
.brand svg.w{height:46px;width:auto}
h1{font:700 92px/.95 "Barlow Condensed",sans-serif;text-transform:uppercase;letter-spacing:-.01em;margin-top:44px;max-width:1000px}
.pills{position:absolute;left:72px;right:72px;bottom:66px;display:flex;align-items:center;gap:14px}
.pill{display:inline-flex;align-items:center;gap:12px;background:#fff;color:#1b1d1f;border-radius:999px;padding:0 26px 0 10px;height:64px;font-weight:700;font-size:28px;white-space:nowrap}
.pill b{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:50%;background:#c54b38;color:#fff;font-size:24px}
.arr{font-size:34px;font-weight:700;color:#fff}
.bar{position:absolute;left:0;right:0;bottom:0;height:14px;background:#c54b38}
</style></head><body>
<div class="brand"><svg class="m" viewBox="0 0 256 256">${markPaths}</svg><svg class="w" viewBox="${wordBox}">${wordPaths}</svg></div>
<h1>${esc(c.line)}</h1>
<div class="pills">${pills}</div>
<div class="bar"></div>
</body></html>`;
}

async function main() {
  const dir = process.env.REELBOOK_PLAYWRIGHT || join(process.env.REELBOOK_E2E_DIR || join(homedir(), '.cache', 'reelbook-e2e'), 'node_modules', 'playwright');
  let pw;
  try { pw = createRequire(import.meta.url)(dir); } catch { throw new Error(`Playwright not found in ${dir}: run tools/e2e-setup.sh (or set REELBOOK_PLAYWRIGHT)`); }
  mkdirSync(OUT, {recursive: true});
  const browser = await pw.chromium.launch();
  try {
    const ctx = await browser.newContext({viewport: {width: W, height: H}, deviceScaleFactor: 1});
    // nothing leaves the page: every resource is inlined, any request is a bug
    await ctx.route('**/*', r => r.abort());
    for (const lang of Object.keys(COPY)) {
      const p = await ctx.newPage();
      await p.setContent(page(lang), {waitUntil: 'load'});
      await p.evaluate(() => document.fonts.ready);
      const over = await p.evaluate(() => {
        const pills = document.querySelector('.pills').getBoundingClientRect(), h1 = document.querySelector('h1').getBoundingClientRect();
        return {pillsRight: pills.left + document.querySelector('.pills').scrollWidth, h1Bottom: h1.bottom, pillsTop: pills.top};
      });
      if (over.pillsRight > W - 72 + 1) throw new Error(`${lang}: the pills overflow (${over.pillsRight}px)`);
      if (over.h1Bottom > over.pillsTop - 24) throw new Error(`${lang}: the line runs into the pills`);
      const file = join(OUT, COPY[lang].file);
      await p.screenshot({path: file, type: 'png'});
      console.log(`${file} (${Math.round(statSync(file).size / 1024)} KB)`);
      await p.close();
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message || e); process.exitCode = 1; });
}
