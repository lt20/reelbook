// The end of the installers: a reel and REELBOOK in block letters, then what to do next, only when the whole install
// went through. Colour only on a terminal (no NO_COLOR, TERM not dumb); 60 columns at most; French or English from the
// locale. The welcome function is cut out of each installer and run alone; the sign-in case runs all of install.sh
// with stand-ins for git and python3 (no network, nothing installed).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const root = path.join(__dirname, '..');
const sh = path.join(root, 'app/install.sh');
const shText = fs.readFileSync(sh, 'utf8');
const ps1 = fs.readFileSync(path.join(root, 'app/install.ps1'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-welcome-'));

function cut(text, start) {
  const i = text.indexOf(start);
  assert.ok(i >= 0, `${start} is in the installer`);
  return text.slice(i, text.indexOf('\n}\n', i) + 2);
}
const welcomeSh = cut(shText, 'welcome() {');
const ESC = /\x1b\[/;
const plain = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const banner = out => plain(out).replace(/\r/g, '').split('\n').slice(0, 9); // a blank line, 7 rows, a blank line

// a command under a pseudo-terminal, as in a real install (`script` differs between macOS and Linux)
const ttyArgs = cmd => process.platform === 'darwin' ? ['-q', '/dev/null', ...cmd] : ['-qec', cmd.map(a => `'${a.replace(/'/g, `'\\''`)}'`).join(' '), '/dev/null'];
const hasScript = spawnSync('script', ttyArgs(['true']), {stdio: 'ignore'}).status === 0;
const runSh = (env, {tty = false} = {}) => {
  const cmd = ['bash', '-c', `${welcomeSh}\nwelcome`];
  const r = tty ? spawnSync('script', ttyArgs(cmd), {encoding: 'utf8', env: {PATH: process.env.PATH, TERM: 'xterm-256color', ...env}, stdio: ['ignore', 'pipe', 'pipe']})
    : spawnSync(cmd[0], cmd.slice(1), {encoding: 'utf8', env: {PATH: process.env.PATH, ...env}});
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.replace(/\r/g, "").replace(/^\^D\x08+/, ""); // macOS script echoes the end of its input
};

test('install.sh parses as bash', () => {
  assert.equal(spawnSync('bash', ['-n', sh]).status, 0);
});

test('outside a terminal, or with NO_COLOR, the welcome has no escape code', () => {
  assert.doesNotMatch(runSh({LANG: 'en_US.UTF-8'}), ESC);
  assert.doesNotMatch(runSh({LANG: 'en_US.UTF-8', NO_COLOR: '1'}), ESC);
});

test('on a terminal it has the brand colours, unless NO_COLOR or TERM=dumb', {skip: hasScript ? false : 'script is not installed here'}, () => {
  const out = runSh({LANG: 'en_US.UTF-8'}, {tty: true});
  assert.match(out, /\x1b\[38;5;167m/, 'the coral of the app');
  assert.match(out, /\x1b\[38;5;25m/, 'the accent blue of the app');
  assert.doesNotMatch(runSh({LANG: 'en_US.UTF-8', NO_COLOR: '1'}, {tty: true}), ESC);
  assert.doesNotMatch(runSh({LANG: 'en_US.UTF-8', TERM: 'dumb'}, {tty: true}), ESC);
  assert.deepEqual(banner(out), banner(runSh({LANG: 'en_US.UTF-8'})), 'the same drawing with or without colour');
});

test('the drawing is 7 rows of 60 columns at most, block characters in UTF-8 and # otherwise', () => {
  for (const LANG of ['en_US.UTF-8', 'C']) {
    const rows = banner(runSh({LANG}));
    assert.equal(rows[0], ''); assert.equal(rows[8], '');
    for (const row of rows) assert.ok([...row].length <= 60, `${[...row].length} columns: ${row}`);
    assert.ok(rows.slice(1, 8).every(r => r.trim()), 'seven rows drawn');
    assert.match(rows.join('\n'), LANG === 'C' ? /^[ #\n]+$/ : /^[ █\n]+$/);
  }
});

test('French with a French locale, English otherwise', () => {
  const fr = runSh({LANG: 'fr_CH.UTF-8'});
  assert.match(fr, /^C'est prêt\.$/m);
  assert.match(fr, /^2\.\ Dans\ Claude\ Code,\ sur\ ton\ ordinateur,\ tape\ \/reelbook,\ avec\ Chrome\ ouvert\ et\ l'extension\ Claude\ in\ Chrome\ installée\.$/m);
  assert.match(fr, /^3\.\ Claude\ ouvre\ les\ liens\ en\ file\ d'attente,\ lit\ les\ vidéos,\ crée\ les\ fiches\ et\ les\ range\ dans\ le\ carnet\ du\ sport\ correspondant\.$/m);
  assert.match(runSh({LANG: 'en_US.UTF-8', LC_ALL: 'fr_FR.UTF-8'}), /^C'est prêt\.$/m, 'LC_ALL wins over LANG');
  const en = runSh({LANG: 'en_US.UTF-8'});
  assert.match(en, /^You're all set\.$/m);
  assert.match(en, /^1\.\ Queue\ your\ videos:\ paste\ their\ link\ in\ the\ app,\ or\ send\ them\ with\ the\ iPhone\ shortcut\.$/m);
  assert.match(en, /^2\.\ In\ Claude\ Code\ on\ your\ computer,\ type\ \/reelbook,\ with\ Chrome\ open\ and\ the\ Claude\ in\ Chrome\ extension\ installed\.$/m);
  assert.match(en, /^3\.\ Claude\ opens\ the\ queued\ links,\ reads\ the\ videos,\ writes\ the\ sheets\ and\ files\ each\ one\ in\ the\ notebook\ of\ its\ sport\.$/m);
  assert.doesNotMatch(en, /prêt/);
});

// all of install.sh, with git and python3 stand-ins; the sign-in reads /dev/tty, hence the pseudo-terminal
test('the welcome shows after a sign-in that went through, never after a failed one', {skip: hasScript ? false : 'script is not installed here'}, () => {
  const run = loginStatus => {
    const base = fs.mkdtempSync(path.join(tmp, 'run-')), bin = path.join(base, 'bin'), dir = path.join(base, 'reelbook');
    fs.mkdirSync(bin); fs.mkdirSync(path.join(dir, '.git'), {recursive: true}); fs.mkdirSync(path.join(dir, '.venv/bin'), {recursive: true});
    const stub = (file, body) => { fs.writeFileSync(file, `#!/bin/sh\n${body}\n`); fs.chmodSync(file, 0o755); };
    stub(path.join(bin, 'git'), 'exit 0');
    stub(path.join(bin, 'python3'), `case "$*" in *login*) echo "login: $REELBOOK_HOSTED_URL"; exit ${loginStatus} ;; *) cat >/dev/null; exit 0 ;; esac`);
    stub(path.join(dir, '.venv/bin/python'), 'exit 0');
    const r = spawnSync('script', ttyArgs(['bash', sh, '--url', 'https://abc.supabase.co', '--key', 'a.b.c', '--dir', dir]), {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: {PATH: `${bin}:${process.env.PATH}`, HOME: base, LANG: 'en_US.UTF-8', TERM: 'xterm-256color'}
    });
    return {status: r.status, out: plain(r.stdout).replace(/\r/g, '')};
  };
  const ok = run(0);
  assert.equal(ok.status, 0, ok.out);
  assert.match(ok.out, /5\/5 Signing this computer in/);
  assert.match(ok.out, /^login: $/m, 'an own backend: no hosted url is given to rb.py');
  assert.match(ok.out, /█{4}/); assert.match(ok.out, /^You're all set\.$/m);
  const failed = run(1);
  assert.notEqual(failed.status, 0, failed.out);
  assert.match(failed.out, /5\/5 Signing this computer in/);
  assert.doesNotMatch(failed.out, /█|You're all set|C'est prêt/);
});

test('install.sh gives rb.py the hosted url only when it took the hosted backend', () => {
  assert.match(shText, /URL="\$\{pair%% \*\}"; KEY="\$\{pair#\* \}"; HOSTED_URL="\$URL"/);
  assert.match(shText, /REELBOOK_HOSTED_URL="\$HOSTED_URL" python3 "\$DIR\/tools\/rb\.py" login/);
});

// pwsh is not on every machine: the order is checked on the text of install.ps1, and the welcome runs when present
test('install.ps1 stops on a failed sign-in before its welcome, and stays ASCII', () => {
  const body = ps1.slice(ps1.indexOf('function Install-Reelbook'));
  const login = body.indexOf('login --url $Backend.Url'), stop = body.indexOf('if ($rc -ne 0) { throw'), show = body.indexOf('Show-ReelbookWelcome');
  assert.ok(login > 0 && login < stop && stop < show, 'sign-in, then a throw on failure, then the welcome');
  assert.match(body, /\$rc = \$LASTEXITCODE/);
  assert.match(ps1, /\$b\.Hosted = \$true/);
  assert.match(body, /\$env:REELBOOK_HOSTED_URL = if \(\$Backend\.Hosted\) \{ \$Backend\.Url \} else \{ "" \}/);
  assert.match(ps1, /-not \$env:NO_COLOR -and \$env:TERM -ne "dumb"/);
  assert.match(ps1, /\$PSUICulture -like "fr\*"/);
  assert.doesNotMatch(ps1, /[^\x00-\x7f]/, 'Windows PowerShell may read the file as Latin-1');
});

const pwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1'], {encoding: 'utf8'}).status === 0;
test('install.ps1 welcome (pwsh)', {skip: pwsh ? false : 'pwsh is not installed here'}, () => {
  const fn = cut(ps1, 'function Show-ReelbookWelcome {');
  const runPs = env => {
    const r = spawnSync('pwsh', ['-NoProfile', '-Command', `${fn}\nShow-ReelbookWelcome`], {encoding: 'utf8', timeout: 30000, env: {PATH: process.env.PATH, HOME: tmp, ...env}});
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.replace(/\r/g, "").replace(/^\^D\x08+/, ""); // macOS script echoes the end of its input
  };
  const en = runPs({LANG: 'en_US.UTF-8', NO_COLOR: '1'});
  assert.doesNotMatch(en, ESC);
  assert.match(en, /^You're all set\.$/m);
  for (const row of banner(en)) assert.ok([...row].length <= 60, row);
  assert.deepEqual(banner(en), banner(runSh({LANG: 'en_US.UTF-8'})), 'the same drawing as install.sh');
  assert.match(runPs({LANG: 'fr_CH.UTF-8', LC_ALL: 'fr_CH.UTF-8'}), /^C'est prêt\.$/m);
});
