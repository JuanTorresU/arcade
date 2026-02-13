#pragma once

#include <array>
#include <cstdint>
#include <deque>
#include <random>
#include <vector>

namespace alphasnake {

struct Point {
  int x = 0;
  int y = 0;
};

struct StepResult {
  float reward = 0.0f;
  bool done = false;
  bool food_eaten = false;
  bool won = false;
};

class SnakeEnv {
 public:
  SnakeEnv(int board_size = 20, int max_steps = 4000, uint32_t seed = 42);

  void reset(uint32_t seed);
  void reset();

  StepResult step(int action);

  [[nodiscard]] std::vector<float> get_state() const;
  [[nodiscard]] std::array<uint8_t, 4> valid_action_mask() const;
  [[nodiscard]] std::vector<Point> free_cells() const;

  void set_food(const Point& p);

  [[nodiscard]] int board_size() const { return board_size_; }
  [[nodiscard]] int max_steps() const { return max_steps_; }
  [[nodiscard]] int steps() const { return steps_; }
  [[nodiscard]] int direction() const { return direction_; }
  [[nodiscard]] std::size_t snake_length() const { return snake_.size(); }
  [[nodiscard]] bool is_done() const { return done_; }
  [[nodiscard]] bool is_win() const { return won_; }
  [[nodiscard]] const std::deque<Point>& snake() const { return snake_; }
  [[nodiscard]] Point food() const { return food_; }

 private:
  int board_size_ = 20;
  int max_steps_ = 4000;
  int steps_ = 0;
  int steps_since_food_ = 0;  // pasos sin comer — mata juegos circulares
  int direction_ = 3;  // 0=UP 1=DOWN 2=LEFT 3=RIGHT

  bool done_ = false;
  bool won_ = false;

  std::deque<Point> snake_;
  Point food_{};

  std::mt19937 rng_;

  [[nodiscard]] bool is_reverse(int action) const;
  [[nodiscard]] bool in_bounds(const Point& p) const;
  [[nodiscard]] bool hits_body(const Point& p) const;
  [[nodiscard]] Point next_head(int action) const;
  void spawn_food();
};

}  // namespace alphasnake
