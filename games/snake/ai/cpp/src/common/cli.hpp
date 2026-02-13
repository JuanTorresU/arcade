#pragma once

#include <string>
#include <unordered_map>

namespace alphasnake {

inline std::unordered_map<std::string, std::string> parse_cli(int argc, char** argv) {
  std::unordered_map<std::string, std::string> out;
  for (int i = 1; i < argc; ++i) {
    std::string k = argv[i];
    if (k.rfind("--", 0) != 0) {
      continue;
    }
    std::string v = "1";
    if (i + 1 < argc) {
      std::string nxt = argv[i + 1];
      if (nxt.rfind("--", 0) != 0) {
        v = nxt;
        ++i;
      }
    }
    out[k] = v;
  }
  return out;
}

inline std::string cli_get(const std::unordered_map<std::string, std::string>& args,
                           const std::string& key,
                           const std::string& fallback = "") {
  auto it = args.find(key);
  if (it == args.end()) {
    return fallback;
  }
  return it->second;
}

inline bool cli_has(const std::unordered_map<std::string, std::string>& args,
                    const std::string& key) {
  return args.find(key) != args.end();
}

}  // namespace alphasnake
