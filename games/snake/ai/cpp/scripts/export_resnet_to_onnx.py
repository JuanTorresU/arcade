#!/usr/bin/env python3
"""Fallback export: ResNet-6 Policy/Value -> ONNX (state -> policy,value)."""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass

import numpy as np
import onnx
import onnxruntime as ort
import torch
import torch.nn as nn


class ResidualBlock(nn.Module):
    def __init__(self, channels: int) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(channels)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        y = torch.relu(self.bn1(self.conv1(x)))
        y = self.bn2(self.conv2(y))
        return torch.relu(x + y)


class AlphaSnakeNet(nn.Module):
    def __init__(self, board_size: int = 20, channels: int = 64, blocks: int = 6) -> None:
        super().__init__()
        self.board_size = board_size

        self.stem_conv = nn.Conv2d(4, channels, kernel_size=3, padding=1, bias=False)
        self.stem_bn = nn.BatchNorm2d(channels)
        self.res_blocks = nn.ModuleList([ResidualBlock(channels) for _ in range(blocks)])

        self.policy_conv = nn.Conv2d(channels, 2, kernel_size=1, bias=False)
        self.policy_bn = nn.BatchNorm2d(2)
        self.policy_fc = nn.Linear(2 * board_size * board_size, 4)

        self.value_conv = nn.Conv2d(channels, 1, kernel_size=1, bias=False)
        self.value_bn = nn.BatchNorm2d(1)
        self.value_fc1 = nn.Linear(board_size * board_size, 64)
        self.value_fc2 = nn.Linear(64, 1)

    def forward(self, x: torch.Tensor):
        x = torch.relu(self.stem_bn(self.stem_conv(x)))
        for b in self.res_blocks:
            x = b(x)

        p = torch.relu(self.policy_bn(self.policy_conv(x)))
        p = p.reshape(p.shape[0], -1)
        p = self.policy_fc(p)
        p = torch.softmax(p, dim=1)

        v = torch.relu(self.value_bn(self.value_conv(x)))
        v = v.reshape(v.shape[0], -1)
        v = torch.relu(self.value_fc1(v))
        v = torch.tanh(self.value_fc2(v))
        return p, v


@dataclass
class ExportCfg:
    checkpoint: str
    out: str
    board_size: int
    channels: int
    blocks: int


def _load_state_dict(path: str) -> dict[str, torch.Tensor]:
    obj = torch.load(path, map_location="cpu")
    if isinstance(obj, dict):
        # Accept direct state dict or nested payload.
        if all(isinstance(v, torch.Tensor) for v in obj.values()):
            return obj
        if "state_dict" in obj and isinstance(obj["state_dict"], dict):
            return obj["state_dict"]
    raise RuntimeError(
        "Checkpoint no compatible con exporter Python. "
        "Asegura que el archivo viene de torch::serialize::OutputArchive con net_->save()."
    )


def export_onnx(cfg: ExportCfg) -> None:
    model = AlphaSnakeNet(board_size=cfg.board_size, channels=cfg.channels, blocks=cfg.blocks)
    state = _load_state_dict(cfg.checkpoint)
    model.load_state_dict(state, strict=True)
    model.eval()

    os.makedirs(os.path.dirname(cfg.out) or ".", exist_ok=True)

    dummy = torch.randn(1, 4, cfg.board_size, cfg.board_size, dtype=torch.float32)
    with torch.inference_mode():
        torch.onnx.export(
            model,
            dummy,
            cfg.out,
            input_names=["state"],
            output_names=["policy", "value"],
            dynamic_axes={
                "state": {0: "batch"},
                "policy": {0: "batch"},
                "value": {0: "batch"},
            },
            opset_version=17,
        )

    m = onnx.load(cfg.out)
    onnx.checker.check_model(m)

    sess = ort.InferenceSession(cfg.out, providers=["CPUExecutionProvider"])
    x = np.random.randn(2, 4, cfg.board_size, cfg.board_size).astype(np.float32)
    with torch.inference_mode():
        p_pt, v_pt = model(torch.from_numpy(x))
    p_ort, v_ort = sess.run(None, {"state": x})

    p_diff = np.max(np.abs(p_pt.numpy() - p_ort))
    v_diff = np.max(np.abs(v_pt.numpy() - v_ort))
    print(f"[OK] ONNX exportado: {cfg.out}")
    print(f"[OK] Paridad max | policy={p_diff:.6e} value={v_diff:.6e}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--board-size", type=int, default=20)
    ap.add_argument("--channels", type=int, default=64)
    ap.add_argument("--blocks", type=int, default=6)
    args = ap.parse_args()

    cfg = ExportCfg(
        checkpoint=args.checkpoint,
        out=args.out,
        board_size=args.board_size,
        channels=args.channels,
        blocks=args.blocks,
    )
    export_onnx(cfg)


if __name__ == "__main__":
    main()
