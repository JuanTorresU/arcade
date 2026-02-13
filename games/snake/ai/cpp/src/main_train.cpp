#include <iostream>
#include <string>

#include "common/cli.hpp"
#include "common/config.hpp"
#include "train/trainer.hpp"

using namespace alphasnake;

int main(int argc, char** argv) {
  auto args = parse_cli(argc, argv);

  const std::string config_path = cli_get(args, "--config", "config/config_paper_20x20.yaml");
  const std::string profile = cli_get(args, "--profile", "two_phase");
  const std::string resume_raw = cli_get(args, "--resume", "auto");
  const bool resume = (resume_raw != "0" && resume_raw != "false" && resume_raw != "False");

  TrainConfig base_cfg;
  std::string err;
  if (!load_config_file(config_path, base_cfg, err)) {
    std::cerr << "[ERROR] " << err << "\n";
    return 1;
  }

  if (cli_has(args, "--save_dir")) {
    base_cfg.save_dir = cli_get(args, "--save_dir", base_cfg.save_dir);
  }

  if (profile == "two_phase") {
    TrainConfig warm = with_profile(base_cfg, "warmup_fast");
    warm.iterations = std::max(1, base_cfg.warmup_iterations);
    warm.save_dir = base_cfg.save_dir;

    TrainConfig strict = with_profile(base_cfg, "paper_strict");
    strict.iterations = std::max(1, base_cfg.strict_iterations);
    strict.save_dir = base_cfg.save_dir;

    std::cout << "== Fase 1/2: warmup_fast ==\n";
    AlphaSnakeTrainer t1(warm);
    if (!t1.run(resume, err)) {
      std::cerr << "[ERROR][warmup] " << err << "\n";
      return 1;
    }

    std::cout << "== Fase 2/2: paper_strict ==\n";
    AlphaSnakeTrainer t2(strict);
    if (!t2.run(true, err)) {
      std::cerr << "[ERROR][strict] " << err << "\n";
      return 1;
    }

    std::cout << "\nEntrenamiento 2 fases completado.\n";
    return 0;
  }

  TrainConfig cfg = with_profile(base_cfg, profile);
  cfg.save_dir = base_cfg.save_dir;

  AlphaSnakeTrainer trainer(cfg);
  if (!trainer.run(resume, err)) {
    std::cerr << "[ERROR] " << err << "\n";
    return 1;
  }

  std::cout << "\nEntrenamiento completado.\n";
  return 0;
}
