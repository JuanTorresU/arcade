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

mkdir -p /workspace/alphasnake_paper_10x10

echo "[OK] Provisioning completado"
