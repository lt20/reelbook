// Tests de scripts/lib/codex.mjs — node --test scripts/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  isProtectedPath,
  zoneOf,
  parseReview,
  renderComment,
  verdictFromComments as vfc,
  planAcceptanceFiles,
} from '../lib/codex.mjs';

const CLI = fileURLToPath(new URL('../lib/codex.mjs', import.meta.url));

test('zones protégées Reelbook : supabase, .github, config du backend, installeurs, rb.py, secrets', () => {
  for (const p of [
    'supabase/schema.sql',
    'supabase/migrations/20261019_x.sql',
    '.github/workflows/ci.yml',
    'app/config.js',
    'app/install.sh',
    'app/install.ps1',
    'tools/rb.py',
    '.env.local',
    'tools/.env',
    'certs/key.pem',
  ]) {
    assert.equal(isProtectedPath(p), true, p);
  }
  for (const p of [
    'app/index.html',
    'app/sessions.js',
    'app/config.example.js',
    'tools/nightly.sh',
    'tools/crop.py',
    'tests/auth-flow.test.cjs',
    'scripts/codex-review.sh',
    'README.md',
    '',
  ]) {
    assert.equal(isProtectedPath(p), false, p);
  }
  assert.equal(zoneOf(['README.md', 'app/index.html']), 'standard');
  assert.equal(zoneOf(['README.md', 'supabase/schema.sql']), 'protegee');
});

test('parseReview : seul un ok propre vaut ok', () => {
  const ok = parseReview(JSON.stringify({ verdict: 'ok', resume: 'RAS', points: [], donnees_existantes: '' }));
  assert.equal(ok.verdict, 'ok');

  const bl = parseReview(JSON.stringify({ verdict: 'bloquant', resume: 'x', points: [], donnees_existantes: '' }));
  assert.equal(bl.verdict, 'bloquant');

  // ok contredit par un point bloquant → bloquant
  const contra = parseReview(
    JSON.stringify({
      verdict: 'ok',
      resume: '',
      points: [{ gravite: 'bloquant', fichier: 'a.ts', ligne: 3, constat: 'fuite' }],
      donnees_existantes: '',
    }),
  );
  assert.equal(contra.verdict, 'bloquant');
  assert.equal(contra.contradiction, true);

  // ok avec une simple attention reste ok
  const att = parseReview(
    JSON.stringify({ verdict: 'OK', resume: '', points: [{ gravite: 'attention', fichier: '', ligne: null, constat: 'x' }], donnees_existantes: '' }),
  );
  assert.equal(att.verdict, 'ok');

  assert.equal(parseReview('').verdict, 'invalide');
  assert.equal(parseReview('pas du json').verdict, 'invalide');
  assert.equal(parseReview('[]').verdict, 'invalide');
  assert.equal(parseReview(JSON.stringify({ verdict: 'peut-être' })).verdict, 'invalide');
  assert.equal(parseReview(JSON.stringify({})).verdict, 'invalide');

  // zone protégée : sans réponse sur les données existantes, un ok devient bloquant
  const sansDonnees = JSON.stringify({ verdict: 'ok', resume: '', points: [], donnees_existantes: '  ' });
  assert.equal(parseReview(sansDonnees).verdict, 'ok');
  const p = parseReview(sansDonnees, { zone: 'protegee' });
  assert.equal(p.verdict, 'bloquant');
  assert.equal(p.donneesManquantes, true);
  assert.match(renderComment(p, { sha: 'a', zone: 'protegee' }), /verdict=bloquant/);
  const avec = JSON.stringify({ verdict: 'ok', resume: '', points: [], donnees_existantes: 'Aucune donnée touchée.' });
  assert.equal(parseReview(avec, { zone: 'protegee' }).verdict, 'ok');
});

test('renderComment : marqueur machine, verdict, question des données en zone protégée', () => {
  const r = parseReview(JSON.stringify({ verdict: 'ok', resume: 'Rien à signaler.', points: [], donnees_existantes: 'Conservées.' }));
  const c = renderComment(r, { sha: 'abc123def4567890', zone: 'protegee', cible: 'PR #7' });
  assert.match(c.split('\n')[0], /^<!-- codex-review sha=abc123def4567890 zone=protegee verdict=ok -->$/);
  assert.match(c, /\*\*Verdict : ok\*\*/);
  assert.match(c, /Que se passe-t-il pour les données existantes au déploiement \?/);
  assert.match(c, /Conservées\./);

  const std = renderComment(r, { sha: 'abc', zone: 'standard' });
  assert.doesNotMatch(std, /données existantes/);

  // une sortie invalide se publie comme bloquante, jamais comme ok
  const inv = renderComment(parseReview('???'), { sha: 'abc', zone: 'standard' });
  assert.match(inv, /verdict=bloquant/);
  assert.match(inv, /inexploitable/);

  // zone protégée sans réponse sur les données : signalé
  const vide = renderComment(
    parseReview(JSON.stringify({ verdict: 'ok', resume: '', points: [], donnees_existantes: '' }), { zone: 'protegee' }),
    { sha: 'a', zone: 'protegee' },
  );
  assert.match(vide, /n’a pas répondu/);
  assert.match(vide, /sans réponse sur les données existantes/);
});

