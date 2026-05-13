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

Convert PDFs, office docs, spreadsheets, and text files into indexed markdown artifacts in the knowledge base

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

Update existing project to current documentation standards

**Usage**

```bash
construct init:update [--force] [--dry-run]
```

**Options**

| Flag | Description |
|---|---|
| `--force` | Apply all updates without prompting |
| `--dry-run` | Show what would be updated without making changes |

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
