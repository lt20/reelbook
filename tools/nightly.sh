#!/bin/bash
# nightly.sh — process the Reelbook queue unattended, once a night (macOS, launchd).
#
#   tools/nightly.sh check               what a run would do now (queue size, screen, claude path)
#   tools/nightly.sh run [--max N]       process up to N queued requests now (default 5)
#   tools/nightly.sh install [HH:MM]     run every night at HH:MM (default 02:00) via a LaunchAgent
#   tools/nightly.sh uninstall           remove the LaunchAgent
#
# A video only plays in a visible Chrome tab: the run needs Chrome with the Claude in Chrome
# extension and an unlocked screen. Empty queue or locked screen = Claude is not started.
# A Mac asleep at the scheduled time catches up on wake, but only within 3 hours: later, the
# night is skipped rather than opening tabs in front of you.
# Optional phone notice: REELBOOK_NOTIFY_URL (an ntfy topic URL), stored at install time.
set -u

LABEL="com.reelbook.nightly"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/reelbook-nightly.log"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
# Main checkout, even when called from a git worktree (work/ and .venv/ live there).
REPO="$(cd "$(dirname "$SELF")" && cd "$(git rev-parse --git-common-dir 2>/dev/null || echo ..)/.." && pwd)"
if [ -n "${CLAUDE_BIN:-}" ]; then CLAUDE="$CLAUDE_BIN"
elif [ -x "$HOME/.local/bin/claude" ]; then CLAUDE="$HOME/.local/bin/claude"
else CLAUDE="$(command -v claude)"; fi

log() { echo "$(date '+%F %T') $*"; }
notify() {
  [ -n "${REELBOOK_NOTIFY_URL:-}" ] && curl -fsS -m 10 -H "Title: Reelbook" -d "$1" "$REELBOOK_NOTIFY_URL" >/dev/null 2>&1
  return 0
}
screen_locked() {
  [ "$(ioreg -n Root -d1 -a | plutil -extract IOConsoleUsers.0.CGSSessionScreenIsLocked raw - 2>/dev/null)" = true ]
}
queued() {  # number of queued requests, fails when rb.py does
  local out
  out="$(cd "$REPO" && python3 tools/rb.py queue 2>/dev/null)" || return 1
  printf '%s\n' "$out" | grep -c '^{'
}

cmd_check() {
  echo "repo:    $REPO"
  echo "claude:  ${CLAUDE:-not found}"
  echo "queued:  $(queued || echo 'rb.py failed: run rb.py login')"
  echo "screen:  $(screen_locked && echo locked || echo unlocked)"
  echo "notify:  $([ -n "${REELBOOK_NOTIFY_URL:-${RALPH_NOTIFY_URL:-}}" ] && echo on || echo off)"
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then echo "nightly: installed ($PLIST)"; else echo "nightly: not installed"; fi
}

cmd_run() {
  local max=5 at="" n left status
  while [ $# -gt 0 ]; do
    case "$1" in
      --max) max="$2"; shift 2 ;;
      --at) at="$2"; shift 2 ;;  # scheduled HH:MM, set by the LaunchAgent
      *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
  done
  if [ -n "$at" ]; then
    local now=$((10#$(date +%H) * 60 + 10#$(date +%M))) sched=$((10#${at%%:*} * 60 + 10#${at##*:}))
    if [ $(((now - sched + 1440) % 1440)) -gt 180 ]; then log "more than 3 h after $at: skipped"; exit 0; fi
  fi
  if ! n="$(queued)"; then
    log "rb.py queue failed"; notify "Night run: rb.py queue failed (signed out?)"; exit 1
  fi
  if [ "$n" -eq 0 ]; then log "queue empty"; exit 0; fi
  if screen_locked; then
    log "$n queued, screen locked: skipped"; notify "$n video(s) waiting, screen was locked: skipped"; exit 0
  fi
  open -a "Google Chrome"
  log "$n queued, processing up to $max"
  cd "$REPO" || exit 1
  # -u wakes the display, -d keeps it on while Claude works.
  caffeinate -dimsu "$CLAUDE" -p --chrome --permission-mode auto \
    "/reelbook process the queue, at most $max requests, then stop and list the sheet links" </dev/null
  status=$?
  left="$(queued || echo '?')"
  log "claude exit $status, $left still queued"
  notify "Night run done (exit $status): $n queued before, $left after"
}

cmd_install() {
  local at="${1:-02:00}"
  case "$at" in [0-2][0-9]:[0-5][0-9]) ;; *) echo "time must be HH:MM" >&2; exit 2 ;; esac
  [ -x "$CLAUDE" ] || { echo "claude not found: set CLAUDE_BIN" >&2; exit 1; }
  local notify_url="${REELBOOK_NOTIFY_URL:-${RALPH_NOTIFY_URL:-}}"
  mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$SELF</string><string>run</string><string>--at</string><string>$at</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>$((10#${at%%:*}))</integer><key>Minute</key><integer>$((10#${at##*:}))</integer></dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$CLAUDE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>CLAUDE_BIN</key><string>$CLAUDE</string>
    <key>REELBOOK_NOTIFY_URL</key><string>$notify_url</string>
  </dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
  launchctl bootstrap "gui/$(id -u)" "$PLIST" || exit 1
  echo "Installed: every night at $at. Log: $LOG"
}

cmd_uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
  rm -f "$PLIST"
  echo "Uninstalled."
}

case "${1:-}" in
  check) cmd_check ;;
  run) shift; cmd_run "$@" ;;
  install) shift; cmd_install "$@" ;;
  uninstall) cmd_uninstall ;;
  *) sed -n '2,13p' "$SELF" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
