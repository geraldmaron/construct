---
title: Work
description: Work commands for Construct.
---

# Work

| Command | What it does |
|---|---|
| `construct bootstrap` | Import seed observation corpus into local memory store for cold-start acceleration |
| `construct distill` | Distill documents with query-focused, citation-ready chunk selection |
| `construct docs:verify` | Validate documentation completeness and quality |
| `construct drop` | Ingest the most recent file dropped into ~/Downloads, Desktop, Documents, or iCloud Drive |
| `construct headhunt` | Create a temporary domain expertise overlay or promotion request |
| `construct infer` | Infer a structured field schema from one or more documents using AI |
| `construct ingest` | Convert PDFs, office docs, spreadsheets, and text files into indexed markdown artifacts in the knowledge base |
| `construct init` | Bootstrap Construct project state and documentation system |
| `construct init-docs` | Stand up opinionated docs lanes and per-lane templates without overwriting existing docs |
| `construct init:update` | Update existing project to current documentation standards |
| `construct memory` | Inspect or consolidate the memory layer |
| `construct reflect` | Capture improvement feedback from chat session and update Construct core |
| `construct search` | Run hybrid file, SQL, and semantic retrieval over core project state |
| `construct storage` | Sync and inspect the hybrid storage backend |
| `construct team` | Team review and template listing |
| `construct wireframe` | Generate a low-fi wireframe (Mermaid diagram or sketch-style HTML) from a description |

## construct bootstrap

Import seed observation corpus into local memory store for cold-start acceleration

**Usage**

```bash
construct bootstrap [--verbose]
```

**Options**

| Flag | Description |
|---|---|
| `--verbose` | Print each observation imported or skipped |

## construct distill

Distill documents with query-focused, citation-ready chunk selection

**Usage**

```bash
construct distill <dir> [--format=summary|decisions|full|extract] [--query=TEXT] [--mode=auto|prompt|json] [--out=FILE]
```

**Options**

| Flag | Description |
|---|---|
| `--format=TYPE` | Output format: summary | decisions | full | extract (default: summary) |
| `--query=TEXT` | Focus chunk selection and output on a specific question |
| `--mode=TYPE` | Execution mode: auto | prompt | json (default: auto) |
| `--out=FILE` | Write output to file instead of stdout |
| `--depth=N` | Max directory depth to scan (default: 3) |
| `--ext=LIST` | Comma-separated extensions to include (default: all text) |

## construct docs:verify

Validate documentation completeness and quality

**Usage**

```bash
construct docs:verify [--quick] [--fix]
```

**Options**

| Flag | Description |
|---|---|
| `--quick` | Perform only critical checks |
| `--fix` | Attempt to fix issues automatically |

## construct drop

Ingest the most recent file dropped into ~/Downloads, Desktop, Documents, or iCloud Drive

**Usage**

```bash
construct drop [--list] [--index N] [--type ext] [--since 1h]
```

## construct graph

Generate and inspect task graphs derived from R&D intake triage. Each graph node carries an owner, dependsOn edges, acceptance criteria, and an evidence list. A node cannot transition to `done` without at least one evidence record.

**Usage**

```bash
construct graph list                                              # all graphs in this project
construct graph show <graph-id>                                   # nodes, edges, owners, evidence
construct graph from-intake <intake-id>                           # generate a graph from a pending intake packet
construct graph status <graph-id> <node-id> <status> [--evidence=text]
```

**Statuses**

`pending`, `claimed`, `in-progress`, `done`, `blocked`, `needs-input`, `skipped`.

**Options**

| Flag | Description |
|---|---|
| `--evidence=<text>` | Evidence string attached to the node on this status update |

Graphs persist to `.cx/task-graphs/<graph-id>.json` in solo mode. See [Concepts → Intake and triage](/concepts/intake-and-triage).

## construct headhunt

Create a temporary domain expertise overlay or promotion request

**Usage**

```bash
construct headhunt <domain> [--for=OBJECTIVE] [--scope=TEXT] [--temp|--save] [--team=a,b] | construct headhunt <list|promote|challenge|cleanup|template>
```

**Options**

