#!/usr/bin/env bash
#
# Render the ALPSTUGA card demos to PNGs with headless Chromium:
#   demo/preview.png   — header showcase (both cards, light + dark)
#   demo/features.png  — guideline-colouring showcase (basic + advanced)
#
# Serves the repo over a local HTTP server (ES module imports need http://,
# not file://) and screenshots each demo page.
#
# Usage:  ./demo/screenshot.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

# shoot <page> <output> <width> <height>
shoot() {
  "$CHROME" --headless=new --no-sandbox --disable-gpu \
    --force-device-scale-factor=2 --hide-scrollbars \
    --window-size="$3,$4" --virtual-time-budget=5000 \
    --screenshot="$REPO_ROOT/demo/$2" \
    "http://localhost:$PORT/demo/$1" >/dev/null 2>&1
  echo "Wrote demo/$2"
}

shoot index.html    preview.png  904 748
shoot features.html features.png 820 528
