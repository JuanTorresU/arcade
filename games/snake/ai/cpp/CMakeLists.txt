cmake_minimum_required(VERSION 3.18)
project(alphasnake_cpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

option(ALPHASNAKE_BUILD_TESTS "Build test binaries" ON)
option(ALPHASNAKE_USE_TORCH "Build with LibTorch backend (ResNet-6)" ON)

if(ALPHASNAKE_USE_TORCH)
  find_package(Torch REQUIRED)
  set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${TORCH_CXX_FLAGS}")
endif()

add_library(alphasnake_core
  src/common/config.cpp
  src/env/snake_env.cpp
  src/model/policy_value_model.cpp
  src/mcts/mcts.cpp
  src/train/trainer.cpp
)

target_include_directories(alphasnake_core PUBLIC src)
if(ALPHASNAKE_USE_TORCH)
  target_link_libraries(alphasnake_core PUBLIC ${TORCH_LIBRARIES})
  target_compile_definitions(alphasnake_core PUBLIC ALPHASNAKE_USE_TORCH=1)
endif()

target_compile_options(alphasnake_core PRIVATE
  $<$<CXX_COMPILER_ID:GNU,Clang>:-O3 -Wall -Wextra -Wpedantic>
  $<$<CXX_COMPILER_ID:MSVC>:/O2 /W4>
)

add_executable(alphasnake_train src/main_train.cpp)
target_link_libraries(alphasnake_train PRIVATE alphasnake_core)

add_executable(alphasnake_eval src/main_eval.cpp)
target_link_libraries(alphasnake_eval PRIVATE alphasnake_core)

add_executable(alphasnake_export_onnx src/main_export_onnx.cpp)
target_link_libraries(alphasnake_export_onnx PRIVATE alphasnake_core)

if(ALPHASNAKE_BUILD_TESTS)
  add_executable(test_env src/tests_env.cpp)
  target_link_libraries(test_env PRIVATE alphasnake_core)
endif()