| Flag | Description |
|---|---|
| `--for=OBJECTIVE` | Outcome the domain expertise should support |
| `--scope=TEXT` | Optional scope boundary for the overlay |
| `--temp` | Force temporary overlay mode |
| `--save` | Create a promotion request in addition to the temporary overlay |
| `--team=a,b` | Explicit existing specialists to attach the overlay to |
| `--freshness=current|stable` | Research freshness requirement (default: current) |
| `list` | List active overlays and promotion requests |
| `promote <id>` | Create a promotion request from an existing overlay |
| `challenge <id>` | Update devil's advocate challenge status for a promotion request |
| `cleanup` | Remove expired temporary overlays |
| `template [name] --for=OBJECTIVE` | Assemble a named team template as a domain overlay |

## construct intake

Inspect and process the R&D intake queue. Operates against the filesystem queue at `.cx/intake/` in solo mode, or the Postgres-backed queue in team / enterprise mode: the CLI contract is identical.

**Usage**

```bash
construct intake list                              # tabular: id, type, stage, owner, action
construct intake show <id>                         # full packet — triage, related artifacts, excerpt
construct intake done <id> [--notes=text]          # move pending → processed
construct intake skip <id> [--reason=text]         # move pending → skipped, audit trail preserved
construct intake reopen <id>                       # processed or skipped → pending
```

**Options**

| Flag | Description |
|---|---|
| `--notes=<text>` | Optional note attached when marking processed |
| `--reason=<text>` | Optional reason attached when skipping |

Triage classification (intakeType, rdStage, primaryOwner, recommendedChain, recommendedAction, risk, requiresApproval, confidence, rationale) is computed deterministically in the daemon: no LLM call. See [Concepts → Intake and triage](/concepts/intake-and-triage) for the full taxonomy and `recommendedAction` enum.

## construct infer

Infer a structured field schema from one or more documents using AI

**Usage**

```bash
construct infer <file> [more files] [--unified] [--max-chars=N] [--sample=N] [--threshold=0.5]
```

**Options**

| Flag | Description |
|---|---|
| `--unified` | Reconcile fields across multiple documents into a single schema |
| `--max-chars=N` | Max document characters to send to the model (default: 40000) |
| `--sample=N` | Max documents to sample for unified inference (default: 10) |
| `--threshold=0.5` | Field inclusion threshold for unified mode (default: 0.5) |

## construct ingest

Convert PDFs, office docs, spreadsheets, transcripts, and text files into indexed markdown artifacts in the knowledge base

**Supported formats**

- **Plain text / Code**: `.md`, `.txt`, `.rst`, `.adoc`, `.json`, `.yaml`, `.yml`, `.toml`, `.js`, `.mjs`, `.ts`, `.tsx`, `.jsx`, `.py`, `.go`, `.rs`, `.sh`, `.bash`, `.html`, `.css`, `.csv`, `.tsv`, `.xml`, `.env`, `.conf`, `.ini`, `.sql`, `.log`
- **Transcripts**: `.vtt` (WebVTT), `.srt` (SubRip), `.lrc` (lyrics), `.transcript`: Zoom, Teams, meeting recordings
- **Office documents**: `.docx`, `.xlsx`, `.pptx`, `.odt`, `.ods`
- **Rich text**: `.doc`, `.rtf`
- **macOS-only** (via `mdls`): `.xls`, `.ppt`, `.pages`, `.numbers`, `.key`
- **PDF**: `.pdf`

**Usage**

```bash
construct ingest <file-or-dir> [more paths] [--out=FILE] [--out-dir=DIR] [--target=knowledge/<subdir>] [--sync]
```

**Options**

| Flag | Description |
|---|---|
| `--out=FILE` | Write a single converted markdown file to an explicit path |
| `--out-dir=DIR` | Directory for generated markdown outputs (default: .cx/knowledge/internal) |
| `--target=MODE` | Output mode: knowledge/internal | knowledge/external | knowledge/decisions | knowledge/how-tos | knowledge/reference (default: knowledge/internal) |
| `--sync` | After writing markdown files, sync file-state into configured SQL/vector storage |

## construct init

Bootstrap Construct project state and documentation system

