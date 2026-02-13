#!/usr/bin/env python3
"""Fallback export: modelo lineal C++ -> ONNX (state -> policy,value)."""

from __future__ import annotations

import argparse
import os
import struct
from typing import Tuple

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

MAGIC = 0x314D5341  # ASM1


def _read_u32(f) -> int:
    return struct.unpack("<I", f.read(4))[0]


def _read_u64(f) -> int:
    return struct.unpack("<Q", f.read(8))[0]


def _read_f32(f) -> float:
    return struct.unpack("<f", f.read(4))[0]


def _read_vec_f32(f) -> np.ndarray:
    n = _read_u64(f)
    if n == 0:
        return np.zeros((0,), dtype=np.float32)
    arr = np.frombuffer(f.read(4 * n), dtype="<f4")
    return arr.astype(np.float32, copy=False)


def load_checkpoint(path: str) -> Tuple[int, int, np.ndarray, np.ndarray, np.ndarray, float]:
    with open(path, "rb") as f:
        magic = _read_u32(f)
        if magic != MAGIC:
            raise ValueError(f"Magic invalido: {hex(magic)}")

        _version = _read_u32(f)
        board_size = _read_u32(f)
        input_dim = _read_u32(f)
        _step = _read_u64(f)

        wp = _read_vec_f32(f)
        bp = np.frombuffer(f.read(4 * 4), dtype="<f4").astype(np.float32, copy=False)
        wv = _read_vec_f32(f)
        bv = _read_f32(f)

        # Resto del archivo (estados Adam) se ignora.

    wp = wp.reshape(4, input_dim)
    wv = wv.reshape(input_dim)
    return board_size, input_dim, wp, bp, wv, float(bv)


def export_onnx(checkpoint: str, out_path: str, board_size_override: int | None = None) -> None:
    board_size, input_dim, wp, bp, wv, bv = load_checkpoint(checkpoint)
    if board_size_override is not None and board_size_override != board_size:
        board_size = board_size_override
        input_dim = 4 * board_size * board_size
        if wp.shape[1] != input_dim or wv.shape[0] != input_dim:
            raise ValueError(
                "board_size override no coincide con el checkpoint: "
                f"checkpoint input_dim={wp.shape[1]} vs override input_dim={input_dim}"
            )

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    input_info = helper.make_tensor_value_info(
        "state", TensorProto.FLOAT, ["batch", 4, board_size, board_size]
    )
    policy_out = helper.make_tensor_value_info("policy", TensorProto.FLOAT, ["batch", 4])
    value_out = helper.make_tensor_value_info("value", TensorProto.FLOAT, ["batch", 1])

    shape_tensor = numpy_helper.from_array(np.array([-1, input_dim], dtype=np.int64), name="shape_flat")
    w_policy = numpy_helper.from_array(wp.T.astype(np.float32), name="W_policy")
    b_policy = numpy_helper.from_array(bp.astype(np.float32), name="B_policy")
    w_value = numpy_helper.from_array(wv.reshape(input_dim, 1).astype(np.float32), name="W_value")
    b_value = numpy_helper.from_array(np.array([bv], dtype=np.float32), name="B_value")

    nodes = [
        helper.make_node("Reshape", ["state", "shape_flat"], ["state_flat"], name="reshape_flat"),
        helper.make_node(
            "Gemm",
            ["state_flat", "W_policy", "B_policy"],
            ["policy_logits"],
            alpha=1.0,
            beta=1.0,
            transB=0,
            name="policy_gemm",
        ),
        helper.make_node("Softmax", ["policy_logits"], ["policy"], axis=1, name="policy_softmax"),
        helper.make_node(
            "Gemm",
            ["state_flat", "W_value", "B_value"],
            ["value_linear"],
            alpha=1.0,
            beta=1.0,
            transB=0,
            name="value_gemm",
        ),
        helper.make_node("Tanh", ["value_linear"], ["value"], name="value_tanh"),
    ]

    graph = helper.make_graph(
        nodes,
        name="AlphaSnakeLinearPV",
        inputs=[input_info],
        outputs=[policy_out, value_out],
        initializer=[shape_tensor, w_policy, b_policy, w_value, b_value],
    )

    model = helper.make_model(graph, producer_name="alphasnake_cpp_fallback")
    model.opset_import[0].version = 17
    onnx.checker.check_model(model)
    onnx.save(model, out_path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--board-size", type=int, default=None)
    args = parser.parse_args()

    export_onnx(args.checkpoint, args.out, args.board_size)
    print(f"[OK] ONNX generado: {args.out}")


if __name__ == "__main__":
    main()
