#!/usr/bin/env bash
# codex-review.sh — le second regard : Codex relit un diff et rend un verdict `ok` | `bloquant`.
#
#   scripts/codex-review.sh 12                 # relit la PR #12 (diff de GitHub, via gh)
#   scripts/codex-review.sh 12 --post          # … et publie le verdict en commentaire de la PR
#   scripts/codex-review.sh feat/x             # relit une ref locale contre origin/main
#   scripts/codex-review.sh HEAD --base main   # … contre une autre base
#   scripts/codex-review.sh 12 --zone protegee # force la variante zones protégées
#   scripts/codex-review.sh 12 --force-pass    # 4e passe ou plus, sur décision du coordinateur
#
# Sortie : une première ligne `verdict: ok` ou `verdict: bloquant`, puis le commentaire Markdown.
# Codes : 0 = ok · 1 = bloquant · 2 = usage / diff trop gros · 3 = Codex en échec ou sortie illisible
#         4 = 3 passes déjà postées sur la PR (règle d'arrêt) · 5 = la tête a bougé : rien publié.
#
# ── Pourquoi ──────────────────────────────────────────────────────────────────────────
# Reelbook suit le protocole Paul (docs/audit-design/COORDINATION.md) : aucun humain ne teste avant le merge,
# et merger sur main publie l'app (GitHub Pages). Un autre modèle (Codex, autres angles morts)
# relit donc chaque PR. Un `bloquant` empêche le merge ; sur une zone protégée (supabase/**,
# .github/**, app/config.js, app/install.*, tools/rb.py, secrets), la revue pose en plus la
# question « que se passe-t-il pour les données existantes et les utilisateurs au déploiement ? »,
# et c'est CE verdict, sur CE commit, que le coordinateur exige avant de merger.
#
# Porté du kit du protocole (~/dev/protocole/kit/scripts/codex-review.sh), consignes adaptées.
#
# ── Garde-fous ────────────────────────────────────────────────────────────────────────
#   - Codex tourne en local avec la connexion ChatGPT de Laurent, jamais avec une clé d'API
#     (scripts/lib/codex.sh retire les variables de clé et vérifie `codex login status`) ;
#   - sandbox lecture seule : la revue ne modifie rien ;
#   - le commentaire porte un marqueur `<!-- codex-review sha=… zone=… verdict=… -->` : un
#     verdict sur un autre commit que la tête de la PR est périmé (le coordinateur le refuse) ;
#   - une sortie illisible n'est jamais un `ok` (exit 3, rien publié) ;
#   - règle d'arrêt (docs/audit-design/COORDINATION.md) : 3 passes au plus par PR. Le script
#     compte les marqueurs déjà postés par le compte gh courant (ou CODEX_REVIEW_AUTHORS) ; à la
#     4e il refuse (exit 4), sauf `--force-pass` ;
#   - le sha du marqueur est celui du diff relu : sha lu une fois, diff demandé POUR ce sha
#     (`compare/<base>...<sha>`, pas `gh pr diff`, qui peut voir une autre tête que `gh pr view`
#     juste après un push). Si la tête GitHub (ou la ref locale) bouge pendant la revue, rien
#     n'est publié (exit 5).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/codex.sh
. "$SCRIPT_DIR/lib/codex.sh"

target=""
base="origin/main"
post=false
zone_opt="auto"
force_pass=false
while [ $# -gt 0 ]; do
  case "$1" in
    --post) post=true; shift ;;
    --base) base="${2:-}"; shift 2 ;;
    --zone) zone_opt="${2:-}"; shift 2 ;;
    --force-pass) force_pass=true; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    -*) echo "argument inconnu : $1 (voir --help)" >&2; exit 2 ;;
    *) [ -z "$target" ] || { echo "une seule cible à la fois." >&2; exit 2; }; target="$1"; shift ;;
  esac
done
[ -n "$target" ] || { echo "usage : codex-review.sh <PR|ref> [--post] [--base <ref>] [--zone auto|protegee|standard] [--force-pass]" >&2; exit 2; }
case "$zone_opt" in auto|protegee|standard) ;; *) echo "⛔ --zone attend auto, protegee ou standard." >&2; exit 2 ;; esac

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