**Usage**

```bash
construct init [path] [--docs-preset=lean|product|full] [--docs-lanes=adrs,prds] [--with-architecture] [--with-readme] [--devcontainer]
```

**Options**

| Flag | Description |
|---|---|
| `--docs-preset=TYPE` | Documentation preset: lean | product | full (default: lean) |
| `--docs-lanes=LIST` | Comma-separated specific lanes to create |
| `--with-architecture` | Include docs/architecture.md |
| `--with-readme` | Create/update project README.md |
| `--devcontainer` | Copy devcontainer recipe into .devcontainer/ |

## construct init-docs

Stand up opinionated docs lanes and per-lane templates without overwriting existing docs

**Usage**

```bash
construct init-docs [path] [--yes] [--docs=lean|product|full|prds,adrs] [--extras=notes] [--with-architecture]
```

**Options**

| Flag | Description |
|---|---|
| `--yes` | Skip interactive questions, use defaults |
| `--docs=LIST` | Preset or comma-separated built-in lanes to scaffold |
| `--extras=LIST` | Comma-separated custom lane directories to create under docs/ |
| `--with-architecture` | Also create docs/architecture.md |

## construct init:update

Prepare non-destructive proposal files for current documentation standards

**Usage**

```bash
construct init:update [--dry-run] [--cwd=path]
```

**Options**

| Flag | Description |
|---|---|
| `--dry-run` | Show which proposal files would be written without creating them |
| `--cwd=path` | Review a different project directory instead of the current working directory |

## construct memory

Inspect or consolidate the memory layer

**Usage**

```bash
construct memory <stats|consolidate> [--project=NAME] [--last=N] [--threshold=0.95] [--archive-days=60]
```

**Subcommands**

- `[object Object]`

**Options**

| Flag | Description |
|---|---|
| `--project=NAME` | Filter stats to a specific project name |
| `--last=N` | Number of most recent sessions to include (default: 50) |

## construct reflect

Capture improvement feedback from chat session and update Construct core

**Usage**

```bash
construct reflect [--target=<internal|how-tos|decisions>] [--summary=<text>]
```

**Options**

| Flag | Description |
|---|---|
| `--target=<internal|how-tos|decisions>` | Knowledge subdir to store feedback (default: internal) |
| `--summary=<text>` | Brief summary of the improvement feedback |

## construct search

Run hybrid file, SQL, and semantic retrieval over core project state

**Usage**

```bash
construct search <query> [--limit=N]
```

**Options**

| Flag | Description |
|---|---|
| `--limit=N` | Maximum results to return (default: 10) |

## construct storage repair-migrations

Re-apply drifted migration files (idempotent only) and update their recorded SHA in `construct_schema_migrations`. Long-lived developer databases pre-date the append-only-migrations policy and may carry stale SHAs; this command heals that drift safely.

**Usage**

```bash
construct storage repair-migrations --yes
```

The safety bar is hard: any drifted file containing a destructive statement (`DROP`, `TRUNCATE`, `ALTER … DROP`, `DELETE`) is refused. The fix path there is to write a new migration file with a higher sequence number: never to silently re-record SHAs for destructive content.

**Output** prints which files were `applied` (genuinely new), `repaired` (drift healed), and `skipped` (unchanged). Exit code 2 indicates non-idempotent drift remains.

## construct storage migrations

Report migration state without applying or repairing.

**Usage**

```bash
construct storage migrations
```

Prints `lastApplied`, `appliedCount`, `onDiskCount`, and any `drift` (each entry includes `idempotent: true|false` so you can predict whether `repair-migrations` will heal it).

## construct storage

Sync and inspect the hybrid storage backend

**Usage**

```bash
construct storage <sync|status|reset|delete-ingested>
```

**Subcommands**

- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`

## construct team

Team review and template listing

**Usage**

```bash
construct team <review|templates>
```

**Subcommands**

- `[object Object]`
- `[object Object]`

## construct wireframe

Generate a low-fi wireframe (Mermaid diagram or sketch-style HTML) from a description

**Usage**

```bash
construct wireframe "<description>" [--type flow|state|sequence|er|layout|user-journey]
```
