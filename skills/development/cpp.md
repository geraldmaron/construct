<!--
skills/development/cpp.md — C/C++ Best Practices — Use this skill when writing, reviewing, or debugging C or C++ code.

Use this skill when writing, reviewing, or debugging C or C++ code. ## Project Structure
-->
# C/C++ Best Practices

Use this skill when writing, reviewing, or debugging C or C++ code.

## Project Structure

```
include/
  project/
    module.h
src/
  module.cpp
  main.cpp
tests/
  test_module.cpp
CMakeLists.txt
```

- Separate headers (public API) from implementation
- CMake as the build system; `CMakeLists.txt` per directory
- Keep header dependencies minimal; forward-declare when possible
- One class or module per header/source pair

## Tooling

| Tool | Purpose |
|---|---|
| clang-format | Formatting |
| clang-tidy | Static analysis and modernization |
| AddressSanitizer (ASan) | Memory error detection |
| UndefinedBehaviorSanitizer (UBSan) | Undefined behavior detection |
| Valgrind | Memory leak detection |
| GoogleTest / Catch2 | Testing |
| gcov / llvm-cov | Coverage |
| cppcheck | Additional static analysis |

## Modern C++ (C++17/20/23)

- `std::string_view` over `const std::string&` for read-only string parameters
- `std::optional<T>` for values that may be absent
- `std::variant` for type-safe unions
- Structured bindings: `auto [key, value] = pair;`
- `if constexpr` for compile-time branching
- `std::span` for non-owning views of contiguous data
- Range-based for loops; `<ranges>` for composable transformations

## Memory Management

### RAII (Resource Acquisition Is Initialization)
- Every resource (memory, file handle, lock, socket) owned by an object
- Acquisition in constructor; release in destructor
- No manual `new`/`delete` in application code

### Smart Pointers
- `std::unique_ptr`: single ownership, zero overhead
- `std::shared_ptr`: shared ownership when genuinely needed (rare)
- `std::weak_ptr`: breaking cycles in shared ownership
- Raw pointers only for non-owning observation; never manage lifetime

### Containers
- `std::vector` as the default container
- `std::array` for fixed-size collections
- `std::unordered_map` for fast lookup; `std::map` when order matters
- Reserve capacity when the size is known: `vec.reserve(n)`

## Error Handling

- Exceptions for C++: throw on failure, catch at boundaries
- `std::expected<T, E>` (C++23) or equivalent library for value-or-error returns
- `noexcept` on functions that do not throw (move constructors, destructors)
- Never throw from destructors
- C: return error codes; check every return value; use `errno` correctly

## Concurrency

- `std::thread` with `std::jthread` (C++20) for automatic join
- `std::mutex` and `std::lock_guard` / `std::scoped_lock` for synchronization
- `std::atomic` for lock-free operations on simple types
- `std::async` and `std::future` for task-based parallelism
- Avoid data races: either protect with mutex or use atomics
- Thread sanitizer (`-fsanitize=thread`) in CI

## Testing

- GoogleTest or Catch2 for unit and integration tests
- `TEST` macros for test definition; `EXPECT_*` / `REQUIRE` for assertions
- CTest for test orchestration via CMake
- Run with sanitizers enabled in CI
- Fuzz testing with libFuzzer or AFL++ for input-handling code

## Performance

- Profile first: `perf`, `Instruments`, `VTune`
- Minimize allocations: stack allocation > pool allocation > heap allocation
- Cache-friendly data layout: struct-of-arrays over array-of-structs when iterating
- Avoid virtual dispatch in hot paths when static polymorphism suffices (CRTP)
- `constexpr` for compile-time computation
- Link-time optimization (`-flto`) for cross-unit inlining

## Build System

- CMake with modern targets: `target_link_libraries`, `target_include_directories`
- Compile with warnings: `-Wall -Wextra -Wpedantic -Werror`
- Enable sanitizers in debug/CI builds
- Use `FetchContent` or `vcpkg`/`conan` for dependency management
- Separate build directories for debug and release

## Security

- Bounds-checked alternatives: `std::span`, `std::string_view`, `at()` over `[]`
- Stack buffer overflow: use `std::array` or `std::vector` instead of C arrays
- Format string safety: never pass user input as a format string
- Integer overflow: use safe integer libraries or explicit checks
- Run ASan, UBSan, and thread sanitizer in CI

## Anti-Patterns

- Manual `new`/`delete` without RAII wrappers
- `void*` and C-style casts in C++ code
- Macros for constants or functions (use `constexpr` and templates)
- Header-only libraries for large codebases (compile time explosion)
- Premature optimization with `inline` or manual memory management
