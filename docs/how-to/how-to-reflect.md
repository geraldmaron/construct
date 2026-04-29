# How to Use construct reflect

`construct reflect` captures a session insight or learning and writes it to your knowledge base. Use it after any session where you discovered something worth preserving.

## Basic usage

```sh
construct reflect --summary="Jira webhook auth requires HMAC-SHA256, not HMAC-SHA1"
```

This writes a timestamped markdown file to `.cx/knowledge/internal/` and records an observation in the observation store.

## Specify a target subdirectory

```sh
# Internal knowledge (default)
construct reflect --target=internal --summary="..."

# Decisions
construct reflect --target=decisions --summary="Chose Postgres over SQLite for multi-user support"

# How-to guides
construct reflect --target=how-tos --summary="Steps to reset a stale sync lock"

# External signals (customer feedback, market notes)
construct reflect --target=external --summary="Customer asked for Linear integration"

# Reference material
construct reflect --target=reference --summary="Embed authority boundary definitions"
```

Both shorthand (`internal`) and full form (`knowledge/internal`) are accepted.

## Add detail

```sh
construct reflect \
  --target=decisions \
  --summary="Chose typed .cx/knowledge/ layout over flat product-intel/" \
  --content="Reasoning: typed subdirs enable automated routing, cleaner MCP tool descriptions, and future ACL per type. Migration: no backward compat needed (pre-launch)."
```

## What gets written

1. A timestamped markdown file in the target subdirectory:
   ```
   ~/.cx/knowledge/internal/reflect-2026-04-29T14-32-00.md
   ```

2. An observation in the observation store with:
   - `category`: `insight`
   - `role`: `construct`
   - `summary`: your `--summary` text
   - `tags`: `['reflect', '<target>']`

## View recent reflections

```sh
construct knowledge index
```

Or search:

```sh
construct ask "what did we learn about Jira?"
```
