<!--
rules/python/hooks.md — <one-line purpose>

<2–6 line summary.>
-->
---
paths:
  - "**/*.py"
  - "**/*.pyi"
---
# Python Hooks

## PostToolUse Hooks

- **black/ruff**: Auto-format `.py` files after edit
- **mypy/pyright**: Run type checking after editing `.py` files

## Warnings

- Warn about `print()` statements in edited files (use `logging` module instead)
