<!--
skills/development/rust.md — Rust Best Practices — Use this skill when writing, reviewing, or debugging Rust code.

Use this skill when writing, reviewing, or debugging Rust code. ## Project Structure
-->
# Rust Best Practices

Use this skill when writing, reviewing, or debugging Rust code.

## Project Structure

```
src/
  main.rs or lib.rs
  models/
    mod.rs
  services/
    mod.rs
  handlers/
    mod.rs
  error.rs
tests/
  integration_tests.rs
Cargo.toml
```

- Binary crates use `main.rs`; libraries use `lib.rs`
- `mod.rs` or named module files for submodules
- Keep `main.rs` thin: parse args, build app, run
- Integration tests in `tests/` directory; unit tests inline with `#[cfg(test)]`

## Tooling

| Tool | Purpose |
|---|---|
| rustfmt | Formatting |
| clippy | Linting with actionable suggestions |
| cargo test | Testing |
| cargo bench | Benchmarking |
| cargo audit | Dependency vulnerability scanning |
| miri | Undefined behavior detection |

## Ownership and Borrowing

- Prefer borrowing (`&T`, `&mut T`) over ownership transfer when the caller keeps the data
- Use `Clone` sparingly; understand the cost
- Prefer `&str` over `String` in function parameters when no ownership is needed
- Use `Cow<'_, str>` when a function may or may not need to allocate
- Lifetime annotations: name them meaningfully when multiple lifetimes interact

## Error Handling

- Use `Result<T, E>` for recoverable errors
- Define a crate-level error enum with `thiserror`
- Use `anyhow` for application code where error types are less important
- The `?` operator for propagation; add context with `.context("message")`
- `panic!` only for programming errors (invariant violations), never for expected failures
- Avoid `unwrap()` outside tests; use `expect("reason")` if failure is a bug

## Patterns

### Builder Pattern
- Use for types with many optional parameters
- `TypeBuilder::new().field(value).build() -> Result<Type>`
- Validate in `build()`, not in individual setters

### Type-State Pattern
- Encode state transitions in the type system
- Prevents invalid state at compile time
- Use for protocols, workflows, and configuration

### Newtype Pattern
- Wrap primitive types to add type safety: `struct UserId(u64)`
- Prevents mixing up parameters of the same underlying type
- Implement `Deref` selectively; prefer explicit conversion methods

## Async Rust

- Use `tokio` for async runtime (or `async-std` if the project uses it)
- `async fn` for I/O-bound operations
- Avoid blocking in async context; use `tokio::task::spawn_blocking` for CPU work
- Use `tokio::select!` for concurrent operations with cancellation
- Structured concurrency with `JoinSet` or `tokio::join!`
- Set timeouts on all async operations: `tokio::time::timeout`

## Testing

- Unit tests in the same file as the code: `#[cfg(test)] mod tests`
- Integration tests in `tests/` directory
- Use `#[test]` and `assert_eq!`, `assert!`
- Property-based testing with `proptest` for complex invariants
- `#[tokio::test]` for async tests
- Mock traits with `mockall` or manual test doubles
- Run `cargo test` and `cargo clippy` in CI

## Performance

- Zero-cost abstractions: iterators, generics, traits have no runtime overhead
- Use iterators over manual loops; they optimize well
- `Vec::with_capacity` when the size is known
- Avoid `Box<dyn Trait>` in hot paths; prefer generics for static dispatch
- Benchmark with `criterion` for statistical rigor
- Profile with `perf`, `flamegraph`, or `cargo-instruments`

## Unsafe

- Minimize `unsafe` blocks; document the safety invariant as a comment
- Prefer safe abstractions that encapsulate `unsafe` internally
- Run Miri on unsafe code: `cargo +nightly miri test`
- Review all `unsafe` blocks during code review with extra scrutiny
- Use `#[deny(unsafe_code)]` at the crate level when possible

## Security

- `cargo audit` in CI to check for vulnerable dependencies
- Use `secrecy` crate for secret values (prevents accidental logging)
- Validate all external input at boundaries
- Use `ring` or `rustcrypto` for cryptographic operations
- Pin dependency versions in `Cargo.lock` (commit it for binaries)

## Anti-Patterns

- Overusing `clone()` to satisfy the borrow checker without understanding ownership
- `unwrap()` in production code paths
- Excessive lifetimes when owned types would be simpler
- Fighting the borrow checker with `Rc<RefCell<T>>` everywhere
- Premature optimization with `unsafe` when safe code is fast enough
