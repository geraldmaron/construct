<!--
rules/swift/hooks.md — <one-line purpose>

<2–6 line summary.>
-->
---
paths:
  - "**/*.swift"
  - "**/Package.swift"
---
# Swift Hooks

## PostToolUse Hooks

- **SwiftFormat**: Auto-format `.swift` files after edit
- **SwiftLint**: Run lint checks after editing `.swift` files
- **swift build**: Type-check modified packages after edit

## Warning

Flag `print()` statements — use `os.Logger` or structured logging instead for production code.
