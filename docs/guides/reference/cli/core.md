---
title: Core
description: Core commands for Construct.
---

# Core

| Command | What it does |
|---|---|
| `construct approvals` | Manage pending MCP tool approvals |
| `construct dev` | Start services for development |
| `construct directives` | View standing directives (construct.config.json directives[]) and their due status |
| `construct docs` | Documentation commands |
| `construct doctor` | Check installation health |
| `construct init` | Project setup (once per repo): scaffold .construct/, AGENTS.md, plan.md, adapters |
| `construct install` | Machine setup (footprint per ADR-0029/ADR-0071): --footprint=project\|user\|both, default project |
| `construct intake` | View and process the active profile's intake queue (queue label varies by profile) |
| `construct oracle` | Oracle meta-controller — fleet health review and bounded-auto maintenance |
| `construct recommendations` | View and manage artifact recommendations |
| `construct sandbox` | Isolated tmpdir-based environment for QA and worker dry-runs |
| `construct status` | Show system health and credentials |
| `construct stop` | Stop all running services |
| `construct sync` | Sync agent adapters to AI tools |
| `construct workers` | List shared-deployment worker heartbeats (requires DATABASE_URL; optional for solo) |
| `construct workspace-preset` | Inspect and apply workspace-wide defaults |

## construct approvals

Manage pending MCP tool approvals

**Usage**

```bash
construct approvals list|approve|deny|status
```

**Subcommands**

- `list` — List pending approvals with tool name, requestedAt, requestedBy
- `approve <id>` — Approve a pending approval by id
- `deny <id> [--reason=...]` — Deny a pending approval by id
- `status <id>` — Show the full status of a specific approval

## construct dev

Start services for development

**Usage**

```bash
construct dev [--select] [--only=memory,opencode,...]
```

**Options**

| Flag | Description |
|---|---|
| `--select` | Pick which services to start from an interactive checklist |
| `--only=<a,b,c>` | Start only the named services (telemetry, memory, opencode, copilot-bridge) |

## construct directives

View standing directives (construct.config.json directives[]) and their due status

**Usage**

```bash
construct directives list|status
```

**Subcommands**

- `list` — List configured directives and their due status
- `status <id>` — Show the full status of a specific directive

## construct docs

Documentation commands

**Usage**

```bash
construct docs check|verify|update
```

**Subcommands**

- `check` — Check for missing how-to guides
- `verify` — Validate documentation quality
- `update` — Regenerate AUTO-managed regions

## construct doctor

Check installation health

**Usage**

```bash
construct doctor [<status|logs|tick|report|production|consistency|watch|stop|credentials>]
```

**Subcommands**

- `status` — Doctor daemon status
- `logs` — Tail doctor daemon logs
- `tick` — Run one doctor daemon check cycle now
- `report` — Print the latest health report
- `production` — Local production go/no-go health gate (construct-4uxq0.14.4)
- `consistency` — Run cross-surface consistency checks
- `watch` — Start the doctor daemon (continuous checks)
- `stop` — Stop the doctor daemon
- `credentials` — Diagnose provider credential resolution

## construct init

Project setup (once per repo): scaffold .construct/, AGENTS.md, plan.md, adapters

**Usage**

```bash
construct init [path] [options]
```

**Options**

| Flag | Description |
|---|---|
| `--yes` | Accept all defaults (non-interactive; auto-runs git init when .git/ is missing) |
| `--no-start` | Do not start services after init |
| `--auto-start` | Start services even in CI/test contexts |
| `--no-beads` | Skip local issue-tracker initialization (CI/ephemeral) |
| `--commit-bootstrap` | Keep the beads bootstrap commit (default: leave files uncommitted) |
| `--force` | Scaffold even when content exists or target is a nested subdirectory |
| `--with-<host>` | Force-include an adapter set (claude|codex|opencode|vscode|cursor|copilot); unions with detection |
| `--all-hosts` | Write every adapter set regardless of what is installed |
| `--interactive, -i` | Enable interactive setup (Packs / Individual docs / Skip) |
| `--quiet, -q` | Minimal output |
| `--verbose, -v` | Detailed output |
| `--docs-preset=<pack>` | Opt into a curated docs pack: lean|product|full (default init is docs/ only) |
| `--docs-lanes=<lanes>` | Opt into specific doc lanes (comma-separated) |
| `--with-docs=<lanes>` | Same as --docs-lanes (comma-separated, or all) |
| `--with-all-docs` | Enable every documentation lane |
| `--with-adrs` | Enable Architecture Decision Records |
| `--with-rfcs` | Enable RFCs (design reviews) |
| `--with-runbooks` | Enable operational runbooks |
| `--with-postmortems` | Enable incident postmortems |
| `--with-architecture` | Create architecture.md |
| `--with-readme` | Create README.md when missing |
| `--watch-inbox` | Enable continuous inbox watching (non-interactive opt-in) |
| `--seed-index` | Embed existing project docs into the local search index |
| `--devcontainer` | Scaffold a .devcontainer/ recipe |
| `--workspace-preset=<id>` | Set the active Workspace Preset in construct.config.json |

