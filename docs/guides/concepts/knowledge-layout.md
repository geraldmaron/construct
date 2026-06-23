---
title: Knowledge layout
description: How .cx/, beads, the vector index, and SQL fit together to make context durable across sessions.
---

`.cx/` is Construct's knowledge store. It's a directory in your project root that persists everything Construct learns: ingested documents, architectural decisions, session history, and observations from past work.

## Overview

`.cx/` has three layers:

| Layer | Dirs | Purpose |
|---|---|---|
| **Knowledge** | `.cx/knowledge/` | Typed, persistent, human-curated or inbox-ingested documents |
| **R&D loop** | `.cx/inbox/`, `.cx/intake/{pending,processed,skipped}/`, `.cx/task-graphs/`, `.cx/traces/` | Per-signal triage queue, per-signal execution plans, append-only trace event log |
| **Runtime** | `.cx/observations/`, `.cx/sessions/`, `.cx/runtime/` | Machine-written, high-churn, agent working memory |

Runtime dirs are **never** hand-edited. Knowledge dirs **are** hand-editable — but like the rest of `.cx/` they are local-only: `construct init` gitignores `.cx/` in full, so knowledge persists on the machine across sessions and is never committed to the repo (see the [README](../../README.md) section "`.cx/` is local-only runtime state"). R&D-loop dirs are written by the daemon and the CLI; agents update them via `construct intake` / `construct graph`, not by editing files.

---

## Knowledge Subdirectories

```
.cx/knowledge/
  internal/              ← team notes, meeting minutes, internal specs, ADRs, PRDs, incident records
  external/              ← customer feedback, support tickets, field notes, external research
  decisions/             ← architecture decision records (ADRs), design decisions, RFCs accepted
    strategy/            ← product strategy per scope: product.md, technical.md, gtm.md, platform.md
  how-tos/               ← runbooks, setup guides, operational playbooks, troubleshooting procedures
  reference/             ← specs, RFCs (pre-decision), schemas, API references, architecture docs
```

**Strategy is a protected subdirectory.** Files under `decisions/strategy/` are NEVER written automatically by the embed daemon or intake pipeline: they require an explicit `writeStrategy()` call or a user-initiated `construct strategy update` invocation. The strategy store exposes `readStrategy(scope)`, `readAllStrategies()`, and `getStrategyDigestSync()`. Agents inject a compact strategy digest (≤ 500 tokens) at prompt-assembly time so declared Bets and Non-bets are visible without a manual `get_skill()` call.

### Routing rules

Files dropped in `.cx/inbox/` are automatically routed by filename convention:

| Filename pattern | Routed to |
|---|---|
| `adr-NNN-*`, `architecture-decision-*` | `decisions/` |
| `*-spec*`, `*rfc*`, `*schema*`, `*api-ref*` | `reference/` |
| `*runbook*`, `*playbook*`, `*how-to*`, `*setup*`, `*guide*` | `how-tos/` |
| `*customer*`, `*feedback*`, `*support*`, `*external*` | `external/` |
| `*postmortem*`, `*incident*`, `*rca*` | `internal/` |
| (everything else) | `internal/` |

Routing is **additive**: files already in the right subdirectory are not moved.

### Neurodiversity-friendly documentation guidelines

To support neurodivergent readers (including those with ADHD, dyslexia, autism, etc.), all knowledge documents should follow these guidelines where practical:

- **Clear hierarchy**: Use descriptive headings (H1, H2, H3) to create a scannable outline. Avoid skipping heading levels.
- **Consistent structure**: Similar document types (e.g., all runbooks) should follow a predictable template (e.g., Purpose, Prerequisites, Steps, Troubleshooting).
- **Chunking**: Break text into short paragraphs (max 3-4 sentences). Use bullet points or numbered lists for steps or items.
- **Plain language**: Avoid jargon when possible; define necessary terms inline or in a glossary.
- **Visual contrast**: Ensure sufficient text-to-background contrast; avoid relying solely on color to convey information.
- **Predictable navigation**: Use consistent naming conventions and logical grouping within directories.
- **Reduce cognitive load**: Highlight important information with callouts or bold text sparingly; avoid dense walls of text.
- **Multiple modalities**: Where possible, supplement text with diagrams, flowcharts, or video walkthroughs (linked or embedded).
- **Linear flow**: For procedural documents, ensure steps are numbered and sequential; avoid branching instructions within the main flow (use appendices for variations).

