// The installers update an existing clone. When the repository is republished with a new history (no common
// ancestor), `git pull --ff-only` can never succeed: the clone is moved onto the new history, and the files git
// ignores (work/, .venv/) and the session file (outside the folder) survive. Same history: the old rule stays.
// Two local repositories stand for the published one (a bare repo, rewritten in place); no network.
// The update function is cut out of each installer and run alone: nothing else of the installer is executed.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const root = path.join(__dirname, '..');
const shText = fs.readFileSync(path.join(root, 'app/install.sh'), 'utf8');
const ps1 = fs.readFileSync(path.join(root, 'app/install.ps1'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-update-'));
const env = {
  PATH: process.env.PATH, HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test'
};

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, {cwd, env, encoding: 'utf8'});
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const write = (file, text) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text); };
const commitAll = (dir, msg) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); return git(dir, 'rev-parse', 'HEAD'); };
const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

let n = 0;
// a published repository with one commit, and an installation cloned from it with local work in work/ and .venv/
function setup() {
  const base = path.join(tmp, `case-${++n}`);
  const pub = path.join(base, 'published.git'), old = path.join(base, 'old'), inst = path.join(base, 'reelbook');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', pub);
  fs.mkdirSync(old, {recursive: true});
  git(old, 'init', '-q', '-b', 'main');
  write(path.join(old, '.gitignore'), ignore);
  write(path.join(old, 'README.md'), 'old history\n');
  write(path.join(old, 'tools/rb.py'), 'print("v1")\n');
  commitAll(old, 'first');
  git(old, 'remote', 'add', 'origin', pub);
  git(old, 'push', '-q', 'origin', 'main');
  git(tmp, 'clone', '-q', pub, inst);
  write(path.join(inst, 'work/my-sheet/meta.json'), '{"title": "mine"}\n');
  write(path.join(inst, '.venv/bin/python'), '#!/bin/sh\n');
  const session = path.join(tmp, `.config/reelbook/config-${n}.json`);
  write(session, '{"refresh_token": "kept"}\n');
  return {base, pub, old, inst, session};
}

// the same repository url now serves an unrelated history (the private repo renamed, a new public one created)
function republish({base, pub}) {
  const fresh = path.join(base, 'fresh');
  fs.mkdirSync(fresh);
  git(fresh, 'init', '-q', '-b', 'main');
  write(path.join(fresh, '.gitignore'), ignore);
  write(path.join(fresh, 'README.md'), 'new history\n');
  write(path.join(fresh, 'tools/rb.py'), 'print("v2")\n');
  const head = commitAll(fresh, 'Update');
  git(fresh, 'push', '-q', '--force', pub, 'main');
  return head;
}

// cuts a function out of an installer: from its first line to the first line that closes it at column 0
function cut(text, start) {
  const i = text.indexOf(start);
  assert.ok(i >= 0, `${start} is in the installer`);
  const end = text.indexOf('\n}\n', i);
  return text.slice(i, end + 2);
}
const updateSh = cut(shText, 'update_repo() {');
const runSh = dir => spawnSync('bash', ['-c', `set -euo pipefail\n${updateSh}\nupdate_repo "$1"`, 'update', dir], {env, encoding: 'utf8', timeout: 30000});

const survived = ({inst, session}) => {
  assert.equal(fs.readFileSync(path.join(inst, 'work/my-sheet/meta.json'), 'utf8'), '{"title": "mine"}\n', 'work/ is kept');
  assert.ok(fs.existsSync(path.join(inst, '.venv/bin/python')), '.venv/ is kept');
  assert.equal(fs.readFileSync(session, 'utf8'), '{"refresh_token": "kept"}\n', 'the session file is kept');
};

test('work/ and .venv/ are ignored by git, so a hard reset keeps them', () => {
  const c = setup();
  assert.equal(git(c.inst, 'check-ignore', 'work/my-sheet/meta.json'), 'work/my-sheet/meta.json');
  assert.equal(git(c.inst, 'check-ignore', '.venv/bin/python'), '.venv/bin/python');
  // the session file is not in the folder at all
  assert.match(fs.readFileSync(path.join(root, 'tools/rb.py'), 'utf8'), /~\/\.config\/reelbook\/config\.json/);
});

