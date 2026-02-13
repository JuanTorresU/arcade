#pragma once

#include <string>
#include <vector>

#include "common/config.hpp"
#include "model/policy_value_model.hpp"
#include "train/replay_buffer.hpp"
#include "train/types.hpp"

namespace alphasnake {

struct EvalMetrics {
  float win_rate = 0.0f;
  float avg_length = 0.0f;
};

class AlphaSnakeTrainer {
 public:
  explicit AlphaSnakeTrainer(const TrainConfig& cfg);

  bool run(bool resume, std::string& error);

  [[nodiscard]] const PolicyValueModel& best_model() const { return best_model_; }
  [[nodiscard]] const TrainConfig& config() const { return cfg_; }

 private:
  TrainConfig cfg_;
  ReplayBuffer buffer_;

  PolicyValueModel best_model_;
  PolicyValueModel candidate_model_;

  int start_iteration_ = 0;
  float best_win_rate_ = 0.0f;

  bool ensure_dirs(std::string& error) const;
  bool load_checkpoint(std::string& error);
  bool save_checkpoint(int iteration, std::string& error) const;

  std::vector<TrainingExample> run_self_play(int iteration);
  std::vector<TrainingExample> play_single_game(const PolicyValueModel& model,
                                                uint32_t seed,
                                                bool add_root_noise) const;

  LossStats train_candidate(std::mt19937& rng);
  EvalMetrics evaluate_model(const PolicyValueModel& model,
                             int games,
                             int iteration_seed) const;
};

}  // namespace alphasnake
