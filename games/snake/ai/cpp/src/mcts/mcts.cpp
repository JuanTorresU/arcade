#include "mcts/mcts.hpp"

#include <algorithm>
#include <cmath>
#include <numeric>
#include <vector>

namespace alphasnake {

MCTS::MCTS(const TrainConfig& cfg, PredictFn predict_fn, uint32_t seed)
    : cfg_(cfg), predict_fn_(std::move(predict_fn)), rng_(seed) {}

MCTS::MCTS(const TrainConfig& cfg, const PolicyValueModel& model, uint32_t seed)
    : MCTS(cfg, [&model](const std::vector<float>& s) { return model.predict(s); }, seed) {}

std::array<float, 4> MCTS::normalize_masked(const std::array<float, 4>& raw,
                                            const std::array<uint8_t, 4>& mask) {
  std::array<float, 4> out{0.0f, 0.0f, 0.0f, 0.0f};
  float sum = 0.0f;
  for (int a = 0; a < 4; ++a) {
    if (mask[static_cast<std::size_t>(a)] == 0) {
      continue;
    }
    out[static_cast<std::size_t>(a)] = std::max(0.0f, raw[static_cast<std::size_t>(a)]);
    sum += out[static_cast<std::size_t>(a)];
  }
  if (sum <= 0.0f) {
    int n = 0;
    for (int a = 0; a < 4; ++a) {
      n += static_cast<int>(mask[static_cast<std::size_t>(a)] != 0);
    }
    if (n <= 0) {
      return {0.25f, 0.25f, 0.25f, 0.25f};
    }
    const float u = 1.0f / static_cast<float>(n);
    for (int a = 0; a < 4; ++a) {
      if (mask[static_cast<std::size_t>(a)] != 0) {
        out[static_cast<std::size_t>(a)] = u;
      }
    }
    return out;
  }
  for (int a = 0; a < 4; ++a) {
    out[static_cast<std::size_t>(a)] /= sum;
  }
  return out;
}

float MCTS::expand(Node& node) {
  node.valid_mask = node.env.valid_action_mask();

  Prediction pred = predict_fn_(node.env.get_state());
  node.priors = normalize_masked(pred.policy, node.valid_mask);
  node.expanded = true;

  float value = pred.value;
  if (node.food_eaten && cfg_.food_samples > 1) {
    std::vector<Point> free = node.env.free_cells();
    if (!free.empty()) {
      const int k = std::min(cfg_.food_samples - 1, static_cast<int>(free.size()));
      std::shuffle(free.begin(), free.end(), rng_);
      float sum = value;
      int used = 1;
      for (int i = 0; i < k; ++i) {
        SnakeEnv alt = node.env;
        alt.set_food(free[static_cast<std::size_t>(i)]);
        Prediction p2 = predict_fn_(alt.get_state());
        sum += p2.value;
        ++used;
      }
      value = sum / static_cast<float>(used);
    }
  }

  return value;
}

int MCTS::select_action(const Node& node) const {
  int best_action = 0;
  float best_score = -1e30f;
  const float n_parent = std::sqrt(std::max(1, node.visit_count));

  for (int a = 0; a < 4; ++a) {
    if (node.valid_mask[static_cast<std::size_t>(a)] == 0) {
      continue;
    }

    const Node* child = node.children[static_cast<std::size_t>(a)].get();
    const float q = child ? child->q() : 0.0f;
    const int n_sa = child ? child->visit_count : 0;
    const float u = cfg_.c_puct * node.priors[static_cast<std::size_t>(a)] * n_parent /
                    (1.0f + static_cast<float>(n_sa));
    const float score = q + u;
    if (score > best_score) {
      best_score = score;
      best_action = a;
    }
  }
  return best_action;
}

void MCTS::add_dirichlet_noise(Node& node) {
  std::vector<int> valid;
  for (int a = 0; a < 4; ++a) {
    if (node.valid_mask[static_cast<std::size_t>(a)] != 0) {
      valid.push_back(a);
    }
  }
  if (valid.empty()) {
    return;
  }

  std::gamma_distribution<float> gamma(cfg_.dirichlet_alpha, 1.0f);
  std::vector<float> noise(valid.size(), 0.0f);
  float sum = 0.0f;
  for (std::size_t i = 0; i < valid.size(); ++i) {
    noise[i] = gamma(rng_);
    sum += noise[i];
  }
  if (sum <= 0.0f) {
    return;
  }

  for (std::size_t i = 0; i < valid.size(); ++i) {
    const int a = valid[i];
    const float dn = noise[i] / sum;
    node.priors[static_cast<std::size_t>(a)] =
        (1.0f - cfg_.dirichlet_eps) * node.priors[static_cast<std::size_t>(a)] +
        cfg_.dirichlet_eps * dn;
  }
}

std::array<float, 4> MCTS::search(const SnakeEnv& root_env,
                                  bool add_root_noise,
                                  float temperature) {
  Node root(root_env, 1.0f);
  const float root_value = expand(root);
  root.visit_count = 1;
  root.value_sum = root_value;

  if (add_root_noise) {
    add_dirichlet_noise(root);
  }

  for (int sim = 0; sim < cfg_.num_simulations; ++sim) {
    Node* node = &root;
    std::vector<Node*> path;
    path.push_back(node);

    while (node->expanded && !node->terminal) {
      const int action = select_action(*node);
      auto& child_slot = node->children[static_cast<std::size_t>(action)];
      if (!child_slot) {
        SnakeEnv env_next = node->env;
        StepResult step = env_next.step(action);

        child_slot = std::make_unique<Node>(env_next, node->priors[static_cast<std::size_t>(action)]);
        child_slot->food_eaten = step.food_eaten;
        child_slot->terminal = step.done;
        child_slot->won = step.won;
      }

      node = child_slot.get();
      path.push_back(node);
      if (node->terminal) {
        break;
      }
    }

    float value = 0.0f;
    if (node->terminal) {
      value = node->won ? 1.0f : -1.0f;
    } else {
      value = expand(*node);
    }

    for (auto* n : path) {
      n->visit_count += 1;
      n->value_sum += value;
    }
  }

  std::array<float, 4> visits{0.0f, 0.0f, 0.0f, 0.0f};
  for (int a = 0; a < 4; ++a) {
    const auto* child = root.children[static_cast<std::size_t>(a)].get();
    if (!child) {
      continue;
    }
    visits[static_cast<std::size_t>(a)] = static_cast<float>(child->visit_count);
  }

  std::array<float, 4> pi{0.0f, 0.0f, 0.0f, 0.0f};
  if (temperature <= 1e-6f) {
    int best = 0;
    float mx = visits[0];
    for (int a = 1; a < 4; ++a) {
      if (visits[static_cast<std::size_t>(a)] > mx) {
        mx = visits[static_cast<std::size_t>(a)];
        best = a;
      }
    }
    pi[static_cast<std::size_t>(best)] = 1.0f;
    return pi;
  }

  float sum = 0.0f;
  for (int a = 0; a < 4; ++a) {
    pi[static_cast<std::size_t>(a)] = std::pow(std::max(1e-6f, visits[static_cast<std::size_t>(a)]),
                                               1.0f / temperature);
    sum += pi[static_cast<std::size_t>(a)];
  }
  if (sum <= 0.0f) {
    return {0.25f, 0.25f, 0.25f, 0.25f};
  }
  for (int a = 0; a < 4; ++a) {
    pi[static_cast<std::size_t>(a)] /= sum;
  }

  return pi;
}

}  // namespace alphasnake
