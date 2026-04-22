<!--
skills/development/go.md — Go Best Practices — Use this skill when writing, reviewing, or debugging Go code.

Use this skill when writing, reviewing, or debugging Go code. ## Project Structure
-->
# Go Best Practices

Use this skill when writing, reviewing, or debugging Go code.

## Project Structure

```
cmd/
  server/
    main.go
internal/
  handler/
  service/
  repository/
  model/
pkg/
  shared-lib/
go.mod
go.sum
```

- `cmd/` for entry points; `internal/` for private packages; `pkg/` for public libraries
- Keep `main.go` thin: parse config, wire dependencies, start server
- One package per directory; package name matches directory name

## Tooling

| Tool | Purpose |
|---|---|
| gofmt / goimports | Formatting (non-negotiable) |
| golangci-lint | Comprehensive linting (replaces individual linters) |
| go vet | Static analysis |
| go test -race | Race condition detection |
| govulncheck | Vulnerability scanning |
| delve | Debugging |

## Error Handling

- Return errors as the last return value
- Wrap errors with context: `fmt.Errorf("fetch user %d: %w", id, err)`
- Use `errors.Is` and `errors.As` for type-safe error checking
- Define sentinel errors for expected conditions: `var ErrNotFound = errors.New("not found")`
- Custom error types for structured error information
- Handle every returned error; never use `_` for errors without justification

## Concurrency

### Goroutines
- Always ensure goroutines can terminate (use context cancellation)
- Use `sync.WaitGroup` to wait for goroutine completion
- Prefer `errgroup.Group` for goroutines that return errors
- Limit goroutine count with semaphores or worker pools

### Channels
- Prefer channels for communication; mutexes for protecting shared state
- Buffered channels for known producer-consumer rates
- Close channels from the sender side only
- Use `select` with `context.Done()` for cancellation

### Context
- Pass `context.Context` as the first parameter to functions
- Use `context.WithTimeout` for all external calls
- Propagate context through the entire call chain
- Never store context in structs

## Interfaces

- Define interfaces at the consumer, not the provider
- Keep interfaces small: 1-3 methods
- Accept interfaces, return structs
- Use interface embedding for composition
- Avoid premature abstraction; extract interfaces when a second implementation appears

## Testing

- Table-driven tests for multiple cases
- `testing.T.Helper()` for test helper functions
- Use `testify` or standard library assertions
- `httptest` for HTTP handler testing
- Test with `-race` flag in CI
- Use `t.Parallel()` for independent tests
- `go test -coverprofile` for coverage analysis

## Performance

- Profile with `pprof`: CPU, memory, goroutine, mutex
- Avoid allocations in hot paths; reuse buffers with `sync.Pool`
- Pre-allocate slices with `make([]T, 0, expectedCap)`
- Use `strings.Builder` for string concatenation
- Benchmark with `testing.B` before and after optimization
- Avoid reflection in performance-critical code

## Patterns

### Dependency Injection
- Constructor functions: `func NewService(repo Repository) *Service`
- Wire dependencies in `main.go` or with a DI tool (wire, fx)
- Interfaces for external dependencies enable testing with mocks

### Options Pattern
- `func NewServer(opts ...Option)` for configurable constructors
- Each option is a function that modifies a config struct
- Provides good defaults with optional overrides

### Middleware
- `func(http.Handler) http.Handler` for HTTP middleware
- Chain: logging, auth, rate limiting, recovery
- Keep middleware focused on cross-cutting concerns

## Security

- Use `crypto/rand` for random values, never `math/rand` for security
- Validate all user input at handler boundaries
- Use parameterized queries; avoid string interpolation in SQL
- Set timeouts on HTTP servers and clients
- Use `gosec` and `govulncheck` in CI

## Anti-Patterns

- `init()` functions for complex initialization (hard to test)
- Package-level mutable variables (hidden global state)
- Ignoring errors with `_`
- Goroutine leaks (no cancellation mechanism)
- Overusing `interface{}` / `any` when concrete types are known
