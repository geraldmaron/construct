---
title: Docs
description: Docs commands for Construct.
---

# Docs

| Command | What it does |
|---|---|
| `construct dashboard:sync` | Sync the built dashboard bundle into lib/server/static for the HTTP server |
| `construct docs:check` | Report CLI commands that have no linked how-to guide in docs/README.md |
| `construct docs:site` | Generate site/docs/ content for the MkDocs GitHub Pages site |
| `construct docs:update` | Regenerate AUTO-managed regions in README and docs/ |
| `construct lint:comments` | Check all files against the comment policy (rules/common/comments.md) |
| `construct lint:research` | Check research and evidence artifacts for minimum structure and evidence metadata |

## construct dashboard:sync

Sync the built dashboard bundle into lib/server/static for the HTTP server

**Usage**

```bash
construct dashboard:sync [--build] [--check]
```

**Options**

| Flag | Description |
|---|---|
| `--build` | Run the dashboard Vite build before syncing static assets |
| `--check` | Exit non-zero if dashboard static assets are stale |

## construct docs:check

Report CLI commands that have no linked how-to guide in docs/README.md

**Usage**

```bash
construct docs:check [--json]
```

**Options**

| Flag | Description |
|---|---|
| `--json` | Output raw JSON coverage report |

## construct docs:site

Generate site/docs/ content for the MkDocs GitHub Pages site

**Usage**

```bash
construct docs:site
```

## construct docs:update

Regenerate AUTO-managed regions in README and docs/

**Usage**

```bash
construct docs:update [--check]
```

**Options**

| Flag | Description |
|---|---|
| `--check` | Exit non-zero if any region would change (used by CI) |

## construct lint:comments

Check all files against the comment policy (rules/common/comments.md)

**Usage**

```bash
construct lint:comments [--fix]
```

**Options**

| Flag | Description |
|---|---|
| `--fix` | Insert stub headers for files missing one |

## construct lint:research

Check research and evidence artifacts for minimum structure and evidence metadata

**Usage**

```bash
construct lint:research
```
