# AlphaSnake C++ (Vast.ai SSH)

Entrenamiento de AlphaSnake por CLI C++ para correr en instancias Vast.ai.

## Objetivo operativo

- Entrenar en la nube (Vast.ai) por SSH.
- Guardar checkpoints en `/workspace/alphasnake_paper_10x10/`.
- Exportar `alphasnake.onnx` para usarlo en:
  - `/Users/JuanCamiloTorresUrrego/Documents/tiktok/arcade/games/snake/ai.html`
  - `/Users/JuanCamiloTorresUrrego/Documents/tiktok/arcade/games/snake/ai-bot.js`

## Estructura

- `CMakeLists.txt`
- `config/config_paper_10x10.yaml`
- `src/main_train.cpp`
- `src/main_eval.cpp`
- `src/main_export_onnx.cpp`
- `scripts/provision_vast.sh`
- `scripts/build.sh`
- `scripts/run_train.sh`
- `scripts/run_eval.sh`
- `scripts/run_export.sh`
- `scripts/scp_onnx_from_vast.sh`
- `scripts/export_linear_to_onnx.py`
- `vast/template.md`

## Compilar

```bash
cd /workspace/arcade/games/snake/ai/cpp
./scripts/build.sh
```

## Entrenar

Perfil 2 fases (`warmup_fast` -> `paper_strict`):

```bash
./scripts/run_train.sh two_phase
```

Perfil único:

```bash
./scripts/run_train.sh paper_strict
```

## Evaluar champion

```bash
./scripts/run_eval.sh
```

## Exportar ONNX

```bash
./scripts/run_export.sh
```

Salida esperada:

- `/workspace/alphasnake_paper_10x10/alphasnake.onnx`

## Deploy local para el juego

```bash
./scripts/scp_onnx_from_vast.sh <vast_host> <ssh_port>
```

Luego abrir:

- `/Users/JuanCamiloTorresUrrego/Documents/tiktok/arcade/games/snake/ai.html`

Usar modo `MCTS` con 400 simulaciones.

## Tests rápidos

```bash
./build/test_env
```

Valida:

- No reversa directa.
- Reward exacto `+1/0/-1`.
- Estado `4x10x10`.

## Nota técnica

Este baseline C++ ya implementa:

- Entorno paper-faithful (10x10, sparse rewards, no reverse).
- MCTS con PUCT + Dirichlet + food stochasticity.
- Loop self-play -> train -> eval -> champion -> checkpoint.

La red implementada en este bootstrap es lineal policy/value para mantener el pipeline 100% C++ operativo.
Si quieres estricta arquitectura ResNet (stem + 6 residuales + heads) en C++/CUDA, se monta sobre el mismo pipeline reemplazando `src/model/policy_value_model.*`.
