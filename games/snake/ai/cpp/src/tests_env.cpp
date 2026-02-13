#include <cassert>
#include <iostream>

#include "env/snake_env.hpp"

using namespace alphasnake;

int main() {
  {
    SnakeEnv env(10, 1000, 123);
    auto head0 = env.snake().front();
    StepResult st = env.step(2);  // LEFT es reversa directa si va RIGHT
    auto head1 = env.snake().front();
    assert(!st.done);
    assert(head1.x == head0.x + 1);  // Debe seguir RIGHT
  }

  {
    SnakeEnv env(10, 1000, 123);
    auto h = env.snake().front();
    env.set_food({h.x + 1, h.y});
    StepResult st = env.step(3);  // RIGHT
    assert(st.reward == 1.0f);
    assert(st.food_eaten);
    assert(!st.done);
  }

  {
    SnakeEnv env(10, 1000, 123);
    StepResult st{};
    for (int i = 0; i < 20; ++i) {
      st = env.step(3);  // RIGHT hasta chocar
      if (st.done) break;
    }
    assert(st.done);
    assert(st.reward == -1.0f);
    assert(!st.won);
  }

  {
    SnakeEnv env(10, 1000, 123);
    auto st = env.get_state();
    assert(st.size() == static_cast<std::size_t>(4 * 10 * 10));
  }

  std::cout << "test_env: OK\n";
  return 0;
}
