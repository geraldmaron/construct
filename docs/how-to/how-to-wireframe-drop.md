<!--
docs/how-to/how-to-wireframe-drop.md — How to use construct wireframe and construct drop.

Covers generating low-fi wireframes from descriptions and ingesting recently
dropped files from Downloads/Desktop/iCloud Drive.
-->

# How to Use Wireframe and Drop

## Generate a wireframe

```bash
construct wireframe "user settings page with avatar, display name, and notification toggles"
```

Auto-detects the best output format (Mermaid diagram or sketch-style HTML) based on the
description. Writes the file to `.cx/wireframes/` and prints the path.

```bash
open ".cx/wireframes/user-settings-2026-04-30T00-00-00.html"
```

### Force a specific diagram type

```bash
construct wireframe "checkout flow" --type flow
construct wireframe "order state machine" --type state
construct wireframe "API auth sequence" --type sequence
construct wireframe "user–post–comment entities" --type er
construct wireframe "dashboard layout" --type layout
construct wireframe "new user activation" --type user-journey
```

| Type | When to use |
|---|---|
| `flow` | Decision trees, process flows |
| `state` | State machines, lifecycle diagrams |
| `sequence` | Service-to-service message flows |
| `er` | Entity-relationship diagrams |
| `layout` | Page/component layout sketches (HTML output) |
| `user-journey` | User-facing step sequences |

HTML output is self-contained — no server needed. Share the file directly or commit it under
`docs/wireframes/`.

---

## Ingest a dropped file

```bash
construct drop
```

Picks the most recently modified file in `~/Downloads`, `~/Desktop`, `~/Documents`, or iCloud
Drive and ingests it into the knowledge base (same pipeline as `construct ingest`).

### Preview before ingesting

```bash
construct drop --list
```

Shows the 10 most recent droppable files with modification times. Nothing is ingested.

### Pick a specific file from the list

```bash
construct drop --index 2
```

Ingests the second file from the `--list` output.

### Limit to recently dropped files

```bash
construct drop --since 30m
```

Only considers files modified in the last 30 minutes. Useful if you dropped multiple files and
want the one you just saved.

### Filter by extension

```bash
construct drop --type pdf
```

Only considers `.pdf` files.

After ingestion, the file is available via `construct ask` and `construct search`.
