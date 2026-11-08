#!/usr/bin/env bash
# Reelbook installer for macOS and Linux.
#   curl -fsSL https://lt20.github.io/reelbook/install.sh | bash                    (the hosted backend)
#   curl -fsSL https://lt20.github.io/reelbook/install.sh | bash -s -- --url <project url> --key <anon key>
# Installs the repository in ~/reelbook, a Python venv with Pillow, links the Claude Code skill,
# then signs the computer in (email + password). Safe to run again: it updates in place.
# Without --url / --key it signs in to the hosted backend: its url and anon key are read, as text, from the app's
# published config.js (the file is never run). REELBOOK_CONFIG_URL reads another one (a fork, a file:// copy).
set -euo pipefail

CONFIG_URL="${REELBOOK_CONFIG_URL:-https://lt20.github.io/reelbook/config.js}"
URL=""; KEY=""; HOSTED_URL=""; DRY=""; DIR="${REELBOOK_DIR:-$HOME/reelbook}"; REPO="https://github.com/lt20/reelbook"

usage() {
  cat <<USAGE
Reelbook installer (macOS, Linux).

  install.sh                           the hosted backend (url and key read from $CONFIG_URL)
  install.sh --url <url> --key <key>   your own Supabase project

Options:
  --dir <folder>   install there instead of ~/reelbook (or set REELBOOK_DIR)
  --dry-run        show which backend would be used, then stop: nothing is installed
  --help           this text
USAGE
}

die() { echo "$*" >&2; exit 1; }

valid_url() { printf '%s' "$1" | grep -Eq '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]+)?$'; }
# a JWT (three base64url parts) or a Supabase publishable key
valid_key() { printf '%s' "$1" | grep -Eq '^([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_publishable_[A-Za-z0-9_-]+)$'; }

# Prints "<url> <key>" from the config.js given on stdin, read as text: the `hosted: { … }` block, then its `url` and
# `anonKey` string values. Nothing in the file is run. Returns 1 when the block or a value is missing or malformed.
hosted_from_config() {
  local block url key
  # line comments out (a `//` at the start of a line or after a space, never the one in 'https://'), then one line
  block=$(sed -E 's#(^|[[:space:]])//.*$##' | tr '\n\r' '  ' | sed -nE 's/(^|.*[{,[:space:]])hosted:[[:space:]]*\{([^}]*)\}.*/\2/p')
  [ -n "$block" ] || return 1
  url=$(printf '%s' "$block" | sed -nE "s/(^|.*[{,[:space:]])url:[[:space:]]*['\"]([^'\"]*)['\"].*/\2/p")
  key=$(printf '%s' "$block" | sed -nE "s/(^|.*[{,[:space:]])anonKey:[[:space:]]*['\"]([^'\"]*)['\"].*/\2/p")
  url="${url%/}"
  valid_url "$url" && valid_key "$key" || return 1
  printf '%s %s\n' "$url" "$key"
}

# Sets URL and KEY: the arguments given, else the hosted backend of config.js. Exits with a message when neither.
resolve_backend() {
  if [ -n "$URL" ] || [ -n "$KEY" ]; then
    [ -n "$URL" ] && [ -n "$KEY" ] || die "Give both --url and --key (the app's Settings page shows the whole line)."
    return 0
  fi
  local text pair
  text=$(curl -fsSL --max-time 20 "$CONFIG_URL" 2>/dev/null) ||
    die "Could not read $CONFIG_URL to find the hosted backend. Check the connection and try again, or run with --url <project url> --key <anon key>."
  pair=$(printf '%s\n' "$text" | hosted_from_config) ||
    die "No hosted backend is set in $CONFIG_URL (an https url and an anon key). Run with --url <project url> --key <anon key> instead: the app's Settings page shows that line."
  URL="${pair%% *}"; KEY="${pair#* }"; HOSTED_URL="$URL"
}

