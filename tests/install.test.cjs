// L26: the installers without arguments use the hosted backend, read as text from config.js; Settings shows the short
// line on the hosted backend and the long one on an own backend; « Send to my computer ».
// No network: config.js is a local file:// fixture (REELBOOK_CONFIG_URL), and nothing past the dry run is executed.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const {app, hostedUrl, ownUrl, ownKey} = require('./harness.cjs');

const root = path.join(__dirname, '..');
const sh = path.join(root, 'app/install.sh');
const ps1 = fs.readFileSync(path.join(root, 'app/install.ps1'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-install-'));
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlLXBhcnQ_-x';

// a config.js fixture written to the temp folder; returns its file:// url
let n = 0;
const fixture = text => { const f = path.join(tmp, `config-${++n}.js`); fs.writeFileSync(f, text); return 'file://' + f; };
const config = (hosted, extra = '') => `// Reelbook — app configuration.\nwindow.REELBOOK = {\n  ${extra}\n  hosted: ${hosted},\n  defaults: ['strength'],\n  repo: 'https://github.com/lt20/reelbook'\n};\n`;
const hostedBlock = (url, key, q = "'") => `{\n    name: 'Reelbook hosted',\n    url: ${q}${url}${q},\n    anonKey: ${q}${key}${q},\n    blurb: 'Free for now.'\n  }`;
// install.sh with these arguments, HOME in the temp folder (nothing of the real one is read), the config url given
const run = (args, configUrl = 'http://127.0.0.1:9/config.js') => spawnSync('bash', [sh, ...args], {
  encoding: 'utf8', timeout: 20000, env: {PATH: process.env.PATH, HOME: tmp, REELBOOK_CONFIG_URL: configUrl}
});

test('install.sh parses as bash', () => {
  const r = spawnSync('bash', ['-n', sh], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
});

test('install.sh --help prints the usage and stops, without reading anything', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--url <url> --key <key>/);
  assert.match(r.stdout, /--dry-run/);
  assert.match(r.stdout, /the hosted backend/);
});

test('without arguments install.sh takes the hosted url and key from config.js', () => {
  const r = run(['--dry-run'], fixture(config(hostedBlock('https://abc.supabase.co', JWT))));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Backend: https:\/\/abc\.supabase\.co$/m);
  assert.match(r.stdout, new RegExp(`^Key: ${JWT.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(r.stdout, /Dry run: nothing installed\./);
});

test('install.sh reads double quotes, a trailing slash, a publishable key, and skips a commented-out line', () => {
  const dq = run(['--dry-run'], fixture(config(hostedBlock('https://abc.supabase.co/', JWT, '"'))));
  assert.equal(dq.status, 0, dq.stderr);
  assert.match(dq.stdout, /^Backend: https:\/\/abc\.supabase\.co$/m);
  const pub = run(['--dry-run'], fixture(config(hostedBlock('https://abc.supabase.co', 'sb_publishable_AbC-12_x'))));
  assert.equal(pub.status, 0, pub.stderr);
  assert.match(pub.stdout, /^Key: sb_publishable_AbC-12_x$/m);
  const commented = `{\n    // url: 'https://old.supabase.co',\n    url: 'https://new.supabase.co', // the current one\n    anonKey: '${JWT}'\n  }`;
  const c = run(['--dry-run'], fixture(config(commented)));
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /^Backend: https:\/\/new\.supabase\.co$/m);
});

test('install.sh reads the repository config.js the same way the app does', () => {
  const file = path.join(root, 'app/config.js');
  const ctx = {window: {}};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx);
  const {url, anonKey} = ctx.window.REELBOOK.hosted;
  const r = run(['--dry-run'], 'file://' + file);
  if (!url) { assert.notEqual(r.status, 0); return; }
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^Backend: ${url.replace(/\/$/, '').replace(/[.]/g, '\\.')}$`, 'm'));
  assert.ok(r.stdout.includes(`Key: ${anonKey}\n`));
});

test('an empty hosted block in config.js asks for --url and --key', () => {
  const r = run(['--dry-run'], fixture(config(hostedBlock('', ''))));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No hosted backend is set in file:.*--url <project url> --key <anon key>/);
  assert.equal(r.stdout, '');
});

test('a malformed url or key, or no hosted block, is refused with the same message', () => {
  for (const text of [
    config(hostedBlock('http://abc.supabase.co', JWT)), // not https
    config(hostedBlock('https://abc.supabase.co/path', JWT)),
    config(hostedBlock('https://abc.supabase.co', 'not a key')),
    config(hostedBlock('https://abc.supabase.co', 'only.two')),
    "window.REELBOOK = {repo: 'https://github.com/lt20/reelbook'};\n",
    '<html>404 Not Found</html>'
  ]) {
    const r = run(['--dry-run'], fixture(text));
    assert.equal(r.status, 1, text);
    assert.match(r.stderr, /No hosted backend is set/, text);
  }
});

test('config.js is read as text, never run, even when it holds shell or JavaScript code', () => {
  const mark = path.join(tmp, 'ran');
  const evil = config(`{\n    url: '$(touch ${mark})',\n    anonKey: \`$(touch ${mark})\`\n  }`, `blurb: "$(touch ${mark}) \`touch ${mark}\`",`);
  const r = run(['--dry-run'], fixture(evil));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No hosted backend is set/);
  const mixed = config(`{\n    url: 'https://abc.supabase.co',\n    anonKey: '${JWT}',\n    blurb: '$(touch ${mark}); \`touch ${mark}\`'\n  }`);
  const ok = run(['--dry-run'], fixture(mixed));
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^Backend: https:\/\/abc\.supabase\.co$/m);
  assert.equal(fs.existsSync(mark), false, 'nothing from config.js was executed');
});

