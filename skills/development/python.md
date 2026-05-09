<!--
skills/development/python.md — Python Best Practices — Use this skill when writing, reviewing, or debugging Python code.

Use this skill when writing, reviewing, or debugging Python code. ## Project Structure
-->
# Python Best Practices

Use this skill when writing, reviewing, or debugging Python code.

## Project Structure

```
src/
  package_name/
    __init__.py
    models.py
    services.py
    utils.py
tests/
  test_models.py
  test_services.py
  conftest.py
pyproject.toml
```

- Use `pyproject.toml` as the single source for project metadata and tool config
- `src/` layout to prevent accidental imports from the working directory
- One module per concern; keep files under 400 lines

## Tooling

| Tool | Purpose |
|---|---|
| uv / poetry / pip | Dependency management |
| ruff | Linting and formatting (replaces flake8, isort, black) |
| mypy / pyright | Static type checking |
| pytest | Testing |
| coverage | Test coverage |
| bandit | Security scanning |

## Type Hints

- Type all function signatures: parameters and return types
- Use `from __future__ import annotations` for modern syntax in older Pythons
- Prefer `str | None` over `Optional[str]`
- Use `TypeAlias`, `TypeVar`, and `Protocol` for complex type patterns
- Run mypy or pyright in CI with strict mode

## Error Handling

- Catch specific exceptions, never bare `except:`
- Use custom exception classes for domain-specific errors
- Context managers (`with`) for resource cleanup
- `logging.exception()` in catch blocks to preserve stack trace
- Return early on validation failures; avoid deep nesting

## Patterns

### Dataclasses and Pydantic
- `dataclass(frozen=True)` for immutable value objects
- Pydantic `BaseModel` for input validation and serialization
- Avoid plain dicts for structured data that crosses function boundaries

### Async
- Use `asyncio` for I/O-bound concurrency
- `async with` for resource management in async contexts
- Never mix `asyncio` and threading without careful isolation
- Use `asyncio.gather` for concurrent I/O operations
- Set timeouts on all async operations

### Dependencies
- Pin exact versions in lock file
- Use virtual environments always
- Separate dev, test, and production dependencies
- Audit with `pip audit` or `safety check`

## Testing

- pytest with fixtures for setup and teardown
- `conftest.py` for shared fixtures scoped to the directory
- `@pytest.mark.parametrize` for data-driven tests
- `unittest.mock.patch` for external dependency isolation
- Test async code with `pytest-asyncio`
- Target 80% branch coverage minimum

## Performance

- Profile before optimizing: `cProfile`, `py-spy`, or `scalene`
- Use generators for large data processing (lazy evaluation)
- `functools.lru_cache` for expensive pure functions
- Avoid global mutable state
- Use list/dict/set comprehensions over manual loops when readable
- Consider `numpy` or `polars` for numerical and tabular data

## Security

- Never use `eval()`, `exec()`, or `pickle.loads()` on untrusted input
- Use `subprocess` with `shell=False` and explicit argument lists
- Validate all external input with Pydantic or equivalent
- Use `secrets` module for cryptographic randomness, not `random`
- Keep dependencies updated; automate vulnerability scanning

## Anti-Patterns

- Mutable default arguments (`def f(x=[])`): use `None` and create inside
- Broad exception handling: catch what you can handle
- Circular imports: restructure modules or use lazy imports
- Star imports (`from module import *`): pollutes namespace
- Global mutable state: use dependency injection or module-level constants