test('verdictFromComments : dernier verdict, périmé si autre commit, absent sinon', () => {
  const head = 'aaaa1111';
  const mk = (sha, verdict, zone = 'protegee', login = 'lt20') => ({
    author: { login },
    body: `<!-- codex-review sha=${sha} zone=${zone} verdict=${verdict} -->\n## Revue`,
  });
  const verdictFromComments = (json, sha = '', opts = { authors: ['lt20'] }) => vfc(json, sha, opts);

  assert.deepEqual(verdictFromComments({ comments: [], headRefOid: head }), { etat: 'absent', zone: '', sha: '' });
  assert.equal(verdictFromComments('pas du json').etat, 'absent');
  assert.equal(verdictFromComments({ comments: [{ body: 'LGTM' }], headRefOid: head }).etat, 'absent');

  assert.deepEqual(verdictFromComments({ comments: [mk(head, 'ok')], headRefOid: head }), {
    etat: 'ok',
    zone: 'protegee',
    sha: head,
  });
  // le dernier commentaire l'emporte
  assert.equal(verdictFromComments({ comments: [mk(head, 'ok'), mk(head, 'bloquant')], headRefOid: head }).etat, 'bloquant');
  assert.equal(verdictFromComments({ comments: [mk(head, 'bloquant'), mk(head, 'ok')], headRefOid: head }).etat, 'ok');
  // un ok sur un ancien commit est périmé
  assert.equal(verdictFromComments({ comments: [mk('bbbb2222', 'ok')], headRefOid: head }).etat, 'perime');
  // la zone est rapportée telle quelle
  assert.equal(verdictFromComments({ comments: [mk(head, 'ok', 'standard')], headRefOid: head }).zone, 'standard');

  // seuls les comptes autorisés comptent : un marqueur posé par un autre est ignoré
  assert.equal(verdictFromComments({ comments: [mk(head, 'ok', 'protegee', 'intrus')], headRefOid: head }).etat, 'absent');
  assert.equal(
    verdictFromComments({ comments: [mk(head, 'bloquant'), mk(head, 'ok', 'protegee', 'intrus')], headRefOid: head }).etat,
    'bloquant',
  );
  assert.equal(verdictFromComments({ comments: [mk(head, 'ok', 'protegee', 'LT20')], headRefOid: head }).etat, 'ok');
  // sans liste d'auteurs, rien ne compte
  assert.equal(vfc({ comments: [mk(head, 'ok')], headRefOid: head }).etat, 'absent');
});

