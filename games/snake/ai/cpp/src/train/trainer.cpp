#include "train/trainer.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <filesystem>
#include <fstream>
#include <future>
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

class InferenceBatcher {
 public:
  struct Stats {
    long long requests = 0;
    long long states = 0;
    long long batches = 0;
  };

  InferenceBatcher(const PolicyValueModel& model, int max_batch, int wait_us)
      : model_(model),
        max_batch_(std::max(1, max_batch)),
        wait_us_(std::max(1, wait_us)) {}

  ~InferenceBatcher() { stop(); }

  void start() {
    bool expected = false;
    if (!running_.compare_exchange_strong(expected, true)) {
      return;
    }
    worker_ = std::thread(&InferenceBatcher::run_loop, this);
  }

  void stop() {
    bool expected = true;
    if (!running_.compare_exchange_strong(expected, false)) {
      return;
    }
    cv_.notify_all();
    if (worker_.joinable()) {
      worker_.join();
    }
  }

  Prediction predict(const std::vector<float>& state) {
    Request req;
    req.state = state;
    auto fut = req.promise.get_future();

    {
      std::lock_guard<std::mutex> lock(mu_);
      queue_.push_back(std::move(req));
      stats_requests_.fetch_add(1);
      stats_states_.fetch_add(1);
    }
    cv_.notify_one();
    return fut.get();
  }

  // Enviar múltiples estados de golpe al batcher.
  // Todos se encolan juntos y pueden caer en el mismo batch GPU,
  // eliminando k round-trips secuenciales (usado por food stochasticity).
  std::vector<Prediction> predict_many(const std::vector<std::vector<float>>& states) {
    if (states.empty()) {
      return {};
    }
    if (states.size() == 1) {
      return {predict(states[0])};
    }

    std::vector<std::future<Prediction>> futures;
    futures.reserve(states.size());

    {
      std::lock_guard<std::mutex> lock(mu_);
      for (const auto& state : states) {
        Request req;
        req.state = state;
        futures.push_back(req.promise.get_future());
        queue_.push_back(std::move(req));
      }
      stats_requests_.fetch_add(static_cast<long long>(states.size()));
      stats_states_.fetch_add(static_cast<long long>(states.size()));
    }
    cv_.notify_one();

    std::vector<Prediction> results;
    results.reserve(futures.size());
    for (auto& f : futures) {
      results.push_back(f.get());
    }
    return results;
  }

  [[nodiscard]] Stats stats() const {
    Stats s;
    s.requests = stats_requests_.load();
    s.states = stats_states_.load();
    s.batches = stats_batches_.load();
    return s;
  }

 private:
  struct Request {
    std::vector<float> state;
    std::promise<Prediction> promise;
  };

  void run_loop() {
    while (true) {
      std::vector<Request> batch;
      {
        std::unique_lock<std::mutex> lock(mu_);
        cv_.wait(lock, [&]() { return !queue_.empty() || !running_.load(); });

        if (queue_.empty() && !running_.load()) {
          break;
        }

        const auto deadline =
            std::chrono::steady_clock::now() + std::chrono::microseconds(wait_us_);
        while (queue_.size() < static_cast<std::size_t>(max_batch_) && running_.load()) {
          if (cv_.wait_until(lock, deadline) == std::cv_status::timeout) {
            break;
          }
        }

        const std::size_t take =
            std::min<std::size_t>(queue_.size(), static_cast<std::size_t>(max_batch_));
        batch.reserve(take);
        for (std::size_t i = 0; i < take; ++i) {
          batch.emplace_back(std::move(queue_.front()));
          queue_.pop_front();
        }
      }

      if (batch.empty()) {
        continue;
      }

      std::vector<std::vector<float>> states;
      states.reserve(batch.size());
      for (const auto& req : batch) {
        states.push_back(req.state);
      }

      std::vector<Prediction> preds = model_.predict_batch(states);
      if (preds.size() != batch.size()) {
        preds.assign(batch.size(), Prediction{});
      }

      for (std::size_t i = 0; i < batch.size(); ++i) {
        batch[i].promise.set_value(preds[i]);
      }
      stats_batches_.fetch_add(1);
    }
  }

  const PolicyValueModel& model_;
  int max_batch_ = 256;
  int wait_us_ = 1000;

  mutable std::mutex mu_;
  std::condition_variable cv_;
  std::deque<Request> queue_;

  std::atomic<bool> running_{false};
  std::thread worker_;

