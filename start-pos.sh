#!/usr/bin/env bash
# Start the POS on macOS/Linux. First run installs everything (needs internet).
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js LTS from https://nodejs.org first."; exit 1; }
[ -f server/.env ] || { echo "server/.env is missing. Follow SETUP.md step 3 first."; exit 1; }
[ -d server/node_modules ] || npm run setup
# Rebuild the screens when they're missing or from an older version.
cmp -s client/public/VERSION client/dist/VERSION 2>/dev/null || npm run build
npm start
