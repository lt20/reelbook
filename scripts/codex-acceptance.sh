#!/usr/bin/env bash
# codex-acceptance.sh — Codex écrit les tests d'acceptation d'un lot, AVANT le code.
#
#   scripts/codex-acceptance.sh docs/audit-design/lots/L4.md --out tests/acceptance/l4
#   scripts/codex-acceptance.sh <spec.md> --out <dossier> --maquette shots/home.png [--maquette …]
#   scripts/codex-acceptance.sh <spec.md> --out <dossier> --commit   # commit séparé, ces fichiers seuls
#   scripts/codex-acceptance.sh <spec.md> --out <dossier> --force    # réécrire des tests existants
#
# Codes : 0 = fichiers écrits · 1 = proposition refusée (chemin hors cible, pas un test…) ·
#         2 = usage · 3 = Codex en échec.
#
# ── Pourquoi ──────────────────────────────────────────────────────────────────────────
# docs/audit-design/COORDINATION.md : pour les lots marqués « acceptance », Codex écrit les tests
# d'acceptation à partir de la spec (et des captures citées), dans un commit séparé ; l'agent
# Claude code jusqu'à les rendre verts et ne les modifie jamais (s'il les juge faux, il le signale
# dans COORDINATION.md, Codex tranche et relance ce script avec --force).
# Reelbook : des fichiers `node:test` (*.test.cjs) qui réutilisent tests/harness.cjs (l'app dans
# un `vm` avec un faux DOM) ou testent app/sessions.js ; ils tournent avec `node --test <dossier>/`.
# Porté du kit du protocole (~/dev/protocole/kit/scripts/codex-acceptance.sh).
#
# ── « Sans toucher au code de prod », par construction ────────────────────────────────
# Codex tourne en sandbox LECTURE SEULE et rend ses fichiers en JSON ({ chemin, contenu }). C'est
# ce script qui écrit, et il refuse tout chemin hors du dossier cible (`..`, absolu) et tout
# fichier qui n'est pas un test (*.test.*, *.spec.*, *.yaml, *.md). Un test existant ne
# se réécrit qu'avec --force.
#
# Maquettes : celles passées en --maquette, plus tout chemin cité dans la spec qui existe dans
# le dépôt (png/jpg/webp en image jointe, html/svg/css à lire par Codex).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/codex.sh
. "$SCRIPT_DIR/lib/codex.sh"

spec=""
out=""
force=false
commit=false
maquettes=()
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="${2:-}"; shift 2 ;;
    --maquette) maquettes+=("${2:-}"); shift 2 ;;
    --force) force=true; shift ;;
    --commit) commit=true; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    -*) echo "argument inconnu : $1 (voir --help)" >&2; exit 2 ;;
    *) [ -z "$spec" ] || { echo "une seule spec à la fois." >&2; exit 2; }; spec="$1"; shift ;;
  esac
done
[ -n "$spec" ] && [ -n "$out" ] || { echo "usage : codex-acceptance.sh <spec.md> --out <dossier> [--maquette f]… [--force] [--commit]" >&2; exit 2; }
[ -f "$spec" ] || { echo "⛔ spec introuvable : $spec" >&2; exit 2; }

spec_abs="$(cd "$(dirname "$spec")" && pwd)/$(basename "$spec")"
repo_root="$(cd "$(git rev-parse --show-toplevel)" && pwd -P)"
cd "$repo_root"

# Chemin PHYSIQUE (pwd -P) du plus proche ancêtre existant : un --out qui passerait par un lien
# vers l'extérieur du dépôt se voit AVANT de créer quoi que ce soit.
# Aucun caractère de contrôle (saut de ligne compris) : la liste des fichiers écrits est relue
# ligne par ligne pour `git add`/`git commit`, un saut de ligne y couperait un chemin en deux.
if [ "$(printf '%s' "$out" | LC_ALL=C tr -d '[:cntrl:]')" != "$out" ]; then
  echo "⛔ --out ne doit contenir aucun caractère de contrôle (saut de ligne, tabulation…)." >&2; exit 2
