#!/usr/bin/env bash
# build.sh — the app on a fake backend, for screenshots and design checks. Nothing here ships.
#
#   tools/preview/build.sh <out-dir>                 # synthetic data (tests/fixtures/preview)
#   tools/preview/build.sh <out-dir> --work <dir>    # Laurent's local work/ folder (never committed)
#   tools/preview/serve.sh <out-dir> <port>          # then http://127.0.0.1:<port>/index.html
#
# Copies app/ to <out-dir>, replaces vendor/supabase.js by tools/preview/fake-supabase.js, adds
# vendor/fake-data.js (script tag injected before supabase.js) and files/ (the photos), and empties
# sw.js (no cache between two builds). Query options of the fake client: ?noauth, ?missing=<tables>,
# ?seats=<taken of 50> | closed | last (beta_seats, the last seat taken when asked again).
# <out-dir> must be new, empty, or a previous preview (it holds .reelbook-preview): it is rebuilt.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd -P)"
out=""
work=""
while [ $# -gt 0 ]; do
  case "$1" in
    --work) work="${2:-}"; [ -n "$work" ] || { echo "--work needs a folder" >&2; exit 2; }; shift 2 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) [ -z "$out" ] || { echo "one output folder only" >&2; exit 2; }; out="$1"; shift ;;
  esac
done
[ -n "$out" ] || { echo "usage: build.sh <out-dir> [--work <dir>]" >&2; exit 2; }

# The output never lives in the repository: a --work build holds Laurent's sheets (fake-data.js,
# links to their photos), which must not be committed by accident. Checked on the physical path
# of the nearest existing ancestor, before anything is created or deleted.
anc="$out"
while [ ! -d "$anc" ]; do anc="$(dirname "$anc")"; done
anc_abs="$(cd "$anc" && pwd -P)"
case "$anc_abs/" in
  "$root/"*) echo "refusing to build inside the repository ($root): use a folder outside it (the scratchpad)" >&2; exit 2 ;;
esac

if [ -e "$out" ]; then
  [ -d "$out" ] || { echo "not a folder: $out" >&2; exit 2; }
  if [ -n "$(ls -A "$out")" ] && [ ! -f "$out/.reelbook-preview" ]; then
    echo "refusing to overwrite $out: not empty and not a previous preview" >&2
    exit 2
  fi
  out_abs="$(cd "$out" && pwd -P)"
  # find -delete does not follow the files/<slug> symlinks of a --work build.
  find "$out_abs" -mindepth 1 -delete
else
  mkdir -p "$out"
  out_abs="$(cd "$out" && pwd -P)"
fi

cp -R "$root/app/." "$out_abs/"
touch "$out_abs/.reelbook-preview"
cp "$here/fake-supabase.js" "$out_abs/vendor/supabase.js"
: > "$out_abs/sw.js"

if [ -n "$work" ]; then
  python3 -I "$here/fake-data.py" "$out_abs" --work "$work"
else
  python3 -I "$here/fake-data.py" "$out_abs" --fixtures "$root/tests/fixtures/preview"
fi

index="$out_abs/index.html"
if ! grep -q '<script src="vendor/supabase.js' "$index"; then
  echo "no supabase.js script tag in index.html: the preview cannot hook the fake client" >&2
  exit 1
fi
sed -i.bak 's#<script src="vendor/supabase.js#<script src="vendor/fake-data.js"></script><script src="vendor/supabase.js#' "$index"
rm -f "$index.bak"
grep -q 'vendor/fake-data.js' "$index" || { echo "fake-data.js was not injected" >&2; exit 1; }
echo "preview built in $out_abs"
