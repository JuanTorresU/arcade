#pragma once

#include <array>
#include <cstdint>
#include <functional>
#include <memory>
#include <random>
#include <vector>

#include "common/config.hpp"
#include "env/snake_env.hpp"
#include "model/policy_value_model.hpp"

namespace alphasnake {

class MCTS {
 public:
  using PredictFn = std::function<Prediction(const std::vector<float>&)>;

  MCTS(const TrainConfig& cfg, PredictFn predict_fn, uint32_t seed = 123);
  MCTS(const TrainConfig& cfg, const PolicyValueModel& model, uint32_t seed = 123);

  std::array<float, 4> search(const SnakeEnv& root_env,
                              bool add_root_noise,
                              float temperature);

 private:
  struct Node {
    explicit Node(const SnakeEnv& env_state, float prior = 0.0f)
        : env(env_state), prior_from_parent(prior) {}

    SnakeEnv env;
    std::array<std::unique_ptr<Node>, 4> children{};
    std::array<float, 4> priors{0.0f, 0.0f, 0.0f, 0.0f};
    std::array<uint8_t, 4> valid_mask{0, 0, 0, 0};

    float prior_from_parent = 0.0f;
    int visit_count = 0;
    float value_sum = 0.0f;

    bool expanded = false;
    bool terminal = false;
    bool won = false;
    bool food_eaten = false;

    [[nodiscard]] float q() const {
      return visit_count > 0 ? (value_sum / static_cast<float>(visit_count)) : 0.0f;
    }
  };

  const TrainConfig cfg_;
  PredictFn predict_fn_;
  std::mt19937 rng_;

  float expand(Node& node);
  int select_action(const Node& node) const;
  void add_dirichlet_noise(Node& node);

  static std::array<float, 4> normalize_masked(const std::array<float, 4>& raw,
                                               const std::array<uint8_t, 4>& mask);
};

}  // namespace alphasnake
