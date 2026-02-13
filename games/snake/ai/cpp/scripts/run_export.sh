#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-$ROOT_DIR/build}"
CONFIG="${CONFIG:-$ROOT_DIR/config/config_paper_10x10.yaml}"
CKPT="${CKPT:-/workspace/alphasnake_paper_10x10/best_model.bin}"
OUT="${OUT:-/workspace/alphasnake_paper_10x10/alphasnake.onnx}"

"$BUILD_DIR/alphasnake_export_onnx" \
  --config "$CONFIG" \
  --checkpoint "$CKPT" \
  --out "$OUT" \
  --python-fallback "$ROOT_DIR/scripts/export_resnet_to_onnx.py" \
  --allow-fallback 1
