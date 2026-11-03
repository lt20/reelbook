// Règle d'arrêt de la revue Codex (docs/audit-design/COORDINATION.md) et cohérence du sha. Porté du kit du protocole.
// Bout en bout de codex-review.sh sur une PR, avec un FAUX `codex` et un FAUX `gh` dans le PATH :
// aucun appel au vrai Codex, à GitHub ni au réseau.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { countReviewPasses, diffFiles, renderComment, MAX_PASSES } from '../lib/codex.mjs';

const SCRIPTS = fileURLToPath(new URL('..', import.meta.url));
const temps = [];
const tmp = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
};
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const OK = { verdict: 'ok', resume: 'RAS.', points: [], donnees_existantes: '' };
const DIFF = `diff --git a/apps/mobile/src/app/index.tsx b/apps/mobile/src/app/index.tsx
index 1111111..2222222 100644
--- a/apps/mobile/src/app/index.tsx
+++ b/apps/mobile/src/app/index.tsx
@@ -1 +1 @@
-export const a = 1;
+export const a = 2;
`;
const marker = (sha) => `<!-- codex-review sha=${sha} zone=standard verdict=bloquant -->\n## 🔎 Revue Codex`;

// Faux `codex` (comme codex-scripts.test.mjs) + faux `gh` :
//   - `gh pr view` rend view<N>.json au N-ième appel (ou view.json à défaut) ;
//   - `gh api` note ses arguments et rend diff.patch ;
//   - `gh pr comment --body-file F` copie F dans posted.md.
function fakes() {
  const dir = tmp('fake-codex-gh-');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'codex'),
    `#!/usr/bin/env bash
if [ "$1" = login ]; then echo "Logged in using ChatGPT"; exit 0; fi
cat > "$FAKE_DIR/prompt.txt"
out=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done
cat "$FAKE_DIR/reply.json" > "$out"
`,
  );
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env bash
case "$1 $2" in
  "pr view")
    n=$(( $(cat "$FAKE_DIR/views" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FAKE_DIR/views"
    if [ -f "$FAKE_DIR/view$n.json" ]; then cat "$FAKE_DIR/view$n.json"; else cat "$FAKE_DIR/view.json"; fi ;;
  "pr comment")
    while [ $# -gt 0 ]; do case "$1" in --body-file) cp "$2" "$FAKE_DIR/posted.md"; shift 2 ;; *) shift ;; esac; done ;;
  "api user") echo "\${FAKE_GH_LOGIN:-lt20}" ;;
  api*)
    printf '%s\\n' "$@" > "$FAKE_DIR/api.txt"; cat "$FAKE_DIR/diff.patch" ;;
  *) echo "gh factice : $*" >&2; exit 1 ;;