test('planAcceptanceFiles : seulement des tests, seulement sous le dossier cible', () => {
  const out = '/repo/apps/mobile/__acceptance__/s1';
  const never = () => false;
  const ok = planAcceptanceFiles(
    JSON.stringify({
      fichiers: [
        { chemin: 'liste.test.cjs', contenu: 'test()' },
        { chemin: 'flows/smoke.yaml', contenu: 'appId: x' },
        { chemin: 'README.md', contenu: '# x' },
      ],
      notes: 'q1',
    }),
    out,
    { exists: never },
  );
  assert.equal(ok.ok, true, ok.erreurs.join('\n'));
  assert.deepEqual(
    ok.fichiers.map((f) => f.rel),
    ['liste.test.cjs', 'flows/smoke.yaml', 'README.md'],
  );

  const bad = planAcceptanceFiles(
    JSON.stringify({
      fichiers: [
        { chemin: '../../src/screens/Home.tsx', contenu: 'x' },
        { chemin: '/etc/passwd', contenu: 'x' },
        { chemin: 'helpers.ts', contenu: 'x' },
        { chemin: 'a/../../b.test.cjs', contenu: 'x' },
      ],
      notes: '',
    }),
    out,
    { exists: never },
  );
  assert.equal(bad.ok, false);
  // 4 chemins refusés + « aucun test node:test » (rien d'exécutable ne reste)
  assert.equal(bad.erreurs.length, 5);
  // Reelbook : un README seul (ou un YAML seul) n'est pas un jeu de tests d'acceptation
  const docOnly = planAcceptanceFiles(JSON.stringify({ fichiers: [{ chemin: 'README.md', contenu: 'x' }], notes: '' }), out, { exists: never });
  assert.equal(docOnly.ok, false);
  assert.match(docOnly.erreurs.join('\n'), /aucun test node:test/);

  const exists = planAcceptanceFiles(JSON.stringify({ fichiers: [{ chemin: 'x.test.cjs', contenu: '' }], notes: '' }), out, {
    exists: () => true,
  });
  assert.equal(exists.ok, false);
  assert.match(exists.erreurs[0], /--force/);
  const forced = planAcceptanceFiles(JSON.stringify({ fichiers: [{ chemin: 'x.test.cjs', contenu: '' }], notes: '' }), out, {
    exists: () => true,
    force: true,
  });
  assert.equal(forced.ok, true);

  // un sous-dossier lien symbolique vers l'extérieur est refusé
  const real = mkdtempSync(join(tmpdir(), 'acc-real-'));
  const ailleurs = mkdtempSync(join(tmpdir(), 'acc-ailleurs-'));
  symlinkSync(ailleurs, join(real, 'lien'));
  const sym = planAcceptanceFiles(JSON.stringify({ fichiers: [{ chemin: 'lien/x.test.cjs', contenu: '' }], notes: '' }), real);
  assert.equal(sym.ok, false);
  assert.match(sym.erreurs[0], /lien symbolique/);
  mkdirSync(join(real, 'vrai'));
  assert.equal(planAcceptanceFiles(JSON.stringify({ fichiers: [{ chemin: 'vrai/x.test.cjs', contenu: '' }], notes: '' }), real).ok, true);

  // un saut de ligne dans un chemin fabriquerait un second chemin pour --commit
  const nl = planAcceptanceFiles(
    JSON.stringify({ fichiers: [{ chemin: 'a.test.cjs\n../../src/Home.tsx', contenu: '' }], notes: '' }),
    out,
    { exists: never },
  );
  assert.equal(nl.ok, false);
  assert.match(nl.erreurs[0], /caractère de contrôle/);

  assert.equal(planAcceptanceFiles('{', out).ok, false);
  assert.equal(planAcceptanceFiles(JSON.stringify({ fichiers: [], notes: '' }), out).ok, false);
});

test('CLI : parse rend le code de sortie, acceptance-files écrit sous la cible', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-cli-'));
  const f = join(dir, 'out.json');
  writeFileSync(f, JSON.stringify({ verdict: 'ok', resume: '', points: [], donnees_existantes: '' }));
  let r = spawnSync(process.execPath, [CLI, 'parse', f], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'ok');
  writeFileSync(f, JSON.stringify({ verdict: 'bloquant', resume: '', points: [], donnees_existantes: '' }));
  r = spawnSync(process.execPath, [CLI, 'parse', f], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  writeFileSync(f, 'cassé');
  r = spawnSync(process.execPath, [CLI, 'parse', f], { encoding: 'utf8' });
  assert.equal(r.status, 3);
  r = spawnSync(process.execPath, [CLI, 'parse', join(dir, 'absent.json')], { encoding: 'utf8' });
  assert.equal(r.status, 3);

  r = spawnSync(process.execPath, [CLI, 'zone'], { input: 'README.md\n.github/workflows/x.yml\n', encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'protegee');

  const target = join(dir, 'acc');
  writeFileSync(f, JSON.stringify({ fichiers: [{ chemin: 'a/b.test.cjs', contenu: 'x' }], notes: '' }));
  r = spawnSync(process.execPath, [CLI, 'acceptance-files', f, target], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(target, 'a/b.test.cjs'), 'utf8'), 'x\n');
  // deuxième passage sans --force : refusé, rien écrasé
  writeFileSync(f, JSON.stringify({ fichiers: [{ chemin: 'a/b.test.cjs', contenu: 'y' }], notes: '' }));
  r = spawnSync(process.execPath, [CLI, 'acceptance-files', f, target], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(readFileSync(join(target, 'a/b.test.cjs'), 'utf8'), 'x\n');
  // un chemin hors cible ne crée rien
  writeFileSync(f, JSON.stringify({ fichiers: [{ chemin: '../evil.test.cjs', contenu: 'z' }], notes: '' }));
  r = spawnSync(process.execPath, [CLI, 'acceptance-files', f, target], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(existsSync(join(dir, 'evil.test.cjs')), false);
});

test('pr-verdict en CLI lit le JSON de gh sur stdin', () => {
  const json = JSON.stringify({
    headRefOid: 'h1',
    comments: [{ author: { login: 'lt20' }, body: '<!-- codex-review sha=h1 zone=protegee verdict=ok -->' }],
  });
  let r = spawnSync(process.execPath, [CLI, 'pr-verdict', 'lt20'], { input: json, encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'ok protegee h1');
  r = spawnSync(process.execPath, [CLI, 'pr-verdict', 'autre,encore'], { input: json, encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'absent - -');
  r = spawnSync(process.execPath, [CLI, 'pr-verdict', ''], { input: json, encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'absent - -');
});
