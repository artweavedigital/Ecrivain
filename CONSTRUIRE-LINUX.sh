#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npm install
npm run check
npm run package:linux
echo "Application Linux créée dans dist/Ecrivain-linux-x64/"