esac
`,
  );
  chmodSync(join(bin, 'codex'), 0o755);
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(join(dir, 'reply.json'), JSON.stringify(OK));
  writeFileSync(join(dir, 'diff.patch'), DIFF);
  const view = (n, { sha = SHA_A, headRefName = 'feat/x', comments = [] } = {}) =>
    writeFileSync(
      join(dir, n ? `view${n}.json` : 'view.json'),
      JSON.stringify({ headRefOid: sha, headRefName, baseRefName: 'main', title: 'feat: x', body: 'corps', comments }),
    );
  return {
    dir,
    view,
    has: (f) => existsSync(join(dir, f)),
    read: (f) => readFileSync(join(dir, f), 'utf8'),
    env: (extra = {}) => ({
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_DIR: dir,
      CODEX_REVIEW_HEAD_DELAY: '0',
      ...extra,
    }),
  };
}

function repo() {
  const dir = tmp('codex-arret-repo-');
  const git = (...a) => {
    const r = spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return { dir, git };
}

const review = (cwd, env, ...args) =>
  spawnSync('bash', [join(SCRIPTS, 'codex-review.sh'), ...args], { cwd, env, encoding: 'utf8' });

test('codex-review.sh <PR> --post : diff demandé pour le sha lu, marqueur sur ce sha, passe 1/3', () => {
  const f = fakes();
  const r = repo();
  f.view(0, { sha: SHA_A });
  const res = review(r.dir, f.env(), '12', '--post');
  assert.equal(res.status, 0, res.stderr);
  const api = f.read('api.txt');
  assert.match(api, new RegExp(`compare/main\\.\\.\\.${SHA_A}`));
  assert.match(api, /application\/vnd\.github\.v3\.diff/);
  const posted = f.read('posted.md');
  assert.match(posted, new RegExp(`^<!-- codex-review sha=${SHA_A} zone=standard verdict=ok -->`));
  assert.match(posted, /Passe 1\/3/);
  // la liste des fichiers vient du diff lui-même
  assert.match(f.read('prompt.txt'), /## Fichiers modifiés\n- apps\/mobile\/src\/app\/index\.tsx\n/);
});

test('codex-review.sh : la consigne porte la définition de la sévérité (standard et zone protégée)', () => {
  const f = fakes();
  const r = repo();
  f.view(0);
  assert.equal(review(r.dir, f.env(), '12').status, 0);
  const standard = f.read('prompt.txt');
  assert.match(standard, /## Sévérité \(règle d'arrêt/);
  assert.match(standard, /scénario concret/);
  assert.match(standard, /l'app.*les données.*la sécurité.*la release/s);
  assert.match(standard, /Scénario : <entrée ou action précise> → <effet observable>/);
  assert.match(standard, /outillage interne.*jamais.*bloquants/s);
  assert.match(standard, /trois passes de revue au plus/);

  assert.equal(review(r.dir, f.env(), '12', '--zone', 'protegee').status, 1); // données vides → bloquant
  const protegee = f.read('prompt.txt');
  assert.match(protegee, /## Sévérité \(règle d'arrêt/);
  assert.match(protegee, /## Zone protégée/);
  assert.match(protegee, /Scénario : <entrée> → <effet>/);
});

test('codex-review.sh : 3 marqueurs déjà postés → la 4e passe est refusée (exit 4), sauf --force-pass', () => {
  const f = fakes();
  const r = repo();
  const comments = [
    { author: { login: 'lt20' }, body: marker('1'.repeat(40)) },
    { author: { login: 'lt20' }, body: 'un commentaire humain sans marqueur' },
    { author: { login: 'lt20' }, body: marker('2'.repeat(40)) },
    { author: { login: 'autre' }, body: marker('9'.repeat(40)) }, // un tiers : ne compte pas
    { author: { login: 'LT20' }, body: marker('3'.repeat(40)) },
  ];
  f.view(0, { comments });
  let res = review(r.dir, f.env(), '12', '--post');
  assert.equal(res.status, 4);
  assert.match(res.stderr, /3 passes atteintes : arbitrage du coordinateur \(docs\/audit-design\/COORDINATION\.md\)/);
  assert.equal(f.has('prompt.txt'), false, 'Codex ne doit pas être lancé');
  assert.equal(f.has('posted.md'), false, 'rien ne doit être publié');

  res = review(r.dir, f.env(), '12', '--post', '--force-pass');
  assert.equal(res.status, 0, res.stderr);
  assert.match(f.read('posted.md'), /Passe 4 \(au-delà de 3, `--force-pass`/);
});

test('codex-review.sh : 2 marqueurs du compte (+ 2 de tiers) → la 3e passe passe et se dit la dernière', () => {
  const f = fakes();
  const r = repo();
  const by = (login, sha) => ({ author: { login }, body: marker(sha) });
  f.view(0, { comments: [by('lt20', '1'.repeat(40)), by('lt20', '2'.repeat(40)), by('x', '3'.repeat(40)), by('y', '4'.repeat(40))] });
  const res = review(r.dir, f.env(), '12', '--post');
  assert.equal(res.status, 0, res.stderr);
  assert.match(f.read('posted.md'), /Passe 3\/3 — dernière/);
});

test('codex-review.sh : la tête GitHub bouge pendant la revue → rien publié (exit 5)', () => {
  const f = fakes();
  const r = repo();
  f.view(1, { sha: SHA_A }); // lecture initiale
  f.view(0, { sha: SHA_B }); // relecture avant publication : un push est arrivé
  const res = review(r.dir, f.env(), '12', '--post');
  assert.equal(res.status, 5);
  assert.match(res.stderr, /la tête a bougé pendant la revue/);
  assert.equal(f.has('posted.md'), false);
});

test('codex-review.sh : relue depuis sa branche, la PR attend que GitHub voie le push (sha local au marqueur)', () => {
  const f = fakes();
  const r = repo();
  r.git('checkout', '-q', '-b', 'feat/x');
  const local = r.git('rev-parse', 'HEAD');
  f.view(1, { sha: SHA_A, headRefName: 'feat/x' }); // vue périmée juste après le push
  f.view(0, { sha: local, headRefName: 'feat/x' }); // GitHub a rattrapé
  const res = review(r.dir, f.env(), '12', '--post');
  assert.equal(res.status, 0, res.stderr);
  assert.match(f.read('api.txt'), new RegExp(`compare/main\\.\\.\\.${local}`));
  assert.match(f.read('posted.md'), new RegExp(`^<!-- codex-review sha=${local} `));
});

test('codex-review.sh : tête locale ≠ tête GitHub qui ne rattrape pas → refus avant la revue (exit 5)', () => {
  const f = fakes();
  const r = repo();
  r.git('checkout', '-q', '-b', 'feat/x');
  f.view(0, { sha: SHA_A, headRefName: 'feat/x' });
  const res = review(r.dir, f.env({ CODEX_REVIEW_HEAD_TRIES: '3' }), '12', '--post');
  assert.equal(res.status, 5);
  assert.match(res.stderr, /tête locale .* ≠ tête GitHub/);
  assert.equal(f.has('prompt.txt'), false);
  assert.equal(f.has('posted.md'), false);
  assert.equal(f.read('views').trim(), '3'); // 1 lecture + 2 relectures
});

test('countReviewPasses : marqueurs des seuls auteurs donnés (tous sans liste), JSON illisible = 0', () => {
  const comments = [
    { author: { login: 'lt20' }, body: marker('1') },
    { author: { login: 'lt20' }, body: 'rien' },
    { author: { login: 'tiers' }, body: marker('2') },
  ];
  assert.equal(countReviewPasses({ comments }, { authors: ['lt20'] }), 1);
  assert.equal(countReviewPasses({ comments }), 2);
  assert.equal(countReviewPasses('pas du json'), 0);
  assert.equal(countReviewPasses({}), 0);
  assert.equal(MAX_PASSES, 3);
});

test('diffFiles : modifié, supprimé, renommé, binaire, espaces', () => {
  const diff = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    'diff --git a/gone.sql b/gone.sql',
    'deleted file mode 100644',
    '--- a/gone.sql',
    '+++ /dev/null',
    'diff --git a/old.md b/new.md',
    'similarity index 100%',
    'rename from old.md',
    'rename to new.md',
    'diff --git a/img/x y.png b/img/x y.png',
    'Binary files a/img/x y.png and b/img/x y.png differ',
  ].join('\n');
  assert.deepEqual(diffFiles(diff), ['a.ts', 'gone.sql', 'new.md', 'img/x y.png']);
  assert.deepEqual(diffFiles(''), []);
});

test('renderComment : la passe est affichée, le marqueur reste au format lu par le coordinateur', () => {
  const out = renderComment({ verdict: 'ok', points: [] }, { sha: SHA_A, passe: 2 });
  assert.match(out, new RegExp(`^<!-- codex-review sha=${SHA_A} zone=standard verdict=ok -->\n`));
  assert.match(out, /Passe 2\/3\n/);
  assert.doesNotMatch(renderComment({ verdict: 'ok', points: [] }, { sha: SHA_A }), /Passe/);
});
