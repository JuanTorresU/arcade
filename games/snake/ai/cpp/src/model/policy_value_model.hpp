#pragma once

#include <array>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include <torch/torch.h>

#include "train/types.hpp"

namespace alphasnake {

struct Prediction {
  std::array<float, 4> policy{0.25f, 0.25f, 0.25f, 0.25f};
  float value = 0.0f;
};

struct ResidualBlockImpl : torch::nn::Module {
  ResidualBlockImpl(int channels);
  torch::Tensor forward(const torch::Tensor& x);

  torch::nn::Conv2d conv1{nullptr};
  torch::nn::BatchNorm2d bn1{nullptr};
  torch::nn::Conv2d conv2{nullptr};
  torch::nn::BatchNorm2d bn2{nullptr};
};
TORCH_MODULE(ResidualBlock);

struct AlphaSnakeNetImpl : torch::nn::Module {
  AlphaSnakeNetImpl(int board_size, int channels, int blocks);

  std::pair<torch::Tensor, torch::Tensor> forward(torch::Tensor x);

  int board_size_ = 10;
  int channels_ = 64;

  torch::nn::Conv2d stem_conv{nullptr};
  torch::nn::BatchNorm2d stem_bn{nullptr};
  torch::nn::ModuleList res_blocks;

  torch::nn::Conv2d policy_conv{nullptr};
  torch::nn::BatchNorm2d policy_bn{nullptr};
  torch::nn::Linear policy_fc{nullptr};

  torch::nn::Conv2d value_conv{nullptr};
  torch::nn::BatchNorm2d value_bn{nullptr};
  torch::nn::Linear value_fc1{nullptr};
  torch::nn::Linear value_fc2{nullptr};
};
TORCH_MODULE(AlphaSnakeNet);

class PolicyValueModel {
 public:
  PolicyValueModel() = default;
  PolicyValueModel(int board_size,
                   int channels,
                   int blocks,
                   uint32_t seed,
                   float lr,
                   float weight_decay);

  void init(int board_size,
            int channels,
            int blocks,
            uint32_t seed,
            float lr,
            float weight_decay);

  [[nodiscard]] int board_size() const { return board_size_; }
  [[nodiscard]] int input_dim() const { return input_dim_; }

  [[nodiscard]] Prediction predict(const std::vector<float>& state) const;

  LossStats train_batch(const std::vector<TrainingExample>& batch, float lr, float weight_decay);

  void copy_from(const PolicyValueModel& other);

  bool save(const std::string& path, std::string& error) const;
  bool load(const std::string& path, std::string& error);

 private:
  int board_size_ = 10;
  int channels_ = 64;
  int blocks_ = 6;
  int input_dim_ = 400;

  torch::Device device_ = torch::kCPU;
  AlphaSnakeNet net_{nullptr};
  std::unique_ptr<torch::optim::AdamW> optimizer_;

  mutable std::mutex train_mu_;
  mutable std::mutex infer_mu_;
};

}  // namespace alphasnake
