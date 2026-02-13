#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  build-essential \
  cmake \
  ninja-build \
  pkg-config \
  git \
  curl \
  ca-certificates \
  python3 \
  python3-pip \
  tmux \
  htop

python3 -m pip install --upgrade pip
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 -m pip install -r "$SCRIPT_DIR/requirements-export.txt"

# Torch debe estar con soporte CUDA para que LibTorch use GPU.
if ! python3 - <<'PY'
import importlib.util
raise SystemExit(0 if importlib.util.find_spec("torch") else 1)
PY
then
  echo "[WARN] torch no instalado; instalando wheel CUDA 12.4..."
  python3 -m pip install --upgrade --index-url https://download.pytorch.org/whl/cu124 torch torchvision torchaudio
fi

python3 - <<'PY'
import torch
print("[INFO] torch:", torch.__version__)
print("[INFO] torch.cuda.is_available:", torch.cuda.is_available())
print("[INFO] torch.version.cuda:", torch.version.cuda)
print("[INFO] cmake_prefix_path:", torch.utils.cmake_prefix_path)
if not torch.cuda.is_available():
    raise SystemExit("[ERROR] PyTorch no detecta CUDA. Revisa imagen/driver/template de Vast.")
PY

mkdir -p /workspace/alphasnake_paper_20x20

echo "[OK] Provisioning completado"
