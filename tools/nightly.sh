#!/bin/bash
# nightly.sh — process the Reelbook queue unattended, once a night (macOS, launchd).
#
#   tools/nightly.sh check               what a run would do now (queue size, screen, claude path)
#   tools/nightly.sh run [--max N] [--glossary-max N]
#                                        process up to N queued requests now (default 5), then let the
#                                        glossary pass read up to N sheets (default 10)
#   tools/nightly.sh install [HH:MM]     run every night at HH:MM (default 02:00) via a LaunchAgent
#   tools/nightly.sh uninstall           remove the LaunchAgent
#
# The run needs Chrome with the Claude in Chrome extension. A locked screen is fine: measured on
# 2026-11-03, a session of 8 exercises processed with the screen locked all along, 31 sharp photos.
# Empty queue = no video run. Mac on battery = Claude is not started at all (on battery, macOS sleeps
# despite caffeinate and the run dies mid-way, 2026-11-01). The screen state is only logged.
# After the queue, and when it is empty too, the night catches up the glossary: the sheets of the technique
# notebooks that no glossary pass has read yet (rb.py glossary pending; sheets made by another engine, or older
# than the glossary) get one more Claude run, without Chrome, a few sheets a night.
# Every run first puts back in the queue the requests a dead run left « processing » (rb.py requeue-stuck).
# A Mac asleep at the scheduled time catches up on wake, but only within 3 hours: later, the
# night is skipped rather than opening tabs in front of you.
# Optional phone notice: REELBOOK_NOTIFY_URL (an ntfy topic URL), stored at install time. After a run it lists
# the titles published (« 2 new sheets: … ») and opens the app when tapped: REELBOOK_APP_URL, default
# https://lt20.github.io/reelbook/, with #<slug> when exactly one sheet or session was published.
set -u
# launchd starts jobs with a bare PATH: ioreg and pmset live in /usr/sbin.
export PATH="$PATH:/usr/sbin:/usr/bin:/bin"

LABEL="com.reelbook.nightly"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/reelbook-nightly.log"
# macOS lists background items by the file launchd starts: a launcher with a readable name, which
# stays the same when this script is updated (so the « background item added » notice does not return).
LAUNCHER="$HOME/Library/Application Support/Reelbook/Reelbook night run"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
# Main checkout, even when called from a git worktree (work/ and .venv/ live there).
REPO="$(cd "$(dirname "$SELF")" && cd "$(git rev-parse --git-common-dir 2>/dev/null || echo ..)/.." && pwd)"
if [ -n "${CLAUDE_BIN:-}" ]; then CLAUDE="$CLAUDE_BIN"
elif [ -x "$HOME/.local/bin/claude" ]; then CLAUDE="$HOME/.local/bin/claude"
else CLAUDE="$(command -v claude)"; fi

