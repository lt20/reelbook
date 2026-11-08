#!/usr/bin/env node
// shots.mjs — screenshots of the app in an iPhone 14 viewport, one fresh browser context per step.
//
//   node tests/e2e/shots.mjs --base http://127.0.0.1:8770/ --out <dir> [--dark] [--steps <file.json>] [--only <name>]
//                            [--browser webkit|chromium]
//
// Browser: WebKit by default (Safari's engine, as on the iPhone), --browser chromium for a cross-check.
// A browser not downloaded yet: tools/e2e-setup.sh installs both.
//
// Steps (default tests/e2e/steps/smoke.json): a JSON array of
//   {name, hash?, query?, viewport?, actions?: [...], full?, settle?, allow?: ["<regex>", …]}
// - name: the screenshot is <out>/<name>.png; hash / query: added to --base (« #strength », « noauth »);
// - actions, in order, each object with one verb:
//     {"click": "<selector>"}  {"fill": "<selector>", "value": "…"}  {"press": "Enter", "selector"?: "…"}
//     {"wait": 500 | "<selector>"}  {"scroll": "bottom" | "top" | <y px> | "<selector>"}
// - viewport: {width, height} instead of the iPhone 14's 390 × 664 (a wider window, or a short one standing for
//   the on-screen keyboard), the rest of the device kept;
// - full: full-page screenshot; settle: ms to wait after load (default 700);
// - allow: errors this step tolerates (regex on the error line), for a known app bug only, with
//   the reason in a `why` field next to it; they are listed under `tolerated` in report.json.
// Every step gets a new context (no localStorage, dialog or scroll leaks from the previous one).
// A step fails on a page error, a console error (a missing image or script included) or an action
// that cannot run. All steps run; <out>/report.json sums them up; exit 1 if any failed, 2 on usage.
// Playwright comes from tools/e2e-setup.sh (~/.cache/reelbook-e2e) or REELBOOK_PLAYWRIGHT.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// WebKit is Safari's engine, the one the app meets on an iPhone; Chromium stays for a quick cross-check.
export const BROWSERS = ['webkit', 'chromium'];

export function parseArgs(argv) {
  const o = { dark: false, steps: join(here, 'steps', 'smoke.json'), only: '', browser: 'webkit' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dark') o.dark = true;
    else if (['--base', '--out', '--steps', '--only', '--browser'].includes(a)) o[a.slice(2)] = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!o.base || !o.out) throw new Error('usage: shots.mjs --base <url> --out <dir> [--dark] [--steps <file.json>] [--only <name>] [--browser webkit|chromium]');
  if (!BROWSERS.includes(o.browser)) throw new Error(`--browser: ${BROWSERS.join(' or ')}, not ${JSON.stringify(o.browser)}`);
  return o;
}

export function loadPlaywright() {
  const dir = process.env.REELBOOK_PLAYWRIGHT || join(process.env.REELBOOK_E2E_DIR || join(homedir(), '.cache', 'reelbook-e2e'), 'node_modules', 'playwright');
  try {
    return createRequire(import.meta.url)(dir);
  } catch {
    throw new Error(`Playwright not found in ${dir}: run tools/e2e-setup.sh (or set REELBOOK_PLAYWRIGHT)`);
  }
}

// Launches WebKit or Chromium; a browser Playwright has not downloaded yet gets a message that says how to fix it.
export async function launchBrowser(pw, name) {
  try {
    return await pw[name].launch();
  } catch (e) {
    if (/Executable doesn't exist|browserType\.launch: .*(install|not found)/i.test(String(e.message))) {
      throw new Error(`Playwright's ${name} is not installed on this machine: run tools/e2e-setup.sh (installs WebKit and Chromium)${name === 'webkit' ? ', or pass --browser chromium' : ''}`);
    }
    throw e;
  }
}