test('both installers call the update function at step 2', () => {
  assert.match(shText, /update_repo "\$DIR" \|\| echo "note: could not update \$DIR, keeping the current version\."/);
  assert.match(ps1, /if \(-not \(Update-ReelbookRepo \$Dir\)\) \{ Write-Host "note: could not update \$Dir, keeping the current version\." \}/);
  assert.doesNotMatch(shText.slice(shText.indexOf('say "2/5')), /pull --ff-only/, 'step 2 goes through update_repo only');
});

test('install.sh: the same history still updates by fast-forward', () => {
  const c = setup();
  write(path.join(c.old, 'tools/rb.py'), 'print("v1.1")\n');
  const head = commitAll(c.old, 'second');
  git(c.old, 'push', '-q', 'origin', 'main');
  const r = runSh(c.inst);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(git(c.inst, 'rev-parse', 'HEAD'), head);
  survived(c);
});

test('install.sh: offline, the current version is kept', () => {
  const c = setup();
  fs.renameSync(c.pub, c.pub + '.gone');
  const before = git(c.inst, 'rev-parse', 'HEAD');
  const r = runSh(c.inst);
  assert.equal(r.status, 1);
  assert.equal(git(c.inst, 'rev-parse', 'HEAD'), before);
  survived(c);
});


// The cases of a new history, run against both installers (the PowerShell one only where pwsh is installed).
// `run` returns {status, out}: the installer's messages, whichever stream they are written to.
const branches = dir => git(dir, 'for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads/reelbook-old-history*')
  .split('\n').filter(Boolean).map(l => l.split(' '));

