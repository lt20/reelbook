#!/usr/bin/env node
// nav-check.mjs — browser checks of the app's navigation (L17, L23) on the preview, run by hand (not in CI).
//
//   node tests/e2e/nav-check.mjs --base http://127.0.0.1:8802/index.html [--browser webkit|chromium] [--out <dir>]
//                                [--only <check>]
//
// What a `vm` test cannot see (real history, real scrolling, real `window.confirm`), on the synthetic fixtures of
// tools/preview (notebook « strength », session « session-gainage-10-min », tags shoulders / band):
// - scroll-back-browser: on a notebook page scrolled down, open a sheet, browser Back → same scroll position;
// - scroll-back-button:  the same with the app's « ‹ Strength » button;
// - edit-prompt-back:    a session in Edit with a changed title, browser Back → « Discard your changes? »;
//                        Cancel keeps the edit (same page, title kept); OK leaves;
// - edit-prompt-button:  the same with the app's Back button; an Edit left unchanged leaves without asking;
// - facets-history:      two facets chosen one after the other, Back, Back, Forward, Forward → the hash, the chips
//                        and the results follow each step.
// Each check runs in a fresh iPhone 14 context and also fails on a page error or a console error. Exit 0 when all
// pass, 1 otherwise, 2 on usage. --out keeps a screenshot of each check's last screen (never inside the repo).
// Replaces the Playwright script L17 kept outside the repo (`check.cjs`, #47). Playwright: tools/e2e-setup.sh.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSERS, launchBrowser, loadPlaywright } from './shots.mjs';

const NOTEBOOK = 'strength';
const SESSION = 'session/session-gainage-10-min';
const T = 5000;

