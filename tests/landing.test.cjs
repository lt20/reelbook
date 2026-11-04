// L30: the bilingual landing (app/landing.js) and the FR / EN screens of a newcomer. landing.js runs here in a `vm`
// with a small fake DOM: elements by id, and the [data-k] / [data-ka] nodes of index.html.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {app, html, ownUrl, ownKey} = require('./harness.cjs');

const ROOT = path.join(__dirname, '..');
const landingJs = fs.readFileSync(path.join(ROOT, 'app/landing.js'), 'utf8');
const attrsOf = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));

function stub(attrs = {}) {
  const el = {
    attrs: {...attrs}, innerHTML: '', textContent: '', hidden: 'hidden' in attrs, value: '', style: {}, listeners: {},
    classList: {toggle() {}},
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
  byId('intro').hidden = false;
  // the nodes landing.js looks up by selector, from the real markup
  const fromHtml = re => [...html.matchAll(re)].map(m => { const a = attrsOf(m[0]); return a.id ? Object.assign(byId(a.id), {attrs: {...byId(a.id).attrs, ...a}}) : stub(a); });
  lists.set('[data-k]', fromHtml(/<[a-z][\w]*\b[^>]*\bdata-k="[^"]+"[^>]*>/g));
  lists.set('[data-ka]', fromHtml(/<[a-z][\w]*\b[^>]*\bdata-ka="[^"]+"[^>]*>/g));
  lists.set('#intro .lp-lang button', fromHtml(/<button\b[^>]*\bdata-lang="[^"]+"[^>]*>/g));
  lists.set('#intro .lp-ex button', fromHtml(/<button\b[^>]*\bdata-ex="[^"]+"[^>]*>/g));
  for (const k of ['data-seats-line', 'data-seats', 'data-seats-bar']) lists.set(`[${k}]`, fromHtml(new RegExp(`<[a-z]+\\b[^>]*\\b${k}(?=[\\s>])[^>]*>`, 'g')));
  // the « Your own notebook » fields hold the markup's English example, as in the browser
  byId('lp-cuName').value = attrsOf(html.match(/<input id="lp-cuName"[^>]*>/)[0]).value;
  byId('lp-cuDesc').value = html.match(/<textarea id="lp-cuDesc">([^<]*)<\/textarea>/)[1];
  // the install line, for « Copy the line »
  const pre = stub(); pre.textContent = '\n' + html.match(/<pre>([^<]*)<\/pre>/)[1] + '\n';
  byId('intro').querySelector = sel => sel === 'pre' ? pre : null;
  const documentElement = {lang: 'en', scrollHeight: 0};
  const document = {getElementById: byId, querySelectorAll: sel => lists.get(sel) || [], documentElement};
  const window = {
    navigator: {language},
    localStorage: {getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k)},
    addEventListener() {}, scrollTo() {}
  };
  const timers = [];
  vm.runInNewContext(landingJs, {window, document, console, setTimeout: fn => timers.push(fn)});
  const click = el => el.listeners.click({preventDefault() {}, target: el, currentTarget: el});
  return {RBL: window.RBL, byId, lists, storage, documentElement, click, window, document, pre, timers};
}

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
  assert.equal(h1.innerHTML, 'Du reel au geste.');
  assert.equal(page.byId('lp-cuName').value, 'Cerceau aérien');
  const heard = [];
  page.RBL.onChange(l => heard.push(l));
  const en = page.lists.get('#intro .lp-lang button').find(b => b.attrs['data-lang'] === 'en');
  page.click(en);
  assert.equal(page.RBL.lang, 'en');
  assert.equal(page.documentElement.lang, 'en');
  assert.equal(page.storage.get('rb.lang'), 'en', 'saved on the device, not per user');
  assert.equal(h1.innerHTML, 'From reel to move.');
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

test('L30 — seats: hidden without an answer, « 14 places prises sur 50 » with one', () => {
  const page = landing({language: 'fr'});
  const lines = page.lists.get('[data-seats-line]'), texts = page.lists.get('[data-seats]'), bar = page.lists.get('[data-seats-bar]')[0];
  assert.equal(lines.length, 2, 'the hero line and the hosting option');
  assert.ok(lines.every(l => l.hidden) && bar.hidden, 'hidden until beta_seats() answers');
  for (const answer of [null, undefined, {}, {taken: null, total: 50}, {taken: 3, total: 0}, 'x', []]) {
    assert.equal(page.RBL.seats(answer), false);
    assert.ok(lines.every(l => l.hidden) && bar.hidden, `hidden for ${JSON.stringify(answer)}`);
  }
  assert.equal(page.RBL.seats({taken: 14, total: 50, open: true}), true);
  assert.ok(lines.every(l => !l.hidden) && !bar.hidden);
  assert.deepEqual(texts.map(t => t.textContent), ['14 places prises sur 50', '14 places prises sur 50']);
  assert.equal(bar.bar.style.width, '28%');
  page.RBL.setLang('en');
  assert.deepEqual(texts.map(t => t.textContent), ['14 of 50 spots taken', '14 of 50 spots taken']);
  assert.equal(page.RBL.seats([{taken: 50, total: 50, open: false}]), true, 'a set-returning function answers an array');
  assert.equal(texts[0].textContent, '50 of 50 spots taken');
  assert.doesNotMatch(html.slice(html.indexOf('id="intro"'), html.indexOf('id="auth-title"')), /\b14\b/, 'no seat number in the markup');
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

test('L30 — MMA / Dance: drawings or MMA photos from the manifest, Laurent\'s generated dance images, saved choice', () => {
  const page = landing({language: 'en'});
  const shot = page.byId('lp-shot'), intro = page.byId('intro');
  assert.equal(page.RBL.example, 'mma');
  assert.match(shot.innerHTML, /<svg\b/);
  assert.doesNotMatch(shot.innerHTML, /<img\b/, 'MMA stays drawn while the manifest is empty');
  assert.equal(page.byId('lp-drawn').textContent, 'MMA view: placeholder drawings, not a real video.');
  const dance = page.lists.get('#intro .lp-ex button').find(b => b.attrs['data-ex'] === 'dance');
  page.click(dance);
  assert.equal(page.RBL.example, 'dance');
  assert.equal(intro.attrs['data-ex'], 'dance');
  assert.equal(page.storage.get('rb.landing.ex'), 'dance');
  assert.equal(dance.attrs['aria-pressed'], 'true');
  assert.match(shot.innerHTML, /src="assets\/dance\/pirouette-en-dehors\/01-preparation-v2\.jpg"/);
  assert.match(page.byId('lp-nbUi').innerHTML, /assets\/dance\/chaines-en-diagonale-card\.jpg/);
  assert.equal(page.byId('lp-drawn').textContent, 'Dance view: generated demo images, not a real video.');
  assert.equal(page.byId('lp-pTitle').textContent, 'Pirouette en dehors');
  assert.equal(landing({stored: {'rb.landing.ex': 'dance'}}).RBL.example, 'dance', 'the example chosen last time');
  // MMA photos once listed: all six steps, else the drawings; a card on its own; nothing but relative paths
  page.RBL.setExample('mma');
  const steps = [1, 2, 3, 4, 5, 6].map(n => `coup-de-pied-tournant-foie/0${n}.jpg`);
  page.RBL.readManifest({steps, cards: {neck: 'prise-de-nuque-card.jpg', kick: 'https://example.com/x.jpg'}});
  page.RBL.setExample('mma');
  assert.match(shot.innerHTML, /src="assets\/mma\/coup-de-pied-tournant-foie\/01\.jpg"/);
  assert.match(page.byId('lp-nbUi').innerHTML, /src="assets\/mma\/prise-de-nuque-card\.jpg"/);
  assert.doesNotMatch(page.byId('lp-nbUi').innerHTML, /example\.com/);
  assert.equal(page.byId('lp-drawn').textContent, 'MMA view: generated demo images, not a real video.');
  page.RBL.readManifest({steps: steps.slice(0, 5)});
  page.RBL.setExample('mma');
  assert.doesNotMatch(shot.innerHTML, /<img\b/, 'five steps out of six: drawn');
  page.RBL.readManifest({steps: steps.map(s => '../' + s)});
  page.RBL.setExample('mma');
  assert.doesNotMatch(shot.innerHTML, /<img\b/);
});

test('L30 — no third-party picture: relative files only, all in the repo, none from a real video', () => {
  const landingMarkup = html.slice(html.indexOf('<div id="intro"'), html.indexOf('id="auth-title"'));
  for (const src of [...landingMarkup.matchAll(/\bsrc="([^"]+)"/g), ...landingJs.matchAll(/\bsrc="([^"]+)"/g)].map(m => m[1])) assert.doesNotMatch(src, /^(?:https?:)?\/\//, src);
  const used = [...landingJs.matchAll(/'((?:pirouette-en-dehors\/)?[\w-]+)(?:\.jpg)?'/g)].map(m => m[1]);
  const dance = path.join(ROOT, 'app/assets/dance');
  const files = [];
  const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else files.push(path.relative(dance, p)); } };
  walk(dance);
  const jpgs = files.filter(f => f.endsWith('.jpg')).sort();
  assert.equal(jpgs.length, 12, 'the six pirouette steps and six cards');
  for (const f of jpgs) {
    assert.ok(landingJs.includes(path.basename(f, '.jpg')), `${f} is used`);
    assert.ok(fs.statSync(path.join(dance, f)).size < 200 * 1024, `${f} is resized`);
  }
  for (const f of ['README.md', 'image-map.json', 'pirouette-en-dehors/README.md']) assert.ok(files.includes(f), f);
  assert.ok(used.length);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/assets/mma/image-map.json'), 'utf8'));
  for (const f of [...manifest.steps, ...Object.values(manifest.cards)]) assert.ok(fs.existsSync(path.join(ROOT, 'app/assets/mma', f)), `listed and present: ${f}`);
  assert.ok(fs.existsSync(path.join(ROOT, 'app/assets/mma/README.md')));
  for (const f of ['app/index.html', 'app/landing.js']) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /Natan Levy|img\/[kt]\d|img\/t-/, `${f}: no third-party frame or credit`);
});

test('L30 — the service worker shell has landing.js at the version index.html loads, under a new cache VERSION', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'app/sw.js'), 'utf8');
  const v = html.match(/<script src="landing\.js\?v=(\d+)"><\/script>/);
  assert.ok(v, 'index.html loads landing.js before the app script');
  assert.ok(html.indexOf('landing.js?v=') < html.indexOf('<script>\n'));
  assert.ok(sw.includes(`'./landing.js?v=${v[1]}'`));
  assert.doesNotMatch(sw, /assets\/(?:dance|mma)/, 'the pictures stay out of the shell');
});

test('L30 — the notes example is read-only: nothing typed there can be lost by a FR / EN switch', () => {
  const page = landing({language: 'fr'});
  const ui = page.byId('lp-notesUi');
  for (const lang of ['fr', 'en']) {
    page.RBL.setLang(lang);
    const ta = /<textarea\b[^>]*>/.exec(ui.innerHTML);
    assert.ok(ta, `${lang}: the example has its note`);
    assert.match(ta[0], /\breadonly\b/, `${lang}: « ${page.RBL.t('ui.saved')} » is shown, so the note cannot be edited`);
  }
  assert.match(html, /#intro \.lp-notes-ui textarea\{[^}]*cursor:default/, 'no text cursor over it');
});

// Supabase's auth errors (supabase-js 2.x: code, status, English message), as the sign-in / sign-up form shows them
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

test('L30 — « Your own notebook »: the example follows FR / EN, what the visitor typed stays', () => {
  const page = landing({language: 'en'});
  const name = page.byId('lp-cuName'), desc = page.byId('lp-cuDesc');
  assert.equal(name.value, 'Aerial hoop');
  page.RBL.setLang('fr');
  assert.equal(name.value, 'Cerceau aérien', 'untouched: the example is translated');
  assert.match(desc.value, /^Montées, figures/);
  name.value = 'Pole dance'; desc.value = 'Mes figures à la barre.';
  page.RBL.setLang('en');
  assert.equal(name.value, 'Pole dance', 'typed: kept');
  assert.equal(desc.value, 'Mes figures à la barre.');
  desc.value = '';
  page.RBL.setLang('fr');
  assert.equal(desc.value, '', 'emptied: stays empty');
  assert.equal(name.value, 'Pole dance');
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
