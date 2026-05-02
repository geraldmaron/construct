# How to sync the dashboard static bundle

Use `construct dashboard:sync` when `dashboard/src/` changes and you need the HTTP server bundle in `lib/server/static/` to match.

## Common commands

```bash
construct dashboard:sync --build
```

Builds the Vite dashboard in `dashboard/dist/` and syncs the output into `lib/server/static/`.

```bash
construct dashboard:sync --check
```

Checks for drift without writing files. This is the right mode for CI and release verification.

## When to run it

- After editing files under `dashboard/src/`
- Before shipping changes that rely on the built dashboard
- In CI or release checks to catch stale static assets

## What it updates

- Source build output: `dashboard/dist/`
- Server-served bundle: `lib/server/static/`

The sync step mirrors `dashboard/dist/` into `lib/server/static/`, including removing stale files that no longer exist in the build output.