work="$(mktemp -d "${TMPDIR:-/tmp}/codex-review.XXXXXX")"
trap 'rm -rf "$work"' EXIT

# ── Le diff et ses métadonnées ─────────────────────────────────────────────────────────
pr=""
case "$target" in
  \#[0-9]*) pr="${target#\#}" ;;
  [0-9]*) [[ "$target" =~ ^[0-9]+$ ]] && pr="$target" ;;
  https://github.com/*/pull/*) pr="${target##*/pull/}"; pr="${pr%%[/?#]*}" ;;
esac

json_field() { codex_node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]];process.stdout.write(v==null?"":String(v))' "$1" "$2"; }
# La tête de la PR vue par GitHub, relue à part (avant le diff, puis avant de publier).
gh_head() { gh pr view "$pr" --json headRefOid > "$work/head.json" && json_field "$work/head.json" headRefOid; }

passe=0
if [ -n "$pr" ]; then
  command -v gh >/dev/null 2>&1 || { echo "⛔ gh introuvable." >&2; exit 2; }
  gh pr view "$pr" --json headRefOid,headRefName,baseRefName,title,body,comments > "$work/meta.json"
  sha="$(json_field "$work/meta.json" headRefOid)"
  head_ref="$(json_field "$work/meta.json" headRefName)"
  base_ref="$(json_field "$work/meta.json" baseRefName)"
  title="$(json_field "$work/meta.json" title)"
  codex_node -e 'process.stdout.write((JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).body||"").slice(0,4000))' "$work/meta.json" > "$work/body.md"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "⛔ tête de la PR #$pr illisible : « $sha »." >&2; exit 2; }

  # ── Règle d'arrêt : 3 passes au plus (docs/audit-design/COORDINATION.md) ──
  # Seuls comptent les marqueurs du compte qui publie les revues (CODEX_REVIEW_AUTHORS pour d'autres) :
  # des marqueurs collés par un tiers n'épuisent pas les passes.
  authors="${CODEX_REVIEW_AUTHORS:-$(gh api user --jq .login 2>/dev/null || true)}"
  [ -n "$authors" ] || echo "⚠️  compte gh inconnu : tous les marqueurs comptent comme des passes." >&2
  deja="$(codex_mjs pr-passes "$authors" < "$work/meta.json")"
  passe=$((deja + 1))
  if [ "$deja" -ge 3 ] && ! $force_pass; then
    echo "⛔ 3 passes atteintes : arbitrage du coordinateur (docs/audit-design/COORDINATION.md)" >&2
    echo "   ($deja revue(s) Codex déjà postée(s) sur la PR #$pr ; le coordinateur relance avec --force-pass s'il le décide.)" >&2
    exit 4
  fi

  # ── Après un push, `gh pr view` peut encore montrer l'ancienne tête. Si on relit la PR depuis sa
  # propre branche, la tête locale doit être celle que GitHub annonce : on attend un peu, puis on refuse.
  if [ "$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)" = "$head_ref" ]; then
    local_head="$(git rev-parse HEAD)"
    tries="${CODEX_REVIEW_HEAD_TRIES:-4}"
    while [ "$sha" != "$local_head" ] && [ "$tries" -gt 1 ]; do
      tries=$((tries - 1))
      sleep "${CODEX_REVIEW_HEAD_DELAY:-5}"
      sha="$(gh_head)"
    done
    if [ "$sha" != "$local_head" ]; then
      echo "⛔ tête locale ${local_head:0:12} ≠ tête GitHub ${sha:0:12} pour la PR #$pr ($head_ref) :" >&2
      echo "   pousse la branche (ou attends que GitHub voie le push) puis relance. Rien relu." >&2
      exit 5
    fi
  fi

  # Le diff est demandé POUR ce sha : diff, liste des fichiers et marqueur portent sur le même commit.
  gh api -H 'Accept: application/vnd.github.v3.diff' "repos/{owner}/{repo}/compare/${base_ref}...${sha}" > "$work/diff.patch"
  codex_mjs diff-files < "$work/diff.patch" > "$work/files.txt"
  cible="PR #$pr"