# The end of an install that went through: a film reel and REELBOOK in block letters (the brand's coral and blue,
# ANSI 256 colours), then what to do next. Colour only on a terminal, without NO_COLOR, and when TERM is not dumb;
# '#' instead of the block character outside a UTF-8 locale. French when the locale is French, English otherwise.
welcome() {
  local coral="" blue="" bold="" off="" px="#" i reel letters
  if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != dumb ]; then
    coral=$'\033[38;5;167m'; blue=$'\033[38;5;25m'; bold=$'\033[1m'; off=$'\033[0m'
  fi
  case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in *[Uu][Tt][Ff]-8*|*[Uu][Tt][Ff]8*) px=$'\xe2\x96\x88' ;; esac
  # a 7 x 7 reel, each dot two columns wide, and 4 x 5 letters
  reel=("    ######    " "  ##########  " "####  ##  ####" "######  ######" "####  ##  ####" "  ##########  " "    ######    ")
  letters=(""
    "###  #### #### #    ###   ##   ##  #  #"
    "#  # #    #    #    #  # #  # #  # # # "
    "###  ###  ###  #    ###  #  # #  # ##  "
    "# #  #    #    #    #  # #  # #  # # # "
    "#  # #### #### #### ###   ##   ##  #  #"
    "")
  echo
  for i in 0 1 2 3 4 5 6; do
    printf '  %s%s%s   %s%s%s\n' "$coral" "${reel[$i]//\#/$px}" "$off" "$blue$bold" "${letters[$i]//\#/$px}" "$off"
  done
  echo
  case "${LC_ALL:-${LANG:-}}" in
    fr*)
      printf '%s%s%s\n' "$bold" "C'est prêt." "$off"
      echo "1. Mets tes vidéos en file d'attente : colle leur lien dans l'app, ou envoie-les avec le raccourci iPhone."
      echo "2. Dans Claude Code, sur ton ordinateur, tape /reelbook, avec Chrome ouvert et l'extension Claude in Chrome installée."
      echo "3. Claude ouvre les liens en file d'attente, lit les vidéos, crée les fiches et les range dans le carnet du sport correspondant."
      echo "Retrouve-les dans l'app : https://lt20.github.io/reelbook/"
      [ "$(uname -s)" = Darwin ] && echo "Sur Mac, la file peut aussi se traiter seule chaque nuit à 2 h (Mac branché, Chrome ouvert) : ${DIR/#$HOME/~}/tools/nightly.sh install"
      true ;;
    *)
      printf '%s%s%s\n' "$bold" "You're all set." "$off"
      echo "1. Queue your videos: paste their link in the app, or send them with the iPhone shortcut."
      echo "2. In Claude Code on your computer, type /reelbook, with Chrome open and the Claude in Chrome extension installed."
      echo "3. Claude opens the queued links, reads the videos, writes the sheets and files each one in the notebook of its sport."
      echo "Find them in the app: https://lt20.github.io/reelbook/"
      [ "$(uname -s)" = Darwin ] && echo "On a Mac, the queue can also run by itself every night at 02:00 (Mac plugged in, Chrome open): ${DIR/#$HOME/~}/tools/nightly.sh install"
      true ;;
  esac
}

# a value, not empty and not the next option (`--url --dry-run` must not install anything)
need_value() { [ $# -ge 2 ] && [ -n "$2" ] && [ "${2#-}" = "$2" ] || { echo "$1 needs a value (see --help)" >&2; exit 2; }; }
while [ $# -gt 0 ]; do
  case "$1" in
    --url) need_value "$@"; URL="$2"; shift 2 ;;
    --key) need_value "$@"; KEY="$2"; shift 2 ;;
    --dir) need_value "$@"; DIR="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

