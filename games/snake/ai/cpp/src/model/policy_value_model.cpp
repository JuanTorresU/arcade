#include "model/policy_value_model.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <filesystem>

namespace fs = std::filesystem;

namespace alphasnake {

ResidualBlockImpl::ResidualBlockImpl(int channels)
    : conv1(torch::nn::Conv2dOptions(channels, channels, 3).padding(1).bias(false)),
      bn1(channels),
      conv2(torch::nn::Conv2dOptions(channels, channels, 3).padding(1).bias(false)),
      bn2(channels) {
  register_module("conv1", conv1);
  register_module("bn1", bn1);
  register_module("conv2", conv2);
  register_module("bn2", bn2);
}

torch::Tensor ResidualBlockImpl::forward(const torch::Tensor& x) {
  auto y = torch::relu(bn1(conv1(x)));
  y = bn2(conv2(y));
  y = y + x;
  return torch::relu(y);
}

AlphaSnakeNetImpl::AlphaSnakeNetImpl(int board_size, int channels, int blocks)
    : board_size_(board_size),
      channels_(channels),
      stem_conv(torch::nn::Conv2dOptions(4, channels, 3).padding(1).bias(false)),
      stem_bn(channels),
      res_blocks(torch::nn::ModuleList()),
      policy_conv(torch::nn::Conv2dOptions(channels, 2, 1).bias(false)),
      policy_bn(2),
      policy_fc(2 * board_size * board_size, 4),
      value_conv(torch::nn::Conv2dOptions(channels, 1, 1).bias(false)),
      value_bn(1),
      value_fc1(board_size * board_size, 64),
      value_fc2(64, 1) {
  register_module("stem_conv", stem_conv);
  register_module("stem_bn", stem_bn);

  for (int i = 0; i < blocks; ++i) {
    res_blocks->push_back(ResidualBlock(channels));
  }
  register_module("res_blocks", res_blocks);

  register_module("policy_conv", policy_conv);
  register_module("policy_bn", policy_bn);
  register_module("policy_fc", policy_fc);

  register_module("value_conv", value_conv);
  register_module("value_bn", value_bn);
  register_module("value_fc1", value_fc1);
  register_module("value_fc2", value_fc2);
}

std::pair<torch::Tensor, torch::Tensor> AlphaSnakeNetImpl::forward(torch::Tensor x) {
  x = torch::relu(stem_bn(stem_conv(x)));

  for (const auto& block : *res_blocks) {
    x = block->as<ResidualBlock>()->forward(x);
  }

  auto p = torch::relu(policy_bn(policy_conv(x)));
  p = p.view({p.size(0), -1});
  p = policy_fc(p);
  p = torch::softmax(p, 1);

  auto v = torch::relu(value_bn(value_conv(x)));
  v = v.view({v.size(0), -1});
  v = torch::relu(value_fc1(v));
  v = torch::tanh(value_fc2(v));

  return {p, v};
}

PolicyValueModel::PolicyValueModel(int board_size,
                                   int channels,
                                   int blocks,
                                   uint32_t seed,
                                   float lr,
                                   float weight_decay) {
  init(board_size, channels, blocks, seed, lr, weight_decay);
}

void PolicyValueModel::init(int board_size,
                            int channels,
                            int blocks,
                            uint32_t seed,
                            float lr,
                            float weight_decay) {
  board_size_ = board_size;
  channels_ = channels;
  blocks_ = blocks;
  input_dim_ = 4 * board_size_ * board_size_;

  torch::manual_seed(static_cast<int64_t>(seed));
  if (torch::cuda::is_available()) {
    device_ = torch::kCUDA;
  } else {
    device_ = torch::kCPU;
  }

  net_ = AlphaSnakeNet(board_size_, channels_, blocks_);
  net_->to(device_);

  optimizer_ = std::make_unique<torch::optim::AdamW>(
      net_->parameters(),
      torch::optim::AdamWOptions(lr).weight_decay(weight_decay));
}

Prediction PolicyValueModel::predict(const std::vector<float>& state) const {
  Prediction pred;
  if (static_cast<int>(state.size()) != input_dim_ || !net_) {
    return pred;
  }

  std::lock_guard<std::mutex> lock(infer_mu_);
  torch::NoGradGuard no_grad;
  net_->eval();

  auto t = torch::from_blob(
               const_cast<float*>(state.data()),
               {1, 4, board_size_, board_size_},
               torch::TensorOptions().dtype(torch::kFloat32))
               .clone()
               .to(device_);

  auto out = net_->forward(t);
  auto p = out.first.to(torch::kCPU).contiguous();
  auto v = out.second.to(torch::kCPU).contiguous();

  const float* pptr = p.data_ptr<float>();
  for (int i = 0; i < 4; ++i) {
    pred.policy[static_cast<std::size_t>(i)] = pptr[i];
  }
  pred.value = v.data_ptr<float>()[0];
  return pred;
}

LossStats PolicyValueModel::train_batch(const std::vector<TrainingExample>& batch,
                                        float lr,
                                        float weight_decay) {
  LossStats stats{};
  if (batch.empty() || !net_ || !optimizer_) {
    return stats;
  }

  std::lock_guard<std::mutex> lock(train_mu_);
  net_->train();

  auto& options = static_cast<torch::optim::AdamWOptions&>(optimizer_->param_groups()[0].options());
  options.lr(lr);
  options.weight_decay(weight_decay);

  const int64_t bs = static_cast<int64_t>(batch.size());
  std::vector<float> states;
  std::vector<float> targets_p;
  std::vector<float> targets_v;
  states.reserve(static_cast<std::size_t>(bs * input_dim_));
  targets_p.reserve(static_cast<std::size_t>(bs * 4));
  targets_v.reserve(static_cast<std::size_t>(bs));

  for (const auto& ex : batch) {
    if (static_cast<int>(ex.state.size()) != input_dim_) {
      continue;
    }
    states.insert(states.end(), ex.state.begin(), ex.state.end());
    for (int a = 0; a < 4; ++a) {
      targets_p.push_back(ex.policy[static_cast<std::size_t>(a)]);
    }
    targets_v.push_back(ex.outcome);
  }

  if (states.empty()) {
    return stats;
  }

  const int64_t real_bs = static_cast<int64_t>(targets_v.size());

  auto x = torch::from_blob(states.data(), {real_bs, 4, board_size_, board_size_}, torch::kFloat32)
               .clone()
               .to(device_);
  auto y_p = torch::from_blob(targets_p.data(), {real_bs, 4}, torch::kFloat32).clone().to(device_);
  auto y_v = torch::from_blob(targets_v.data(), {real_bs, 1}, torch::kFloat32).clone().to(device_);

  auto out = net_->forward(x);
  auto pred_p = out.first;
  auto pred_v = out.second;

  auto p_loss = -(y_p * (pred_p + 1e-8).log()).sum(1).mean();
  auto v_loss = torch::mse_loss(pred_v, y_v);
  auto total = p_loss + v_loss;

  optimizer_->zero_grad();
  total.backward();
  optimizer_->step();

  stats.total = total.item<float>();
  stats.policy = p_loss.item<float>();
  stats.value = v_loss.item<float>();
  return stats;
}

void PolicyValueModel::copy_from(const PolicyValueModel& other) {
  if (!other.net_) {
    return;
  }

  if (!net_ || board_size_ != other.board_size_ || channels_ != other.channels_ || blocks_ != other.blocks_) {
    init(other.board_size_, other.channels_, other.blocks_, 42, 1e-3f, 1e-4f);
  }

  torch::NoGradGuard no_grad;

  auto dst_params = net_->named_parameters(true /* recurse */);
  auto src_params = other.net_->named_parameters(true);
  for (const auto& item : src_params) {
    auto* t = dst_params.find(item.key());
    if (t != nullptr) {
      t->copy_(item.value());
    }
  }

  auto dst_buffers = net_->named_buffers(true);
  auto src_buffers = other.net_->named_buffers(true);
  for (const auto& item : src_buffers) {
    auto* t = dst_buffers.find(item.key());
    if (t != nullptr) {
      t->copy_(item.value());
    }
  }
}

bool PolicyValueModel::save(const std::string& path, std::string& error) const {
  if (!net_) {
    error = "Modelo no inicializado";
    return false;
  }

  try {
    std::error_code ec;
    fs::create_directories(fs::path(path).parent_path(), ec);
    torch::serialize::OutputArchive archive;
    net_->save(archive);
    archive.save_to(path);
    return true;
  } catch (const c10::Error& e) {
    error = std::string("save archive fallo: ") + e.what();
    return false;
  }
}

bool PolicyValueModel::load(const std::string& path, std::string& error) {
  if (!net_) {
    error = "Modelo no inicializado";
    return false;
  }

  try {
    torch::serialize::InputArchive archive;
    archive.load_from(path);
    net_->load(archive);
    net_->to(device_);
    return true;
  } catch (const c10::Error& e) {
    error = std::string("load archive fallo: ") + e.what();
    return false;
  }
}

}  // namespace alphasnake
