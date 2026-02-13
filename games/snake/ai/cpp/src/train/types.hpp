#pragma once

#include <array>
#include <vector>

namespace alphasnake {

struct TrainingExample {
  std::vector<float> state;
  std::array<float, 4> policy{0.0f, 0.0f, 0.0f, 0.0f};
  float outcome = 0.0f;
};

struct LossStats {
  float total = 0.0f;
  float policy = 0.0f;
  float value = 0.0f;
};

}  // namespace alphasnake
