#!/usr/bin/env bash
#
# Render both ALPSTUGA cards (light + dark, with demo data) to demo/preview.png.
#
# Serves the repo over a local HTTP server (ES module imports need http://,
# not file://) and screenshots demo/index.html with headless Chromium.
#
# Usage:  ./demo/screenshot.sh [output.png]
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$REPO_ROOT/demo/preview.png}"
PORT="${PORT:-8899}"

# Pick a Chromium/Chrome binary.
CHROME=""
for b in chromium chromium-browser google-chrome google-chrome-stable chrome; do
  if command -v "$b" >/dev/null 2>&1; then CHROME="$b"; break; fi
done
if [ -z "$CHROME" ]; then
  echo "No Chromium/Chrome found in PATH." >&2
  exit 1
fi

# Start a static server rooted at the repo and stop it on exit.
( cd "$REPO_ROOT" && python3 -m http.server "$PORT" >/dev/null 2>&1 ) &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
sleep 1

"$CHROME" --headless=new --no-sandbox --disable-gpu \
  --force-device-scale-factor=2 --hide-scrollbars \
  --window-size=904,748 --virtual-time-budget=5000 \
  --screenshot="$OUT" "http://localhost:$PORT/demo/index.html"

echo "Wrote $OUT"
