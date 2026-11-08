#!/usr/bin/env bash
# L42a: a fresh local Supabase with Turnstile on, for tests/e2e/cli-login-real.mjs. Never the hosted project.
#
#   tests/e2e/cli-login-stack.sh up      # new CLI project rb-l42a (ports 549xx) in a scratch folder, schema.sql as its
#                                        # only migration, both Edge Functions served, captcha on (Turnstile)
#   tests/e2e/cli-login-stack.sh env     # the variables cli-login-real.mjs reads (eval "$(… env)")
#   tests/e2e/cli-login-stack.sh down    # stop it and drop its volumes (nothing of it is kept)
#
# The captcha secret is Cloudflare's published TEST secret that always fails (2x0000000000000000000000000000000AA):
# with it, a password grant that is not exempted can never pass, whatever token it carries. The Auth container reaches
# challenges.cloudflare.com to check it (network needed). RB_L42_DIR picks the folder (default: a folder under $TMPDIR).
# Ports 54920-54929 and 8093: free on Laurent's machine (3000, 54321-54324, 54421-54422, 545xx, 546xx, 547xx and 548xx
# belong to other stacks; none of them is ever stopped by this script).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="${RB_L42_DIR:-${TMPDIR:-/tmp}/rb-l42a-stack}"
FAIL_SECRET="2x0000000000000000000000000000000AA"

up() {
  mkdir -p "$DIR"; cd "$DIR"
  [ -f supabase/config.toml ] || supabase init --force >/dev/null
  python3 - supabase/config.toml "$FAIL_SECRET" <<'PY'
import re, sys
p, secret = sys.argv[1], sys.argv[2]
t = open(p).read()
t = re.sub(r'^project_id = ".*"', 'project_id = "rb-l42a"', t, flags=re.M)
for a, b in (("54321", "54921"), ("54322", "54922"), ("54320", "54920"), ("54329", "54929"), ("54323", "54923"),
             ("54324", "54924"), ("54327", "54927"), ("8083", "8093")):
    t = re.sub(rf'^(\w*port = ){a}$', rf'\g<1>{b}', t, flags=re.M)
t = re.sub(r'^# \[auth\.captcha\]\n# enabled = true\n# provider = "hcaptcha"\n# secret = ""',
           f'[auth.captcha]\nenabled = true\nprovider = "turnstile"\nsecret = "{secret}"', t, flags=re.M)
assert 'provider = "turnstile"' in t, "captcha block not found in config.toml"
if "[functions.cli-login]" not in t:
    t += '\n[functions.cli-login]\nverify_jwt = false\n\n[functions.add-link]\nverify_jwt = false\n'
open(p, "w").write(t)
PY
  rm -rf supabase/functions supabase/migrations; mkdir -p supabase/migrations
  cp -R "$ROOT/supabase/functions" supabase/functions
  cp "$ROOT/supabase/schema.sql" supabase/migrations/20261108000000_schema.sql
  supabase start -x studio,imgproxy,realtime,postgres-meta,logflare,vector,supavisor
}

# The CLI's Auth sets no GOTRUE_RATE_LIMIT_HEADER, so it limits nothing per IP on /token. `limited` starts a second
# Auth on 127.0.0.1:54930: same image, network, database and environment, plus GOTRUE_RATE_LIMIT_HEADER=X-Forwarded-For,
# so that the per-IP limits of the hosted platform can be measured (the abuse section of cli-login-real.mjs).
limited() {
  local env_file="$DIR/auth-limited.env"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' supabase_auth_rb-l42a | grep . > "$env_file"
  echo "GOTRUE_RATE_LIMIT_HEADER=X-Forwarded-For" >> "$env_file"
  docker rm -f rb-l42a-auth-limited >/dev/null 2>&1 || true
  docker run -d --name rb-l42a-auth-limited --network supabase_network_rb-l42a --env-file "$env_file" \
    -p 127.0.0.1:54930:9999 "$(docker inspect -f '{{.Config.Image}}' supabase_auth_rb-l42a)" auth >/dev/null
  rm -f "$env_file"
  for _ in $(seq 1 30); do curl -sf http://127.0.0.1:54930/health >/dev/null && { echo "limited Auth on :54930"; return; }; sleep 1; done
  echo "limited Auth did not start" >&2; exit 1
}

case "${1:-}" in
  up) up ;;
  limited) limited ;;
  env) cd "$DIR" && supabase status -o env 2>/dev/null | sed -n 's/^\([A-Z_]*\)=/export RB_\1=/p' ;;
  down) docker rm -f rb-l42a-auth-limited >/dev/null 2>&1 || true; cd "$DIR" && supabase stop --no-backup ;;
  *) echo "usage: $0 up|limited|env|down" >&2; exit 2 ;;
esac