test('a config.js that cannot be read says so and points to --url / --key', () => {
  const r = run(['--dry-run'], 'file://' + path.join(tmp, 'missing.js'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Could not read file:.*missing\.js.*--url <project url> --key <anon key>/);
});

test('with --url and --key install.sh is unchanged: config.js is not read', () => {
  const r = run(['--url', ownUrl, '--key', ownKey, '--dir', path.join(tmp, 'rb'), '--dry-run']); // config url unreachable
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^Backend: ${ownUrl.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(r.stdout, new RegExp(`^Key: ${ownKey}$`, 'm'));
  assert.match(r.stdout, /^Folder: .*\/rb$/m);
});

test('install.sh refuses half a backend, a missing value and an unknown option', () => {
  const half = run(['--url', ownUrl, '--dry-run']);
  assert.equal(half.status, 1);
  assert.match(half.stderr, /Give both --url and --key/);
  const empty = run(['--key']);
  assert.equal(empty.status, 2);
  assert.match(empty.stderr, /--key needs a value/);
  const swallowed = run(['--url', '--dry-run', '--key', 'abc']); // the next option is not a value: stop before any step
  assert.equal(swallowed.status, 2);
  assert.match(swallowed.stderr, /--url needs a value/);
  assert.equal(swallowed.stdout, '');
  const odd = run(['--force']);
  assert.equal(odd.status, 2);
  assert.match(odd.stderr, /unknown option: --force/);
});

// pwsh is not on every machine: the same rules are checked on the text of install.ps1 (static), and run when present.
test('install.ps1 takes the hosted backend from config.js as text when REELBOOK_URL / REELBOOK_KEY are not set', () => {
  assert.match(ps1, /REELBOOK_CONFIG_URL/);
  assert.match(ps1, /https:\/\/lt20\.github\.io\/reelbook\/config\.js/);
  assert.match(ps1, /function Get-HostedBackend/);
  assert.match(ps1, /hosted:\\s\*\\\{/);
  assert.match(ps1, /Set both REELBOOK_URL and REELBOOK_KEY/);
  assert.match(ps1, /No hosted backend is set in \$ConfigUrl/);
  assert.match(ps1, /REELBOOK_DRY_RUN/);
  // the variables of a line are cleared once read: a later short line in the same window uses the hosted backend
  assert.match(ps1, /Remove-Item Env:REELBOOK_URL, Env:REELBOOK_KEY, Env:REELBOOK_CONFIG_URL, Env:REELBOOK_DRY_RUN/);
  const body = ps1.slice(ps1.indexOf('function Install-Reelbook'));
  assert.ok(body.indexOf('Remove-Item Env:REELBOOK_URL') < body.indexOf('Resolve-ReelbookBackend'), 'cleared before anything can fail');
  // the downloaded text goes to the parser only: never to Invoke-Expression / iex / a script block
  const code = ps1.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
  assert.doesNotMatch(code, /Invoke-Expression|\biex\b|\[scriptblock\]|ScriptBlock\]::Create|&\s*\(\s*\$text/i);
  // same url and key formats as install.sh
  const shText = fs.readFileSync(sh, 'utf8');
  const shUrl = shText.match(/valid_url\(\) \{ printf '%s' "\$1" \| grep -Eq '([^']+)'/)[1];
  const shKey = shText.match(/valid_key\(\) \{ printf '%s' "\$1" \| grep -Eq '([^']+)'/)[1];
  assert.ok(ps1.includes(`-match '${shUrl}'`), 'install.ps1 checks the url like install.sh');
  assert.ok(ps1.includes(`-match '${shKey}'`), 'install.ps1 checks the key like install.sh');
});

const pwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1'], {encoding: 'utf8'}).status === 0;
test('install.ps1 dry run (pwsh)', {skip: pwsh ? false : 'pwsh is not installed here'}, () => {
  const runPs = (env, configUrl) => spawnSync('pwsh', ['-NoProfile', '-File', path.join(root, 'app/install.ps1')], {
    encoding: 'utf8', timeout: 30000, env: {PATH: process.env.PATH, HOME: tmp, REELBOOK_DRY_RUN: '1', REELBOOK_CONFIG_URL: configUrl, ...env}
  });
  const ok = runPs({}, fixture(config(hostedBlock('https://abc.supabase.co/', JWT))));
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Backend: https:\/\/abc\.supabase\.co\r?\n/);
  const empty = runPs({}, fixture(config(hostedBlock('', ''))));
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr + empty.stdout, /No hosted backend is set/);
  const own = runPs({REELBOOK_URL: ownUrl, REELBOOK_KEY: ownKey}, 'http://127.0.0.1:9/config.js');
  assert.equal(own.status, 0, own.stderr);
  assert.match(own.stdout, /Backend: https:\/\/personal\.example\.test/);
});

// ---------- Settings ----------
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const user = {id: 'u1', email: 'me+rb@example.test'};
const tables = {user_themes: [{id: 'strength', title: 'Strength', groups: [], builtin: true, position: 0}], sheets: [], queue: []};
const onHosted = extra => app({remembered: {mode: 'hosted'}, sessions: {[hostedUrl]: user}, tables, hash: '#settings', ...extra});
const onOwn = extra => app({remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: user}, tables, hash: '#settings', ...extra});
const cmds = page => [...page.element('s-install').innerHTML.matchAll(/<pre data-cmd="(sh|ps)">([^<]*)<\/pre>/g)].map(m => m[2]);
const unesc = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const clickSend = page => page.element('settings').listeners.click({target: {closest: s => s === '[data-send]' ? {dataset: {}} : null}});

