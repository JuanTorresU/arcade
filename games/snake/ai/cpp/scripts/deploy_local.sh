#!/usr/bin/env bash
set -euo pipefail

REMOTE_ONNX="${1:-/workspace/alphasnake_paper_20x20/alphasnake.onnx}"
LOCAL_TARGET="${2:-/Users/JuanCamiloTorresUrrego/Documents/tiktok/arcade/games/snake/ai/alphasnake.onnx}"

cp "$REMOTE_ONNX" "$LOCAL_TARGET"

echo "[OK] Modelo copiado a: $LOCAL_TARGET"
