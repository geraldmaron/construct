---
title: Sync the dashboard
description: Rebuild the Next.js dashboard static export and serve it from lib/server/.
---

Use `construct dashboard:sync` when `apps/dashboard/` changes and you need the HTTP server bundle in `lib/server/static/` to match.

## Common commands

```bash
construct dashboard:sync --build
```

Builds the Next.js dashboard under `apps/dashboard/` and copies the static export into `lib/server/static/`.

```bash
construct dashboard:sync --check
```

Checks for drift without writing files. This is the right mode for CI and release verification.

## When to run it

- After editing files under `apps/dashboard/`
- Before shipping changes that rely on the built dashboard
- In CI or release checks to catch stale static assets

## What it updates

- Source build output: `apps/dashboard/out/` (Next.js static export)
- Server-served bundle: `lib/server/static/`

The sync step mirrors `apps/dashboard/out/` into `lib/server/static/`, including removing stale files that no longer exist in the build output.
