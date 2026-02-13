#pragma once

#include <cstddef>
#include <string>

namespace alphasnake {

struct TrainConfig {
  int board_size = 10;
  int max_steps = 1000;
  int num_simulations = 400;
  float c_puct = 1.0f;
  float dirichlet_alpha = 0.03f;
  float dirichlet_eps = 0.25f;
  int temp_decay_move = 30;
  int food_samples = 8;

  float lr = 1e-3f;
  float weight_decay = 1e-4f;
  int batch_size = 128;
  std::size_t buffer_size = 200000;
  int epochs_per_iter = 10;

  int games_per_iter = 1000;
  int eval_games = 200;
  float accept_threshold = 0.55f;
  int selfplay_workers = 8;
  int iterations = 200;

  int seed = 42;
  std::string save_dir = "/workspace/alphasnake_paper_10x10";
  std::string profile = "paper_strict";

  int warmup_iterations = 60;
  int strict_iterations = 12;
};

bool load_config_file(const std::string& path, TrainConfig& cfg, std::string& error);
TrainConfig with_profile(const TrainConfig& base, const std::string& profile);

}  // namespace alphasnake
