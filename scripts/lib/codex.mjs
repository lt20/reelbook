#!/usr/bin/env node
// codex.mjs — la logique pure du « second regard » Codex, partagée par
// `scripts/codex-review.sh` et `scripts/codex-acceptance.sh`.
// Porté du kit du protocole Paul (~/dev/protocole/kit), sans la release ni le garde CI.
//
// Rien ici n'appelle Codex ni le réseau : on lit ce que Codex a rendu (un JSON contraint par
// un schéma), on le juge, on le met en forme, et on relit les commentaires de PR pour
// retrouver le dernier verdict. C'est ce que les tests figent (`scripts/tests/codex.test.mjs`).
//
// Règle d'or : seul un JSON valide disant exactement `ok`, sans point `bloquant`, vaut `ok`.
// Tout le reste (sortie vide, JSON cassé, verdict inconnu, contradiction) vaut `bloquant`
// ou `invalide` — jamais un `ok` par défaut.
//
// Usage en ligne de commande (pour les scripts bash) :
//   node codex.mjs zone                         < liste de fichiers  → « protegee » | « standard »
//   node codex.mjs protected                    < liste de fichiers  → les fichiers en zone protégée
//   node codex.mjs parse <sortie.json> [zone]                         → « ok » | « bloquant » | « invalide » (exit 0/1/3)
//   node codex.mjs render <sortie.json> <sha> <zone> <cible>         → le commentaire Markdown
//   node codex.mjs pr-verdict <auteurs,…> [sha] < JSON gh pr view --json comments,headRefOid → « ok zone sha »
//   node codex.mjs pr-passes [auteurs,…]   < JSON gh pr view --json comments         → nombre de passes
//   node codex.mjs diff-files              < diff unifié                             → fichiers du diff
//   node codex.mjs acceptance-files <sortie.json> <dossier>           → écrit les fichiers (voir plus bas)

import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync, lstatSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = 'codex-review';
// Règle d'arrêt (protocole Paul, repris dans `docs/audit-design/COORDINATION.md`) : trois passes de revue au plus par PR,
// ensuite le coordinateur arbitre.
export const MAX_PASSES = 3;

// ── Zones protégées ─────────────────────────────────────────────────────────────────
// Reelbook (`docs/audit-design/lots/L0.md` §1) : schéma et RLS (`supabase/`), CI (`.github/`),
// configuration du backend de l'app (`app/config.js`), installeurs du CLI (`app/install.*`),
// CLI qui écrit dans le backend (`tools/rb.py`), plus tout ce qui ressemble à un secret.
const PROTECTED = [
  /^supabase\//,
  /^\.github\//,
  /^app\/config\.js$/,
  /^app\/install\.(sh|ps1)$/,
  /^tools\/rb\.py$/,
  /(^|\/)\.env(\.|$)/,
  /(^|\/)secrets?(\/|\.)/i,
  /\.(p8|p12|pem|key)$/,
];

