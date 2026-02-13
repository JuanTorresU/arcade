#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="${1:-$ROOT_DIR/build}"

# LibTorch CMake path from Python torch (pytorch image in Vast.ai)
# Probar python3 por defecto; si no tiene torch, usar /venv/main/bin/python3
TORCH_CMAKE_PREFIX=""
if python3 -c "import torch" 2>/dev/null; then
  TORCH_CMAKE_PREFIX="$(python3 -c 'import torch; print(torch.utils.cmake_prefix_path)')"
elif [ -x "/venv/main/bin/python3" ] && /venv/main/bin/python3 -c "import torch" 2>/dev/null; then
  TORCH_CMAKE_PREFIX="$(/venv/main/bin/python3 -c 'import torch; print(torch.utils.cmake_prefix_path)')"
  echo "[build] usando torch de /venv/main"
fi
if [ -z "$TORCH_CMAKE_PREFIX" ]; then
  echo "[ERROR] No se encontró PyTorch. Activa el venv o instala: pip install torch"
  exit 1
fi

cmake -S "$ROOT_DIR" -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DALPHASNAKE_USE_TORCH=ON \
  -DCMAKE_PREFIX_PATH="$TORCH_CMAKE_PREFIX"
cmake --build "$BUILD_DIR" -j"$(nproc || echo 4)"

echo "[OK] Build listo en: $BUILD_DIR"