export function stepUrl(base, step) {
  const u = new URL(base);
  if (step.query) u.search = String(step.query).replace(/^\?/, '');
  if (step.hash) u.hash = String(step.hash).replace(/^#/, '');
  return u.toString();
}

async function act(page, a) {
  if ('click' in a) return page.click(a.click, { timeout: 5000 });
  if ('fill' in a) return page.fill(a.fill, String(a.value ?? ''), { timeout: 5000 });
  if ('press' in a) return a.selector ? page.press(a.selector, a.press, { timeout: 5000 }) : page.keyboard.press(a.press);
  if ('wait' in a) {
    return typeof a.wait === 'number' ? page.waitForTimeout(a.wait) : page.waitForSelector(a.wait, { state: 'visible', timeout: 5000 });
  }
  if ('scroll' in a) {
    const s = a.scroll;
    if (s === 'bottom') return page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    if (s === 'top') return page.evaluate(() => window.scrollTo(0, 0));
    if (typeof s === 'number') return page.evaluate((y) => window.scrollTo(0, y), s);
    return page.locator(s).first().scrollIntoViewIfNeeded({ timeout: 5000 });
  }
  throw new Error(`unknown action: ${JSON.stringify(a)}`);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  let steps = JSON.parse(readFileSync(resolve(opts.steps), 'utf8'));
  if (!Array.isArray(steps)) throw new Error('the steps file must hold a JSON array');
  if (opts.only) steps = steps.filter((s) => s.name === opts.only);
  const names = new Set();
  for (const s of steps) {
    if (!s.name || !/^[\w.-]+$/.test(s.name)) throw new Error(`step name missing or not a file name: ${JSON.stringify(s.name)}`);
    if (names.has(s.name)) throw new Error(`duplicate step name: ${s.name}`);
    names.add(s.name);
  }
  const pw = loadPlaywright();
  const { devices } = pw;
  const browser = await launchBrowser(pw, opts.browser);
  const out = resolve(opts.out);
  mkdirSync(out, { recursive: true });
  const report = { base: opts.base, browser: opts.browser, dark: opts.dark, steps: [], ok: true };
  try {
    for (const step of steps) {
      const url = stepUrl(opts.base, step);
      const errors = [];
      const ctx = await browser.newContext({ ...devices['iPhone 14'], ...(step.viewport ? { viewport: step.viewport } : {}), colorScheme: opts.dark ? 'dark' : 'light' });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      // « Failed to load resource » in the console carries no URL: the response / requestfailed
      // listeners report the same failure with its URL instead.
      page.on('console', (m) => {
        if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
      });
      page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
      page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()} (${r.failure()?.errorText || '?'})`));
      const file = join(out, `${step.name}.png`);
      try {
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForTimeout(step.settle ?? 700);
        for (const a of step.actions || []) {
          await act(page, a);
          await page.waitForTimeout(250);
        }
        await page.screenshot({ path: file, fullPage: !!step.full });
      } catch (e) {
        errors.push(`action: ${String(e.message).split('\n')[0]}`);
      }
      await ctx.close();
      // `allow`: patterns of known errors this step tolerates (each one says why in the steps file).
      const allow = (step.allow || []).map((a) => new RegExp(a));
      const tolerated = errors.filter((e) => allow.some((re) => re.test(e)));
      errors.splice(0, errors.length, ...errors.filter((e) => !tolerated.includes(e)));
      const ok = errors.length === 0;
      report.ok &&= ok;
      report.steps.push({ name: step.name, url, ok, file, errors, tolerated });
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${step.name}${ok ? '' : `\n     ${errors.join('\n     ')}`}`);
    }
  } finally {
    await browser.close();
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(`${report.steps.filter((s) => s.ok).length}/${report.steps.length} steps ok (${opts.browser}, ${opts.dark ? 'dark' : 'light'}) → ${out}`);
  return report.ok && report.steps.length > 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.message || e); process.exitCode = 2; });
}
