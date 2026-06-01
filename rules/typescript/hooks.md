---
description: Construct typescript hooks rule. Applies to files matching **/*.ts, **/*.tsx, **/*.js, **/*.jsx. Use when writing or reviewing typescript code that involves hooks.
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# TypeScript/JavaScript Hooks

## PostToolUse Hooks

- **Prettier**: Auto-format JS/TS files after edit
- **TypeScript check**: Run `tsc` after editing `.ts`/`.tsx` files
- **console.log warning**: Warn about `console.log` in edited files

## Stop Hooks

- **console.log audit**: Check all modified files for `console.log` before session ends
