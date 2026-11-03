// Bout en bout de codex-review.sh et codex-acceptance.sh avec un FAUX `codex` dans le PATH :
// il note ses arguments, son environnement et son prompt, puis rend une réponse en conserve.
// Aucun appel au vrai Codex, à gh ni au réseau.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, existsSync, symlinkSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = fileURLToPath(new URL('..', import.meta.url));

// Tous les dossiers temporaires sont supprimés à la fin.
const temps = [];
const tmp = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
};
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function fakeCodex() {
  const dir = tmp('fake-codex-');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'codex'),
    `#!/usr/bin/env bash
if [ "$1" = login ]; then echo "\${FAKE_CODEX_LOGIN:-Logged in using ChatGPT}"; exit 0; fi
printf '%s\\n' "$@" > "$FAKE_CODEX_DIR/args.txt"
# Les NOMS des variables de clé seulement (jamais leurs valeurs, jamais tout l'environnement).
env | grep -E '^(OPENAI_|CODEX_API_KEY)' | cut -d= -f1 > "$FAKE_CODEX_DIR/env.txt"
cat > "$FAKE_CODEX_DIR/prompt.txt"
out=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done
cat "$FAKE_CODEX_DIR/reply.json" > "$out"
`,
  );
  chmodSync(join(bin, 'codex'), 0o755);
  return {
    dir,
    reply: (obj) => writeFileSync(join(dir, 'reply.json'), typeof obj === 'string' ? obj : JSON.stringify(obj)),
    read: (f) => readFileSync(join(dir, f), 'utf8'),
    env: (extra = {}) => ({
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_CODEX_DIR: dir,
      OPENAI_API_KEY: 'sk-ne-doit-pas-passer',
      CODEX_API_KEY: 'ne-doit-pas-passer',
      ...extra,
    }),
  };
}

function repo() {
  const dir = tmp('codex-repo-');
  const git = (...a) => {
    const r = spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout;
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  const write = (p, c = 'x\n') => {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), c);
  };
  write('README.md');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return { dir, git, write };
}

const OK = { verdict: 'ok', resume: 'RAS.', points: [], donnees_existantes: 'Aucune ligne existante touchée.' };

