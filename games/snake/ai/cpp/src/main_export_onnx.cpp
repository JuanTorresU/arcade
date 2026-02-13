#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <string>

#include "common/cli.hpp"
#include "common/config.hpp"

using namespace alphasnake;
namespace fs = std::filesystem;

int main(int argc, char** argv) {
  auto args = parse_cli(argc, argv);

  const std::string config_path = cli_get(args, "--config", "config/config_paper_10x10.yaml");
  TrainConfig cfg;
  std::string err;
  if (!load_config_file(config_path, cfg, err)) {
    std::cerr << "[ERROR] " << err << "\n";
    return 1;
  }

  const std::string ckpt = cli_get(args, "--checkpoint", cfg.save_dir + "/best_model.bin");
  const std::string out = cli_get(args, "--out", cfg.save_dir + "/alphasnake.onnx");
  const std::string py_fallback = cli_get(args, "--python-fallback", "scripts/export_resnet_to_onnx.py");
  const bool allow_fallback = cli_get(args, "--allow-fallback", "1") != "0";

  std::cout << "Export ONNX (C++ path)\n";
  std::cout << "  checkpoint: " << ckpt << "\n";
  std::cout << "  out: " << out << "\n";

  // Placeholder para export C++ puro con ONNX protobuf.
  std::cerr << "[WARN] Export ONNX puro C++ aun no esta implementado en este baseline.\n";

  if (!allow_fallback) {
    std::cerr << "[ERROR] Fallback deshabilitado (--allow-fallback 0).\n";
    return 2;
  }

  if (!fs::exists(py_fallback)) {
    std::cerr << "[ERROR] Script fallback no encontrado: " << py_fallback << "\n";
    return 3;
  }

  std::string cmd = "python3 \"" + py_fallback + "\" --checkpoint \"" + ckpt +
                    "\" --out \"" + out + "\" --board-size " +
                    std::to_string(cfg.board_size) + " --channels " +
                    std::to_string(cfg.model_channels) + " --blocks " +
                    std::to_string(cfg.model_blocks);

  std::cout << "[INFO] Ejecutando fallback: " << cmd << "\n";
  const int rc = std::system(cmd.c_str());
  if (rc != 0) {
    std::cerr << "[ERROR] Fallback de export fallo con codigo " << rc << "\n";
    return 4;
  }

  std::cout << "[OK] ONNX generado: " << out << "\n";
  return 0;
}