const published = 'https://lt20.github.io/reelbook/';
test('Settings on the hosted backend shows the short line, the same for everyone', async () => {
  const page = await onHosted({href: published + '#settings'});
  await settle();
  assert.equal(page.element('settings').hidden, false);
  assert.deepEqual(cmds(page), [
    'curl -fsSL https://lt20.github.io/reelbook/install.sh | bash',
    'irm https://lt20.github.io/reelbook/install.ps1 | iex'
  ]);
  assert.doesNotMatch(page.element('s-install').innerHTML, /--url|REELBOOK_URL|hosted\.example/);
  assert.match(page.element('s-install').innerHTML, /<button[^>]*data-send[^>]*>Send to my computer<\/button>/);
});

test('an app served elsewhere (a fork) names its own config.js in the short line', async () => {
  const page = await onHosted();
  await settle();
  assert.deepEqual(cmds(page).map(unesc), [
    'curl -fsSL https://app.example.test/reelbook/install.sh | REELBOOK_CONFIG_URL=https://app.example.test/reelbook/config.js bash',
    '$env:REELBOOK_CONFIG_URL = "https://app.example.test/reelbook/config.js"; irm https://app.example.test/reelbook/install.ps1 | iex'
  ]);
});

test('Settings on an own backend keeps the line with its url and key', async () => {
  const page = await onOwn();
  await settle();
  assert.deepEqual(cmds(page).map(unesc), [
    `curl -fsSL https://app.example.test/reelbook/install.sh | bash -s -- --url ${ownUrl} --key ${ownKey}`,
    `$env:REELBOOK_URL = "${ownUrl}"; $env:REELBOOK_KEY = "${ownKey}"; irm https://app.example.test/reelbook/install.ps1 | iex`
  ]);
});

test('« Send to my computer » shares the lines and one sentence', async () => {
  const shared = [];
  const page = await onHosted({href: published + '#settings', nav: {share: async data => { shared.push(data); }}});
  await settle();
  await clickSend(page);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].title, 'Set up Reelbook');
  assert.match(shared[0].text, /^Set up Reelbook on this computer: paste one of these lines in a terminal\./);
  assert.ok(shared[0].text.includes('\ncurl -fsSL https://lt20.github.io/reelbook/install.sh | bash\n'));
  assert.ok(shared[0].text.includes('\nirm https://lt20.github.io/reelbook/install.ps1 | iex\n'));
});

test('« Send to my computer » without the share sheet opens a mail to oneself with the lines', async () => {
  const page = await onOwn();
  await settle();
  await clickSend(page);
  const href = page.location.href;
  assert.match(href, /^mailto:me%2Brb@example\.test\?subject=Set%20up%20Reelbook&body=/);
  const body = decodeURIComponent(href.split('&body=')[1]);
  assert.match(body, /^Set up Reelbook on this computer: paste one of these lines in a terminal\./);
  assert.ok(body.includes(`bash -s -- --url ${ownUrl} --key ${ownKey}\n`));
  assert.ok(body.includes(`$env:REELBOOK_URL = "${ownUrl}"`));
});

test('a share closed by the person does not fall back to mail; a failed share does', async () => {
  const abort = await onHosted({nav: {share: async () => { const e = new Error('closed'); e.name = 'AbortError'; throw e; }}});
  await settle();
  await clickSend(abort);
  assert.equal(abort.location.href, 'https://app.example.test/reelbook/');
  const failed = await onHosted({nav: {share: async () => { throw new Error('not allowed'); }}});
  await settle();
  await clickSend(failed);
  assert.match(failed.location.href, /^mailto:me%2Brb@example\.test\?subject=Set%20up%20Reelbook&body=Set%20up%20Reelbook/);
});