test('codex-review.sh : zone protégée détectée, sandbox lecture seule, aucune clé d’API transmise', () => {
  const fake = fakeCodex();
  const r = repo();
  r.git('checkout', '-q', '-b', 'feat/x');
  r.write('supabase/migrations/20261020000001_a.sql', 'create table a(id int);\n');
  r.git('add', '-A');
  r.git('commit', '-q', '-m', 'feat: table a');

  fake.reply(OK);
  let res = spawnSync('bash', [join(SCRIPTS, 'codex-review.sh'), 'HEAD', '--base', 'main'], {
    cwd: r.dir,
    env: fake.env(),
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^verdict: ok\n<!-- codex-review sha=[0-9a-f]{40} zone=protegee verdict=ok -->/);

  const args = fake.read('args.txt').split('\n');
  assert.equal(args[0], 'exec');
  assert.equal(args[args.indexOf('-s') + 1], 'read-only');
  assert.ok(args.includes('--output-schema'));
  assert.ok(args.includes('--ephemeral'));
  assert.equal(args[args.indexOf('-c') + 1], 'forced_login_method="chatgpt"');
  const env = fake.read('env.txt');
  assert.doesNotMatch(env, /^OPENAI_API_KEY$/m);
  assert.doesNotMatch(env, /^CODEX_API_KEY$/m);
  const prompt = fake.read('prompt.txt');
  assert.match(prompt, /## Zone protégée/);
  assert.match(prompt, /supabase\/migrations\/20261020000001_a\.sql/);
  assert.match(prompt, /\+create table a\(id int\);/);

  // zone protégée sans réponse sur les données : bloquant (exit 1)
  fake.reply({ ...OK, donnees_existantes: '' });
  res = spawnSync('bash', [join(SCRIPTS, 'codex-review.sh'), 'HEAD', '--base', 'main'], {
    cwd: r.dir,
    env: fake.env(),
    encoding: 'utf8',
  });
  assert.equal(res.status, 1);
  assert.match(res.stdout, /^verdict: bloquant/);

  // sortie illisible : exit 3, jamais ok
  fake.reply('pas du json');
  res = spawnSync('bash', [join(SCRIPTS, 'codex-review.sh'), 'HEAD', '--base', 'main'], {
    cwd: r.dir,
    env: fake.env(),
    encoding: 'utf8',
  });
  assert.equal(res.status, 3);
  assert.doesNotMatch(res.stdout, /verdict: ok/);

  // connexion autre que ChatGPT : refus avant tout appel
  res = spawnSync('bash', [join(SCRIPTS, 'codex-review.sh'), 'HEAD', '--base', 'main'], {
    cwd: r.dir,
    env: fake.env({ FAKE_CODEX_LOGIN: 'Logged in using an API key' }),
    encoding: 'utf8',
  });
  assert.equal(res.status, 3);
  assert.match(res.stderr, /jamais par une clé d'API/);
});

test('codex-review.sh : diff hors zone protégée = variante standard', () => {
  const fake = fakeCodex();
  const r = repo();
  r.git('checkout', '-q', '-b', 'feat/y');
  r.write('apps/mobile/src/Home.tsx', 'export {}\n');
  r.git('add', '-A');
  r.git('commit', '-q', '-m', 'feat: home');
  fake.reply({ ...OK, donnees_existantes: '' });
  const res = spawnSync('bash', [join(SCRIPTS, 'codex-review.sh'), 'HEAD', '--base', 'main'], {
    cwd: r.dir,
    env: fake.env(),
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /zone=standard verdict=ok/);
  assert.doesNotMatch(fake.read('prompt.txt'), /## Zone protégée/);
});

test('codex-acceptance.sh : écrit sous la cible (espaces compris), maquette jointe, commit séparé', () => {
  const fake = fakeCodex();
  const r = repo();
  r.write('design/liste vide.png', 'png');
  r.write('apps/mobile/src/Home.tsx', 'prod\n');
  r.write('docs/s1/S1-A.md', '# S1-A\nMaquette : design/liste vide.png\n- critère 1\n');
  r.git('add', '-A');
  r.git('commit', '-q', '-m', 'spec');

  fake.reply({
    fichiers: [
      { chemin: 'liste.test.cjs', contenu: "test('critère 1', () => {});" },
      { chemin: 'flows/smoke.yaml', contenu: 'appId: guide.paul' },
    ],
    notes: '',
  });
  const out = 'apps/mobile/__acceptance__/s1 a';
  let res = spawnSync('bash', [join(SCRIPTS, 'codex-acceptance.sh'), 'docs/s1/S1-A.md', '--out', out, '--commit'], {
    cwd: r.dir,
    env: fake.env(),
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFileSync(join(r.dir, out, 'liste.test.cjs'), 'utf8'), "test('critère 1', () => {});\n");
  assert.ok(existsSync(join(r.dir, out, 'flows/smoke.yaml')));
  assert.equal(readFileSync(join(r.dir, 'apps/mobile/src/Home.tsx'), 'utf8'), 'prod\n');

  const args = fake.read('args.txt').split('\n');
  assert.equal(args[args.indexOf('-s') + 1], 'read-only');
  // une maquette citée avec un espace dans le nom n'est pas reconnue, sans rien casser ; le commit
  // séparé ne contient que les tests :
  const log = r.git('log', '-1', '--name-only', '--format=%s');
  assert.match(log, /^test\(acceptance\): S1-A/);
  assert.match(log, /__acceptance__\/s1 a\/liste\.test\.cjs/);
  assert.doesNotMatch(log, /Home\.tsx/);

  // une proposition hors cible ne touche pas au code de prod
  fake.reply({ fichiers: [{ chemin: '../../src/Home.tsx', contenu: 'piraté' }], notes: '' });
  res = spawnSync('bash', [join(SCRIPTS, 'codex-acceptance.sh'), 'docs/s1/S1-A.md', '--out', out], {
    cwd: r.dir,
    env: fake.env(),
    encoding: 'utf8',
  });
  assert.equal(res.status, 1);
  assert.equal(readFileSync(join(r.dir, 'apps/mobile/src/Home.tsx'), 'utf8'), 'prod\n');
});

test('codex-acceptance.sh : une maquette PNG citée est jointe en image', () => {
  const fake = fakeCodex();
  const r = repo();
  r.write('design/s1/liste.png', 'png');
  r.write('docs/s1/S1-B.md', '# S1-B\nMaquette : design/s1/liste.png et design/s1/absente.png\n');
  fake.reply({ fichiers: [{ chemin: 'b.test.cjs', contenu: 'x' }], notes: '' });
  const res = spawnSync('bash', [join(SCRIPTS, 'codex-acceptance.sh'), 'docs/s1/S1-B.md', '--out', 'acc'], {
    cwd: r.dir,
    env: fake.env(),
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  const args = fake.read('args.txt').split('\n');
  const i = args.indexOf('-i');
  assert.ok(i > -1, 'image jointe');
  assert.match(args[i + 1], /design\/s1\/liste\.png$/);
  assert.equal(args.filter((a) => /absente/.test(a)).length, 0);
  // `--` sépare les options du `-` (prompt sur stdin) : -i ne l'avale pas
  assert.deepEqual(args.slice(-3, -1), ['--', '-']);
});

test('codex-acceptance.sh : un --out lien symbolique vers l’extérieur du dépôt est refusé', () => {
  const fake = fakeCodex();
  const r = repo();
  r.write('docs/spec.md', '# Spec\n');
  const dehors = tmp('dehors-');
  symlinkSync(dehors, join(r.dir, 'lien'));
  fake.reply({ fichiers: [{ chemin: 'x.test.cjs', contenu: 'x' }], notes: '' });
  const res = spawnSync('bash', [join(SCRIPTS, 'codex-acceptance.sh'), 'docs/spec.md', '--out', 'lien/acc'], {
    cwd: r.dir,
    env: fake.env(),
    encoding: 'utf8',
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /--out doit être dans le dépôt/);
  assert.deepEqual(readdirSync(dehors), []); // rien créé dehors
});

test('codex-acceptance.sh : un --out avec « .. » est refusé avant toute création', () => {
  const fake = fakeCodex();
  const r = repo();
  r.write('docs/spec.md', '# Spec\n');
  fake.reply({ fichiers: [{ chemin: 'x.test.cjs', contenu: 'x' }], notes: '' });
  const nom = `hors-depot-${Date.now()}`;
  const res = spawnSync('bash', [join(SCRIPTS, 'codex-acceptance.sh'), 'docs/spec.md', '--out', `nouveau/../../${nom}`], {
    cwd: r.dir,
    env: fake.env(),
    encoding: 'utf8',
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /segment « \.\. »/);
  assert.equal(existsSync(join(r.dir, '..', nom)), false);
  assert.equal(existsSync(join(r.dir, 'nouveau')), false);
});

test('codex-acceptance.sh : un --out avec un caractère de contrôle est refusé avant toute création', () => {
  const fake = fakeCodex();
  const r = repo();
  r.write('docs/spec.md', '# Spec\n');
  fake.reply({ fichiers: [{ chemin: 'x.test.cjs', contenu: 'x' }], notes: '' });
  for (const out of ['foo\n', 'foo\nbar', 'foo\tbar', 'foo\rbar', 'foo\x7fbar']) {
    const res = spawnSync('bash', [join(SCRIPTS, 'codex-acceptance.sh'), 'docs/spec.md', '--out', out, '--commit'], {
      cwd: r.dir,
      env: fake.env(),
      encoding: 'utf8',
    });
    assert.equal(res.status, 2, JSON.stringify(out));
    assert.match(res.stderr, /aucun caractère de contrôle/);
    assert.equal(existsSync(join(r.dir, out)), false);
    assert.equal(existsSync(join(r.dir, 'foo')), false);
  }
});
