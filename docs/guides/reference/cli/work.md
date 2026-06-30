---
title: Work
description: Work commands for Construct.
---

# Work

| Command | What it does |
|---|---|
| `construct artifact` | Plan or locally execute manifest-backed artifact workflows with execution provenance |
| `construct ask` | One-shot ask against the active knowledge index |
| `construct bootstrap` | Import seed observation corpus into local memory store for cold-start acceleration |
| `construct customer` | Manage customer profiles for product intelligence |
| `construct demo` | Run guided tours or record VHS/asciinema tapes |
| `construct diagram` | Render code-driven diagrams via D2/Graphviz (optional system binaries; ADR-0001) |
| `construct distill` | Distill documents with query-focused chunking |
| `construct drop` | Ingest file from Downloads/Desktop |
| `construct export` | Export markdown to PDF, DOCX, HTML, and other Pandoc formats via Pandoc + Typst (optional system binaries; ADR-0024) |
| `construct graph` | Task graph management |
| `construct handoffs` | List and inspect session handoff files in .cx/handoffs/ |
| `construct headhunt` | Create domain expertise overlays |
| `construct infer` | Infer schema from documents |
| `construct ingest` | Convert documents to indexed markdown |
| `construct integrations` | Check and manage external system connections |
| `construct knowledge` | Query, index, or add to the project knowledge base |
| `construct memory` | Inspect memory layer |
| `construct publish` | Publish typed artifacts: release gate + export PDF with figures + optional demos |
| `construct reflect` | Capture improvement feedback and update Construct core |
| `construct search` | Hybrid search across project state |
| `construct storage` | Manage storage backend |
| `construct tags` | Manage the controlled tag vocabulary (propose, add, deprecate, audit) |
| `construct team` | Team review and template listing (`team:add` / `team:remove` are internal registry editors) |
| `construct tools` | Detect optional publish pipeline binaries (Pandoc, D2, VHS, Playwright) |
| `construct wireframe` | Generate wireframes from description |
| `construct workflow` | Instantiate workflow templates (PRD-to-review chains, onboarding, handoffs) |
| `construct workspace` | Manage PM workspaces for multi-PM signal routing |

## construct artifact

Plan or locally execute manifest-backed artifact workflows with execution provenance

**Usage**

```bash
construct artifact <validate|workflow> ...
```

**Subcommands**

- `validate` — Run manifest structure, citation, and reviewer checks
- `workflow` — Return a truthful plan/run report; --apply only runs local validation/export after approval

## construct ask

One-shot ask against the active knowledge index

**Usage**

```bash
construct ask <query>
```

## construct bootstrap

Import seed observation corpus into local memory store for cold-start acceleration

**Usage**

```bash
construct bootstrap
```

## construct customer

Manage customer profiles for product intelligence

**Usage**

```bash
construct customer list|show|add|update|search
```

**Subcommands**

- `list` — List all customer profiles
- `show <id>` — Show a customer profile
- `add --name=Acme --owner=Jane` — Create a new customer profile
- `search <query>` — Search customer profiles by name/alias

## construct demo

Run guided tours or record VHS/asciinema tapes

**Usage**

```bash
construct demo <list|init|record|tour|name> [--surface=tape|playwright] [--format=gif|mp4|webm] [--out=<path>] [--source-only]
```

**Options**

| Flag | Description |
|---|---|
| `--surface=<s>` | tape (default) | playwright |
| `--accessible` | Screen-reader-friendly linear tour renderer |
| `--skip-input` | Tour: auto-advance without waiting for Enter (headless/CI) |
| `--format=<f>` | gif (default) | mp4 | webm (tape surface only) |
| `--out=<path>` | Output path (tape recording) |
| `--from=<t>` | Template for init: quickstart | diagram |
| `--from-project` | init: scaffold a project demo plug-in under .cx/demos/ |
| `--source-only` | Tape: write .tape only; skip recording |

## construct diagram

Render code-driven diagrams via D2/Graphviz (optional system binaries; ADR-0001)

**Usage**

```bash
construct diagram <description> [--type=architecture|flow|sequence|state|er|class] [--format=svg|png] [--theme=<name>] [--out=<path>] [--source-only]
```

**Options**

| Flag | Description |
|---|---|
| `--type=<t>` | architecture (default) | flow | sequence | state | er | class |
| `--format=<f>` | svg (default) | png |
| `--theme=<name>` | D2 theme name (e.g. neutral, sketch, cool-classics) |
| `--out=<path>` | Output path (default: .cx/diagrams/<slug>-<ts>.<ext>) |
| `--source-only` | Always write the source file; skip rendering |

## construct distill

Distill documents with query-focused chunking

**Usage**

```bash
construct distill <file>
```

## construct drop

Ingest file from Downloads/Desktop

**Usage**

```bash
construct drop <file>
```

## construct export

Export markdown to PDF, DOCX, HTML, and other Pandoc formats via Pandoc + Typst (optional system binaries; ADR-0024)

**Usage**

```bash
construct export <markdown-file> --to=<pdf|docx|deck|pptx|html|rtf|odt|epub|tex|txt|md|mdx> [--output=<path>] [--figures|--no-figures] [--plain] [--detect]
```

