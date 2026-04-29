# How to Configure the Inbox Watcher

The inbox watcher monitors one or more directories and automatically ingests any new files into your knowledge base. It runs every two minutes as part of the embed daemon.

## Default inbox directory

The watcher always monitors:

```
~/.cx/inbox/
```

Drop any file there and it will be processed within two minutes.

## Add extra directories

Set `CX_INBOX_DIRS` to a colon-separated list of additional paths:

```sh
# In ~/.construct/config.env
CX_INBOX_DIRS=/Users/you/Downloads/construct-inbox:/Volumes/shared/team-docs
```

All directories are watched in addition to `~/.cx/inbox/` — you cannot disable the default.

## Supported file types

The inbox watcher accepts any file that can produce extractable text:

- Markdown (`.md`)
- Plain text (`.txt`)
- PDF (`.pdf`)
- Word documents (`.docx`)
- Source code files

Binary files that cannot be read as text are skipped with a warning observation.

## How routing works

Files are routed to a typed subdirectory of `.cx/knowledge/` based on filename patterns:

| Filename pattern | Knowledge subdirectory |
|-----------------|----------------------|
| `adr-NNN-*` | `decisions/` |
| `*runbook*`, `*how-to*` | `how-tos/` |
| `*customer*`, `*feedback*` | `external/` |
| `*postmortem*`, `*incident*` | `internal/` |
| Everything else | `internal/` (default) |

## Avoid re-processing

The watcher tracks which files it has already seen by recording a content hash. Editing a file causes it to be re-ingested. Renaming a file also triggers re-ingestion.

## Check what was ingested

```sh
construct knowledge index
```

Or use the dashboard Knowledge → Index tab.