## construct install

Machine setup (footprint per ADR-0029/ADR-0071): --footprint=project|user|both, default project

**Usage**

```bash
construct install [--footprint=project|user|both] [--yes] [--dry-run] [--no-launch-agent] [--reconfigure] [--with-docling]
```

**Options**

| Flag | Description |
|---|---|
| `--footprint=<f>` | project (default, no-op + guidance) | user (writes ~/.config/construct/, MCP, ~/.claude/* via consent) | both |
| `--yes` | Apply defaults without prompts (only meaningful with --footprint=user|both) |
| `--dry-run` | Preview the install plan (footprints, files, services) without writing anything |
| `--no-launch-agent` | Skip background macOS LaunchAgent registration |
| `--reconfigure` | Re-prompt for service consent, ignoring cached answers |
| `--with-docling` | Eagerly provision the docling document-extraction venv now (heavy, ~10 min; else lazy on first ingest) |

## construct intake

View and process the active profile's intake queue (queue label varies by profile)

**Usage**

```bash
construct intake list|show|done|skip|reopen|integrate|classify
```

**Subcommands**

- `list` — List pending packets
- `show <id>` — Show one packet (triage, related docs, excerpt, tag suggestions)
- `done <id> [--output=<path>]` — Mark processed; optionally stamp the produced artifact
- `skip <id> [--reason=…]` — Drop without action; preserves audit trail
- `reopen <id>` — Move a processed or skipped packet back to pending
- `integrate <id> <github|jira|confluence> [--publish-issues]` — Create an external ticket from a packet (--publish-issues unlocks the demo-source gate)
- `classify --json [--text|--file|<stdin>]` — Classify an artifact and return a role-aware plan without enqueuing (embedded contract)

## construct oracle

Oracle meta-controller — fleet health review and bounded-auto maintenance

**Usage**

```bash
construct oracle status|review|pending|approve|gaps|reconcile|invariants|impact|semantic-review|miss|miss-analysis
```

## construct recommendations

View and manage artifact recommendations

**Usage**

```bash
construct recommendations list|show|dismiss|stats
```

## construct sandbox

Isolated tmpdir-based environment for QA and worker dry-runs

**Usage**

```bash
construct sandbox create|list|delete|prune [--profile=<id>]
```

**Subcommands**

- `create [--profile=<id>]` — Create a new sandbox under ~/.construct/sandboxes/
- `list` — List existing sandboxes, newest first
- `delete <id>` — Remove one sandbox by id
- `prune [--days=N]` — Remove sandboxes older than N days (default 7)

## construct status

Show system health and credentials

**Usage**

```bash
construct status
```

**Options**

| Flag | Description |
|---|---|
| `--json` | Output full status payload as JSON |

## construct stop

Stop all running services

**Usage**

```bash
construct stop
```

## construct sync

Sync agent adapters to AI tools

**Usage**

```bash
construct sync [--project] [--dry-run] [--no-docs] [--all-hosts] [--with-<host>] [--hosts=<list>]
```

**Options**

| Flag | Description |
|---|---|
| `--project` | Write project-local adapters into the current repo only |
| `--dry-run` | Preview adapter changes without writing files |
| `--no-docs` | Skip AUTO docs regeneration after syncing adapters |
| `--with-<host>` | Force-include an adapter set (claude|codex|opencode|vscode|cursor|copilot); unions with detection unless --hosts= is set |
| `--all-hosts` | Sync every adapter set regardless of what is installed |
| `--hosts=<list>` | Restrict to a comma-separated host list (or all); CONSTRUCT_SYNC_HOSTS= is the env equivalent |

## construct workers

List shared-deployment worker heartbeats (requires DATABASE_URL; optional for solo)

**Usage**

```bash
construct workers <list> [--json]
```

**Options**

| Flag | Description |
|---|---|
| `--json` | Output worker list as JSON |

## construct workspace-preset

Inspect and apply workspace-wide defaults

**Usage**

```bash
construct workspace-preset list|show|apply
```

**Subcommands**

- `list [--grep=<term>]` — List workspace presets (sorted by id)
- `show [<id>]` — Show active or named preset summary (--json for full record)
- `apply <id> [--dry-run] [--docs-preset=lean|product|full] [--yes]` — Validate and persist workspacePreset; docs packs are opt-in via flag or TTY picker
