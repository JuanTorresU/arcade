#include <algorithm>
#include <iostream>
#include <string>

#include "common/cli.hpp"
#include "common/config.hpp"
#include "env/snake_env.hpp"
#include "mcts/mcts.hpp"
#include "model/policy_value_model.hpp"

using namespace alphasnake;

namespace {

int argmax4(const std::array<float, 4>& v) {
  int idx = 0;
  float mx = v[0];
  for (int i = 1; i < 4; ++i) {
    if (v[static_cast<std::size_t>(i)] > mx) {
      mx = v[static_cast<std::size_t>(i)];
      idx = i;
    }
  }
  return idx;
}

}  // namespace

int main(int argc, char** argv) {
  auto args = parse_cli(argc, argv);

  const std::string config_path = cli_get(args, "--config", "config/config_paper_20x20.yaml");
  const std::string profile = cli_get(args, "--profile", "paper_strict");

  TrainConfig base_cfg;
  std::string err;
  if (!load_config_file(config_path, base_cfg, err)) {
    std::cerr << "[ERROR] " << err << "\n";
    return 1;
  }

  TrainConfig cfg = with_profile(base_cfg, profile);
  if (cli_has(args, "--games")) {
    cfg.eval_games = std::max(1, std::stoi(cli_get(args, "--games", "200")));
  }
  if (cli_has(args, "--simulations")) {
    cfg.num_simulations = std::max(1, std::stoi(cli_get(args, "--simulations", "400")));
  }

  const std::string ckpt = cli_get(args, "--checkpoint", cfg.save_dir + "/best_model.bin");

  PolicyValueModel model(cfg.board_size, cfg.model_channels, cfg.model_blocks,
                         static_cast<uint32_t>(cfg.seed), cfg.lr, cfg.weight_decay);
  if (!model.load(ckpt, err)) {
    std::cerr << "[ERROR] " << err << "\n";
    return 1;
  }

  int wins = 0;
  long long len_sum = 0;

  std::cout << "Evaluando checkpoint: " << ckpt << "\n";
  std::cout << "Juegos: " << cfg.eval_games << " | Simulaciones MCTS: " << cfg.num_simulations << "\n";
  std::cout << std::flush;

  for (int g = 0; g < cfg.eval_games; ++g) {
    const uint32_t seed = static_cast<uint32_t>(cfg.seed + g * 97);
    SnakeEnv env(cfg.board_size, cfg.max_steps, seed);

    int move = 0;
    while (!env.is_done()) {
      MCTS mcts(cfg, model, seed + static_cast<uint32_t>(move * 19 + 11));
      auto pi = mcts.search(env, false, 0.0f);
      const int action = argmax4(pi);
      env.step(action);
      ++move;
      if (move > cfg.max_steps + 8) {
        break;
      }
    }

    if (env.is_win()) {
      ++wins;
    }
    len_sum += static_cast<long long>(env.snake_length());

    std::cout << "  Progreso: " << (g + 1) << "/" << cfg.eval_games << "\r" << std::flush;
    if ((g + 1) % std::max(1, cfg.eval_games / 10) == 0) {
      std::cout << "  Progreso: " << (g + 1) << "/" << cfg.eval_games << "\n";
    }
  }
  std::cout << "\n";

  const float win_rate = static_cast<float>(wins) / static_cast<float>(cfg.eval_games);
  const float avg_len = static_cast<float>(len_sum) / static_cast<float>(cfg.eval_games);

  std::cout << "\nResultado:\n";
  std::cout << "  win_rate=" << win_rate << "\n";
  std::cout << "  avg_length=" << avg_len << "\n";

  return 0;
}
