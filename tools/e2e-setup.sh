#!/usr/bin/env bash
# e2e-setup.sh — install Playwright once, outside the repository, for tests/e2e/shots.mjs.
#
#   tools/e2e-setup.sh            # playwright@1.63.0 into ~/.cache/reelbook-e2e (REELBOOK_E2E_DIR to change)
#
# The repository has no package.json on purpose (static app, no build): Playwright lives in a
# cache folder shared by every worktree. Browsers go to Playwright's own cache
# (~/Library/Caches/ms-playwright on macOS); browsers of the same version already there are reused.
set -euo pipefail
version="1.63.0"
dir="${REELBOOK_E2E_DIR:-$HOME/.cache/reelbook-e2e}"
n20="$HOME/.nvm/versions/node/v20.20.2/bin"
[ -x "$n20/node" ] && export PATH="$n20:$PATH"
command -v npm >/dev/null || { echo "npm not found (Node 20 needed)" >&2; exit 1; }

have="$(node -p "try { require('$dir/node_modules/playwright/package.json').version } catch { '' }" 2>/dev/null || true)"
if [ "$have" = "$version" ]; then
  echo "playwright $version already in $dir"
else
  mkdir -p "$dir"
  [ -f "$dir/package.json" ] || printf '{ "name": "reelbook-e2e", "private": true }\n' > "$dir/package.json"
  npm install --prefix "$dir" --no-audit --no-fund --silent "playwright@$version"
  echo "playwright $version installed in $dir"
fi
# Downloads WebKit (default of shots.mjs) and Chromium only when the cache does not already hold this version's builds.
node "$dir/node_modules/playwright/cli.js" install webkit chromium
