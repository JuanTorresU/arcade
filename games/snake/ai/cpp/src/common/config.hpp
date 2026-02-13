#pragma once

#include <cstddef>
#include <string>

namespace alphasnake {

struct TrainConfig {
  int board_size = 20;
  int max_steps = 2000;
  int model_channels = 64;
  int model_blocks = 6;
  int num_simulations = 200;
  float c_puct = 1.0f;
  float dirichlet_alpha = 0.03f;
  float dirichlet_eps = 0.25f;
  int temp_decay_move = 60;
  int food_samples = 4;

  float lr = 1e-3f;
  float weight_decay = 1e-4f;
  float gamma = 0.99f;
  int batch_size = 128;
  std::size_t buffer_size = 500000;
  int epochs_per_iter = 10;

  int games_per_iter = 500;
  int eval_games = 100;
  float accept_threshold = 0.55f;
  int selfplay_workers = 64;
  int inference_batch_size = 256;
  int inference_wait_us = 800;
  int iterations = 200;

  int seed = 42;
  std::string save_dir = "/workspace/alphasnake_paper_20x20";
  std::string profile = "paper_strict";

  int warmup_iterations = 60;
  int strict_iterations = 12;
};

bool load_config_file(const std::string& path, TrainConfig& cfg, std::string& error);
TrainConfig with_profile(const TrainConfig& base, const std::string& profile);

}  // namespace alphasnake
