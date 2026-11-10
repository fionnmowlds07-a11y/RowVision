#!/usr/bin/env bash
# Builds the full Linux installer (an AppImage with the measuring program and ffmpeg inside) on this computer.
# Needs Docker and Node. Python 3.12 runs inside Docker, so nothing is installed on the host.
#
#   bash scripts/build-installer.sh            # build it
#   bash scripts/build-installer.sh --install  # build it, then put RowVision in the app launcher
#
# The Windows installer is built by the Installers workflow in CI, as it has to be built on Windows.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
root="$(cd ../.. && pwd)"

if [ ! -x engine/rowvision-engine ]; then
  echo "== Bundling the measuring program (Docker, python 3.12)"
  rm -rf engine
  docker run --rm -v "$root:/src:ro" -v "$PWD:/out" -e OWNER="$(id -u):$(id -g)" \
    -w /tmp python:3.12-slim bash -euc '
      apt-get update -qq >/dev/null && apt-get install -y -qq binutils >/dev/null
      python -m venv /tmp/venv && . /tmp/venv/bin/activate
      cp -r /src/services /tmp/services
      pip install -q /tmp/services/vision /tmp/services/worker pyinstaller
      pip uninstall -y -q opencv-contrib-python opencv-python opencv-python-headless
      pip install -q "opencv-python-headless>=4.10,<5"
      cd /tmp
      pyinstaller --noconfirm --onedir --name rowvision-engine --exclude-module psycopg \
        --collect-all rtmlib --collect-all onnxruntime --collect-all cv2 \
        --collect-submodules rowvision --collect-submodules rowvision_worker \
        --add-data "services/vision/reference:reference" --add-data "services/vision/rowvision/*.py:rowvision" \
        services/worker/packaging/smoke.py
      mkdir -p /out/engine && cp -r dist/rowvision-engine/. /out/engine/
      chown -R "$OWNER" /out/engine
    '
  echo "== Putting ffmpeg beside it"
  python3 scripts/fetch-ffmpeg.py engine
else
  echo "== Reusing engine/ (delete it to rebuild the measuring program)"
fi

echo "== Building the installer"
npm ci
npm run dist
ls -lh release/*.AppImage

if [ "${1:-}" = "--install" ]; then
  bash scripts/install-linux.sh
fi
