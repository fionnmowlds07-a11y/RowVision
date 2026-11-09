#!/usr/bin/env bash
# Starts the built app with the real engine, through Docker. Run `npm run build` first.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export ROWVISION_ENGINE="[\"$PWD/scripts/dev-engine.sh\"]"
exec npx electron . "$@"
