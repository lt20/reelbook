#!/usr/bin/env bash
# Reelbook installer for macOS and Linux.
#   curl -fsSL https://lt20.github.io/reelbook/install.sh | bash -s -- --url <project url> --key <anon key>
# Installs the repository in ~/reelbook, a Python venv with Pillow, links the Claude Code skill,
# then signs the computer in (email + password). Safe to run again: it updates in place.
set -euo pipefail

URL=""; KEY=""; DIR="${REELBOOK_DIR:-$HOME/reelbook}"; REPO="https://github.com/lt20/reelbook"
while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --key) KEY="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1. $2" >&2; exit 1; }; }

say "1/5 Checking the basics"
need git "Install it from https://git-scm.com (macOS: run 'xcode-select --install')."
need python3 "Install Python 3.10 or newer from https://python.org."
python3 - <<'EOF' || { echo "Python 3.10 or newer is needed." >&2; exit 1; }
import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)
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
if [ -n "$URL" ] && [ -n "$KEY" ]; then
  python3 "$DIR/tools/rb.py" login --url "$URL" --key "$KEY" < /dev/tty
else
  echo "Paste the command from the app's Settings page later:  python3 $DIR/tools/rb.py login --url … --key …"
fi

say "Done."
echo "Open Claude Code in any folder, keep Chrome open with the Claude in Chrome extension, and type:  /reelbook"