function parseArgs(argv) {
  const o = { browser: 'webkit', out: '', only: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--base', '--browser', '--out', '--only'].includes(a)) o[a.slice(2)] = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!o.base) throw new Error('usage: nav-check.mjs --base <url> [--browser webkit|chromium] [--out <dir>] [--only <check>]');
  if (!BROWSERS.includes(o.browser)) throw new Error(`--browser: ${BROWSERS.join(' or ')}, not ${JSON.stringify(o.browser)}`);
  return o;
}

const at = (base, hash) => { const u = new URL(base); u.hash = hash; return u.toString(); };
const hashOf = (page) => page.evaluate(() => decodeURIComponent(location.hash.replace(/^#/, '')));
const waitHash = (page, h) => page.waitForFunction((x) => decodeURIComponent(location.hash.replace(/^#/, '')) === x, h, { timeout: T });
const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));
function check(cond, msg) { if (!cond) throw new Error(msg); }

// A notebook page scrolled to its 5th group, a sheet opened from there, then `back` → the same position.
async function scrollBack(page, base, back) {
  await page.goto(at(base, ''), { waitUntil: 'load' });
  await page.waitForSelector('#portal', { timeout: T });
  await page.evaluate((h) => { location.hash = h; }, NOTEBOOK);
  await page.waitForSelector('#groups .group-row .card', { timeout: T });
  const sections = await page.locator('#groups section').count();
  check(sections >= 5, `the notebook shows ${sections} groups, 5 needed to scroll`);
  await page.locator('#groups section').nth(4).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(500);
  const before = await scrollY(page);
  check(before > 300, `notebook page not scrolled (scrollY ${before})`);
  await page.locator('#groups section').nth(4).locator('.card').first().click({ timeout: T });
  await page.waitForFunction((nb) => location.hash.slice(1) !== nb, NOTEBOOK, { timeout: T });
  await page.waitForSelector('#view h1', { state: 'visible', timeout: T });
  await back(page);
  await waitHash(page, NOTEBOOK);
  await page.waitForSelector('#groups .group-row .card', { state: 'visible', timeout: T });
  await page.waitForTimeout(500);
  const after = await scrollY(page);
  check(Math.abs(after - before) <= 2, `scroll not restored: ${before} before the sheet, ${after} after Back`);
  return `scrollY ${before} → ${after}`;
}

// A session opened from home, put in Edit, its title changed; `back` asks, Cancel keeps it, OK leaves.
async function editPrompt(page, base, back, { untouchedFirst = false } = {}) {
  const dialogs = [];
  let answer = 'dismiss';
  page.on('dialog', (d) => { dialogs.push(d.message()); d[answer]().catch(() => {}); });
  const openEdit = async () => {
    await page.goto(at(base, ''), { waitUntil: 'load' });
    await page.waitForSelector('#portal', { timeout: T });
    await page.evaluate((h) => { location.hash = h; }, SESSION);
    await page.waitForSelector('#view h1', { state: 'visible', timeout: T });
    await page.click('#nav-more', { timeout: T });
    await page.click('#nav-actions #ed-open', { timeout: T });
    await page.waitForSelector('#ed-title', { state: 'visible', timeout: T });
  };
  const notes = [];
  if (untouchedFirst) {
    await openEdit();
    await back(page);
    await page.waitForFunction((s) => decodeURIComponent(location.hash.slice(1)) !== s, SESSION, { timeout: T });
    check(dialogs.length === 0, `an unchanged edit asked: ${JSON.stringify(dialogs)}`);
    notes.push('unchanged edit leaves without asking');
  }
  await openEdit();
  const title = (await page.inputValue('#ed-title')) + ' (edited)';
  await page.fill('#ed-title', title);
  await back(page);
  await page.waitForTimeout(600);
  check(dialogs.length === 1, `expected one prompt on leaving, got ${JSON.stringify(dialogs)}`);
  check(dialogs[0] === 'Discard your changes?', `prompt text: ${JSON.stringify(dialogs[0])}`);
  await waitHash(page, SESSION);
  check(await page.isVisible('#ed-title'), 'Cancel: the edit form is gone');
  check((await page.inputValue('#ed-title')) === title, 'Cancel: the changed title is lost');
  notes.push('Cancel keeps the edit');
  answer = 'accept';
  await back(page);
  await page.waitForFunction((s) => decodeURIComponent(location.hash.slice(1)) !== s, SESSION, { timeout: T });
  check(dialogs.length === 2, `expected a second prompt, got ${JSON.stringify(dialogs)}`);
  notes.push(`OK leaves (→ #${await hashOf(page)})`);
  return notes.join('; ');
}

// Chips: which facets are on, and which sheets the search shows (their links, in order; visible cards only).
const facetState = (page) => page.evaluate(() => ({
  hash: decodeURIComponent(location.hash.replace(/^#/, '')),
  zone: document.getElementById('facet-zone').classList.contains('on'),
  gear: document.getElementById('facet-gear').classList.contains('on'),
  results: [...document.querySelectorAll('#results .card')].filter((c) => c.getClientRects().length).map((c) => c.getAttribute('href')),
}));
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

async function facetsHistory(page, base) {
  await page.goto(at(base, ''), { waitUntil: 'load' });
  await page.waitForSelector('#facets button', { state: 'visible', timeout: T });
  const pick = async (chip, value, hash) => {
    await page.click(`#facet-${chip}`, { timeout: T });
    await page.click(`[data-facet-value="${value}"]`, { timeout: T });
    await page.click('#facet-done', { timeout: T });
    await waitHash(page, hash);
    await page.waitForTimeout(400);
  };
  const ONE = 'search?zone=shoulders';
  const TWO = 'search?zone=shoulders&gear=band';
  const home = await facetState(page);
  await pick('zone', 'shoulders', ONE);
  const one = await facetState(page);
  await pick('gear', 'band', TWO);
  const two = await facetState(page);
  check(one.zone && !one.gear && one.results.length > 0, `after shoulders: ${JSON.stringify(one)}`);
  check(two.zone && two.gear && two.results.length > 0 && two.results.length < one.results.length
    && two.results.every((h) => one.results.includes(h)), `after band: ${JSON.stringify(two)}`);
  const same = (a, b, step) => check(a.hash === b.hash && a.zone === b.zone && a.gear === b.gear && sameList(a.results, b.results),
    `${step}: ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
  const move = async (dir, want, step) => {
    await (dir === 'back' ? page.goBack() : page.goForward());
    await waitHash(page, want.hash);
    await page.waitForTimeout(400);
    same(await facetState(page), want, step);
  };
  await move('back', one, 'Back once');
  await move('back', home, 'Back twice');
  await move('forward', one, 'Forward once');
  await move('forward', two, 'Forward twice');
  return `results ${one.results.length} → ${two.results.length} sheets, Back ×2 / Forward ×2 show the same sheets`;
}

const browserBack = (page) => page.goBack();
const appBack = (page) => page.click('#nav-back', { timeout: T });

const CHECKS = {
  'scroll-back-browser': (page, base) => scrollBack(page, base, browserBack),
  'scroll-back-button': (page, base) => scrollBack(page, base, appBack),
  'edit-prompt-back': (page, base) => editPrompt(page, base, browserBack),
  'edit-prompt-button': (page, base) => editPrompt(page, base, appBack, { untouchedFirst: true }),
  'facets-history': facetsHistory,
};

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  const names = opts.only ? [opts.only] : Object.keys(CHECKS);
  if (!names.every((n) => n in CHECKS)) { console.error(`--only: one of ${Object.keys(CHECKS).join(', ')}`); return 2; }
  const pw = loadPlaywright();
  const browser = await launchBrowser(pw, opts.browser);
  const out = opts.out ? resolve(opts.out) : '';
  if (out) mkdirSync(out, { recursive: true });
  let failed = 0;
  try {
    for (const name of names) {
      const errors = [];
      const ctx = await browser.newContext({ ...pw.devices['iPhone 14'] });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
      // the sheet header photo is first requested as img/thumb.jpg (known app bug, tolerated by the steps files too)
      page.on('response', (r) => { if (r.status() >= 400 && !/\/img\/thumb\.jpg$/.test(r.url())) errors.push(`http ${r.status()}: ${r.url()}`); });
      // as shots.mjs, except a photo the browser cancels itself because the page moved on (WebKit « cancelled »,
      // Chromium « net::ERR_ABORTED »): opening a sheet mid-scroll leaves the notebook's thumbnails unfinished.
      page.on('requestfailed', (r) => {
        const why = r.failure()?.errorText || '?';
        if (r.resourceType() === 'image' && /^(cancelled|net::ERR_ABORTED)$/i.test(why)) return;
        errors.push(`request failed: ${r.url()} (${why})`);
      });
      let detail = '';
      try {
        detail = await CHECKS[name](page, opts.base);
      } catch (e) {
        errors.push(String(e.message).split('\n')[0]);
      }
      if (out) await page.screenshot({ path: join(out, `${name}.png`) }).catch(() => {});
      await ctx.close();
      if (errors.length) failed++;
      console.log(errors.length ? `FAIL ${name}\n     ${errors.join('\n     ')}` : `ok   ${name} (${detail})`);
    }
  } finally {
    await browser.close();
  }
  console.log(`${names.length - failed}/${names.length} navigation checks ok (${opts.browser})`);
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.message || e); process.exitCode = 2; });
}
