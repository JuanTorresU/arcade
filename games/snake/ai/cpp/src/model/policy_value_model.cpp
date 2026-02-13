#include "model/policy_value_model.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <limits>
#include <numeric>
#include <random>

namespace alphasnake {
namespace {

constexpr uint32_t kMagic = 0x314d5341U;  // ASM1
constexpr float kBeta1 = 0.9f;
constexpr float kBeta2 = 0.999f;
constexpr float kEps = 1e-8f;

struct FileHeader {
  uint32_t magic;
  uint32_t version;
  uint32_t board_size;
  uint32_t input_dim;
  uint64_t step;
};

template <typename T>
void write_vec(std::ofstream& out, const std::vector<T>& v) {
  const uint64_t n = static_cast<uint64_t>(v.size());
  out.write(reinterpret_cast<const char*>(&n), sizeof(n));
  if (!v.empty()) {
    out.write(reinterpret_cast<const char*>(v.data()), static_cast<std::streamsize>(sizeof(T) * v.size()));
  }
}

template <typename T>
bool read_vec(std::ifstream& in, std::vector<T>& v) {
  uint64_t n = 0;
  in.read(reinterpret_cast<char*>(&n), sizeof(n));
  if (!in.good()) return false;
  v.resize(static_cast<std::size_t>(n));
  if (n > 0) {
    in.read(reinterpret_cast<char*>(v.data()), static_cast<std::streamsize>(sizeof(T) * v.size()));
  }
  return in.good();
}

}  // namespace

PolicyValueModel::PolicyValueModel(int board_size, uint32_t seed) {
  init(board_size, seed);
}

void PolicyValueModel::init(int board_size, uint32_t seed) {
  board_size_ = board_size;
  input_dim_ = 4 * board_size_ * board_size_;
  step_ = 0;

  wp_.assign(static_cast<std::size_t>(4 * input_dim_), 0.0f);
  bp_.fill(0.0f);
  wv_.assign(static_cast<std::size_t>(input_dim_), 0.0f);
  bv_ = 0.0f;

  m_wp_.assign(wp_.size(), 0.0f);
  v_wp_.assign(wp_.size(), 0.0f);
  m_bp_.fill(0.0f);
  v_bp_.fill(0.0f);
  m_wv_.assign(wv_.size(), 0.0f);
  v_wv_.assign(wv_.size(), 0.0f);
  m_bv_ = 0.0f;
  v_bv_ = 0.0f;

  std::mt19937 rng(seed);
  std::normal_distribution<float> nd(0.0f, 0.02f);
  for (auto& w : wp_) w = nd(rng);
  for (auto& w : wv_) w = nd(rng);
}

std::array<float, 4> PolicyValueModel::logits(const std::vector<float>& state) const {
  std::array<float, 4> out{0.0f, 0.0f, 0.0f, 0.0f};
  for (int a = 0; a < 4; ++a) {
    float z = bp_[static_cast<std::size_t>(a)];
    const std::size_t base = static_cast<std::size_t>(a * input_dim_);
    for (int i = 0; i < input_dim_; ++i) {
      z += wp_[base + static_cast<std::size_t>(i)] * state[static_cast<std::size_t>(i)];
    }
    out[static_cast<std::size_t>(a)] = z;
  }
  return out;
}

std::array<float, 4> PolicyValueModel::softmax(const std::array<float, 4>& logits) {
  float mx = logits[0];
  for (int i = 1; i < 4; ++i) mx = std::max(mx, logits[static_cast<std::size_t>(i)]);

  std::array<float, 4> ex{0.0f, 0.0f, 0.0f, 0.0f};
  float sum = 0.0f;
  for (int i = 0; i < 4; ++i) {
    ex[static_cast<std::size_t>(i)] = std::exp(logits[static_cast<std::size_t>(i)] - mx);
    sum += ex[static_cast<std::size_t>(i)];
  }
  if (sum <= 0.0f) {
    return {0.25f, 0.25f, 0.25f, 0.25f};
  }
  for (int i = 0; i < 4; ++i) {
    ex[static_cast<std::size_t>(i)] /= sum;
  }
  return ex;
}

Prediction PolicyValueModel::predict(const std::vector<float>& state) const {
  Prediction pred;
  if (static_cast<int>(state.size()) != input_dim_) {
    return pred;
  }

  std::array<float, 4> lg = logits(state);
  pred.policy = softmax(lg);

  float v = bv_;
  for (int i = 0; i < input_dim_; ++i) {
    v += wv_[static_cast<std::size_t>(i)] * state[static_cast<std::size_t>(i)];
  }
  pred.value = std::tanh(v);
  return pred;
}

LossStats PolicyValueModel::train_batch(const std::vector<TrainingExample>& batch,
                                        float lr,
                                        float weight_decay) {
  LossStats stats{};
  if (batch.empty()) {
    return stats;
  }

  std::vector<float> g_wp(wp_.size(), 0.0f);
  std::array<float, 4> g_bp{0.0f, 0.0f, 0.0f, 0.0f};
  std::vector<float> g_wv(wv_.size(), 0.0f);
  float g_bv = 0.0f;

  for (const auto& ex : batch) {
    if (static_cast<int>(ex.state.size()) != input_dim_) {
      continue;
    }

    auto lg = logits(ex.state);
    auto p = softmax(lg);

    float linear_v = bv_;
    for (int i = 0; i < input_dim_; ++i) {
      linear_v += wv_[static_cast<std::size_t>(i)] * ex.state[static_cast<std::size_t>(i)];
    }
    const float v = std::tanh(linear_v);

    float p_loss = 0.0f;
    for (int a = 0; a < 4; ++a) {
      const float target = ex.policy[static_cast<std::size_t>(a)];
      const float pa = std::max(p[static_cast<std::size_t>(a)], 1e-8f);
      p_loss += -target * std::log(pa);
    }
    const float v_loss = (v - ex.outcome) * (v - ex.outcome);

    stats.policy += p_loss;
    stats.value += v_loss;

    std::array<float, 4> dlogits{0.0f, 0.0f, 0.0f, 0.0f};
    for (int a = 0; a < 4; ++a) {
      dlogits[static_cast<std::size_t>(a)] = p[static_cast<std::size_t>(a)] - ex.policy[static_cast<std::size_t>(a)];
    }

    for (int a = 0; a < 4; ++a) {
      const std::size_t base = static_cast<std::size_t>(a * input_dim_);
      const float dl = dlogits[static_cast<std::size_t>(a)];
      g_bp[static_cast<std::size_t>(a)] += dl;
      for (int i = 0; i < input_dim_; ++i) {
        g_wp[base + static_cast<std::size_t>(i)] += dl * ex.state[static_cast<std::size_t>(i)];
      }
    }

    const float dvalue = 2.0f * (v - ex.outcome) * (1.0f - v * v);
    g_bv += dvalue;
    for (int i = 0; i < input_dim_; ++i) {
      g_wv[static_cast<std::size_t>(i)] += dvalue * ex.state[static_cast<std::size_t>(i)];
    }
  }

  const float inv_n = 1.0f / static_cast<float>(batch.size());

  for (std::size_t i = 0; i < g_wp.size(); ++i) {
    g_wp[i] = g_wp[i] * inv_n + weight_decay * wp_[i];
  }
  for (int a = 0; a < 4; ++a) {
    g_bp[static_cast<std::size_t>(a)] *= inv_n;
  }
  for (std::size_t i = 0; i < g_wv.size(); ++i) {
    g_wv[i] = g_wv[i] * inv_n + weight_decay * wv_[i];
  }
  g_bv *= inv_n;

  ++step_;
  const float t = static_cast<float>(step_);
  const float b1_corr = 1.0f - std::pow(kBeta1, t);
  const float b2_corr = 1.0f - std::pow(kBeta2, t);

  auto adam_update = [&](float& w, float& m, float& v, float g) {
    m = kBeta1 * m + (1.0f - kBeta1) * g;
    v = kBeta2 * v + (1.0f - kBeta2) * g * g;
    const float m_hat = m / b1_corr;
    const float v_hat = v / b2_corr;
    w -= lr * m_hat / (std::sqrt(v_hat) + kEps);
  };

  for (std::size_t i = 0; i < wp_.size(); ++i) {
    adam_update(wp_[i], m_wp_[i], v_wp_[i], g_wp[i]);
  }
  for (int a = 0; a < 4; ++a) {
    adam_update(bp_[static_cast<std::size_t>(a)],
                m_bp_[static_cast<std::size_t>(a)],
                v_bp_[static_cast<std::size_t>(a)],
                g_bp[static_cast<std::size_t>(a)]);
  }
  for (std::size_t i = 0; i < wv_.size(); ++i) {
    adam_update(wv_[i], m_wv_[i], v_wv_[i], g_wv[i]);
  }
  adam_update(bv_, m_bv_, v_bv_, g_bv);

  stats.policy *= inv_n;
  stats.value *= inv_n;
  stats.total = stats.policy + stats.value;
  return stats;
}

void PolicyValueModel::copy_from(const PolicyValueModel& other) {
  board_size_ = other.board_size_;
  input_dim_ = other.input_dim_;
  step_ = other.step_;

  wp_ = other.wp_;
  bp_ = other.bp_;
  wv_ = other.wv_;
  bv_ = other.bv_;

  m_wp_ = other.m_wp_;
  v_wp_ = other.v_wp_;
  m_bp_ = other.m_bp_;
  v_bp_ = other.v_bp_;
  m_wv_ = other.m_wv_;
  v_wv_ = other.v_wv_;
  m_bv_ = other.m_bv_;
  v_bv_ = other.v_bv_;
}

bool PolicyValueModel::save(const std::string& path, std::string& error) const {
  std::ofstream out(path, std::ios::binary);
  if (!out) {
    error = "No se pudo abrir para escribir: " + path;
    return false;
  }

  FileHeader h{};
  h.magic = kMagic;
  h.version = 1;
  h.board_size = static_cast<uint32_t>(board_size_);
  h.input_dim = static_cast<uint32_t>(input_dim_);
  h.step = step_;

  out.write(reinterpret_cast<const char*>(&h), sizeof(h));
  write_vec(out, wp_);
  out.write(reinterpret_cast<const char*>(bp_.data()), sizeof(float) * bp_.size());
  write_vec(out, wv_);
  out.write(reinterpret_cast<const char*>(&bv_), sizeof(bv_));

  write_vec(out, m_wp_);
  write_vec(out, v_wp_);
  out.write(reinterpret_cast<const char*>(m_bp_.data()), sizeof(float) * m_bp_.size());
  out.write(reinterpret_cast<const char*>(v_bp_.data()), sizeof(float) * v_bp_.size());
  write_vec(out, m_wv_);
  write_vec(out, v_wv_);
  out.write(reinterpret_cast<const char*>(&m_bv_), sizeof(m_bv_));
  out.write(reinterpret_cast<const char*>(&v_bv_), sizeof(v_bv_));

  if (!out.good()) {
    error = "Fallo al escribir modelo: " + path;
    return false;
  }
  return true;
}

bool PolicyValueModel::load(const std::string& path, std::string& error) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    error = "No se pudo abrir modelo: " + path;
    return false;
  }

  FileHeader h{};
  in.read(reinterpret_cast<char*>(&h), sizeof(h));
  if (!in.good() || h.magic != kMagic) {
    error = "Modelo invalido o magic incorrecto: " + path;
    return false;
  }

  board_size_ = static_cast<int>(h.board_size);
  input_dim_ = static_cast<int>(h.input_dim);
  step_ = h.step;

  if (!read_vec(in, wp_)) {
    error = "Error leyendo wp";
    return false;
  }
  in.read(reinterpret_cast<char*>(bp_.data()), sizeof(float) * bp_.size());
  if (!read_vec(in, wv_)) {
    error = "Error leyendo wv";
    return false;
  }
  in.read(reinterpret_cast<char*>(&bv_), sizeof(bv_));

  if (!read_vec(in, m_wp_) || !read_vec(in, v_wp_)) {
    error = "Error leyendo estados Adam wp";
    return false;
  }
  in.read(reinterpret_cast<char*>(m_bp_.data()), sizeof(float) * m_bp_.size());
  in.read(reinterpret_cast<char*>(v_bp_.data()), sizeof(float) * v_bp_.size());
  if (!read_vec(in, m_wv_) || !read_vec(in, v_wv_)) {
    error = "Error leyendo estados Adam wv";
    return false;
  }
  in.read(reinterpret_cast<char*>(&m_bv_), sizeof(m_bv_));
  in.read(reinterpret_cast<char*>(&v_bv_), sizeof(v_bv_));

  if (!in.good()) {
    error = "Error leyendo modelo completo: " + path;
    return false;
  }
  return true;
}

}  // namespace alphasnake
