<!--
skills/development/typescript.md — TypeScript Best Practices — Use this skill when writing, reviewing, or debugging TypeScript or JavaScript co

Use this skill when writing, reviewing, or debugging TypeScript or JavaScript code. ## Project Structure
-->
# TypeScript Best Practices

Use this skill when writing, reviewing, or debugging TypeScript or JavaScript code.

## Project Structure

```
src/
  modules/
    users/
      user.service.ts
      user.repository.ts
      user.types.ts
      user.test.ts
  lib/
    validation.ts
    http.ts
  types/
    index.ts
tsconfig.json
package.json
```

- Organize by feature or domain, not by file type
- Colocate tests with source files or in a parallel `__tests__` directory
- Barrel exports (`index.ts`) only at module boundaries

## Tooling

| Tool | Purpose |
|---|---|
| TypeScript compiler (tsc) | Type checking |
| ESLint | Linting |
| Prettier | Formatting |
| Vitest / Jest | Testing |
| tsx / ts-node | Development execution |
| Biome | All-in-one alternative to ESLint + Prettier |

## Type System

- Strict mode enabled: `"strict": true` in tsconfig
- No `any`; use `unknown` when the type is truly unknown, then narrow
- Prefer interfaces for object shapes; type aliases for unions and intersections
- Use discriminated unions for state machines and variant types
- `as const` for literal type inference on arrays and objects
- Generics with constraints: `<T extends Record<string, unknown>>`
- Zod or Valibot for runtime validation that infers static types

## Error Handling

- Use typed error classes extending `Error`
- `Result<T, E>` pattern (custom or `neverthrow`) for expected failures
- Try/catch only at boundaries (HTTP handler, message consumer)
- Always catch async rejections; unhandled rejections crash Node
- Include context in error messages: what operation, what input

## Immutability

- `const` by default; `let` only when reassignment is necessary
- `Readonly<T>` and `ReadonlyArray<T>` for function parameters
- Spread operator for object and array updates
- `Object.freeze` for runtime enforcement when needed
- `as const` for deeply immutable literal types

## Patterns

### Module Pattern
- Named exports over default exports (better refactoring, better tree-shaking)
- Explicit public API via barrel files
- Internal modules not re-exported

### Dependency Injection
- Constructor injection for services
- Factory functions for configurable instances
- Interface-based dependencies for testability

### Async Patterns
- `async/await` over raw promises
- `Promise.all` for independent concurrent operations
- `Promise.allSettled` when partial failure is acceptable
- Set timeouts with `AbortController` on fetch and long operations
- Never fire-and-forget a promise; handle the result or error

## Testing

- Vitest or Jest with TypeScript support
- Mock modules with `vi.mock()` or `jest.mock()`
- Test behavior, not implementation
- `@testing-library` for component tests
- Snapshot tests sparingly; prefer explicit assertions
- MSW (Mock Service Worker) for HTTP mocking in integration tests

## Performance

- Lazy imports with `import()` for code splitting
- Avoid unnecessary object creation in hot paths
- Use `Map` and `Set` over objects for frequent lookups/additions
- Profile with Node inspector or Chrome DevTools
- Monitor event loop lag and memory usage in production

## Node.js Specifics

- Use `node:` prefix for built-in modules
- Streams for large data processing
- Cluster or worker threads for CPU-bound tasks
- Graceful shutdown: handle SIGTERM, close connections, drain requests
- Health check endpoint for load balancers

## Security

- Validate all external input at API boundaries (Zod, Joi, class-validator)
- Parameterized queries for database access (never string concatenation)
- `helmet` middleware for HTTP security headers
- Sanitize user content before HTML rendering
- Use `crypto.randomUUID()` for identifiers
- Audit dependencies: `npm audit`, `pnpm audit`

## Anti-Patterns

- `any` as an escape hatch instead of proper typing
- Barrel files that re-export everything (kills tree-shaking)
- Enums for simple unions (prefer string literal unions)
- Class inheritance chains deeper than two levels
- Mixing async and sync error handling styles