export function isProtectedPath(path) {
  const p = String(path || '').trim().replace(/^\.\//, '');
  return p !== '' && PROTECTED.some((re) => re.test(p));
}

export function protectedFiles(files) {
  return files.map((f) => f.trim()).filter(isProtectedPath);
}

export function zoneOf(files) {
  return protectedFiles(files).length > 0 ? 'protegee' : 'standard';
}

// ── Sortie de Codex ─────────────────────────────────────────────────────────────────
// Le schéma (`scripts/codex/review.schema.json`) impose { verdict, resume, points[],
// donnees_existantes }. On revérifie ici : le schéma est une demande, pas une garantie.
export function parseReview(text, { zone = 'standard' } = {}) {
  let data;
  try {
    data = JSON.parse(String(text || '').trim());
  } catch {
    return { verdict: 'invalide', raison: 'sortie Codex illisible (JSON invalide ou vide)' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { verdict: 'invalide', raison: 'sortie Codex : objet attendu' };
  }
  const points = Array.isArray(data.points) ? data.points : [];
  const resume = typeof data.resume === 'string' ? data.resume.trim() : '';
  const donnees = typeof data.donnees_existantes === 'string' ? data.donnees_existantes.trim() : '';
  const v = typeof data.verdict === 'string' ? data.verdict.trim().toLowerCase() : '';
  if (v !== 'ok' && v !== 'bloquant') {
    return { verdict: 'invalide', raison: `verdict inconnu : « ${data.verdict ?? ''} »`, resume, points, donnees };
  }
  // Un `ok` qui porte un point bloquant se contredit : on retient le plus prudent.
  const hasBlocking = points.some((p) => p && String(p.gravite).toLowerCase() === 'bloquant');
  // En zone protégée, la question des données existantes est obligatoire : sans réponse, la
  // revue ne peut pas autoriser le merge.
  const donneesManquantes = zone === 'protegee' && donnees === '';
  const verdict = v === 'ok' && (hasBlocking || donneesManquantes) ? 'bloquant' : v;
  return { verdict, resume, points, donnees, contradiction: v === 'ok' && hasBlocking, donneesManquantes };
}

// ── Commentaire de PR ───────────────────────────────────────────────────────────────
// La première ligne est un marqueur HTML lisible par machine : c'est lui que le coordinateur
// relit avant le merge, pas la prose. `sha` = le commit relu : un verdict sur un autre commit est périmé.
export function renderComment(review, { sha = '', zone = 'standard', cible = '', passe = 0 } = {}) {
  const v = review.verdict === 'ok' ? 'ok' : 'bloquant';
  const icon = v === 'ok' ? '✅' : '⛔';
  const lines = [];
  lines.push(`<!-- ${MARKER} sha=${sha || 'inconnu'} zone=${zone} verdict=${v} -->`);
  lines.push(`## 🔎 Revue Codex${zone === 'protegee' ? ' — zone protégée' : ''}`);
  lines.push('');
  lines.push(`**Verdict : ${v}** ${icon}`);
  lines.push('');
  if (cible || sha) lines.push(`Relu : \`${cible || '?'}\`${sha ? ` @ \`${sha.slice(0, 12)}\`` : ''}`);
  if (passe > 0) {
    lines.push('');
    lines.push(
      passe <= MAX_PASSES
        ? `Passe ${passe}/${MAX_PASSES}${passe === MAX_PASSES ? ' — dernière : ensuite, arbitrage du coordinateur' : ''}`
        : `Passe ${passe} (au-delà de ${MAX_PASSES}, \`--force-pass\` : arbitrage du coordinateur)`,
    );
  }
  if (review.verdict === 'invalide') {
    lines.push('');
    lines.push(`> Sortie Codex inexploitable (${review.raison}) : compté comme **bloquant**.`);
  }
  if (review.donneesManquantes) {
    lines.push('');
    lines.push('> Zone protégée sans réponse sur les données existantes : retenu comme **bloquant**.');
  }
  if (review.contradiction) {
    lines.push('');
    lines.push('> Codex a répondu `ok` avec un point `bloquant` : retenu comme **bloquant**.');
  }
  if (review.resume) {
    lines.push('');
    lines.push(review.resume);
  }
  if (Array.isArray(review.points) && review.points.length > 0) {
    lines.push('');
    for (const p of review.points) {
      if (!p) continue;
      const where = p.fichier ? ` \`${p.fichier}${p.ligne ? `:${p.ligne}` : ''}\`` : '';
      lines.push(`- **${p.gravite || 'remarque'}**${where} — ${p.constat || ''}`);
    }
  }
  if (zone === 'protegee') {
    lines.push('');
    lines.push('**Que se passe-t-il pour les données existantes au déploiement ?**');
    lines.push('');
    lines.push(review.donnees || '_Codex n’a pas répondu à cette question : à traiter comme bloquant._');
  }
  lines.push('');
  lines.push('<sub>`scripts/codex-review.sh` — Codex en local (connexion ChatGPT), sandbox lecture seule.</sub>');
  return lines.join('\n') + '\n';
}

// ── Relecture des commentaires d'une PR ─────────────────────────────────────────────
// Entrée : le JSON de `gh pr view <n> --json comments,headRefOid`. Sortie : le DERNIER
// verdict Codex, avec son état vis-à-vis du commit de tête de la PR.
//   { etat: 'ok' | 'bloquant' | 'perime' | 'absent', zone, sha }
// `authors` : seuls les commentaires de ces comptes GitHub comptent (le compte qui lance
// codex-review.sh --post, celui de Laurent). Sans liste, aucun commentaire ne compte : un
// marqueur posé par n'importe qui ne doit pas valoir un verdict.
// Limite assumée : le marqueur n'est pas signé ; qui tient le compte de Laurent peut l'écrire.
export function verdictFromComments(json, headSha = '', { authors = [] } = {}) {
  let data = json;
  if (typeof json === 'string') {
    try {
      data = JSON.parse(json);
    } catch {
      return { etat: 'absent', zone: '', sha: '' };
    }
  }
  const head = headSha || data?.headRefOid || '';
  const comments = Array.isArray(data?.comments) ? data.comments : [];
  const re = new RegExp(`<!--\\s*${MARKER}\\s+sha=(\\S+)\\s+zone=(\\S+)\\s+verdict=(\\S+)\\s*-->`);
  let last = null;
  const allowed = new Set(authors.map((a) => String(a).trim().toLowerCase()).filter(Boolean));
  for (const c of comments) {
    if (!allowed.has(String(c?.author?.login || '').toLowerCase())) continue;
    const m = re.exec(String(c?.body || ''));
    if (m) last = { sha: m[1], zone: m[2], verdict: m[3] };
  }
  if (!last) return { etat: 'absent', zone: '', sha: '' };
  if (head && last.sha !== head) return { etat: 'perime', zone: last.zone, sha: last.sha };
  return { etat: last.verdict === 'ok' ? 'ok' : 'bloquant', zone: last.zone, sha: last.sha };
}

// ── Compteur de passes ──────────────────────────────────────────────────────────────
// Entrée : le JSON de `gh pr view <n> --json comments`. Sortie : le nombre de commentaires qui
// portent un marqueur `codex-review`, posés par l'un des `authors` (le compte qui lance
// codex-review.sh --post, comme pour `verdictFromComments`) : un tiers qui colle des marqueurs ne
// doit pas épuiser les passes. Sans liste d'auteurs, tous comptent (sens prudent).
export function countReviewPasses(json, { authors = [] } = {}) {
  let data = json;
  if (typeof json === 'string') {
    try {
      data = JSON.parse(json);
    } catch {
      return 0;
    }
  }
  const comments = Array.isArray(data?.comments) ? data.comments : [];
  const re = new RegExp(`<!--\\s*${MARKER}\\s+sha=`);
  const allowed = new Set(authors.map((a) => String(a).trim().toLowerCase()).filter(Boolean));
  return comments.filter(
    (c) =>
      (allowed.size === 0 || allowed.has(String(c?.author?.login || '').toLowerCase())) &&
      re.test(String(c?.body || '')),
  ).length;
}

// ── Fichiers d'un diff unifié ───────────────────────────────────────────────────────
// La liste des fichiers est tirée du diff lui-même (et pas d'un second appel) : diff et liste
// viennent de la même source, donc du même commit.
export function diffFiles(text) {
  const files = [];
  const seen = new Set();
  const add = (f) => {
    if (f && !seen.has(f)) {
      seen.add(f);
      files.push(f);
    }
  };
  const unquote = (p) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p);
  let cur = null;
  // A rename (or a move with edits) lists both paths: the source path decides the zone too
  // (renaming supabase/schema.sql away must still be a protected-zone review).
  const flush = () => {
    if (cur) {
      const to = cur.plus || cur.renameTo || cur.minus || cur.header;
      add(to);
      const from = cur.renameFrom || cur.minus;
      if (from && from !== to) add(from);
    }
    cur = null;
  };
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      const rest = line.slice('diff --git '.length);
      // `a/P b/P` (même chemin des deux côtés) : le seul cas sûr malgré les espaces.
      let header = '';
      if ((rest.length - 1) % 2 === 0) {
        const n = (rest.length - 1) / 2;
        const left = rest.slice(0, n);
        const right = rest.slice(n + 1);
        if (left.startsWith('a/') && right.startsWith('b/') && left.slice(2) === right.slice(2)) header = right.slice(2);
      }
      cur = { header, plus: '', minus: '', renameTo: '', renameFrom: '' };
    } else if (cur && line.startsWith('+++ ')) {
      const p = unquote(line.slice(4));
      if (p.startsWith('b/')) cur.plus = p.slice(2);
    } else if (cur && line.startsWith('--- ')) {
      const p = unquote(line.slice(4));
      if (p.startsWith('a/')) cur.minus = p.slice(2);
    } else if (cur && line.startsWith('rename from ')) {
      cur.renameFrom = line.slice('rename from '.length);
    } else if (cur && line.startsWith('rename to ')) {
      cur.renameTo = line.slice('rename to '.length);
    }
  }
  flush();
  return files;
}