These guidelines are aspirational; existing documents need not be refactored immediately, but new documents should aim to comply.

---

## Using the Inbox

Drop any supported file into `.cx/inbox/` and the embed daemon will:

1. Detect it on the next inbox-watcher cycle (reactive within a second or two; scheduler fallback every two minutes)
2. Classify it using the filename rules above
3. Extract text (PDF, DOCX, XLSX, PPTX, Markdown, plain text, code…)
4. Write a normalised Markdown artifact to `.cx/knowledge/<subdir>/<filename>.md`
5. Record a typed observation in `.cx/observations/` with tag `knowledge:<subdir>`
6. Run `classifyRdIntake` and write an R&D triage packet to `.cx/intake/pending/<id>.json`: intake type, R&D stage, primary owner persona, recommended chain, recommended action, risk, confidence, rationale. Drive the queue with `construct intake list / show / done / skip / reopen`. See [intake and triage](/guides/concepts/intake-and-triage).

Supported formats:
- **Plain text / Code**: `.md`, `.txt`, `.rst`, `.adoc`, `.json`, `.yaml`, `.yml`, `.toml`, `.js`, `.mjs`, `.ts`, `.tsx`, `.jsx`, `.py`, `.go`, `.rs`, `.sh`, `.bash`, `.html`, `.css`, `.csv`, `.tsv`, `.xml`, `.env`, `.conf`, `.ini`, `.sql`, `.log`
- **Transcripts**: `.vtt` (WebVTT), `.srt` (SubRip), `.lrc` (lyrics), `.transcript`: Zoom, Teams, meeting recordings
- **Office documents** (via [docling](https://github.com/docling-project/docling) Python sidecar): `.docx`, `.xlsx`, `.pptx`, `.odt`, `.ods`
- **Rich text** (via docling): `.doc`, `.rtf`
- **Legacy iWork/Office** (via docling): `.xls`, `.ppt`, `.pages`, `.numbers`, `.key`
- **PDF** (via docling, layout-aware with built-in OCR): `.pdf`
- **Audio / Video** (via [whisper.cpp](https://github.com/ggml-org/whisper.cpp), Metal-accelerated on macOS): `.mp3`, `.wav`, `.m4a`, `.mp4`, `.mov`, `.avi`, `.mkv`, `.flac`, `.ogg`, `.webm`, `.m4v`

High-fidelity extraction runs through the docling Python sidecar (provisioned automatically via [uv](https://github.com/astral-sh/uv) on first use into `.cx/runtime/docling/.venv`). Pass `--legacy-extractor` to `construct ingest` to fall back to the pre-docling regex path. Audio/video transcription requires `whisper-cli` (`brew install whisper-cpp` on macOS); see [Audio and Video Intake](/intake/audio-video).

Ingested documents are also stored content-addressed at `.cx/ingest/<sha256>/{source,markdown,meta}.json` for idempotent re-ingest, and indexed into `knowledge_search` so dropped documents become retrievable from any agent session.

Full list in `lib/document-extract.mjs`.

**50 MB hard cap**: files above this are skipped silently.

### Extra inbox dirs

Set `CX_INBOX_DIRS` to a colon-separated list of additional directories to watch:

```
CX_INBOX_DIRS=/Users/me/Downloads/docs:/Volumes/shared/specs
```

---

## Manual Ingest

Use `construct ingest` to place files directly without going through the inbox:

```sh
# Route to a specific knowledge subdir
construct ingest ./my-runbook.md --target=knowledge/how-tos

# Route to decisions
construct ingest ./adr-001-auth.md --target=knowledge/decisions

# Default: route to internal knowledge
construct ingest ./customer-research.pdf

# Sibling: write .md next to source
construct ingest ./spec.docx --target=sibling
```

Valid `--target` values: `sibling`, `knowledge/internal`, `knowledge/external`, `knowledge/decisions`, `knowledge/how-tos`, `knowledge/reference`.

---

## Observation Tags

Every inbox-ingested observation carries:

| Tag | Example | Meaning |
|---|---|---|
| `inbox` | `inbox` | Created by inbox-watcher |
| `ingested-doc` | `ingested-doc` | Produced by document extraction |
| `<category>` | `decision`, `pattern`, `anti-pattern`, `insight` | Observation category |
| `knowledge:<subdir>` | `knowledge:decisions` | Which knowledge subdir the artifact landed in |

Use these tags in `searchObservations` calls or the dashboard to filter by type.

---

## Runtime Directories (do not hand-edit)

```
.cx/
  observations/          ← machine-written observations (addObservation)
    entities.json        ← entity store: name, type, summary, relatedEntities[] (graph edges)
    entity-vectors.json  ← entity embeddings for hybrid search
  sessions/              ← distilled session records
  runtime/
    inbox-state.json     ← mtime-keyed state so files aren't re-ingested
    daemon.json          ← daemon PID + uptime state
    sync.lock            ← sync-agents write lock
  decisions/             ← session-scoped ADRs (short, per-session decisions)
  roadmap.md             ← generated hourly by roadmap.mjs
  context.md             ← human-readable project context (hand-maintained)
  context.json           ← machine-readable context (kept in sync with context.md)
  inbox/                 ← drop zone (auto-created, files moved to knowledge/ after processing)
```

### Entity graph (GraphRAG)

`entities.json` is the JSONL-backed graph. Each entity carries a
`relatedEntities[]` array which forms the undirected edge set.
`lib/knowledge/graph.mjs` reads this file and produces communities via label
propagation. Two queries are exposed:

- `askGlobal({ query, rootDir })` returns the top communities ranked by BM25
  against their member summaries. Useful for "how does X relate across the
  project?" questions that pure semantic retrieval misses.
- MCP wrapper `knowledge_graph_ask` exposes the same primitive to subagents.

The Postgres projection lives in `construct_entities.community_id` and
`construct_entity_communities` (see `db/schema/006_graph.sql`). The JSONL
file remains the source of truth in solo mode.

---

## Slack Channel Intent → Knowledge Category

When SLACK messages are ingested via the embed daemon, the channel intent tag
determines observation category and implicitly the knowledge subdir:

| SLACK_CHANNELS entry | Intent | Observation category | Knowledge subdir |
|---|---|---|---|
| `#eng-general` (no tag) | `internal` | `insight` | `internal/` |
| `#incidents:risk` | `risk` | `anti-pattern` | `internal/` |
| `#decisions:decision` | `decision` | `decision` | `decisions/` |
| `#tips:how-to` | `how-to` | `pattern` | `how-tos/` |
| `#customer:external` | `external` | `insight` | `external/` |

Configure channels in `~/.construct/config.env`:

```
SLACK_CHANNELS=#eng-general,#incidents:risk,#decisions:decision,#customer-feedback:external
```

---

## Migration from `product-intel/`

`product-intel` is retired. New ingests and cleanup tools use `.cx/knowledge/` only.

If an older project still has `.cx/product-intel/sources/ingested/`, move those markdown files into the closest matching `.cx/knowledge/<subdir>/` directory.

Structured Product Intelligence stores now live under `.cx/knowledge/internal/` as well:

- `customer-profiles/`
- `workspaces/`

Compatibility shims still read or migrate older `product-intel` locations when present, but new writes should never target that namespace.
