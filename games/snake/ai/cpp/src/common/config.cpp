#include "common/config.hpp"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <sstream>
#include <unordered_map>

namespace alphasnake {
namespace {

std::string trim(const std::string& s) {
  std::size_t b = 0;
  while (b < s.size() && std::isspace(static_cast<unsigned char>(s[b]))) {
    ++b;
  }
  std::size_t e = s.size();
  while (e > b && std::isspace(static_cast<unsigned char>(s[e - 1]))) {
    --e;
  }
  return s.substr(b, e - b);
}

bool parse_kv(const std::string& line, std::string& key, std::string& value) {
  const auto p = line.find(':');
  if (p == std::string::npos) {
    return false;
  }
  key = trim(line.substr(0, p));
  value = trim(line.substr(p + 1));
  if (!value.empty() && (value.front() == '"' || value.front() == '\'')) {
    if (value.back() == value.front() && value.size() > 1) {
      value = value.substr(1, value.size() - 2);
    }
  }
  return !key.empty();
}

template <typename T>
bool to_num(const std::string& s, T& out) {
  std::stringstream ss(s);
  ss >> out;
  return !ss.fail() && ss.eof();
}

}  // namespace

bool load_config_file(const std::string& path, TrainConfig& cfg, std::string& error) {
  std::ifstream in(path);
  if (!in) {
    error = "No se pudo abrir config: " + path;
    return false;
  }

  std::string line;
  std::string section;
  std::size_t lineno = 0;

  while (std::getline(in, line)) {
    ++lineno;
    std::string t = trim(line);
    if (t.empty() || t[0] == '#') {
      continue;
    }
    if (t.back() == ':') {
      section = trim(t.substr(0, t.size() - 1));
      continue;
    }

    std::string key;
    std::string value;
    if (!parse_kv(t, key, value)) {
      continue;
    }

    std::string full = section.empty() ? key : (section + "." + key);

    auto set_int = [&](int& target) {
      int v = 0;
      if (!to_num(value, v)) {
        error = "Valor invalido en linea " + std::to_string(lineno) + ": " + full;
        return false;
      }
      target = v;
      return true;
    };

    auto set_size = [&](std::size_t& target) {
      std::size_t v = 0;
      if (!to_num(value, v)) {
        error = "Valor invalido en linea " + std::to_string(lineno) + ": " + full;
        return false;
      }
      target = v;
      return true;
    };

    auto set_float = [&](float& target) {
      float v = 0.0f;
      if (!to_num(value, v)) {
        error = "Valor invalido en linea " + std::to_string(lineno) + ": " + full;
        return false;
      }
      target = v;
      return true;
    };

    if (full == "env.board_size" || full == "board_size") {
      if (!set_int(cfg.board_size)) return false;
    } else if (full == "env.max_steps" || full == "max_steps") {
      if (!set_int(cfg.max_steps)) return false;
    } else if (full == "model.channels" || full == "model_channels") {
      if (!set_int(cfg.model_channels)) return false;
    } else if (full == "model.blocks" || full == "model_blocks") {
      if (!set_int(cfg.model_blocks)) return false;
    } else if (full == "mcts.simulations" || full == "num_simulations") {
      if (!set_int(cfg.num_simulations)) return false;
    } else if (full == "mcts.cpuct" || full == "c_puct") {
      if (!set_float(cfg.c_puct)) return false;
    } else if (full == "mcts.dir_alpha" || full == "dirichlet_alpha") {
      if (!set_float(cfg.dirichlet_alpha)) return false;
    } else if (full == "mcts.dir_eps" || full == "dirichlet_eps") {
      if (!set_float(cfg.dirichlet_eps)) return false;
    } else if (full == "selfplay.temp_decay" || full == "temp_decay_move") {
      if (!set_int(cfg.temp_decay_move)) return false;
    } else if (full == "mcts.food_samples" || full == "food_samples") {
      if (!set_int(cfg.food_samples)) return false;
    } else if (full == "train.lr" || full == "lr") {
      if (!set_float(cfg.lr)) return false;
    } else if (full == "train.weight_decay" || full == "weight_decay") {
      if (!set_float(cfg.weight_decay)) return false;
    } else if (full == "train.batch_size" || full == "batch_size") {
      if (!set_int(cfg.batch_size)) return false;
    } else if (full == "train.buffer" || full == "buffer_size") {
      if (!set_size(cfg.buffer_size)) return false;
    } else if (full == "train.epochs" || full == "epochs_per_iter") {
      if (!set_int(cfg.epochs_per_iter)) return false;
    } else if (full == "selfplay.games" || full == "games_per_iter") {
      if (!set_int(cfg.games_per_iter)) return false;
    } else if (full == "eval.games" || full == "eval_games") {
      if (!set_int(cfg.eval_games)) return false;
    } else if (full == "eval.accept_threshold" || full == "accept_threshold") {
      if (!set_float(cfg.accept_threshold)) return false;
    } else if (full == "selfplay.workers" || full == "selfplay_workers") {
      if (!set_int(cfg.selfplay_workers)) return false;
    } else if (full == "train.iterations" || full == "iterations") {
      if (!set_int(cfg.iterations)) return false;
    } else if (full == "seed") {
      if (!set_int(cfg.seed)) return false;
    } else if (full == "save_dir") {
      cfg.save_dir = value;
    } else if (full == "profile") {
      cfg.profile = value;
    } else if (full == "schedule.warmup_iterations" || full == "warmup_iterations") {
      if (!set_int(cfg.warmup_iterations)) return false;
    } else if (full == "schedule.strict_iterations" || full == "strict_iterations") {
      if (!set_int(cfg.strict_iterations)) return false;
    }
  }

  return true;
}

TrainConfig with_profile(const TrainConfig& base, const std::string& profile) {
  TrainConfig cfg = base;
  cfg.profile = profile;

  if (profile == "warmup_fast") {
    cfg.num_simulations = 96;
    cfg.food_samples = 4;
    cfg.games_per_iter = 256;
    cfg.eval_games = 80;
    cfg.selfplay_workers = std::min(8, std::max(2, cfg.selfplay_workers));
    cfg.iterations = cfg.warmup_iterations;
    cfg.temp_decay_move = 20;
    return cfg;
  }

  if (profile == "smoke") {
    cfg.num_simulations = 32;
    cfg.food_samples = 2;
    cfg.games_per_iter = 16;
    cfg.eval_games = 16;
    cfg.epochs_per_iter = 2;
    cfg.batch_size = 32;
    cfg.selfplay_workers = std::min(4, std::max(1, cfg.selfplay_workers));
    cfg.iterations = 1;
    cfg.temp_decay_move = 8;
    return cfg;
  }

  if (profile == "paper_strict") {
    cfg.num_simulations = 400;
    cfg.food_samples = 8;
    cfg.games_per_iter = 1000;
    cfg.eval_games = 200;
    cfg.iterations = cfg.strict_iterations > 0 ? cfg.strict_iterations : cfg.iterations;
    cfg.temp_decay_move = 30;
  }

  return cfg;
}

}  // namespace alphasnake
