<!--
rules/golang/hooks.md — <one-line purpose>

<2–6 line summary.>
-->
---
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
