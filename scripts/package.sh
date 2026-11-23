#!/usr/bin/env bash
# Builds dist/git-code-port-<version>.zip containing only what the browser needs.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./manifest.json').version")
mkdir -p dist
OUT="dist/git-code-port-${VERSION}.zip"
rm -f "$OUT"
zip -qr -9 "$OUT" manifest.json src assets -x '*.DS_Store'
echo "$OUT: $(wc -c < "$OUT") bytes"