  std::atomic<long long> stats_requests_{0};
  std::atomic<long long> stats_states_{0};
  std::atomic<long long> stats_batches_{0};
};

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

std::vector<TrainingExample> AlphaSnakeTrainer::play_single_game(PredictFn predict_fn,
                                                                  BatchPredictFn batch_predict_fn,
                                                                  uint32_t seed,
                                                                  bool add_root_noise) const {
  SnakeEnv env(cfg_.board_size, cfg_.max_steps, seed);
  std::mt19937 rng(seed);

  std::vector<std::vector<float>> states;
  std::vector<std::array<float, 4>> policies;
  std::vector<float> rewards;

  int move = 0;
  while (!env.is_done()) {
    const float temp = (move < cfg_.temp_decay_move) ? 1.0f : 0.0f;
    MCTS mcts(cfg_, predict_fn, batch_predict_fn, seed + static_cast<uint32_t>(move * 31 + 7));
    std::array<float, 4> pi = mcts.search(env, add_root_noise, temp);

    states.push_back(env.get_state());
    policies.push_back(pi);

    const int action = sample_action(pi, rng);
    StepResult step = env.step(action);
    rewards.push_back(step.reward);

    ++move;
    if (move > cfg_.max_steps + 8) {
      break;
    }
  }

  // Discounted returns: calcular retorno descontado por posición.
  // G_t = r_t + gamma * r_{t+1} + gamma² * r_{t+2} + ...
  // Esto da señal fuerte al value head: posiciones cerca de comida
  // reciben valores positivos, posiciones cerca de muerte negativos.
  std::vector<float> returns(rewards.size(), 0.0f);
  float G = 0.0f;
  for (int t = static_cast<int>(rewards.size()) - 1; t >= 0; --t) {
    G = rewards[static_cast<std::size_t>(t)] + cfg_.gamma * G;
    returns[static_cast<std::size_t>(t)] = std::max(-1.0f, std::min(1.0f, G));
  }

  std::vector<TrainingExample> examples;
  examples.reserve(states.size());
  for (std::size_t i = 0; i < states.size(); ++i) {
    TrainingExample ex;
    ex.state = std::move(states[i]);
    ex.policy = policies[i];
    ex.outcome = returns[i];
    examples.push_back(std::move(ex));
  }
  return examples;
}