function newHistoryCases(name, run, skip) {
  test(`${name}: a clone of the old history moves onto the new one, local files kept`, {skip}, () => {
    const c = setup();
    const oldHead = git(c.inst, 'rev-parse', 'HEAD');
    const head = republish(c);
    const r = run(c.inst);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /has a new history; .* the old history, with any commits of your own, is in the branch reelbook-old-history\)/);
    assert.equal(git(c.inst, 'rev-parse', 'HEAD'), head);
    assert.equal(git(c.inst, 'rev-parse', 'reelbook-old-history'), oldHead, 'the old history is kept in a branch');
    assert.equal(fs.readFileSync(path.join(c.inst, 'README.md'), 'utf8'), 'new history\n');
    assert.equal(git(c.inst, 'status', '--porcelain'), '', 'nothing tracked is left over');
    survived(c);
    // a second run is a plain fast-forward (nothing to do)
    const again = run(c.inst);
    assert.equal(again.status, 0, again.out);
    assert.doesNotMatch(again.out, /new history/);
  });

  test(`${name}: a git pull that failed first (origin/main already on the new history) does not stop the move`, {skip}, () => {
    const c = setup();
    const oldHead = git(c.inst, 'rev-parse', 'HEAD');
    const head = republish(c);
    const pull = spawnSync('git', ['pull'], {cwd: c.inst, env, encoding: 'utf8'});
    assert.notEqual(pull.status, 0, 'the plain pull fails on unrelated histories');
    assert.equal(git(c.inst, 'rev-parse', 'origin/main'), head, 'the failed pull has fetched the new history');
    const r = run(c.inst);
    assert.equal(r.status, 0, r.out);
    assert.equal(git(c.inst, 'rev-parse', 'HEAD'), head);
    assert.equal(git(c.inst, 'rev-parse', 'reelbook-old-history'), oldHead);
    survived(c);
  });

  test(`${name}: a tracked file edited by hand (a self-hosted config.js) stops the move until it is set aside`, {skip}, () => {
    const c = setup();
    const oldHead = git(c.inst, 'rev-parse', 'HEAD');
    write(path.join(c.inst, 'tools/rb.py'), 'print("my own backend")\n');
    const head = republish(c);
    const r = run(c.inst);
    assert.equal(r.status, 1);
    assert.match(r.out, /new history, but .* has tracked files edited by hand\. Keep a copy of them with {2}git -C .* stash {2}.*then run this installer again/);
    assert.equal(git(c.inst, 'rev-parse', 'HEAD'), oldHead);
    assert.equal(fs.readFileSync(path.join(c.inst, 'tools/rb.py'), 'utf8'), 'print("my own backend")\n', 'the edit is untouched');
    survived(c);
    // a staged edit stops it too
    git(c.inst, 'add', 'tools/rb.py');
    assert.equal(run(c.inst).status, 1);
    assert.equal(git(c.inst, 'rev-parse', 'HEAD'), oldHead);
    // the way the note gives: the edit set aside in a stash, then the installer again
    git(c.inst, 'stash', '-q');
    const again = run(c.inst);
    assert.equal(again.status, 0, again.out);
    assert.equal(git(c.inst, 'rev-parse', 'HEAD'), head);
    assert.equal(git(c.inst, 'show', 'stash@{0}:tools/rb.py'), 'print("my own backend")', 'the copy is in the stash');
    survived(c);
  });

  test(`${name}: a commit of the clone's own does not stop the move, it stays in reelbook-old-history`, {skip}, () => {
    const c = setup();
    write(path.join(c.inst, 'tools/rb.py'), 'print("my own backend")\n');
    const mine = commitAll(c.inst, 'my backend');
    const head = republish(c);
    const r = run(c.inst);
    assert.equal(r.status, 0, r.out);
    assert.equal(git(c.inst, 'rev-parse', 'HEAD'), head);
    assert.equal(git(c.inst, 'rev-parse', 'reelbook-old-history'), mine);
    assert.equal(git(c.inst, 'show', 'reelbook-old-history:tools/rb.py'), 'print("my own backend")');
    survived(c);
  });

  test(`${name}: a reelbook-old-history left by an earlier run is not overwritten`, {skip}, () => {
    const c = setup();
    const oldHead = git(c.inst, 'rev-parse', 'HEAD');
    git(c.inst, 'branch', 'reelbook-old-history');
    write(path.join(c.inst, 'tools/rb.py'), 'print("later")\n');
    const mine = commitAll(c.inst, 'later');
    const head = republish(c);
    const r = run(c.inst);
    assert.equal(r.status, 0, r.out);
    assert.equal(git(c.inst, 'rev-parse', 'HEAD'), head);
    assert.equal(git(c.inst, 'rev-parse', 'reelbook-old-history'), oldHead, 'the earlier branch is kept as it was');
    const dated = branches(c.inst).filter(([b]) => /^reelbook-old-history-\d{8}-\d{6}$/.test(b));
    assert.equal(dated.length, 1, branches(c.inst).join('; '));
    assert.equal(dated[0][1], mine, 'the current HEAD is in a dated branch');
    assert.ok(r.out.includes(`in the branch ${dated[0][0]})`), r.out);
    survived(c);
  });

  test(`${name}: local commits on the same history are never thrown away (the current version is kept)`, {skip}, () => {
    const c = setup();
    write(path.join(c.inst, 'tools/rb.py'), 'print("my change")\n');
    const mine = commitAll(c.inst, 'mine');
    write(path.join(c.old, 'README.md'), 'old history, next\n');
    commitAll(c.old, 'second');
    git(c.old, 'push', '-q', 'origin', 'main');
    const r = run(c.inst);
    assert.equal(r.status, 1);
    assert.equal(git(c.inst, 'rev-parse', 'HEAD'), mine);
    assert.deepEqual(branches(c.inst), [], 'no branch is made on the same history');
  });
}

newHistoryCases('install.sh', dir => {
  const r = runSh(dir);
  return {status: r.status, out: r.stdout + r.stderr};
});

const pwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1'], {encoding: 'utf8'}).status === 0;
const fnPs = cut(ps1, 'function Update-ReelbookRepo(');
newHistoryCases('install.ps1 (pwsh)', dir => {
  const r = spawnSync('pwsh', ['-NoProfile', '-Command',
    `$ErrorActionPreference = "Stop"\n${fnPs}\nif (Update-ReelbookRepo '${dir.replace(/'/g, "''")}') { exit 0 } else { exit 1 }`],
  {env, encoding: 'utf8', timeout: 60000});
  return {status: r.status, out: r.stdout + r.stderr};
}, pwsh ? false : 'pwsh is not installed here');
