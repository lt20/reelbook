#!/usr/bin/env bash
# L42b: a fresh local Supabase for tests/e2e/turnstile-real.mjs: email confirmation on (6-digit codes in the subject),
# Turnstile on or off in Auth. Never the hosted project.
#
#   tests/e2e/turnstile-stack.sh up        # new CLI project rb-l42b (ports 5495x) in a scratch folder, schema.sql as its
#                                          # only migration, captcha on with Cloudflare's TEST secret that always passes
#   tests/e2e/turnstile-stack.sh captcha off|on   # restart Auth's settings with the captcha off (or on again)
#   tests/e2e/turnstile-stack.sh env       # the variables turnstile-real.mjs reads (eval "$(… env)")
#   tests/e2e/turnstile-stack.sh down      # stop it and drop its volumes (nothing of it is kept)
#
# The secret 1x0000000000000000000000000000000AA accepts any token Cloudflare's test site keys give, and still refuses a
# request without a token (Auth checks that first). The Auth container reaches challenges.cloudflare.com (network
# needed). RB_L42B_DIR picks the folder (default: a folder under $TMPDIR). Ports 54950-54959 and 8095: free on Laurent's
# machine (other stacks: 3000, 54321-54324, 54421-54422, 545xx, 546xx, 547xx, 548xx, 549[23]x; none of them is ever
# stopped by this script).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="${RB_L42B_DIR:-${TMPDIR:-/tmp}/rb-l42b-stack}"
PASS_SECRET="1x0000000000000000000000000000000AA"
SKIP="studio,imgproxy,realtime,postgres-meta,logflare,vector,supavisor,edge-runtime,storage-api"

configure() { # $1: on | off
  python3 - supabase/config.toml "$PASS_SECRET" "$1" <<'PY'
import re, sys
p, secret, on = sys.argv[1], sys.argv[2], sys.argv[3] == "on"
t = open(p).read()
t = re.sub(r'^project_id = ".*"', 'project_id = "rb-l42b"', t, flags=re.M)
for a, b in (("54321", "54951"), ("54322", "54952"), ("54320", "54950"), ("54329", "54959"), ("54323", "54953"),
             ("54324", "54954"), ("54327", "54957"), ("8083", "8095")):
    t = re.sub(rf'^(\w*port = ){a}$', rf'\g<1>{b}', t, flags=re.M)
t = re.sub(r'^# \[auth\.captcha\]\n# enabled = true\n# provider = "hcaptcha"\n# secret = ""',
           f'[auth.captcha]\nenabled = true\nprovider = "turnstile"\nsecret = "{secret}"', t, flags=re.M)
t = re.sub(r'(\[auth\.captcha\]\nenabled = )(true|false)', rf'\g<1>{"true" if on else "false"}', t)
assert 'provider = "turnstile"' in t, "captcha block not found in config.toml"
t = re.sub(r'^email_sent = \d+$', 'email_sent = 200', t, flags=re.M)
t = re.sub(r'^(\[auth\.email\](?:\n[^\[].*)*?\nenable_confirmations = )false', r'\g<1>true', t, flags=re.M)
if "[auth.email.template.confirmation]" not in t:
    t += ('\n[auth.email.template.confirmation]\nsubject = "Reelbook code {{ .Token }}"\ncontent_path = "./supabase/templates/code.html"\n'
          '\n[auth.email.template.recovery]\nsubject = "Reelbook code {{ .Token }}"\ncontent_path = "./supabase/templates/code.html"\n')
open(p, "w").write(t)
PY
}

up() {
  mkdir -p "$DIR"; cd "$DIR"
  [ -f supabase/config.toml ] || supabase init --force >/dev/null
  configure on
  mkdir -p supabase/templates; printf '<p>Your code: {{ .Token }}</p>\n' > supabase/templates/code.html
  rm -rf supabase/migrations; mkdir -p supabase/migrations
  cp "$ROOT/supabase/schema.sql" supabase/migrations/20261108000000_schema.sql
  supabase start -x "$SKIP"
}

captcha() { # Auth reads its settings at start: stop (keeping the data) and start again
  cd "$DIR"; configure "$1"; supabase stop >/dev/null; supabase start -x "$SKIP" >/dev/null; echo "captcha $1"
}

case "${1:-}" in
  up) up ;;
  captcha) captcha "${2:?on or off}" ;;
  env) cd "$DIR" && supabase status -o env 2>/dev/null | sed -n 's/^\([A-Z_]*\)=/export RB_\1=/p' ;;
  down) cd "$DIR" && supabase stop --no-backup ;;
  *) echo "usage: $0 up|captcha on|off|env|down" >&2; exit 2 ;;
esac
