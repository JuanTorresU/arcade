#!/usr/bin/env bash
set -euo pipefail

cd /workspace/arcade/games/snake/ai/cpp
./scripts/provision_vast.sh
./scripts/build.sh