log() { echo "$(date '+%F %T') $*"; }
notify() {  # notify <message> [<url opened when the notice is tapped>]
  [ -n "${REELBOOK_NOTIFY_URL:-}" ] && curl -fsS -m 10 -H "Title: Reelbook" ${2:+-H "Click: $2"} -d "$1" "$REELBOOK_NOTIFY_URL" >/dev/null 2>&1
  return 0
}
# night_notice <claude exit> <still queued> <rb.py list --since output>: prints the notice text on line 1 and the
# app URL to open on line 2 (#<slug> when exactly one sheet or session was published). Pure, tested.
night_notice() {
  local status="$1" left="$2" listing="$3" app="${REELBOOK_APP_URL:-https://lt20.github.io/reelbook/}"
  local items n titles slug kind msg
  # rb.py list --since line: theme, group, kind, slug, title, tab-separated (a group may hold spaces and the
  # word « session »); a line without tabs (older rb.py) is read word by word, the first kind word wins
  items="$(printf '%s\n' "$listing" | awk '
  index($0, "\t") { n = split($0, f, "\t"); if (n >= 5) { t = f[5]; for (j = 6; j <= n; j++) t = t " " f[j]; print f[3] "\t" f[4] "\t" t }; next }
  {
    for (i = 2; i < NF; i++) if ($i == "sheet" || $i == "session" || $i == "session2") {
      t = $(i + 2); for (j = i + 3; j <= NF; j++) t = t " " $j
      print $i "\t" $(i + 1) "\t" t; break
    }
  }')"
  n=0; [ -n "$items" ] && n="$(printf '%s\n' "$items" | wc -l | tr -d ' ')"
  if [ "$n" -eq 0 ]; then
    msg="Night run: nothing published (claude exit $status)"
  else
    titles="$(printf '%s\n' "$items" | cut -f3 | awk 'NR > 1 { printf ", " } { printf "%s", $0 }')"
    msg="$n new sheet$([ "$n" -gt 1 ] && echo s): $titles"
    [ "$status" != 0 ] && msg="$msg (claude exit $status)"
  fi
  case "$left" in 0|"") ;; *) msg="$msg · $left still queued" ;; esac
  if [ "$n" -eq 1 ]; then
    kind="$(printf '%s\n' "$items" | cut -f1)"; slug="$(printf '%s\n' "$items" | cut -f2)"
    [ "$kind" = sheet ] && app="$app#$slug" || app="$app#session/$slug"
  fi
  printf '%s\n%s\n' "$msg" "$app"
}
# rb_failed_notice <rb.py exit code>: the notice when rb.py fails before the run. Exit 3 = the computer's session was
# revoked (signed out everywhere): rb.py login is the fix. Pure, tested.
rb_failed_notice() {
  if [ "$1" = 3 ]; then echo "Reelbook night run: signed out, run rb.py login"
  else echo "Night run: rb.py queue failed (exit $1)"; fi
}
on_battery() {
  pmset -g batt 2>/dev/null | head -1 | grep -q "Battery Power"
}
screen_locked() {
  [ "$(ioreg -n Root -d1 -a | plutil -extract IOConsoleUsers.0.CGSSessionScreenIsLocked raw - 2>/dev/null)" = true ]
}
# glossary_count <rb.py glossary pending output>: the sheets waiting for the glossary pass, all notebooks together
# (one line per notebook, `<theme> <count>`; no line = 0). Pure, tested.
glossary_count() {
  printf '%s\n' "$1" | awk 'NF >= 2 && $NF ~ /^[0-9]+$/ { n += $NF } END { print n + 0 }'
}
# glossary_notice <claude exit> <waiting after>: how the glossary run ended, for the log and the phone: the exit code
# of the pass and the sheets still waiting after it (`?` = rb.py could not say). The sheets read are not worked out
# from the count before and after: another engine may publish sheets while the pass runs, and the difference would
# then call a pass that read some a failure. A failure is the pass's own (a non-zero exit). Pure, tested.
glossary_notice() {
  local status="$1" after="$2" msg
  if [ "$status" = 0 ]; then msg="Glossary: run done (claude exit 0)"; else msg="Glossary run failed (claude exit $status)"; fi
  case "$after" in
    ''|*[!0-9]*) echo "$msg, rb.py glossary pending failed" ;;
    *) echo "$msg · $after still waiting" ;;
  esac
}
glossary_waiting() {  # number of sheets waiting for the glossary pass, fails with rb.py's exit code
  local out
  out="$(cd "$REPO" && python3 tools/rb.py glossary pending 2>/dev/null)" || return $?
  glossary_count "$out"
}
queued() {  # number of queued requests, fails with rb.py's exit code
  local out
  out="$(cd "$REPO" && python3 tools/rb.py queue 2>/dev/null)" || return $?
  printf '%s\n' "$out" | grep -c '^{' || true  # grep -c exits 1 on a count of 0: an empty queue is not a failure
}

cmd_check() {
  echo "repo:    $REPO"
  echo "claude:  ${CLAUDE:-not found}"
  echo "queued:  $(queued || echo 'rb.py failed: run rb.py login')"
  local waiting
  if waiting="$(glossary_waiting)"; then echo "glossary: $waiting sheet(s) waiting for the pass"
  else echo "glossary: rb.py glossary pending failed (no glossary on this backend, or run rb.py login)"; fi
  echo "screen:  $(screen_locked && echo locked || echo unlocked)"
  echo "power:   $(on_battery && echo "battery (a run would be skipped)" || echo "AC")"
  echo "notify:  $([ -n "${REELBOOK_NOTIFY_URL:-${RALPH_NOTIFY_URL:-}}" ] && echo on || echo off)"
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then echo "nightly: installed ($PLIST)"; else echo "nightly: not installed"; fi
}

# The glossary catch-up: one Claude run without Chrome (text only), when sheets wait for the pass. The caller has
# checked the 3-hour window and the session; a screen locked or not does not matter here.
cmd_glossary() {  # cmd_glossary <at most N sheets>
  local gmax="$1" before after status notice
  before="$(glossary_waiting)" || { log "glossary: rb.py glossary pending failed (exit $?): skipped"; return 0; }
  [ "$before" -eq 0 ] && return 0
  if on_battery; then log "glossary: $before sheet(s) waiting, Mac on battery: skipped"; return 0; fi
  log "glossary: $before sheet(s) waiting, reading up to $gmax"
  cd "$REPO" || return 1
  caffeinate -ims "$CLAUDE" -p --model claude-opus-5-5 --permission-mode auto \
    "/reelbook glossary, at most $gmax sheets" </dev/null
  status=$?
  after="$(glossary_waiting || echo '?')"
  notice="$(glossary_notice "$status" "$after")"
  log "$notice"; notify "$notice" "${REELBOOK_APP_URL:-https://lt20.github.io/reelbook/}"
}

