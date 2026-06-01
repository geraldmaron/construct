---
description: Construct golang hooks rule. Applies to files matching **/*.go, **/go.mod, **/go.sum. Use when writing or reviewing golang code that involves hooks.
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---
# Go Hooks

## PostToolUse Hooks

- **gofmt/goimports**: Auto-format `.go` files after edit
- **go vet**: Run static analysis after editing `.go` files
- **staticcheck**: Run extended static checks on modified packages