resolve_backend
if [ -n "$DRY" ]; then
  echo "Backend: $URL"
  # masked: a secret key given by mistake must not land in a terminal log
  if [ ${#KEY} -ge 20 ]; then echo "Key: ${KEY:0:10}...${KEY: -4} (${#KEY} characters)"; else echo "Key: (${#KEY} characters)"; fi
  echo "Folder: $DIR"
  echo "Dry run: nothing installed."
  exit 0
fi

# Updates the clone in $1. A clone made before the repository was republished with a new history has no common
# ancestor with it: a fast-forward can never succeed, so the clone is moved onto the new history (reset --hard
# origin/main). Files git ignores (work/, .venv/) stay as they are; the session file is outside the folder
# (~/.config/reelbook). The old HEAD is kept first in the branch reelbook-old-history (an existing one is never
# overwritten: a dated name is used instead), so commits of the clone's own are not lost. A tracked file edited or
# staged by hand (app/config.js of a self-hosted app...) would be replaced: the clone does not move until it is set
# aside. Returns 1 when the clone was not updated (offline, local commits on the same history, files edited by hand):
# the current version is kept, as before.
update_repo() {
  local dir="$1" rc=0 dirty keep
  git -C "$dir" pull --ff-only -q 2>/dev/null && return 0
  git -C "$dir" fetch -q origin 2>/dev/null || return 1
  git -C "$dir" rev-parse --verify -q origin/main >/dev/null || return 1
  # 0: a common ancestor, the usual rule applies (keep the current version); 1: none; anything else: an error
  git -C "$dir" merge-base HEAD origin/main >/dev/null 2>&1 || rc=$?
  [ "$rc" -eq 1 ] || return 1
  dirty=$(git -C "$dir" status --porcelain --untracked-files=no) || return 1
  if [ -n "$dirty" ]; then
    echo "note: the Reelbook repository has a new history, but $dir has tracked files edited by hand." \
      "Keep a copy of them with  git -C \"$dir\" stash  (or copy them elsewhere and undo the edits), then run this installer again." >&2
    return 1
  fi
  # the old history, with any commits of the clone's own, stays in a branch; an earlier run's branch is kept as it is
  keep=reelbook-old-history
  if git -C "$dir" rev-parse -q --verify "refs/heads/$keep" >/dev/null; then
    if [ "$(git -C "$dir" rev-parse "refs/heads/$keep")" != "$(git -C "$dir" rev-parse HEAD)" ]; then
      keep="reelbook-old-history-$(date +%Y%m%d-%H%M%S)"
      git -C "$dir" branch "$keep" HEAD || return 1
    fi
  else
    git -C "$dir" branch "$keep" HEAD || return 1
  fi
  git -C "$dir" reset -q --hard origin/main || return 1
  echo "note: the Reelbook repository has a new history; $dir now follows it (work/ and .venv/ are kept; the old history, with any commits of your own, is in the branch $keep)."
}

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1. $2" >&2; exit 1; }; }

say "1/5 Checking the basics"
need git "Install it from https://git-scm.com (macOS: run 'xcode-select --install')."
need python3 "Install Python 3.9 or newer from https://python.org."
python3 - <<'EOF' || { echo "Python 3.9 or newer is needed." >&2; exit 1; }
import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)
EOF
if ! command -v claude >/dev/null 2>&1; then
  echo "note: Claude Code ('claude') is not on your PATH yet. Install it from https://claude.com/claude-code before running /reelbook."
fi

say "2/5 Getting the code into $DIR"
if [ -d "$DIR/.git" ]; then
  update_repo "$DIR" || echo "note: could not update $DIR, keeping the current version."
else
  git clone -q "$REPO" "$DIR"
fi

say "3/5 Python tools (Pillow in a private venv)"
if [ ! -x "$DIR/.venv/bin/python" ]; then python3 -m venv "$DIR/.venv"; fi
"$DIR/.venv/bin/python" -m pip install -q --upgrade pip pillow

say "4/5 Linking the Claude Code skill"
mkdir -p "$HOME/.claude/skills"
ln -sfn "$DIR/skill/reelbook" "$HOME/.claude/skills/reelbook"
echo "~/.claude/skills/reelbook -> $DIR/skill/reelbook"

say "5/5 Signing this computer in to your Reelbook account"
echo "Use the email and password of your Reelbook account (the ones you chose in the app)."
# a failed sign-in stops here (set -e): the welcome below is only for an install that went through
REELBOOK_HOSTED_URL="$HOSTED_URL" python3 "$DIR/tools/rb.py" login --url "$URL" --key "$KEY" < /dev/tty

welcome
