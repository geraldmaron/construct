---
description: Construct python hooks rule. Applies to files matching **/*.py, **/*.pyi. Use when writing or reviewing python code that involves hooks.
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