// ── Tests d'acceptation : Codex propose, le script écrit ────────────────────────────
// Codex tourne en lecture seule et rend { fichiers: [{ chemin, contenu }], notes } ; seul ce
// script écrit, et seulement SOUS le dossier cible, des fichiers de test. Le code de prod
// n'est donc jamais touché, par construction.
const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?|\.ya?ml|\.md)$/;

// Le chemin réel (liens symboliques résolus) du plus proche ancêtre existant de `p`, suivi du
// reste du chemin : un sous-dossier qui serait un lien vers l'extérieur se voit ici.
function realTarget(p) {
  let cur = p;
  const rest = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    rest.unshift(cur.slice(parent.length + 1));
    cur = parent;
  }
  return resolve(realpathSync(cur), ...rest);
}

function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function planAcceptanceFiles(output, outDir, { force = false, exists = existsSync } = {}) {
  let data;
  try {
    data = typeof output === 'string' ? JSON.parse(output) : output;
  } catch {
    return { ok: false, erreurs: ['sortie Codex illisible (JSON invalide)'], fichiers: [] };
  }
  const files = Array.isArray(data?.fichiers) ? data.fichiers : [];
  const erreurs = [];
  const fichiers = [];
  if (files.length === 0) erreurs.push('Codex n’a proposé aucun fichier');
  const root = resolve(outDir);
  for (const f of files) {
    const chemin = String(f?.chemin || '');
    const target = resolve(root, chemin);
    const rel = relative(root, target);
    // Caractères de contrôle (saut de ligne, NUL…) refusés : les chemins écrits sont relus ligne
    // à ligne par codex-acceptance.sh (--commit), un saut de ligne y fabriquerait un autre chemin.
    if (/[\u0000-\u001f\u007f]/.test(chemin)) {
      erreurs.push(`chemin refusé (caractère de contrôle) : ${JSON.stringify(chemin)}`);
      continue;
    }
    if (!chemin || isAbsolute(chemin) || rel.startsWith('..') || rel === '' || rel.split(sep).includes('..')) {
      erreurs.push(`chemin refusé (hors du dossier cible) : ${chemin}`);
      continue;
    }
    if (!TEST_FILE.test(rel)) {
      erreurs.push(`chemin refusé (pas un fichier de test : *.test.*, *.spec.*, *.yaml, *.md) : ${chemin}`);
      continue;
    }
    if (existsSync(root)) {
      const realRoot = realpathSync(root);
      const real = realTarget(target);
      const realRel = relative(realRoot, real);
      if (isSymlink(target) || realRel.startsWith('..') || isAbsolute(realRel)) {
        erreurs.push(`chemin refusé (lien symbolique hors du dossier cible) : ${chemin}`);
        continue;
      }
    }
    if (!force && exists(target)) {
      erreurs.push(`existe déjà (un test d'acceptation ne se réécrit qu'avec --force) : ${rel}`);
      continue;
    }
    fichiers.push({ rel, target, contenu: String(f?.contenu ?? '') });
  }
  // Reelbook : le contrat d'un lot, ce sont des tests `node:test` exécutables (*.test.cjs|mjs|js) ;
  // une proposition faite seulement d'un README ou d'un YAML ne vaut pas tests d'acceptation.
  if (files.length > 0 && !fichiers.some((f) => /\.test\.[cm]?js$/.test(f.rel))) {
    erreurs.push('aucun test node:test (*.test.cjs) dans la proposition');
  }
  return { ok: erreurs.length === 0, erreurs, fichiers, notes: typeof data?.notes === 'string' ? data.notes : '' };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────
function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main(argv) {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case 'zone':
      process.stdout.write(zoneOf(readStdin().split('\n').filter(Boolean)) + '\n');
      return 0;
    case 'protected':
      for (const f of protectedFiles(readStdin().split('\n').filter(Boolean))) process.stdout.write(f + '\n');
      return 0;
    case 'parse': {
      const r = parseReview(existsSync(args[0] || '') ? readFileSync(args[0], 'utf8') : '', { zone: args[1] });
      process.stdout.write(r.verdict + '\n');
      return r.verdict === 'ok' ? 0 : r.verdict === 'bloquant' ? 1 : 3;
    }
    case 'render': {
      const [file, sha, zone, cible, passe] = args;
      const r = parseReview(existsSync(file || '') ? readFileSync(file, 'utf8') : '', { zone });
      process.stdout.write(renderComment(r, { sha, zone, cible, passe: Number(passe) || 0 }));
      return 0;
    }
    case 'pr-verdict': {
      // args : <auteurs séparés par des virgules> [headSha]
      const authors = String(args[0] || '').split(',').filter(Boolean);
      const r = verdictFromComments(readStdin(), args[1] || '', { authors });
      process.stdout.write(`${r.etat} ${r.zone || '-'} ${r.sha || '-'}\n`);
      return 0;
    }
    case 'pr-passes': {
      // args : [auteurs séparés par des virgules]
      const authors = String(args[0] || '').split(',').filter(Boolean);
      process.stdout.write(`${countReviewPasses(readStdin(), { authors })}\n`);
      return 0;
    }
    case 'diff-files':
      for (const f of diffFiles(readStdin())) process.stdout.write(f + '\n');
      return 0;
    case 'acceptance-files': {
      const [file, outDir, flag] = args;
      const plan = planAcceptanceFiles(existsSync(file || '') ? readFileSync(file, 'utf8') : '', outDir, {
        force: flag === '--force',
      });
      if (!plan.ok) {
        for (const e of plan.erreurs) process.stderr.write(`⛔ ${e}\n`);
        return 1;
      }
      for (const f of plan.fichiers) {
        mkdirSync(dirname(f.target), { recursive: true });
        writeFileSync(f.target, f.contenu.endsWith('\n') ? f.contenu : f.contenu + '\n');
        process.stdout.write(f.target + '\n');
      }
      if (plan.notes) process.stderr.write(`ℹ️  Notes de Codex : ${plan.notes}\n`);
      return 0;
    }
    default:
      process.stderr.write('usage : codex.mjs zone|protected|parse|render|pr-verdict|pr-passes|diff-files|acceptance-files …\n');
      return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
