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
URL=""; KEY=""; DRY=""; DIR="${REELBOOK_DIR:-$HOME/reelbook}"; REPO="https://github.com/lt20/reelbook"

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
  URL="${pair%% *}"; KEY="${pair#* }"
}

need_value() { [ $# -ge 2 ] && [ -n "$2" ] || { echo "$1 needs a value (see --help)" >&2; exit 2; }; }
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
  echo "Key: $KEY"
  echo "Folder: $DIR"
  echo "Dry run: nothing installed."
  exit 0
fi

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
  git -C "$DIR" pull --ff-only -q || echo "note: could not update $DIR, keeping the current version."
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
python3 "$DIR/tools/rb.py" login --url "$URL" --key "$KEY" < /dev/tty

say "Done."
echo "Open Claude Code in any folder, keep Chrome open with the Claude in Chrome extension, and type:  /reelbook"
