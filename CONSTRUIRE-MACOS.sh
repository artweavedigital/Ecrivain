#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npm install
npm run check
npm run package:mac:arm64
npm run package:mac:x64
cat <<'MSG'
Bundles macOS créés dans dist/.
Pour une distribution publique sur macOS, il reste à signer et notariser l'application avec un compte Apple Developer.
MSG
