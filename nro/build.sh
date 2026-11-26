#!/usr/bin/env bash
# Build vesper.nro inside the ounce-devkit Docker image.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${OUNCE_DEVKIT_IMAGE:-ghcr.io/ouncebrew/ounce-devkit:latest}"

echo "Building vesper.nro using Docker image: $IMAGE"
docker run --rm -v "$SCRIPT_DIR:/src" -w /src "$IMAGE" make "$@"
echo "Done: $SCRIPT_DIR/vesper.nro"
