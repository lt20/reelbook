#!/usr/bin/env bash
# serve.sh — serve a preview built by build.sh, bound to 127.0.0.1 only.
#
#   tools/preview/serve.sh <out-dir> <port>     # http://127.0.0.1:<port>/index.html (Ctrl-C to stop)
#
# One port per lot (docs/audit-design/COORDINATION.md: L0 8770, L1 8771 … L8 8778).
set -euo pipefail
dir="${1:-}"
port="${2:-}"
[ -n "$dir" ] && [ -n "$port" ] || { echo "usage: serve.sh <out-dir> <port>" >&2; exit 2; }
[ -f "$dir/.reelbook-preview" ] || { echo "$dir is not a preview built by tools/preview/build.sh" >&2; exit 2; }
[[ "$port" =~ ^[0-9]+$ ]] || { echo "port must be a number" >&2; exit 2; }
echo "serving $dir on http://127.0.0.1:$port/index.html" >&2
exec python3 -I -m http.server "$port" --bind 127.0.0.1 --directory "$dir"
