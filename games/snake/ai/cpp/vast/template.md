# Vast.ai Template — AlphaSnake C++ CUDA Train

## Configuración recomendada (UI)

- **Template name**: `AlphaSnake C++ CUDA Train`
- **Base template**: NVIDIA CUDA recommended
- **Docker image**: `vastai/base-image:[Automatic]`
- **Launch mode**: `SSH`
- **Disk**: `80-120 GB`
- **Ports**: solo SSH

## PROVISIONING_SCRIPT

En Vast.ai, `PROVISIONING_SCRIPT` debe ser una URL raw (no script pegado).
Usa exactamente este valor:

```text
https://raw.githubusercontent.com/JuanTorresU/arcade/main/games/snake/ai/cpp/vast/provision_bootstrap.sh
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

- Checkpoints: `/workspace/alphasnake_paper_20x20/`
- ONNX: `/workspace/alphasnake_paper_20x20/alphasnake.onnx`

## Integración local JS/HTML

Desde tu máquina local:

```bash
/Users/JuanCamiloTorresUrrego/Documents/tiktok/arcade/games/snake/ai/cpp/scripts/scp_onnx_from_vast.sh <vast_host> <ssh_port>
```

Abrir:

`/Users/JuanCamiloTorresUrrego/Documents/tiktok/arcade/games/snake/ai.html`
