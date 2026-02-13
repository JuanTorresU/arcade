#include "train/trainer.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <numeric>
#include <random>
#include <sstream>
#include <thread>

#include "mcts/mcts.hpp"

namespace fs = std::filesystem;

namespace alphasnake {
namespace {

int argmax4(const std::array<float, 4>& v) {
  int idx = 0;
  float mx = v[0];
  for (int i = 1; i < 4; ++i) {
    if (v[static_cast<std::size_t>(i)] > mx) {
      mx = v[static_cast<std::size_t>(i)];
      idx = i;
    }
  }
  return idx;
}

int sample_action(const std::array<float, 4>& pi, std::mt19937& rng) {
  float s = 0.0f;
  for (int i = 0; i < 4; ++i) s += std::max(0.0f, pi[static_cast<std::size_t>(i)]);
  if (s <= 0.0f) {
    std::uniform_int_distribution<int> d(0, 3);
    return d(rng);
  }
  std::discrete_distribution<int> dd({std::max(0.0f, pi[0]),
                                      std::max(0.0f, pi[1]),
                                      std::max(0.0f, pi[2]),
                                      std::max(0.0f, pi[3])});
  return dd(rng);
}

std::string now_clock() {
  const auto now = std::chrono::system_clock::now();
  const auto t = std::chrono::system_clock::to_time_t(now);
  std::tm tm{};
#ifdef _WIN32
  localtime_s(&tm, &t);
#else
  localtime_r(&t, &tm);
#endif
  std::ostringstream oss;
  oss << std::put_time(&tm, "%Y-%m-%d %H:%M:%S");
  return oss.str();
}

}  // namespace

AlphaSnakeTrainer::AlphaSnakeTrainer(const TrainConfig& cfg)
    : cfg_(cfg),
      buffer_(cfg.buffer_size),
      best_model_(cfg.board_size,
                  cfg.model_channels,
                  cfg.model_blocks,
                  static_cast<uint32_t>(cfg.seed),
                  cfg.lr,
                  cfg.weight_decay),
      candidate_model_(cfg.board_size,
                       cfg.model_channels,
                       cfg.model_blocks,
                       static_cast<uint32_t>(cfg.seed + 1),
                       cfg.lr,
                       cfg.weight_decay) {}

bool AlphaSnakeTrainer::ensure_dirs(std::string& error) const {
  std::error_code ec;
  fs::create_directories(cfg_.save_dir, ec);
  if (ec) {
    error = "No se pudo crear save_dir: " + cfg_.save_dir + " | " + ec.message();
    return false;
  }
  return true;
}

bool AlphaSnakeTrainer::save_checkpoint(int iteration, std::string& error) const {
  const std::string best_path = cfg_.save_dir + "/best_model.bin";
  const std::string cand_path = cfg_.save_dir + "/candidate_model.bin";
  const std::string state_path = cfg_.save_dir + "/trainer_state.txt";

  if (!best_model_.save(best_path, error)) {
    return false;
  }
  if (!candidate_model_.save(cand_path, error)) {
    return false;
  }

  std::ofstream out(state_path);
  if (!out) {
    error = "No se pudo escribir estado de trainer: " + state_path;
    return false;
  }
  out << "iteration=" << iteration << "\n";
  out << "best_win_rate=" << best_win_rate_ << "\n";
  out << "profile=" << cfg_.profile << "\n";
  out << "updated_at=" << now_clock() << "\n";
  return true;
}

bool AlphaSnakeTrainer::load_checkpoint(std::string& error) {
  const std::string best_path = cfg_.save_dir + "/best_model.bin";
  const std::string cand_path = cfg_.save_dir + "/candidate_model.bin";
  const std::string state_path = cfg_.save_dir + "/trainer_state.txt";

  if (!fs::exists(best_path) || !fs::exists(state_path)) {
    return true;
  }

  if (!best_model_.load(best_path, error)) {
    return false;
  }

  if (fs::exists(cand_path)) {
    std::string cand_err;
    if (!candidate_model_.load(cand_path, cand_err)) {
      candidate_model_.copy_from(best_model_);
    }
  } else {
    candidate_model_.copy_from(best_model_);
  }

  std::ifstream in(state_path);
  if (!in) {
    error = "No se pudo leer estado trainer";
    return false;
  }

  std::string line;
  while (std::getline(in, line)) {
    if (line.rfind("iteration=", 0) == 0) {
      start_iteration_ = std::max(0, std::stoi(line.substr(10)));
    } else if (line.rfind("best_win_rate=", 0) == 0) {
      best_win_rate_ = std::stof(line.substr(14));
    }
  }

  return true;
}

std::vector<TrainingExample> AlphaSnakeTrainer::play_single_game(const PolicyValueModel& model,
                                                                  uint32_t seed,
                                                                  bool add_root_noise) const {
  SnakeEnv env(cfg_.board_size, cfg_.max_steps, seed);
  std::mt19937 rng(seed);

  std::vector<std::vector<float>> states;
  std::vector<std::array<float, 4>> policies;

  int move = 0;
  while (!env.is_done()) {
    const float temp = (move < cfg_.temp_decay_move) ? 1.0f : 0.0f;
    MCTS mcts(cfg_, model, seed + static_cast<uint32_t>(move * 31 + 7));
    std::array<float, 4> pi = mcts.search(env, add_root_noise, temp);

    states.push_back(env.get_state());
    policies.push_back(pi);

    const int action = sample_action(pi, rng);
    StepResult step = env.step(action);
    (void)step;

    ++move;
    if (move > cfg_.max_steps + 8) {
      break;
    }
  }

  const float z = env.is_win() ? 1.0f : -1.0f;
  std::vector<TrainingExample> examples;
  examples.reserve(states.size());
  for (std::size_t i = 0; i < states.size(); ++i) {
    TrainingExample ex;
    ex.state = std::move(states[i]);
    ex.policy = policies[i];
    ex.outcome = z;
    examples.push_back(std::move(ex));
  }
  return examples;
}

std::vector<TrainingExample> AlphaSnakeTrainer::run_self_play(int iteration) {
  const int workers = std::max(1, std::min(cfg_.selfplay_workers, cfg_.games_per_iter));

  std::cout << "  [Self-play] workers=" << workers << " games=" << cfg_.games_per_iter
            << " sims=" << cfg_.num_simulations << "\n";

  std::vector<TrainingExample> all_examples;
  all_examples.reserve(static_cast<std::size_t>(cfg_.games_per_iter * 64));

  std::mutex data_mu;
  std::atomic<int> next_game{0};
  std::atomic<int> completed{0};
  std::atomic<long long> total_positions{0};

  std::vector<std::thread> pool;
  pool.reserve(static_cast<std::size_t>(workers));

  for (int w = 0; w < workers; ++w) {
    pool.emplace_back([&, w]() {
      PolicyValueModel local_model(cfg_.board_size,
                                   cfg_.model_channels,
                                   cfg_.model_blocks,
                                   static_cast<uint32_t>(cfg_.seed + 100 + w),
                                   cfg_.lr,
                                   cfg_.weight_decay);
      local_model.copy_from(best_model_);
      while (true) {
        const int g = next_game.fetch_add(1);
        if (g >= cfg_.games_per_iter) {
          break;
        }
        const uint32_t seed = static_cast<uint32_t>(
            cfg_.seed + iteration * 100000 + w * 1000 + g);
        auto ex = play_single_game(local_model, seed, true);

        total_positions.fetch_add(static_cast<long long>(ex.size()));
        {
          std::lock_guard<std::mutex> lock(data_mu);
          all_examples.insert(all_examples.end(),
                              std::make_move_iterator(ex.begin()),
                              std::make_move_iterator(ex.end()));
        }
        completed.fetch_add(1);
      }
    });
  }

  while (completed.load() < cfg_.games_per_iter) {
    std::this_thread::sleep_for(std::chrono::seconds(2));
    std::cout << "      [Heartbeat] games=" << completed.load() << "/" << cfg_.games_per_iter
              << " | positions=" << total_positions.load() << "\n";
  }

  for (auto& th : pool) {
    th.join();
  }

  std::cout << "  [Self-play] completado | posiciones=" << all_examples.size() << "\n";
  return all_examples;
}

LossStats AlphaSnakeTrainer::train_candidate(std::mt19937& rng) {
  candidate_model_.copy_from(best_model_);

  if (buffer_.size() < static_cast<std::size_t>(cfg_.batch_size)) {
    return LossStats{};
  }

  LossStats last{};
  const std::size_t dataset = buffer_.size();
  const int steps_per_epoch = std::max(1, static_cast<int>(dataset / cfg_.batch_size));

  for (int epoch = 0; epoch < cfg_.epochs_per_iter; ++epoch) {
    LossStats avg{};
    for (int step = 0; step < steps_per_epoch; ++step) {
      auto batch = buffer_.sample(static_cast<std::size_t>(cfg_.batch_size), rng);
      LossStats ls = candidate_model_.train_batch(batch, cfg_.lr, cfg_.weight_decay);
      avg.total += ls.total;
      avg.policy += ls.policy;
      avg.value += ls.value;
    }
    avg.total /= static_cast<float>(steps_per_epoch);
    avg.policy /= static_cast<float>(steps_per_epoch);
    avg.value /= static_cast<float>(steps_per_epoch);
    last = avg;
    std::cout << "    Epoch " << (epoch + 1) << "/" << cfg_.epochs_per_iter
              << " loss=" << avg.total << " (p=" << avg.policy << ", v=" << avg.value << ")\n";
  }

  return last;
}

EvalMetrics AlphaSnakeTrainer::evaluate_model(const PolicyValueModel& model,
                                              int games,
                                              int iteration_seed) const {
  EvalMetrics out{};
  if (games <= 0) {
    return out;
  }

  int wins = 0;
  long long len_sum = 0;

  for (int g = 0; g < games; ++g) {
    const uint32_t seed = static_cast<uint32_t>(cfg_.seed + iteration_seed * 100000 + g);
    SnakeEnv env(cfg_.board_size, cfg_.max_steps, seed);

    int move = 0;
    while (!env.is_done()) {
      MCTS mcts(cfg_, model, seed + static_cast<uint32_t>(move * 17 + 3));
      std::array<float, 4> pi = mcts.search(env, false, 0.0f);
      const int action = argmax4(pi);
      env.step(action);
      ++move;
      if (move > cfg_.max_steps + 8) {
        break;
      }
    }

    if (env.is_win()) {
      ++wins;
    }
    len_sum += static_cast<long long>(env.snake_length());
  }

  out.win_rate = static_cast<float>(wins) / static_cast<float>(games);
  out.avg_length = static_cast<float>(len_sum) / static_cast<float>(games);
  return out;
}

bool AlphaSnakeTrainer::run(bool resume, std::string& error) {
  if (!ensure_dirs(error)) {
    return false;
  }

  if (resume) {
    if (!load_checkpoint(error)) {
      return false;
    }
  }

  std::mt19937 rng(static_cast<uint32_t>(cfg_.seed + 77));

  std::cout << "============================================================\n";
  std::cout << " AlphaSnake C++ Training\n";
  std::cout << " Profile: " << cfg_.profile << "\n";
  std::cout << " Board: " << cfg_.board_size << "x" << cfg_.board_size << "\n";
  std::cout << " Simulations: " << cfg_.num_simulations << "\n";
  std::cout << " Games/iter: " << cfg_.games_per_iter << "\n";
  std::cout << " Save dir: " << cfg_.save_dir << "\n";
  std::cout << "============================================================\n\n";

  const int end_iteration = start_iteration_ + cfg_.iterations;

  for (int iter = start_iteration_ + 1; iter <= end_iteration; ++iter) {
    std::cout << "\n============================================================\n";
    std::cout << " ITERACION " << iter << " / " << end_iteration << "\n";
    std::cout << "============================================================\n";
    std::cout << "  [Iter " << iter << "] Inicio: " << now_clock() << "\n";

    std::vector<TrainingExample> new_examples = run_self_play(iter);
    buffer_.add_many(new_examples);

    std::cout << "  [Train] buffer=" << buffer_.size() << "\n";
    LossStats losses = train_candidate(rng);
    std::cout << "  [Train] loss=" << losses.total << " (p=" << losses.policy
              << ", v=" << losses.value << ")\n";

    EvalMetrics eval_new = evaluate_model(candidate_model_, cfg_.eval_games, iter);
    std::cout << "  [Eval] win_rate=" << eval_new.win_rate
              << " avg_len=" << eval_new.avg_length << "\n";

    const bool accept = eval_new.win_rate >= cfg_.accept_threshold &&
                        eval_new.win_rate >= best_win_rate_;
    if (accept) {
      best_model_.copy_from(candidate_model_);
      best_win_rate_ = eval_new.win_rate;
      std::cout << "  [Champion] actualizado (threshold=" << cfg_.accept_threshold << ")\n";
    } else {
      std::cout << "  [Champion] se mantiene\n";
    }

    if (!save_checkpoint(iter, error)) {
      return false;
    }

    std::cout << "  [Checkpoint] guardado\n";
  }

  return true;
}

}  // namespace alphasnake
