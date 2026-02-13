#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-$ROOT_DIR/build}"
PROFILE="${1:-two_phase}"
CONFIG="${CONFIG:-$ROOT_DIR/config/config_paper_20x20.yaml}"
RESUME="${RESUME:-auto}"
# Para correr dos entrenamientos a la vez, usa otro SAVE_DIR en cada uno.
SAVE_DIR="${SAVE_DIR:-}"

ARGS=(
  --config "$CONFIG"
  --profile "$PROFILE"
  --resume "$RESUME"
)
[ -n "$SAVE_DIR" ] && ARGS+=(--save_dir "$SAVE_DIR")

"$BUILD_DIR/alphasnake_train" "${ARGS[@]}"
