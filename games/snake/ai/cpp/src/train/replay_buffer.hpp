#pragma once

#include <cstddef>
#include <mutex>
#include <random>
#include <vector>

#include "train/types.hpp"

namespace alphasnake {

class ReplayBuffer {
 public:
  explicit ReplayBuffer(std::size_t capacity) : capacity_(capacity) {
    data_.reserve(capacity_);
  }

  void add_many(const std::vector<TrainingExample>& examples) {
    std::lock_guard<std::mutex> lock(mu_);
    for (const auto& ex : examples) {
      if (data_.size() < capacity_) {
        data_.push_back(ex);
      } else {
        data_[head_] = ex;
        head_ = (head_ + 1) % capacity_;
      }
    }
  }

  [[nodiscard]] std::size_t size() const {
    std::lock_guard<std::mutex> lock(mu_);
    return data_.size();
  }

  std::vector<TrainingExample> sample(std::size_t n, std::mt19937& rng) const {
    std::lock_guard<std::mutex> lock(mu_);
    std::vector<TrainingExample> out;
    if (data_.empty()) {
      return out;
    }
    n = std::min(n, data_.size());
    out.reserve(n);

    std::uniform_int_distribution<std::size_t> dist(0, data_.size() - 1);
    for (std::size_t i = 0; i < n; ++i) {
      out.push_back(data_[dist(rng)]);
    }
    return out;
  }

 private:
  std::size_t capacity_ = 0;
  mutable std::mutex mu_;
  std::vector<TrainingExample> data_;
  std::size_t head_ = 0;
};

}  // namespace alphasnake