fi
case "/$out/" in
  */../*) echo "⛔ --out ne doit pas contenir de segment « .. »." >&2; exit 2 ;;
esac
anc="$out"
while [ ! -d "$anc" ]; do anc="$(dirname "$anc")"; done
case "$(cd "$anc" && pwd -P)/" in
  "$repo_root"/*) ;;
  *) echo "⛔ --out doit être dans le dépôt ($repo_root)." >&2; exit 2 ;;
esac
mkdir -p "$out"
out_abs="$(cd "$out" && pwd -P)"
case "$out_abs/" in
  "$repo_root"/*) ;;
  *) echo "⛔ --out doit être dans le dépôt ($repo_root)." >&2; exit 2 ;;
esac
out_rel="${out_abs#"$repo_root"/}"

codex_check_login || exit 3

work="$(mktemp -d "${TMPDIR:-/tmp}/codex-acceptance.XXXXXX")"
trap 'rm -rf "$work"' EXIT

# ── Maquettes citées ───────────────────────────────────────────────────────────────────
spec_dir="$(dirname "$spec_abs")"
while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  for cand in "$repo_root/$ref" "$spec_dir/$ref"; do
    if [ -f "$cand" ]; then maquettes+=("$cand"); break; fi
  done
done < <(grep -oE '[A-Za-z0-9_./-]+\.(png|jpe?g|webp|html|svg|css)' "$spec_abs" | sort -u || true)

images=()
lire=()
if [ "${#maquettes[@]}" -gt 0 ]; then
  while IFS= read -r m; do
    [ -f "$m" ] || { echo "⛔ maquette introuvable : $m" >&2; exit 2; }
    case "$m" in
      *.png|*.jpg|*.jpeg|*.webp) images+=("-i" "$m") ;;
      *) lire+=("$m") ;;
    esac
  done < <(printf '%s\n' "${maquettes[@]}" | awk '!seen[$0]++')
fi

# ── Le prompt ──────────────────────────────────────────────────────────────────────────
{
  cat "$CODEX_DIR/acceptance.prompt.md"
  echo
  echo "## Dossier cible"
  echo
  echo "\`$out_rel/\` — tes chemins sont relatifs à ce dossier."
  if [ -n "$(ls -A "$out_abs" 2>/dev/null)" ]; then
    echo
    echo "Déjà présents (ne les propose que si on te demande de les réécrire) :"
    (cd "$out_abs" && find . -type f | sed 's#^\./#- #')
  fi
  echo
  echo "## Maquettes"
  if [ "${#images[@]}" -eq 0 ] && [ "${#lire[@]}" -eq 0 ]; then
    echo "(aucune citée)"
  else
    [ "${#images[@]}" -gt 0 ] && echo "- images jointes à ce message : $(( ${#images[@]} / 2 ))"
    for f in ${lire[@]+"${lire[@]}"}; do echo "- à lire : \`${f#"$repo_root"/}\`"; done
  fi
  echo
  echo "## Spec du lot (\`${spec_abs#"$repo_root"/}\`)"
  echo
  cat "$spec_abs"
} > "$work/prompt.md"

echo "▸ Codex écrit les tests d'acceptation de $(basename "$spec") → $out_rel/ …" >&2
if ! codex_run "$CODEX_DIR/acceptance.schema.json" "$work/out.json" "$work/prompt.md" "$repo_root" \
     ${images[@]+"${images[@]}"} > "$work/codex.log" 2>&1; then
  echo "⛔ codex exec en échec — dernières lignes :" >&2
  tail -15 "$work/codex.log" >&2
  exit 3
fi

flag=""
$force && flag="--force"
written="$(codex_mjs acceptance-files "$work/out.json" "$out_abs" $flag)" || exit 1
echo "$written" | sed "s#^$repo_root/#  ✓ #"

if $commit; then
  paths=()
  while IFS= read -r f; do [ -n "$f" ] && paths+=("$f"); done <<< "$written"
  git add -- "${paths[@]}"
  git commit -q -m "test(acceptance): $(basename "$spec" .md) — tests d'acceptation écrits par Codex" -- "${paths[@]}"
  echo "✅ Commit séparé : $(git log -1 --format='%h %s')" >&2
fi
