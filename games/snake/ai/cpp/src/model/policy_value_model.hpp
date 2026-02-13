#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <vector>

#include "train/types.hpp"

namespace alphasnake {

struct Prediction {
  std::array<float, 4> policy{0.25f, 0.25f, 0.25f, 0.25f};
  float value = 0.0f;
};

class PolicyValueModel {
 public:
  PolicyValueModel() = default;
  PolicyValueModel(int board_size, uint32_t seed);

  void init(int board_size, uint32_t seed);

  [[nodiscard]] int board_size() const { return board_size_; }
  [[nodiscard]] int input_dim() const { return input_dim_; }

  [[nodiscard]] Prediction predict(const std::vector<float>& state) const;

  LossStats train_batch(const std::vector<TrainingExample>& batch, float lr, float weight_decay);

  void copy_from(const PolicyValueModel& other);

  bool save(const std::string& path, std::string& error) const;
  bool load(const std::string& path, std::string& error);

 private:
  int board_size_ = 10;
  int input_dim_ = 400;
  uint64_t step_ = 0;

  std::vector<float> wp_;  // [4, input_dim]
  std::array<float, 4> bp_{};
  std::vector<float> wv_;  // [input_dim]
  float bv_ = 0.0f;

  std::vector<float> m_wp_;
  std::vector<float> v_wp_;
  std::array<float, 4> m_bp_{};
  std::array<float, 4> v_bp_{};
  std::vector<float> m_wv_;
  std::vector<float> v_wv_;
  float m_bv_ = 0.0f;
  float v_bv_ = 0.0f;

  [[nodiscard]] std::array<float, 4> logits(const std::vector<float>& state) const;
  static std::array<float, 4> softmax(const std::array<float, 4>& logits);
};

}  // namespace alphasnake
