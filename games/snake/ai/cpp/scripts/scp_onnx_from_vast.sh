#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Uso: $0 <vast_host> <ssh_port> [remote_path] [local_path]"
  echo "Ejemplo: $0 203.0.113.10 41352"
  exit 1
fi

HOST="$1"
PORT="$2"
REMOTE_PATH="${3:-/workspace/alphasnake_paper_20x20/alphasnake.onnx}"
LOCAL_PATH="${4:-/Users/JuanCamiloTorresUrrego/Documents/tiktok/arcade/games/snake/ai/alphasnake.onnx}"
USER_NAME="${VAST_USER:-root}"

scp -P "$PORT" "$USER_NAME@$HOST:$REMOTE_PATH" "$LOCAL_PATH"

echo "[OK] ONNX copiado a: $LOCAL_PATH"
