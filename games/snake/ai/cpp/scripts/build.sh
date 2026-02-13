#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="${1:-$ROOT_DIR/build}"

# LibTorch CMake path from Python torch (pytorch image in Vast.ai)
TORCH_CMAKE_PREFIX="$(python3 - <<'PY'
import torch
print(torch.utils.cmake_prefix_path)
PY
)"

cmake -S "$ROOT_DIR" -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DALPHASNAKE_USE_TORCH=ON \
  -DCMAKE_PREFIX_PATH="$TORCH_CMAKE_PREFIX"
cmake --build "$BUILD_DIR" -j"$(nproc || echo 4)"

echo "[OK] Build listo en: $BUILD_DIR"