std::vector<TrainingExample> AlphaSnakeTrainer::run_self_play(int iteration) {
  // GPU es el cuello de botella principal: usar el número de workers
  // configurado sin inflar artificialmente. Más workers solo agregan
  // overhead de hilos cuando la GPU ya está saturada.
  const int hw = static_cast<int>(std::thread::hardware_concurrency());
  const int workers = std::max(1, std::min(cfg_.selfplay_workers, cfg_.games_per_iter));

  std::cout << "  [Self-play] workers=" << workers << " games=" << cfg_.games_per_iter
            << " sims=" << cfg_.num_simulations
            << " (hw_threads=" << hw << ")\n";

  std::vector<TrainingExample> all_examples;
  all_examples.reserve(static_cast<std::size_t>(cfg_.games_per_iter * 64));

  std::mutex data_mu;
  std::atomic<int> next_game{0};
  std::atomic<int> completed{0};
  std::atomic<long long> total_positions{0};
  InferenceBatcher infer_server(best_model_, cfg_.inference_batch_size, cfg_.inference_wait_us);
  infer_server.start();

  std::vector<std::thread> pool;
  pool.reserve(static_cast<std::size_t>(workers));

  for (int w = 0; w < workers; ++w) {
    pool.emplace_back([&, w]() {
      auto predict_fn = [&infer_server](const std::vector<float>& state) {
        return infer_server.predict(state);
      };
      auto batch_predict_fn = [&infer_server](const std::vector<std::vector<float>>& states) {
        return infer_server.predict_many(states);
      };
      while (true) {
        const int g = next_game.fetch_add(1);
        if (g >= cfg_.games_per_iter) {
          break;
        }
        const uint32_t seed = static_cast<uint32_t>(
            cfg_.seed + iteration * 100000 + w * 1000 + g);
        auto ex = play_single_game(predict_fn, batch_predict_fn, seed, true);

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
    const auto st = infer_server.stats();
    const double avg_states = st.batches > 0 ? static_cast<double>(st.states) / st.batches : 0.0;
    std::cout << "      [Heartbeat] games=" << completed.load() << "/" << cfg_.games_per_iter
              << " | positions=" << total_positions.load()
              << " | batches=" << st.batches
              << " | avg_batch=" << std::fixed << std::setprecision(1) << avg_states
              << std::defaultfloat << std::setprecision(6);
    if (avg_states > 0.0 && avg_states < static_cast<double>(cfg_.inference_batch_size) * 0.25) {
      std::cout << " [WARN: batch bajo, GPU ociosa]";
    }
    std::cout << "\n";
  }

  for (auto& th : pool) {
    th.join();
  }
  infer_server.stop();

  std::cout << "  [Self-play] completado | posiciones=" << all_examples.size() << "\n";
  return all_examples;
}

LossStats AlphaSnakeTrainer::train_candidate(std::mt19937& rng) {
  candidate_model_.copy_from(best_model_);
  // Reiniciar optimizador para que momentum/varianza de Adam no queden
  // desalineados con los pesos recién copiados.
  candidate_model_.reset_optimizer(cfg_.lr, cfg_.weight_decay);

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

  // Evaluación paralela con batching — misma estrategia que self-play.
  const int hw = static_cast<int>(std::thread::hardware_concurrency());
  const int eval_workers = std::max(1, std::min(games, std::max(16, hw * 2)));

  InferenceBatcher infer_server(model, cfg_.inference_batch_size, cfg_.inference_wait_us);
  infer_server.start();

  std::atomic<int> wins{0};
  std::atomic<long long> len_sum{0};
  std::atomic<int> next_game{0};
  std::atomic<int> completed{0};

  std::vector<std::thread> pool;
  pool.reserve(static_cast<std::size_t>(eval_workers));

  for (int w = 0; w < eval_workers; ++w) {
    pool.emplace_back([&]() {
      auto predict_fn = [&infer_server](const std::vector<float>& state) {
        return infer_server.predict(state);
      };
      auto batch_predict_fn = [&infer_server](const std::vector<std::vector<float>>& states) {
        return infer_server.predict_many(states);
      };
      while (true) {
        const int g = next_game.fetch_add(1);
        if (g >= games) {
          break;
        }
        const uint32_t seed = static_cast<uint32_t>(
            cfg_.seed + iteration_seed * 100000 + g);
        SnakeEnv env(cfg_.board_size, cfg_.max_steps, seed);

        int move = 0;
        while (!env.is_done()) {
          MCTS mcts(cfg_, predict_fn, batch_predict_fn, seed + static_cast<uint32_t>(move * 17 + 3));
          std::array<float, 4> pi = mcts.search(env, false, 0.0f);
          const int action = argmax4(pi);
          env.step(action);
          ++move;
          if (move > cfg_.max_steps + 8) {
            break;
          }
        }

        if (env.is_win()) {
          wins.fetch_add(1);
        }
        len_sum.fetch_add(static_cast<long long>(env.snake_length()));
        completed.fetch_add(1);
      }
    });
  }

  for (auto& th : pool) {
    th.join();
  }
  infer_server.stop();

  out.win_rate = static_cast<float>(wins.load()) / static_cast<float>(games);
  out.avg_length = static_cast<float>(len_sum.load()) / static_cast<float>(games);
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
  std::cout << " Model device: " << best_model_.device_string() << "\n";
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

    // Evaluar ambos modelos con los MISMOS seeds para comparación justa.
    EvalMetrics eval_best = evaluate_model(best_model_, cfg_.eval_games, iter);
    EvalMetrics eval_new = evaluate_model(candidate_model_, cfg_.eval_games, iter);
    std::cout << "  [Eval best]      win=" << eval_best.win_rate
              << " avg_len=" << eval_best.avg_length << "\n";
    std::cout << "  [Eval candidate] win=" << eval_new.win_rate
              << " avg_len=" << eval_new.avg_length << "\n";

    // Aceptar si el candidato logra mejor longitud promedio en los mismos juegos.
    const bool accept = eval_new.avg_length >= eval_best.avg_length;
    if (accept) {
      best_model_.copy_from(candidate_model_);
      best_win_rate_ = eval_new.win_rate;
      std::cout << "  [Champion] actualizado (avg_len " << eval_best.avg_length
                << " -> " << eval_new.avg_length << ")\n";
    } else {
      std::cout << "  [Champion] se mantiene (best=" << eval_best.avg_length
                << " > candidate=" << eval_new.avg_length << ")\n";
    }

    if (!save_checkpoint(iter, error)) {
      return false;
    }

    std::cout << "  [Checkpoint] guardado\n";
  }

  return true;
}

}  // namespace alphasnake