cmd_run() {
  local max=5 gmax=10 at="" n rc left status since published notice
  while [ $# -gt 0 ]; do
    case "$1" in
      --max) max="$2"; shift 2 ;;
      --glossary-max) gmax="$2"; shift 2 ;;
      --at) at="$2"; shift 2 ;;  # scheduled HH:MM, set by the LaunchAgent
      *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
  done
  if [ -n "$at" ]; then
    local now=$((10#$(date +%H) * 60 + 10#$(date +%M))) sched=$((10#${at%%:*} * 60 + 10#${at##*:}))
    if [ $(((now - sched + 1440) % 1440)) -gt 180 ]; then log "more than 3 h after $at: skipped"; exit 0; fi
  fi
  # a run that died (sleep, crash) leaves its request « processing », out of the queue for good
  (cd "$REPO" && python3 tools/rb.py requeue-stuck 2>&1) | sed "s/^/$(date '+%F %T') /"
  n="$(queued)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    log "$(rb_failed_notice "$rc")"; notify "$(rb_failed_notice "$rc")"; exit 1
  fi
  # an empty queue is not the end of the night: another engine may have taken every video, and its sheets
  # still wait for the glossary pass
  if [ "$n" -eq 0 ]; then log "queue empty"; cmd_glossary "$gmax"; exit 0; fi
  if on_battery; then
    log "$n queued, Mac on battery: skipped"; notify "$n video(s) waiting, Mac was on battery: skipped (plug it in)"; exit 0
  fi
  open -a "Google Chrome"
  log "$n queued, processing up to $max (screen $(screen_locked && echo locked || echo unlocked))"
  cd "$REPO" || exit 1
  # what this run publishes = added from now on (a minute back for a clock slightly ahead of the backend's)
  since="$(date -u -v-1M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)"
  # -u wakes the display, -d keeps it on while Claude works.
  caffeinate -dimsu "$CLAUDE" -p --chrome --model claude-opus-5-5 --permission-mode auto \
    "/reelbook process the queue, at most $max requests, then stop and list the sheet links" </dev/null
  status=$?
  left="$(queued || echo '?')"
  log "claude exit $status, $left still queued"
  if published="$(python3 tools/rb.py list --since "$since" 2>/dev/null)"; then
    notice="$(night_notice "$status" "$left" "$published")"
    notify "$(printf '%s\n' "$notice" | sed -n 1p)" "$(printf '%s\n' "$notice" | sed -n 2p)"
  else
    rc=$?  # revoked during the run (exit 3): say so rather than « list failed »
    if [ "$rc" = 3 ]; then log "$(rb_failed_notice 3)"; notify "$(rb_failed_notice 3) (claude exit $status)"
    else notify "Night run done (claude exit $status), $left still queued; rb.py list failed" "${REELBOOK_APP_URL:-https://lt20.github.io/reelbook/}"; fi
  fi
  cmd_glossary "$gmax"
}

cmd_install() {
  local at="${1:-02:00}"
  case "$at" in [0-2][0-9]:[0-5][0-9]) ;; *) echo "time must be HH:MM" >&2; exit 2 ;; esac
  [ -x "$CLAUDE" ] || { echo "claude not found: set CLAUDE_BIN" >&2; exit 1; }
  # a reinstall keeps the topic already in the LaunchAgent
  local kept; kept="$(plutil -extract EnvironmentVariables.REELBOOK_NOTIFY_URL raw "$PLIST" 2>/dev/null)"
  local notify_url="${REELBOOK_NOTIFY_URL:-${kept:-${RALPH_NOTIFY_URL:-}}}"
  mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")" "$(dirname "$LAUNCHER")"
  printf '#!/bin/bash\n# Reelbook: processes the video queue at night. Remove with: %s uninstall\nexec "%s" "$@"\n' \
    "$REPO/tools/nightly.sh" "$REPO/tools/nightly.sh" > "$LAUNCHER"
  chmod +x "$LAUNCHER"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$LAUNCHER</string><string>run</string><string>--at</string><string>$at</string></array>
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
  echo "Installed: every night at $at, listed by macOS as « Reelbook night run ». Log: $LOG"
}

cmd_uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
  rm -f "$PLIST" "$LAUNCHER"
  echo "Uninstalled."
}

# sourced (tests/rb-queue.test.py reads night_notice, tests/rb-auth.test.py rb_failed_notice,
# tests/rb-glossary-pass.test.py the glossary functions): define the functions only
[ "${BASH_SOURCE[0]}" = "$0" ] || return 0
case "${1:-}" in
  check) cmd_check ;;
  run) shift; cmd_run "$@" ;;
  install) shift; cmd_install "$@" ;;
  uninstall) cmd_uninstall ;;
  *) sed -n '2,18p' "$SELF" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
