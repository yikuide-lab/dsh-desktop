#!/bin/bash
# Build script for DSH Desktop Linux packages

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Building DSH Desktop Linux packages..."
echo "Project root: $PROJECT_ROOT"

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed or not in PATH"
    exit 1
fi

# Create output directory
mkdir -p "$SCRIPT_DIR/output"

# Build AppImage (most portable)
echo "Building AppImage..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" run --rm build-appimage

echo ""
echo "Build complete! Artifacts are in: $SCRIPT_DIR/output"
ls -lh "$SCRIPT_DIR/output/" 2>/dev/null || echo "No artifacts found"