else
  $post && { echo "⛔ --post exige un numéro de PR (une ref locale n'a pas de fil de commentaires)." >&2; exit 2; }
  git rev-parse --verify --quiet "$target^{commit}" >/dev/null || { echo "⛔ ref inconnue : $target" >&2; exit 2; }
  git rev-parse --verify --quiet "$base^{commit}" >/dev/null || { echo "⛔ base inconnue : $base" >&2; exit 2; }
  # La ref est résolue UNE fois : tout ce qui suit lit ce sha, pas la ref (qui peut bouger).
  sha="$(git rev-parse "$target^{commit}")"
  mb="$(git merge-base "$base" "$sha")"
  title="$(git log -1 --format=%s "$sha")"
  git log --format='- %s' "$mb..$sha" > "$work/body.md"
  git diff "$mb" "$sha" > "$work/diff.patch"
  git diff --name-only "$mb" "$sha" > "$work/files.txt"
  cible="$target (contre $base)"
fi

if [ ! -s "$work/diff.patch" ]; then
  echo "⛔ diff vide : rien à relire pour $cible." >&2
  exit 2
fi
max="${CODEX_REVIEW_MAX_BYTES:-400000}"
size="$(wc -c < "$work/diff.patch" | tr -d ' ')"
if [ "$size" -gt "$max" ]; then
  echo "⛔ diff de $size octets (> $max) : une revue tronquée ne vaut rien. Découpe la PR." >&2
  exit 2
fi

codex_check_login || exit 3

zone="$zone_opt"
[ "$zone" = "auto" ] && zone="$(codex_mjs zone < "$work/files.txt")"

# ── Le prompt ──────────────────────────────────────────────────────────────────────────
{
  cat "$CODEX_DIR/review.prompt.md"
  [ "$zone" = "protegee" ] && cat "$CODEX_DIR/review-protected.prompt.md"
  echo
  echo "## Ce qui est relu : $cible"
  echo
  echo "Titre : $title"
  echo
  echo "Description / commits :"
  cat "$work/body.md"
  echo
  echo "## Fichiers modifiés"
  sed 's/^/- /' "$work/files.txt"
  if [ "$zone" = "protegee" ]; then
    echo
    echo "## Fichiers en zone protégée"
    codex_mjs protected < "$work/files.txt" | sed 's/^/- /'
  fi
  echo
  echo "## Diff"
  echo
  echo '```diff'
  cat "$work/diff.patch"
  echo '```'
} > "$work/prompt.md"

echo "▸ Codex relit $cible ($(wc -l < "$work/files.txt" | tr -d ' ') fichier(s), zone $zone)…" >&2
if ! codex_run "$CODEX_DIR/review.schema.json" "$work/out.json" "$work/prompt.md" "$repo_root" > "$work/codex.log" 2>&1; then
  echo "⛔ codex exec en échec — dernières lignes :" >&2
  tail -15 "$work/codex.log" >&2
  exit 3
fi

set +e
verdict="$(codex_mjs parse "$work/out.json" "$zone")"
set -e
codex_mjs render "$work/out.json" "$sha" "$zone" "$cible" "$passe" > "$work/comment.md"

if [ "$verdict" = "invalide" ]; then
  echo "verdict: bloquant"
  cat "$work/comment.md"
  echo "⛔ Sortie Codex inexploitable : rien publié, relance la revue." >&2
  exit 3
fi

echo "verdict: $verdict"
cat "$work/comment.md"

# ── La tête a-t-elle bougé pendant la revue ? Le verdict ne vaut que pour le sha relu. ──
if [ -n "$pr" ]; then
  now="$(gh_head || true)"
else
  now="$(git rev-parse --verify --quiet "$target^{commit}" || true)"
fi
if [ "$now" != "$sha" ]; then
  echo "⛔ la tête a bougé pendant la revue (${sha:0:12} → ${now:0:12}) : verdict périmé, rien publié. Relance." >&2
  exit 5
fi

if $post; then
  gh pr comment "$pr" --body-file "$work/comment.md" >/dev/null
  echo "✅ Verdict publié sur la PR #$pr." >&2
fi

[ "$verdict" = "ok" ] && exit 0 || exit 1
