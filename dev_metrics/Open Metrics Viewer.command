#!/usr/bin/env bash
# Double-click this file to open the Quotify Parse Metrics Viewer.
#
# What it does:
#   1. Kills any stale process holding port 8080.
#   2. Starts a local web server in this folder on port 8080.
#   3. Opens viewer.html in your default browser.
#   4. Keeps running until you close this Terminal window (Ctrl+C also works).
#
# Why this exists: the viewer can't fetch from the Railway API when opened
# via file:// (browser CORS rule). Serving it from http://localhost:8080
# matches one of the origins listed in backend/main.py CORS, so the fetch
# succeeds and your DEV_METRICS_API_KEY (already saved in local.config.js)
# auto-fills the form.

set -e

# Move into the folder this script lives in (works no matter where it's launched from).
cd "$(dirname "$0")"

PORT=8080
URL="http://localhost:${PORT}/viewer.html"

# Find a python interpreter (prefer python3).
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "ERROR: Python is not installed. Install it from https://www.python.org/downloads/ and try again."
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

# If something is already listening on the port, kill it. Avoids the "Address already in use" error.
if lsof -ti tcp:${PORT} >/dev/null 2>&1; then
  echo "Port ${PORT} is in use — freeing it..."
  lsof -ti tcp:${PORT} | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# Open the browser shortly after the server starts.
( sleep 1 && open "${URL}" ) &

echo "------------------------------------------------------------"
echo "  Quotify Parse Metrics Viewer"
echo "  Serving:  $(pwd)"
echo "  URL:      ${URL}"
echo "  Stop:     close this window or press Ctrl+C"
echo "------------------------------------------------------------"

exec "${PY}" -m http.server ${PORT}
