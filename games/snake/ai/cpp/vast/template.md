# Vast.ai Template — AlphaSnake C++ CUDA Train

## Configuración recomendada (UI)

- **Template name**: `AlphaSnake C++ CUDA Train`
- **Base template**: NVIDIA CUDA recommended
- **Docker image**: `vastai/base-image:[Automatic]`
- **Launch mode**: `SSH`
- **Disk**: `80-120 GB`
- **Ports**: solo SSH

## PROVISIONING_SCRIPT

Pega esto en el campo `PROVISIONING_SCRIPT`:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd /workspace/arcade/games/snake/ai/cpp
./scripts/provision_vast.sh
./scripts/build.sh
```

## Inicio de entrenamiento en la instancia

```bash
cd /workspace/arcade/games/snake/ai/cpp
./scripts/run_train.sh two_phase
```

## Evaluación y export

```bash
./scripts/run_eval.sh
./scripts/run_export.sh
```

## Artefactos

- Checkpoints: `/workspace/alphasnake_paper_10x10/`
- ONNX: `/workspace/alphasnake_paper_10x10/alphasnake.onnx`

## Integración local JS/HTML

Desde tu máquina local:

```bash
/Users/JuanCamiloTorresUrrego/Documents/tiktok/arcade/games/snake/ai/cpp/scripts/scp_onnx_from_vast.sh <vast_host> <ssh_port>
```

Abrir:

`/Users/JuanCamiloTorresUrrego/Documents/tiktok/arcade/games/snake/ai.html`
