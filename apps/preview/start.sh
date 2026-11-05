#!/usr/bin/env bash
# Start the preview page. Python runs in Docker, so the port is published on 127.0.0.1 only.
# Inside the container the server must listen on all of the container's own interfaces, or Docker
# could not reach it. Nothing outside this machine can, because the host side is loopback.
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
videos=${ROWVISION_VIDEOS:-$HOME/CompVisionRowing/videos}
private=${ROWVISION_PRIVATE:-$HOME/CompVisionRowing/private}
port=${PREVIEW_PORT:-8765}

echo "Open http://127.0.0.1:$port (press Ctrl+C here to stop)"
exec docker run --rm --init --name rowvision-preview \
  --user "$(id -u):$(id -g)" \
  -e HOME=/private/cache \
  -e PYTHONPATH=/app:/preview \
  -p "127.0.0.1:$port:$port" \
  -v "$repo/services/vision:/app:ro" \
  -v "$repo/apps/preview:/preview:ro" \
  -v "$private:/private" \
  -v "$videos:/videos:ro" \
  rowvision-vision:dev \
  python -B -m rowvision_preview.server \
  --videos /videos --private /private --host 0.0.0.0 --port "$port"
