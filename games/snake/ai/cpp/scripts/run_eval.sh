#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-$ROOT_DIR/build}"
CONFIG="${CONFIG:-$ROOT_DIR/config/config_paper_20x20.yaml}"
GAMES="${GAMES:-200}"
SIMS="${SIMS:-400}"
CKPT="${CKPT:-/workspace/alphasnake_paper_20x20/best_model.bin}"

"$BUILD_DIR/alphasnake_eval" \
  --config "$CONFIG" \
  --checkpoint "$CKPT" \
  --games "$GAMES" \
  --simulations "$SIMS"
