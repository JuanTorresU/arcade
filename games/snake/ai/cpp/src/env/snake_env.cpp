#include "env/snake_env.hpp"

#include <algorithm>

namespace alphasnake {
namespace {

Point delta_for_action(int action) {
  switch (action) {
    case 0:
      return {0, -1};
    case 1:
      return {0, 1};
    case 2:
      return {-1, 0};
    case 3:
    default:
      return {1, 0};
  }
}

float direction_value(int action) {
  switch (action) {
    case 0:
      return 0.25f;
    case 1:
      return 0.5f;
    case 2:
      return 0.75f;
    case 3:
    default:
      return 1.0f;
  }
}

}  // namespace

SnakeEnv::SnakeEnv(int board_size, int max_steps, uint32_t seed)
    : board_size_(board_size), max_steps_(max_steps), rng_(seed) {
  reset(seed);
}

void SnakeEnv::reset(uint32_t seed) {
  rng_.seed(seed);
  reset();
}

void SnakeEnv::reset() {
  done_ = false;
  won_ = false;
  steps_ = 0;
  steps_since_food_ = 0;
  direction_ = 3;

  snake_.clear();
  const int cx = board_size_ / 2;
  const int cy = board_size_ / 2;
  snake_.push_back({cx, cy});
  snake_.push_back({cx - 1, cy});
  snake_.push_back({cx - 2, cy});

  spawn_food();
}

bool SnakeEnv::is_reverse(int action) const {
  if (action == 0 && direction_ == 1) return true;
  if (action == 1 && direction_ == 0) return true;
  if (action == 2 && direction_ == 3) return true;
  if (action == 3 && direction_ == 2) return true;
  return false;
}

bool SnakeEnv::in_bounds(const Point& p) const {
  return p.x >= 0 && p.y >= 0 && p.x < board_size_ && p.y < board_size_;
}

bool SnakeEnv::hits_body(const Point& p) const {
  for (const auto& s : snake_) {
    if (s.x == p.x && s.y == p.y) {
      return true;
    }
  }
  return false;
}

Point SnakeEnv::next_head(int action) const {
  Point d = delta_for_action(action);
  Point h = snake_.front();
  return {h.x + d.x, h.y + d.y};
}

StepResult SnakeEnv::step(int action) {
  StepResult out{};
  if (done_) {
    out.done = true;
    out.won = won_;
    return out;
  }

  if (action < 0 || action > 3 || is_reverse(action)) {
    action = direction_;
  }
  direction_ = action;

  Point h2 = next_head(action);
  bool grow = (h2.x == food_.x && h2.y == food_.y);

  if (!in_bounds(h2)) {
    done_ = true;
    won_ = false;
    out.reward = -1.0f;
    out.done = true;
    out.won = false;
    return out;
  }

  // Si no crece, la cola se mueve y no cuenta como colision.
  Point tail = snake_.back();
  bool body_hit = false;
  for (std::size_t i = 0; i < snake_.size(); ++i) {
    const auto& s = snake_[i];
    if (!grow && i == snake_.size() - 1 && s.x == tail.x && s.y == tail.y) {
      continue;
    }
    if (s.x == h2.x && s.y == h2.y) {
      body_hit = true;
      break;
    }
  }
  if (body_hit) {
    done_ = true;
    won_ = false;
    out.reward = -1.0f;
    out.done = true;
    out.won = false;
    return out;
  }

  snake_.push_front(h2);
  if (grow) {
    out.reward = 1.0f;
    out.food_eaten = true;
    steps_since_food_ = 0;
    if (snake_.size() >= static_cast<std::size_t>(board_size_ * board_size_)) {
      done_ = true;
      won_ = true;
      out.done = true;
      out.won = true;
      return out;
    }
    spawn_food();
  } else {
    snake_.pop_back();
    out.reward = 0.0f;
    ++steps_since_food_;
  }

  ++steps_;

  // Inanición: si la serpiente no come en board_size² pasos, termina.
  // En 10x10 = 100 pasos hay tiempo de sobra para alcanzar cualquier
  // celda. Esto mata juegos donde la serpiente da vueltas en círculos
  // y desperdicia compute (~1000 movimientos MCTS inútiles).
  const int starvation_limit = board_size_ * board_size_;
  if (steps_since_food_ >= starvation_limit) {
    done_ = true;
    won_ = false;
    out.done = true;
    out.won = false;
    return out;
  }

  if (steps_ >= max_steps_) {
    done_ = true;
    won_ = false;
    out.done = true;
    out.won = false;
    return out;
  }

  out.done = false;
  out.won = false;
  return out;
}

std::vector<float> SnakeEnv::get_state() const {
  const int size = board_size_ * board_size_;
  std::vector<float> st(static_cast<std::size_t>(4 * size), 0.0f);

  for (const auto& s : snake_) {
    st[static_cast<std::size_t>(s.y * board_size_ + s.x)] = 1.0f;
  }

  if (!snake_.empty()) {
    const auto& h = snake_.front();
    st[static_cast<std::size_t>(size + h.y * board_size_ + h.x)] = 1.0f;
  }

  st[static_cast<std::size_t>(2 * size + food_.y * board_size_ + food_.x)] = 1.0f;

  const float dir_val = direction_value(direction_);
  for (int i = 0; i < size; ++i) {
    st[static_cast<std::size_t>(3 * size + i)] = dir_val;
  }

  return st;
}

std::array<uint8_t, 4> SnakeEnv::valid_action_mask() const {
  std::array<uint8_t, 4> mask{1, 1, 1, 1};
  if (direction_ == 0) mask[1] = 0;
  if (direction_ == 1) mask[0] = 0;
  if (direction_ == 2) mask[3] = 0;
  if (direction_ == 3) mask[2] = 0;
  return mask;
}

std::vector<Point> SnakeEnv::free_cells() const {
  std::vector<Point> out;
  out.reserve(static_cast<std::size_t>(board_size_ * board_size_));
  for (int y = 0; y < board_size_; ++y) {
    for (int x = 0; x < board_size_; ++x) {
      Point p{x, y};
      if (!hits_body(p)) {
        out.push_back(p);
      }
    }
  }
  return out;
}

void SnakeEnv::set_food(const Point& p) {
  if (in_bounds(p) && !hits_body(p)) {
    food_ = p;
  }
}

void SnakeEnv::spawn_food() {
  std::vector<Point> free = free_cells();
  if (free.empty()) {
    done_ = true;
    won_ = true;
    return;
  }
  std::uniform_int_distribution<int> dist(0, static_cast<int>(free.size() - 1));
  food_ = free[static_cast<std::size_t>(dist(rng_))];
}

}  // namespace alphasnake
