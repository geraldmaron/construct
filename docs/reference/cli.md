<!--
docs/reference/cli.md — Complete CLI reference for the construct command.

Source of truth: lib/cli-commands.mjs. Run construct <command> --help for inline usage.
-->

# CLI Reference

Every `construct` subcommand with description and key flags. Source of truth: `lib/cli-commands.mjs`.

## Services

| Command | Flags | Description |
|---|---|---|
| `construct up` | | Start services (memory, dashboard) |
| `construct down` | | Stop all running services |
| `construct status` | `--json` | Canonical health check across runtime and integrations |
| `construct show` | | Show runtime service URLs and live status |
| `construct serve` | `--token` | Start the dashboard (auto-selects port). `--token` prints a new token and exits. |
| `construct beads` | `--json` `--silent` | Manage beads lock/queue or run `bd` commands |
| `construct completions` | `bash\|zsh\|install` | Generate shell completion scripts |
| `construct version` | | Show installed version |
| `construct doctor` | | Run installation health checks |

## Setup & Distribution

| Command | Description |
|---|---|
| `construct setup [--yes] [--no-docker]` | First-run wizard: provisions resources, configures providers, wires hooks |
| `construct init [path] [--docs-preset=lean\|product\|full]` | Bootstrap project state and documentation system |
| `construct init:update [--force] [--dry-run]` | Update existing project to current documentation standards |
| `construct update` | Reinstall this checkout globally, then sync and verify hosts |
| `construct completions [bash\|zsh\|install]` | Generate shell completion scripts |

## Sync & Adapters

| Command | Description |
|---|---|
| `construct sync [--project] [--no-docs]` | Generate agent adapters for all platforms |
| `construct list` | Show all personas and specialist agents |
| `construct validate` | Validate registry.json structure and field constraints |
| `construct diff` | Show which agents changed prompts or settings since HEAD |

## Embed Mode

| Command | Description |
|---|---|
| `construct embed start [--config <path>]` | Fork detached embed daemon |
| `construct embed stop` | Send SIGTERM to running daemon |
| `construct embed status` | Print daemon status + last snapshot summary |
| `construct embed snapshot [--config <path>]` | Run a one-shot snapshot |
| `construct embed migrate-model [--apply]` | Migrate embedding column to the active engine's dimensions |
| `construct embed supervise` | Install platform supervisor (launchd/systemd/Task Scheduler) for auto-restart |
| `construct embed unsupervise` | Remove the platform supervisor entry |

## Providers

| Command | Description |
|---|---|
| `construct provider list` | List registered providers and their health |
| `construct provider info <id>` | Show config schema and capabilities |
| `construct provider test <id> [--query=...]` | Round-trip health check |
| `construct provider plugins add <package>` | Install a custom provider plugin |
| `construct provider plugins remove <id>` | Remove a custom provider plugin |
| `construct providers [list\|test <name>]` | Alias for `construct provider` |

## Knowledge & Memory

| Command | Description |
|---|---|
| `construct memory stats` | Show session counts, hit rate, retrieval latency |
| `construct memory consolidate [--threshold=0.95] [--archive-days=60]` | Merge near-duplicate observations |
| `construct bootstrap [--verbose]` | Import seed observation corpus for cold-start |
| `construct distill <dir> [--query=TEXT]` | Query-focused document distillation |
| `construct ingest <file-or-dir>` | Index PDFs, office docs, text files into the knowledge base |
| `construct infer <file>` | Infer a structured field schema from documents |
| `construct drop [--list]` | Ingest the most recent file from Downloads/Desktop |

## Artifacts & Docs

| Command | Description |
|---|---|
| `construct artifact generate [--type prd\|adr\|rfc]` | Generate a structured artifact |
| `construct artifact list` | List existing artifacts |
| `construct docs:verify [--quick] [--fix]` | Validate documentation completeness |
| `construct docs:update [--check]` | Regenerate AUTO-managed regions |
| `construct docs:check [--json]` | Report CLI commands without how-to guides |
| `construct docs:site` | Generate MkDocs site content |
| `construct wireframe "<desc>"` | Generate a Mermaid or HTML wireframe |

## Backup

| Command | Description |
|---|---|
| `construct backup create [--include-secrets]` | Archive all system state to `~/.construct/backups/` |
| `construct backup verify <archive>` | Check checksums without extracting |
| `construct backup restore <archive> [--yes]` | Restore from an archive |
| `construct backup list` | List available backup archives |

## Evals & Quality

| Command | Description |
|---|---|
| `construct evals [--json]` | Show evaluator catalog |
| `construct evals retrieval [--fixture=PATH]` | Run retrieval eval harness (Recall@k, MRR, NDCG) |
| `construct audit skills` | Audit skill files for stub headers and broken references |
| `construct audit trail [--verify] [--agent] [--since]` | Show the append-only mutation audit trail |
| `construct lint:comments [--fix]` | Check all files against the comment policy |
| `construct lint:research` | Check research artifacts for structure and evidence metadata |

## Platform & Plugins

| Command | Description |
|---|---|
| `construct hook <name>` | Run a named hook script (used by settings.json) |
| `construct plugin engine list\|add\|remove` | Manage retrieval engine plugin overrides |
| `construct skills scope` | Detect tech stack and classify skills by relevance |
| `construct skills apply [--host claude\|opencode\|codex\|all]` | Write per-host skill filter configs |
| `construct team review` | Run telemetry-backed team performance review |
| `construct team templates` | List available team templates |

## Operational

| Command | Description |
|---|---|
| `construct doctor [--bootstrap]` | Run health checks; `--bootstrap` re-probes every resource |
| `construct reflect [--target=internal\|how-tos\|decisions]` | Capture session feedback into Construct core |
| `construct cleanup [--pressure-release]` | Release memory pressure by cleaning stale processes |
| `construct beads [status\|queue\|cleanup]` | Manage beads issue tracker |
| `construct dashboard:sync [--build] [--check]` | Sync dashboard bundle into server static |
| `construct doc verify [path]` | Verify auditability stamps on generated markdown files |
