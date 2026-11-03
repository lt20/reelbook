#!/usr/bin/env bash
# codex.sh (lib) — lancer Codex en non-interactif, toujours de la même façon prudente.
# Sourcé par `scripts/codex-review.sh` et `scripts/codex-acceptance.sh` (porté du kit du protocole).
#
#   - connexion ChatGPT de Laurent (forfait Codex) : JAMAIS l'API. On retire du lancement toute
#     variable de clé (OPENAI_API_KEY, CODEX_API_KEY…) et on refuse si `codex login status`
#     ne dit pas « ChatGPT » ;
#   - sandbox lecture seule (`-s read-only`) : Codex lit le dépôt, n'écrit rien ;
#   - sortie contrainte par un schéma JSON (`--output-schema`), dernier message dans un fichier
#     (`-o`), session éphémère (rien d'enregistré dans ~/.codex/sessions).
# Modèle : celui de la config de Laurent, ou `CODEX_MODEL` s'il est posé.

CODEX_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODEX_DIR="$(cd "$CODEX_LIB_DIR/../codex" && pwd)"

# Le node du projet (Node 20) s'il est là, sinon celui du PATH : codex.mjs n'exige rien de récent.
codex_node() {
  local n20="$HOME/.nvm/versions/node/v20.20.2/bin/node"
  if [ -x "$n20" ]; then "$n20" "$@"; else node "$@"; fi
}

codex_mjs() { codex_node "$CODEX_LIB_DIR/codex.mjs" "$@"; }

# 0 si Codex est installé et connecté par ChatGPT ; sinon un message et 1.
codex_check_login() {
  command -v codex >/dev/null 2>&1 || { echo "⛔ codex introuvable dans le PATH." >&2; return 1; }
  local status
  status="$(env -u OPENAI_API_KEY -u CODEX_API_KEY codex login status 2>&1 </dev/null || true)"
  case "$status" in
    *ChatGPT*) return 0 ;;
    *) echo "⛔ Codex doit être connecté par ChatGPT (forfait Codex), jamais par une clé d'API." >&2
       echo "   État : ${status:-inconnu}. Laurent : \`codex login\` (choisir ChatGPT)." >&2
       return 1 ;;
  esac
}

# `codex_run <schema.json> <sortie.json> <prompt.md> <racine> [args codex…]` — prompt lu sur stdin.
codex_run() {
  local schema="$1" out="$2" prompt="$3" root="$4"; shift 4
  local model_args=()
  [ -n "${CODEX_MODEL:-}" ] && model_args=(-m "$CODEX_MODEL")
  env -u OPENAI_API_KEY -u CODEX_API_KEY -u OPENAI_BASE_URL \
    codex exec \
      -s read-only \
      --ephemeral \
      --color never \
      -C "$root" \
      -c 'forced_login_method="chatgpt"' \
      --output-schema "$schema" \
      -o "$out" \
      ${model_args[@]+"${model_args[@]}"} \
      "$@" -- - < "$prompt"
}
