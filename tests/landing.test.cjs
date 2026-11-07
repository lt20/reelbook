// L30, L36: the bilingual landing (app/landing.js, mockup v3) and the FR / EN screens of a newcomer. landing.js runs
// here in a `vm` with a small fake DOM: elements by id, and the nodes of index.html it looks up by selector.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {app, html, ownUrl, ownKey} = require('./harness.cjs');

const ROOT = path.join(__dirname, '..');
const landingJs = fs.readFileSync(path.join(ROOT, 'app/landing.js'), 'utf8');
const attrsOf = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
const intro = html.slice(html.indexOf('<div id="intro"'), html.indexOf('id="auth-title"'));

function stub(attrs = {}) {
  const el = {
    attrs: {...attrs}, innerHTML: '', textContent: '', hidden: 'hidden' in attrs, value: '', style: {}, listeners: {}, classes: new Set(),
    classList: {toggle(c, on) { if (on) el.classes.add(c); else el.classes.delete(c); }},
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelector(sel) { return sel === 'i' ? (this.bar = this.bar || stub()) : null; }
  };
  return el;
}

// Runs landing.js. `language`: navigator.language; `stored`: localStorage entries.
function landing({language, stored = {}} = {}) {
  const storage = new Map(Object.entries(stored));
  const ids = new Map(), lists = new Map();
  const byId = id => { if (!ids.has(id)) ids.set(id, stub({id})); return ids.get(id); };
  // the nodes landing.js looks up by selector, from the real markup (an element with an id is the same object)
  const fromHtml = re => [...html.matchAll(re)].map(m => {
    const a = attrsOf(m[0]), hidden = /\shidden(?=[\s>/])/.test(m[0]);
    return a.id ? Object.assign(byId(a.id), {attrs: {...byId(a.id).attrs, ...a}, hidden}) : Object.assign(stub(a), {hidden});
  });
  for (const m of intro.matchAll(/<[a-z][\w]*\b[^>]*\bid="([^"]+)"[^>]*>/g)) fromHtml(new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
  byId('intro').hidden = false;
  lists.set('[data-k]', fromHtml(/<[a-z][\w]*\b[^>]*\bdata-k="[^"]+"[^>]*>/g));
  lists.set('[data-ka]', fromHtml(/<[a-z][\w]*\b[^>]*\bdata-ka="[^"]+"[^>]*>/g));
  lists.set('#intro [data-k="cta"]', lists.get('[data-k]').filter(el => el.attrs['data-k'] === 'cta'));
  lists.set('#intro .lp-lang button', fromHtml(/<button\b[^>]*\bdata-lang="[^"]+"[^>]*>/g));
  lists.set('#intro .lp-ex button', fromHtml(/<button\b[^>]*\bdata-ex="[^"]+"[^>]*>/g));
  lists.set('#intro .lp-os button', fromHtml(/<button\b[^>]*\bdata-os="[^"]+"[^>]*>/g));
  lists.set('#intro [data-os-pane]', fromHtml(/<[a-z]+\b[^>]*\bdata-os-pane="[^"]+"[^>]*>/g));
  const pres = lists.get('#intro [data-os-pane]').filter(el => el.attrs.id && /^lp-line/.test(el.attrs.id));
  for (const p of pres) p.textContent = '\n' + html.match(new RegExp(`<pre\\b[^>]*id="${p.attrs.id}"[^>]*>([^<]*)</pre>`))[1] + '\n';
  lists.set('#intro pre[data-os-pane]', pres);
  const documentElement = {lang: 'en', scrollHeight: 0};
  const document = {getElementById: byId, querySelectorAll: sel => lists.get(sel) || [], documentElement};
  const window = {
    navigator: {language},
    localStorage: {getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k)},
    addEventListener() {}, scrollTo() {}
  };
  const timers = [];
  vm.runInNewContext(landingJs, {window, document, console, setTimeout: fn => timers.push(fn)});
  const click = (el, target) => el.listeners.click({preventDefault() {}, target: target || el, currentTarget: el});
  return {RBL: window.RBL, byId, lists, storage, documentElement, click, window, document, pre: pres[0], pres, timers};
}
const dk = (page, k) => page.lists.get('[data-k]').find(el => el.attrs['data-k'] === k);
const imgs = s => [...s.matchAll(/<img src="([^"]+)"/g)].map(m => m[1]);

test('L30 — language: saved choice, else navigator.language, else English', () => {
  const {pickLang} = landing().RBL;
  assert.equal(pickLang(null, 'fr-CH'), 'fr');
  assert.equal(pickLang(null, 'fr'), 'fr');
  assert.equal(pickLang(null, 'FR_be'), 'fr');
  assert.equal(pickLang(null, 'en-GB'), 'en');
  assert.equal(pickLang(null, 'de-CH'), 'en');
  assert.equal(pickLang(null, undefined), 'en');
  assert.equal(pickLang('en', 'fr-FR'), 'en', 'the saved choice wins');
  assert.equal(pickLang('fr', 'en-US'), 'fr');
  assert.equal(pickLang('de', 'fr-FR'), 'fr', 'an unknown saved value is ignored');
});

test('L30 — a French browser gets the French landing; the choice is saved and <html lang> follows', () => {
  const page = landing({language: 'fr-FR'});
  assert.equal(page.RBL.lang, 'fr');
  assert.equal(page.documentElement.lang, 'fr');
  const h1 = page.lists.get('[data-k]').find(el => el.attrs['data-k'] === 'h1');
  assert.match(h1.innerHTML, /^Un <span class="lp-slash">\/skill<\/span> Claude Code/);
  const heard = [];
  page.RBL.onChange(l => heard.push(l));
  const en = page.lists.get('#intro .lp-lang button').find(b => b.attrs['data-lang'] === 'en');
  page.click(en);
  assert.equal(page.RBL.lang, 'en');
  assert.equal(page.documentElement.lang, 'en');
  assert.equal(page.storage.get('rb.lang'), 'en', 'saved on the device, not per user');
  assert.match(h1.innerHTML, /^A Claude Code <span class="lp-slash">\/skill<\/span>/);
  assert.equal(en.attrs['aria-pressed'], 'true');
  assert.deepEqual(heard, ['en'], 'the app script relabels what it writes');
  // next visit: the saved choice beats the browser's language
  assert.equal(landing({language: 'fr-FR', stored: {'rb.lang': 'en'}}).RBL.lang, 'en');
  assert.equal(landing({language: 'en-US'}).RBL.lang, 'en');
  assert.equal(landing({}).RBL.lang, 'en', 'no language at all: English');
});

test('L30 — every data-k / data-ka key is in both dictionaries, and the HTML default is the English one', () => {
  const {DICT} = landing().RBL;
  const keys = [...html.matchAll(/\bdata-k="([^"]+)"/g)].map(m => m[1]);
  const aria = [...html.matchAll(/\bdata-ka="([^"]+)"/g)].map(m => m[1]);
  assert.ok(keys.length > 80, `${keys.length} data-k keys`);
  for (const k of [...keys, ...aria]) {
    assert.equal(typeof DICT.fr[k], 'string', `fr: ${k}`);
    assert.equal(typeof DICT.en[k], 'string', `en: ${k}`);
  }
  for (const m of html.matchAll(/<(\w+)\b[^>]*\bdata-k="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) assert.equal(m[3], DICT.en[m[2]], `the English default of ${m[2]}`);
  for (const m of html.matchAll(/aria-label="([^"]*)" data-ka="([^"]+)"/g)) assert.equal(m[1], DICT.en[m[2]], `aria ${m[2]}`);
  // the app script's own strings: T('key', 'English') matches the English dictionary
  const calls = [...html.matchAll(/\bT\('([\w.]+)', '([^']*)'\)/g)];
  assert.ok(calls.length >= 15, `${calls.length} T() calls`);
  for (const [, k, en] of calls) { assert.equal(DICT.en[k], en, `T(${k})`); assert.ok(DICT.fr[k], `fr: ${k}`); }
  assert.ok(DICT.fr['s.blurb'] && !('s.blurb' in DICT.en), 'English keeps the blurb of config.js');
});

test('L30 — the app asks beta_seats() on the hosted backend, once, and hides the line when it cannot answer', async () => {
  const fake = () => { const got = []; return {got, RBL: {t: () => null, onChange() {}, seats: d => got.push(d)}}; };
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const ok = fake();
  let asked = 0;
  await app({win: {RBL: ok.RBL}, rpc: async name => { asked++; return name === 'beta_seats' ? {data: {taken: 14, total: 50, open: true}, error: null} : {data: null, error: {code: 'PGRST202'}}; }});
  await flush();
  assert.equal(asked, 1);
  assert.deepEqual(ok.got, [{taken: 14, total: 50, open: true}]);
  for (const rpc of [null, async () => ({data: null, error: {code: 'PGRST202', message: 'Could not find the function public.beta_seats'}}), async () => { throw new Error('offline'); }, async () => ({data: null, error: null})]) {
    const f = fake();
    await app({win: {RBL: f.RBL}, rpc});
    await flush();
    assert.deepEqual(f.got, [null], 'counter hidden, no visible error');
  }
  // a device that has signed in before goes straight to Sign in: no landing, no call
  const back = fake(); let calls = 0;
  await app({win: {RBL: back.RBL}, remembered: {mode: 'hosted'}, rpc: async () => { calls++; return {data: null, error: null}; }});
  await flush();
  assert.equal(calls, 0);
});

test('L30 — the service worker shell has landing.js at the version index.html loads, under a new cache VERSION', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'app/sw.js'), 'utf8');
  const v = html.match(/<script src="landing\.js\?v=(\d+)"><\/script>/);
  assert.ok(v, 'index.html loads landing.js before the app script');
  assert.ok(html.indexOf('landing.js?v=') < html.indexOf('<script>\n'));
  assert.ok(sw.includes(`'./landing.js?v=${v[1]}'`));
  assert.doesNotMatch(sw, /assets\//, 'the pictures stay out of the shell');
  assert.ok(Number(sw.match(/const VERSION = 'rb-shell-(\d+)'/)[1]) >= 42, 'cache VERSION bumped (L36)');
});

const AUTH_ERRORS = {
  in: [
    [{code: 'invalid_credentials', status: 400, message: 'Invalid login credentials'}, 'E-mail ou mot de passe incorrect.', 'Wrong email or password.'],
    [{status: 400, message: 'Invalid login credentials'}, 'E-mail ou mot de passe incorrect.', 'Wrong email or password.'],
    [{code: 'email_not_confirmed', status: 400, message: 'Email not confirmed'}, 'Confirme d’abord ton e-mail avec le lien reçu dans ta boîte, puis connecte-toi.', 'Confirm your email first with the link in your inbox, then sign in.'],
    [{code: 'over_request_rate_limit', status: 429, message: 'Request rate limit reached'}, 'Trop d’essais : réessaie dans quelques minutes.', 'Too many attempts: try again in a few minutes.'],
    [{name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch'}, 'Le serveur n’a pas répondu : vérifie ta connexion et réessaie.', 'The server did not answer: check your connection and try again.'],
    [{code: 'some_new_code', status: 400, message: 'Some new English message'}, 'Connexion impossible.', 'Could not sign in.']
  ],
  up: [
    [{code: 'user_already_exists', status: 422, message: 'User already registered'}, 'Un compte existe déjà avec cet e-mail : connecte-toi plutôt.', 'An account already exists with this email: sign in instead.'],
    [{code: 'weak_password', status: 422, message: 'Password should be at least 6 characters.'}, 'Ce mot de passe est trop faible : choisis-en un plus long.', 'That password is too weak: choose a longer one.'],
    [{code: 'email_address_invalid', status: 400, message: 'Email address "x@y" is invalid'}, 'Cette adresse e-mail n’est pas valide.', 'That email address is not valid.'],
    [{code: 'over_email_send_rate_limit', status: 429, message: 'email rate limit exceeded'}, 'Trop d’essais : réessaie dans quelques minutes.', 'Too many attempts: try again in a few minutes.'],
    [{code: 'signup_disabled', status: 422, message: 'Signups not allowed for this instance'}, 'Ce serveur ne prend pas de nouveaux comptes.', 'This server does not take new accounts.'],
    [{code: 'unexpected_failure', status: 400, message: 'Some new English message'}, 'Impossible de créer le compte.', 'Could not create the account.']
  ]
};

test('L30 — Supabase auth errors are said in the page language: known codes mapped, anything else a generic line', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    for (const lang of ['fr', 'en']) {
      for (const authMode of ['in', 'up']) {
        for (const [error, fr, en] of AUTH_ERRORS[authMode]) {
          // FR: the real dictionary of landing.js; EN: the app's own English (no landing loaded)
          const page = await app(lang === 'fr' ? {win: {RBL: landing({language: 'fr'}).RBL}} : {});
          if (authMode === 'up') await page.fire('intro-signup');
          const client = page.clients.at(-1);
          // a network failure rejects (supabase-js throws AuthRetryableFetchError); the others answer {error}
          const fail = error.status === 0 ? async () => { throw Object.assign(new Error(error.message), error); } : async () => ({data: {}, error});
          if (authMode === 'up') client.auth.signUp = fail; else client.auth.signInWithPassword = fail;
          page.element('a-email').value = 'user@example.test';
          page.element('a-pass').value = 'example-password';
          await page.fire('auth-form', 'submit');
          const err = page.element('a-err'), what = `${lang} ${authMode} ${error.code || error.message}`;
          assert.equal(err.hidden, false, `${what}: shown`);
          assert.equal(err.textContent, lang === 'fr' ? fr : en, what);
          if (lang === 'fr') assert.notEqual(err.textContent, error.message, 'never Supabase’s English on the French form');
        }
      }
    }
  } finally { console.warn = warn; }
});

test('L30 — installation « On my own Supabase » + « Create my notebook »: the project form, then the sign-up goes on', async () => {
  const page = await app();
  assert.equal(page.element('intro').hidden, false, 'a new visitor is on the landing');
  page.element('lp-host-own').checked = true;
  await page.fire('intro-signup');
  assert.equal(page.element('auth').hidden, true, 'the landing, inside #auth, is gone');
  assert.equal(page.element('setup').hidden, false, 'the setup screen');
  assert.equal(page.element('own-form').hidden, false, 'with the project form open');
  assert.equal(page.storage.get('rb.backend'), undefined);
  page.element('own-url').value = ownUrl;
  page.element('own-key').value = ownKey;
  await page.fire('own-form', 'submit');
  assert.equal(page.clients.at(-1).url, ownUrl);
  assert.equal(page.element('auth').hidden, false);
  assert.equal(page.element('auth-title').textContent, 'Create an account', 'the sign-up goes on, on that project');
  assert.equal(page.storage.get('rb.backend'), undefined, 'the project is kept once the account exists');
  page.element('a-email').value = 'new@example.test';
  page.element('a-pass').value = 'example-password';
  await page.fire('auth-form', 'submit');
  assert.deepEqual(page.clients.at(-1).calls.map(c => c[0]), ['up']);
  assert.deepEqual(JSON.parse(page.storage.get('rb.backend')), {mode: 'own', url: ownUrl, key: ownKey});
});

test('L30 — « Copy the line »: copied, or else selected with a message to copy it by hand', async () => {
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const run = async (clipboard, {copyCommand = false} = {}) => {
    const page = landing({language: 'fr'});
    if (clipboard !== undefined) page.window.navigator.clipboard = clipboard;
    const selected = [];
    page.document.createRange = () => ({selectNodeContents: node => selected.push(node)});
    page.window.getSelection = () => ({removeAllRanges() {}, addRange() {}});
    page.document.execCommand = cmd => cmd === 'copy' && copyCommand;
    const button = page.byId('lp-copy'), msg = page.byId('lp-copyMsg');
    page.click(button);
    await flush();
    return {page, button, msg, selected};
  };
  let wrote = null;
  const ok = await run({writeText: async s => { wrote = s; }});
  assert.equal(wrote, 'curl -fsSL https://lt20.github.io/reelbook/install.sh | bash');
  assert.equal(ok.button.textContent, 'Copiée');
  assert.equal(ok.msg.hidden, true);
  ok.page.timers.forEach(fn => fn());
  assert.equal(ok.button.textContent, ok.page.RBL.t('i2.copy'), 'the label comes back');
  const hand = 'La copie n’a pas marché : la ligne est sélectionnée, copie-la à la main (⌘C ou Ctrl+C).';
  for (const [what, clipboard] of [['no clipboard API', undefined], ['writing refused', {writeText: async () => { throw new Error('NotAllowedError'); }}], ['writeText missing', {}]]) {
    const r = await run(clipboard);
    assert.equal(r.msg.hidden, false, `${what}: a visible message`);
    assert.equal(r.msg.textContent, hand, what);
    assert.deepEqual(r.selected, [r.page.pre], `${what}: the line is selected`);
    assert.notEqual(r.button.textContent, 'Copiée');
  }
  const cmd = await run({writeText: async () => { throw new Error('NotAllowedError'); }}, {copyCommand: true});
  assert.equal(cmd.button.textContent, 'Copiée', 'the page copy command copied it');
  assert.equal(cmd.msg.hidden, true);
  assert.match(html, /<p class="lp-copy-msg" id="lp-copyMsg" role="status" hidden><\/p>/);
  assert.match(html, /#intro pre\{[^}]*user-select:all/, 'one tap selects the whole line');
});

test('L30 — step 2 on « On my own Supabase »: no hosted line to copy, the line comes after sign-up', async () => {
  const page = await app();
  const line = page.element('lp-lines'), copy = page.element('lp-lines'), own = page.element('lp-ownLine'); // L36: both systems' lines, the copy button and the script links
  assert.equal(line.hidden, false); assert.equal(copy.hidden, false); assert.equal(own.hidden, true);
  page.element('lp-host-own').checked = true;
  await page.fire('lp-host-own', 'change');
  assert.equal(line.hidden, true, 'the hosted line, which would link the skill to the hosted backend, is gone');
  assert.equal(copy.hidden, true);
  assert.equal(own.hidden, false);
  page.element('lp-host-own').checked = false; page.element('lp-host-hosted').checked = true;
  await page.fire('lp-host-hosted', 'change');
  assert.equal(line.hidden, false); assert.equal(own.hidden, true);
  assert.match(html, /<pre data-os-pane="unix" id="lp-line">curl -fsSL https:\/\/lt20\.github\.io\/reelbook\/install\.sh \| bash<\/pre>/);
});

test('L30 — no hosted backend in config.js: the landing offers « On my own Supabase » only, and its button opens the project form', async () => {
  const page = await app({win: {REELBOOK: {library: [], hosted: {name: '', url: '', anonKey: ''}, repo: 'https://github.com/lt20/reelbook'}}});
  assert.equal(page.element('lp-host-hosted-opt').hidden, true, '« With Reelbook » is not offered');
  assert.equal(page.element('lp-host-own').checked, true);
  assert.equal(page.element('lp-lines').hidden, true);
  assert.equal(page.element('lp-ownLine').hidden, false);
  page.element('lp-host-own').checked = false; // even with the radio state lost, the only path is the own project
  await page.fire('intro-signup');
  assert.equal(page.element('setup').hidden, false);
  assert.equal(page.element('own-form').hidden, false, 'the project form is open');
  assert.match(html, /#intro \[hidden\]\{display:none!important\}/, 'the grid option really hides');
});

test('L30 — <html lang>: the landing language on the screens it translates, English on the others', async () => {
  const docEl = {lang: 'en'};
  const fr = landing({language: 'fr'}).RBL;
  const page = await app({win: {RBL: fr}, docEl});
  assert.equal(docEl.lang, 'fr', 'auth (the landing) in French');
  await page.fire('intro-signup');
  assert.equal(page.element('auth').hidden, false);
  assert.equal(docEl.lang, 'fr', 'the sign-up form is translated');
  const signedIn = await app({win: {RBL: landing({language: 'fr'}).RBL}, docEl, remembered: {mode: 'hosted'}, sessions: {'https://hosted.example.test': {id: 'u1', email: 'user@example.test'}}});
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(signedIn.element('home').hidden, false, 'signed in: the notebooks');
  assert.equal(docEl.lang, 'en', 'the notebooks are English only');
  const noLanding = {lang: 'fr'};
  await app({docEl: noLanding});
  assert.equal(noLanding.lang, 'en', 'without landing.js, English');
});

test('L36 — the beta follows beta_seats(): open without an answer, the count with one, the waiting list at the limit', () => {
  const page = landing({language: 'fr'});
  const line = page.byId('lp-betaLine'), bar = page.byId('lp-seatsBar'), seat = page.byId('lp-seatline');
  const card = page.byId('lp-host-full'), hostedOpt = page.byId('lp-host-hosted-opt'), hosted = page.byId('lp-host-hosted');
  const cta = page.byId('intro-signup'), ctas = page.lists.get('#intro [data-k="cta"]');
  hosted.checked = true;
  const open = () => {
    assert.equal(card.hidden, true, 'no waiting list'); assert.equal(cta.hidden, false);
    assert.equal(cta.textContent, 'Créer mon carnet'); assert.ok(ctas.length >= 2 && ctas.every(b => b.textContent === 'Créer mon carnet'));
  };
  assert.equal(line.textContent, 'Gratuit pendant la bêta'); assert.equal(bar.hidden, true); assert.equal(seat.hidden, true); open();
  for (const answer of [null, undefined, {}, {taken: null, total: 50}, {taken: 3, total: 0}, 'x', []]) {
    assert.equal(page.RBL.seats(answer), false);
    assert.equal(line.textContent, 'Gratuit pendant la bêta', `no count for ${JSON.stringify(answer)}`);
    assert.ok(bar.hidden && seat.hidden); open();
  }
  assert.equal(page.RBL.seats({taken: 14, total: 50, open: true}), true);
  assert.equal(line.textContent, 'Gratuit pendant la bêta · 14 places prises sur 50');
  assert.equal(seat.hidden, false); assert.equal(seat.textContent, '14 places prises sur 50');
  assert.equal(bar.hidden, false); assert.equal(bar.bar.style.width, '28%'); open();
  page.RBL.setLang('en');
  assert.equal(line.textContent, 'Free during the beta · 14 of 50 spots taken');
  assert.equal(seat.textContent, '14 of 50 spots taken');
  // at the limit (or closed): the waiting-list card, « On my own Supabase » the way in, the buttons say so
  for (const full of [{taken: 50, total: 50, open: true}, [{taken: 61, total: 50}], {taken: 3, total: 50, open: false}]) {
    const p = landing({language: 'fr'}), h = p.byId('lp-host-hosted'), own = p.byId('lp-host-own'), c = p.byId('intro-signup');
    h.checked = true;
    assert.equal(p.RBL.seats(full), true);
    assert.equal(p.RBL.full, true);
    assert.equal(p.byId('lp-betaLine').textContent, 'Bêta complète · inscris-toi sur la liste d’attente');
    assert.equal(p.byId('lp-wl').hidden, false, 'the form'); assert.equal(p.byId('lp-wlP').hidden, false);
    assert.equal(p.byId('lp-host-full').hidden, false); assert.equal(p.byId('lp-host-hosted-opt').hidden, true);
    assert.equal(h.checked, false, 'the hosted option is no longer picked');
    assert.equal(own.checked, true, '« Sur mon Supabase » is the option picked');
    assert.equal(c.textContent, 'Connecter mon Supabase'); assert.equal(c.hidden, false);
    assert.ok(p.lists.get('#intro [data-k="cta"]').every(b => b.textContent === 'Rejoindre la liste d’attente'), 'the buttons lead to step 1');
    assert.ok(p.byId('lp-installList').classes.has('lp-full'));
  }
  const p = landing({language: 'en'}); p.RBL.seats({taken: 50, total: 50});
  assert.equal(p.byId('lp-wlH').textContent, 'Beta full: 50 of 50 spots taken'); assert.equal(p.byId('lp-lockN').textContent, '50');
  assert.equal(p.byId('lp-betaLine').textContent, 'Beta full · join the waiting list');
  assert.match(landingJs, /\n  const WAITLIST = true;\n/);
  assert.equal(p.RBL.t('cta.full'), 'Join the waiting list');
  assert.equal(p.byId('intro-signup').textContent, 'Connect my Supabase');
  // nothing in the markup says a number of seats, and the visitor has no switch
  assert.doesNotMatch(intro.replace(/<b data-k="wl.h"[^>]*>[^<]*<\/b>|id="lp-lockN"[^>]*>50</g, ''), /\b(14|50) (places|of|sur)\b/);
  assert.doesNotMatch(landingJs + intro, /[?&]places=|data-seats-toggle/);
  // the waiting list has no table yet (L31): its button is visible and inactive
  assert.match(intro, /<button class="lp-btn" type="submit" id="lp-wl-go" data-k="wl.cta" disabled aria-disabled="true">/);
  // L31: a seat freed again gives the hosted option back; closed: the heading without a count of seats not taken
  const q = landing({language: 'fr'}); q.byId('lp-host-hosted').checked = true;
  q.RBL.seats({taken: 50, total: 50});
  assert.equal(q.byId('lp-wlH').textContent, 'Bêta complète : 50 places sur 50 prises');
  q.RBL.seats({taken: 49, total: 50, open: true});
  assert.equal(q.byId('lp-host-hosted').checked, true); assert.equal(q.byId('lp-host-own').checked, false); assert.equal(q.byId('lp-host-hosted-opt').hidden, false);
  assert.equal(q.byId('lp-host-full').hidden, true);
  q.RBL.seats({taken: 3, total: 50, open: false});
  assert.equal(q.byId('lp-wlH').textContent, 'Bêta complète');
  // the coordinator's wording, and the consent text of decision 20, word for word
  const {DICT} = q.RBL;
  assert.equal(DICT.fr['wl.p'], 'Aucun compte n’est créé ici : laisse ton prénom et ton e-mail, on te prévient dès qu’une place se libère.');
  assert.equal(DICT.fr['wl.ok.h'], 'C’est noté'); assert.equal(DICT.fr['wl.ok'], 'C’est noté : on t’écrit dès qu’une place se libère.');
  assert.equal(DICT.en['wl.ok.h'], 'You’re on the list'); assert.equal(DICT.en['wl.ok'], 'You’re on the list. We’ll email you as soon as a spot opens.');
  assert.equal(DICT.fr['wl.c'], 'J’accepte que Reelbook garde mon prénom et mon e-mail pour me prévenir d’une place libre, et rien d’autre. Effacés à mon inscription ou sur simple demande.');
  assert.equal(DICT.en['wl.c'], 'I agree that Reelbook keeps my first name and email to tell me when a spot opens, and for nothing else. Deleted when I sign up or whenever I ask.');
});

test('L36 — five examples: each step has its frame, its dot and its words, from the example\'s data', () => {
  const page = landing({language: 'fr', stored: {'rb.landing.ex': 'snow'}});
  assert.deepEqual([...page.RBL.examples], ['mma', 'dance', 'stretch', 'snow', 'hiit']);
  assert.equal(page.RBL.example, 'snow', 'the saved choice');
  assert.deepEqual(page.lists.get('#intro .lp-ex button').map(b => b.attrs['data-ex']), [...page.RBL.examples], 'one button per example');
  for (const x of page.RBL.examples) {
    page.RBL.setExample(x);
    assert.equal(page.storage.get('rb.landing.ex'), x);
    const shot = page.byId('lp-shot').innerHTML, dots = page.byId('lp-thumbs').innerHTML;
    const frames = (shot.match(/<div role="img"/g) || []).length, nDots = (dots.match(/<button /g) || []).length;
    assert.ok(frames >= 2, `${x}: frames`);
    assert.equal(nDots, frames, `${x}: as many dots as frames`);
    assert.equal((page.byId('lp-seq').innerHTML.match(/data-frame=/g) || []).length, frames, `${x}: the route's strip too`);
    for (const lang of ['fr', 'en']) {
      page.RBL.setLang(lang);
      for (let i = 0; i < frames; i++) {
        page.click(page.byId('lp-thumbs'), {closest: () => ({getAttribute: () => String(i)})});
        assert.equal(page.RBL.step, i);
        assert.ok(page.byId('lp-stepName').textContent && page.byId('lp-cue').textContent, `${x} ${lang} step ${i + 1}: words`);
        assert.equal(page.byId('lp-num').textContent, String(i + 1));
      }
      assert.ok(page.byId('lp-pTitle').textContent && page.byId('lp-drawn').textContent && page.byId('lp-pCrumb').textContent);
    }
    page.RBL.setLang('fr');
    assert.equal(page.byId('intro').attrs['data-ex'], x);
    assert.ok(page.byId('lp-sessionUi').innerHTML.includes('<ol>') && page.byId('lp-sessionMini').innerHTML.includes('<ol>'));
    assert.ok(page.byId('lp-rUrl').textContent, `${x}: the address in Chrome`);
  }
  // the step count follows the data, never a fixed 6
  assert.doesNotMatch(landingJs.slice(landingJs.indexOf('// @gen-end')), /%\s*6\b|<\s*6\b|=== 6\b/);
});

test('L36 — every picture the landing can show is in the repo, resized; nothing unused, nothing third-party', () => {
  const page = landing({language: 'en'});
  const shown = new Set(imgs(intro));
  for (const x of page.RBL.examples) for (const lang of ['fr', 'en']) {
    page.RBL.setExample(x); page.RBL.setLang(lang);
    for (const id of ['lp-shot', 'lp-nbUi', 'lp-sessionUi', 'lp-sessionMini', 'lp-progressUi', 'lp-routeNb']) imgs(page.byId(id).innerHTML).forEach(s => shown.add(s));
    for (const el of [...page.lists.get('[data-k]')]) imgs(el.innerHTML).forEach(s => shown.add(s));
  }
  // [data-frame] / [data-share] fill the same frames as the sheet
  assert.ok(shown.size > 60, `${shown.size} pictures`);
  for (const src of shown) {
    assert.match(src, /^assets\/(mma|dance|stretch|snow|hiit|yoga|notebooks)\/[\w-]+\.jpg$/, src);
    const f = path.join(ROOT, 'app', src);
    assert.ok(fs.existsSync(f), `exists: ${src}`);
    assert.ok(fs.statSync(f).size < (src.endsWith('-t.jpg') ? 40 : 160) * 1024, `resized: ${src}`);
  }
  const files = [];
  for (const d of fs.readdirSync(path.join(ROOT, 'app/assets'))) {
    const dir = path.join(ROOT, 'app/assets', d);
    if (!fs.statSync(dir).isDirectory() || d === 'og') continue;
    const map = JSON.parse(fs.readFileSync(path.join(dir, 'image-map.json'), 'utf8'));
    assert.ok(fs.existsSync(path.join(dir, 'README.md')), `${d}/README.md`);
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jpg'))) {
      files.push(`assets/${d}/${f}`);
      assert.ok(map.files[f], `${d}/${f} listed in image-map.json`);
    }
  }
  assert.deepEqual(files.filter(f => !shown.has(f)), [], 'no picture shipped that the landing never shows');
  assert.doesNotMatch(files.join(' '), /\/(ki\d|n-kite-|hi0[125]\.|c-fouette|c-heels|t-osoto-gari-mma|ref-|orig-)/, 'the unused and reference files stay out');
});

test('L36 — no request to another host, no third-party credit or reel address in the app', () => {
  for (const s of [...imgs(intro), ...imgs(landingJs)]) assert.doesNotMatch(s, /^(?:https?:)?\/\//, s);
  assert.doesNotMatch(intro + landingJs, /<(?:img|script|link|iframe|source|video)\b[^>]*\b(?:src|href)="(?:https?:)?\/\//, 'no resource from another host');
  assert.doesNotMatch(html.slice(0, html.indexOf('</head>')), /fonts\.googleapis|fonts\.gstatic|<script[^>]+src="https?:/, 'fonts and scripts are the app\'s');
  assert.doesNotMatch(landingJs, /url\((?:https?:)?\/\//);
  for (const f of fs.readdirSync(path.join(ROOT, 'app')).filter(f => /\.(js|html|json|webmanifest)$/.test(f))) {
    const s = fs.readFileSync(path.join(ROOT, 'app', f), 'utf8');
    assert.doesNotMatch(s, /Natan Levy|instagram\.com\/reel/, `${f}: no third-party credit or reel address`);
  }
  // the links out of the page are to the project's own repository, in a new tab
  for (const m of intro.matchAll(/<a\b[^>]*href="(https?:[^"]+)"[^>]*>/g)) {
    assert.match(m[1], /^https:\/\/github\.com\/lt20\/reelbook(\/|$)/, m[1]);
    assert.match(m[0], /target="_blank" rel="noopener"/);
  }
});

test('L36 — <head>: title, description, canonical, Open Graph and Twitter card with an absolute 1200×630 image', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  const meta = (k, v) => { const m = head.match(new RegExp(`<meta (?:property|name)="${k}" content="([^"]*)">`)); return m && m[1]; };
  assert.match(head, /<title>Reelbook · [^<]+<\/title>/);
  assert.ok(meta('description').length > 60);
  assert.match(head, /<link rel="canonical" href="https:\/\/lt20\.github\.io\/reelbook\/">/);
  assert.equal(meta('og:locale'), 'fr_FR'); assert.equal(meta('og:locale:alternate'), 'en_GB');
  assert.equal(meta('og:url'), 'https://lt20.github.io/reelbook/');
  const og = meta('og:image');
  assert.match(og, /^https:\/\/lt20\.github\.io\/reelbook\/assets\/og\/[\w-]+\.jpg$/);
  assert.equal(meta('og:image:width'), '1200'); assert.equal(meta('og:image:height'), '630');
  assert.equal(meta('twitter:card'), 'summary_large_image'); assert.equal(meta('twitter:image'), og);
  const file = path.join(ROOT, 'app', og.replace('https://lt20.github.io/reelbook/', ''));
  const jpg = fs.readFileSync(file);
  let i = 2, size = null;
  while (i < jpg.length) { const marker = jpg[i + 1], len = jpg.readUInt16BE(i + 2); if (marker >= 0xc0 && marker <= 0xc2) { size = [jpg.readUInt16BE(i + 7), jpg.readUInt16BE(i + 5)]; break; } i += 2 + len; }
  assert.deepEqual(size, [1200, 630], 'the preview picture is 1200 × 630');
  assert.ok(jpg.length < 300 * 1024);
  assert.match(head, /<link rel="icon" href="icons\/reelbook-app\.svg"/);
});

test('L36 — the landing\'s #signin, #signup and #shortcut open the app\'s screens', async () => {
  for (const [id, href] of [['intro-signin', '#signin'], ['intro-signup', '#signup'], ['intro-shortcut', '#shortcut']]) assert.match(intro, new RegExp(`<a [^>]*href="${href}" id="${id}"`), id);
  const a = await app();
  await a.fire('intro-signin');
  assert.equal(a.element('intro').hidden, true); assert.equal(a.element('auth-form').hidden, false);
  assert.equal(a.element('auth-title').textContent, 'Sign in');
  const b = await app();
  await b.fire('intro-shortcut');
  assert.equal(b.element('intro').hidden, true, 'the sign-in form');
  assert.equal(b.element('auth-form').hidden, false);
  assert.equal(b.location.hash.replace('#', ''), 'settings', 'Settings › iPhone shortcut, once signed in');
  const c = await app();
  await c.fire('intro-signup');
  assert.equal(c.element('auth-title').textContent, 'Create an account');
});

test('L36 — step 2, macOS / Linux or Windows: one line in view, the one « Copy the line » copies', async () => {
  const page = landing({language: 'en'});
  const [unix, win] = page.lists.get('#intro .lp-os button');
  const panes = page.lists.get('#intro [data-os-pane]');
  assert.ok(panes.filter(p => p.attrs['data-os-pane'] === 'unix').every(p => !p.hidden) && panes.filter(p => p.attrs['data-os-pane'] === 'win').every(p => p.hidden));
  page.click(win);
  assert.equal(win.attrs['aria-pressed'], 'true'); assert.equal(unix.attrs['aria-pressed'], 'false');
  assert.ok(panes.filter(p => p.attrs['data-os-pane'] === 'win').every(p => !p.hidden) && panes.filter(p => p.attrs['data-os-pane'] === 'unix').every(p => p.hidden));
  let wrote = null;
  page.window.navigator.clipboard = {writeText: async s => { wrote = s; }};
  page.click(page.byId('lp-copy'));
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(wrote, 'irm https://lt20.github.io/reelbook/install.ps1 | iex');
});

test('L36 — the pause button stops the sheet and the band, and says what it does', () => {
  const page = landing({language: 'fr'});
  const pp = page.byId('lp-pp');
  assert.equal(pp.attrs['aria-label'], 'Mettre en pause les animations');
  page.click(page.byId('intro'), {closest: sel => sel === '#lp-pp' ? pp : null});
  assert.equal(pp.attrs['aria-label'], 'Relancer les animations');
  assert.ok(page.byId('lp-top').classes.has('lp-anim-off'));
  page.RBL.setLang('en');
  assert.equal(page.byId('lp-pp').attrs['aria-label'], 'Play the animations');
});

test('L36 — the copy is the v3 mockup\'s, word for word, in French and in English', () => {
  const mock = fs.readFileSync(path.join(ROOT, 'docs/audit-design/mockups/p6-landing.html'), 'utf8');
  const {DICT} = landing().RBL;
  const scoped = s => s.replace(/class="([^"]*)"/g, (m, v) => 'class="' + v.split(/\s+/).map(c => 'lp-' + c).join(' ') + '"');
  const STATE = new Set(['beta', 'i1.seats', 'wl.h']); // written from beta_seats(), checked in the beta test
  const enStart = mock.indexOf('var EN={'), en = new Function('return ' + mock.slice(enStart + 7, mock.indexOf('\n  };', enStart)) + '\n}')();
  let n = 0;
  for (const [k, v] of Object.entries(en)) if (!k.startsWith('nav.') && !STATE.has(k)) { assert.equal(DICT.en[k], scoped(v), `en: ${k}`); n++; }
  for (const m of mock.slice(0, mock.indexOf('<script>')).matchAll(/<(\w+)\b[^>]*\bdata-k="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) if (!STATE.has(m[2])) { assert.equal(DICT.fr[m[2]], scoped(m[3]), `fr: ${m[2]}`); n++; }
  assert.ok(n > 150, `${n} strings compared`);
});
