#!/usr/bin/env bash
# The measuring program for running the app from source (Linux, needs Docker). The app calls it with a job file.
# It runs the real engine in the worker image with no network, and only sees the clip's folder and the video's folder.
# Build the image once with: docker build -t compvisionrowing-worker:latest -f services/worker/Dockerfile .
set -euo pipefail
job=$1
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
image=${ROWVISION_ENGINE_IMAGE:-compvisionrowing-worker:latest}
cpus=${ROWVISION_ENGINE_CPUS:-3}
models=${ROWVISION_MODELS:-$repo/private/cache}

if ! docker image inspect "$image" >/dev/null 2>&1; then
  echo "The engine image $image is missing. Build it first (see the top of scripts/dev-engine.sh)." >&2
  exit 1
fi
if [ ! -d "$models/.cache/rtmlib" ]; then
  echo "The measuring models are not in $models. Set ROWVISION_MODELS to a folder that has .cache/rtmlib in it." >&2
  exit 1
fi

folder=$(dirname "$job")
source=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("source") or "")' "$job")
mounts=(-v "$folder:$folder")
if [ -n "$source" ] && [ -e "$source" ]; then
  mounts+=(-v "$(dirname "$source"):$(dirname "$source"):ro")
fi

exec docker run --rm -i --network none --cpus "$cpus" --user "$(id -u):$(id -g)" -e HOME=/cache \
  "${mounts[@]}" -v "$models:/cache" \
  --entrypoint python "$image" -m rowvision_worker.desktop "$job"
