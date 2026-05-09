# Hello World — Construct provider plugin example

A minimal reference implementation of the [Construct provider contract](../../docs/providers/authoring.md). Returns canned data; no external credentials required.

## Quick start

```bash
# Register the plugin (absolute path required)
construct provider plugins add /path/to/examples/provider-plugin

# Verify registration
construct provider list

# Test search
construct provider test hello-world --query "greet"
```

## What this shows

- The factory function signature (`create({ env })`)
- `meta` — id, displayName, capabilities
- `configSchema` — JSON Schema for provider settings
- `health()` — always-healthy health check
- `read()` — look up a single item by id
- `search()` — full-text filter over canned items

## Adapting for real providers

1. Replace the `ITEMS` constant with real API calls.
2. Add auth logic in `create()` — read tokens from `env` or `config`.
3. Add `watch()` and/or `webhook()` if your source supports push.
4. Publish as an npm package and register via `construct provider plugins add <package>`.

See [docs/providers/authoring.md](../../docs/providers/authoring.md) for the full contract reference.
