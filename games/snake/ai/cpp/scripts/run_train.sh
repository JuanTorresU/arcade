#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-$ROOT_DIR/build}"
PROFILE="${1:-two_phase}"
CONFIG="${CONFIG:-$ROOT_DIR/config/config_paper_10x10.yaml}"
RESUME="${RESUME:-auto}"

"$BUILD_DIR/alphasnake_train" \
  --config "$CONFIG" \
  --profile "$PROFILE" \
  --resume "$RESUME"