**Options**

| Flag | Description |
|---|---|
| `--to=<format>` | pdf, docx, deck, pptx, html, rtf, odt, epub, tex, txt, md, mdx |
| `--output=<path>` | Output path |
| `--figures` | Render d2/mermaid via pandoc-ext/diagram filter |
| `--no-figures` | Skip diagram rendering |
| `--plain, --no-brand` | Explicitly opt out of Construct branding for a brand-capable output |
| `--detect` | Report binary availability (JSON) |

## construct graph

Task graph management

**Usage**

```bash
construct graph <list|show|from-intake|recommend>
```

**Subcommands**

- `recommend --json [--text|--file|<stdin>]` — Return a role-aware plan for an artifact without enqueuing (embedded contract; alias of intake classify)

## construct handoffs

List and inspect session handoff files in .cx/handoffs/

**Usage**

```bash
construct handoffs <list|show>
```

## construct headhunt

Create domain expertise overlays

**Usage**

```bash
construct headhunt <create|list>
```

## construct infer

Infer schema from documents

**Usage**

```bash
construct infer <file>
```

## construct ingest

Convert documents to indexed markdown

**Usage**

```bash
construct ingest <file> [--strategy=adapter|provider] [--orchestration=prompt-only|orchestrated] [--strict] [--fidelity=fast|high]
```

## construct integrations

Check and manage external system connections

**Usage**

```bash
construct integrations status
```

**Subcommands**

- `status` — Check which external integrations are configured

## construct knowledge

Query, index, or add to the project knowledge base

**Usage**

```bash
construct knowledge trends|index|add
```

**Subcommands**

- `trends` — Show trend report across observations and artifacts
- `index` — Rebuild the local RAG corpus over .cx/ artifacts
- `add --source=research --slug=<id> --topic="..." [--source-url=<url>]` — Persist a research finding into .cx/knowledge/external/research/

## construct memory

Inspect memory layer

**Usage**

```bash
construct memory <status|search>
```

## construct publish

Publish typed artifacts: release gate + export PDF with figures + optional demos

**Usage**

```bash
construct publish <markdown> [--to=pdf] [--type=DOC] [--demo=NAME] [--strict]
```

**Options**

| Flag | Description |
|---|---|
| `--to=<format>` | pdf (default), docx, deck, pptx, html, rtf, odt, epub, tex, txt, md, mdx |
| `--output=<path>` | Output path (default: .cx/publish/<name>.<format>) |
| `--type=<doc-type>` | Manifest doc type for release gate (inferred when omitted) |
| `--demo=<name>` | Terminal VHS tape to record (repeatable) |
| `--recording=<name>` | Playwright recording manifest (repeatable) |
| `--figures` | Render d2/mermaid via diagram filter (default on) |
| `--no-figures` | Skip diagram filter |
| `--preview` | Render the export to images and report what was verified |
| `--no-gate` | Skip artifact release gate (escape hatch only) |
| `--source-only` | Write sources only |
| `--strict` | Exit 2 when toolchain or release gate fails (default) |
| `--no-strict` | Do not exit 2 on toolchain/gate failure |
| `--detect` | Print tooling JSON and exit |

## construct reflect

Capture improvement feedback and update Construct core

**Usage**

```bash
construct reflect
```

## construct search

Hybrid search across project state

**Usage**

```bash
construct search <query>
```

## construct storage

Manage storage backend

**Usage**

```bash
construct storage <status|reset>
```

## construct tags

Manage the controlled tag vocabulary (propose, add, deprecate, audit)

**Usage**

```bash
construct tags <audit|propose|add|deprecate|archive|list|proposed>
```

## construct team

Team review and template listing (`team:add` / `team:remove` are internal registry editors)

**Usage**

```bash
construct team <list|show|review|templates>
```

**Subcommands**

- `list` — List macro groups and squads (--kind group|squad)
- `show` — Show one group or squad by id
- `review` — Team review workflow
- `templates` — List team doc templates

## construct tools

Detect optional publish pipeline binaries (Pandoc, D2, VHS, Playwright)

**Usage**

```bash
construct tools detect [--json] [--figures] [--demo=NAME]
```

**Options**

| Flag | Description |
|---|---|
| `--json` | JSON output |
| `--figures` | Include figure tooling (default on) |
| `--no-figures` | Skip figure binaries |
| `--demo=<name>` | Include terminal demo recorder check |

## construct wireframe

Generate wireframes from description

**Usage**

```bash
construct wireframe <description>
```

## construct workflow

Instantiate workflow templates (PRD-to-review chains, onboarding, handoffs)

**Usage**

```bash
construct workflow <list|show|new|invoke>
```

**Subcommands**

- `invoke --json --workflow-type <t> [--text|--file|<stdin>]` — Invoke a workflow (roles/skills) non-interactively with approval gating and provenance (embedded contract)

## construct workspace

Manage PM workspaces for multi-PM signal routing

**Usage**

```bash
construct workspace list|create|show|assign
```

**Subcommands**

- `list` — List all workspaces
- `create --name=X --owner=Jane` — Create a new workspace
- `show <id>` — Show workspace details
- `assign --customer=X --workspace=Y` — Assign customer to workspace
