---
title: Diagnostics
description: Diagnostics commands for Construct.
---

# Diagnostics

| Command | What it does |
|---|---|
| `construct audit` | Audit Construct internals and review the mutation trail |
| `construct certify` | Inspect and run scenario-based certification under .construct/certification/ |
| `construct cleanup` | Release dev-agent memory pressure by cleaning stale helper and bridge processes |
| `construct doc` | Verify or inspect auditability stamps on Construct-generated markdown files |
| `construct docs:check` | Check for missing how-to guides (alias for `docs check`) |
| `construct docs:reconcile` | Reconcile docs against the registry |
| `construct docs:site` | Regenerate generated reference pages under docs/guides/reference/ |
| `construct docs:update` | Regenerate AUTO-managed doc regions (alias for `docs update`) |
| `construct docs:verify` | Validate documentation quality (alias for `docs verify`) |
| `construct impact` | Change-impact analysis — map changed files to affected tests, capabilities, and procedures |
| `construct rules` | Rule and hook reference telemetry rollup |

## construct audit

Audit Construct internals and review the mutation trail

**Usage**

```bash
construct audit <skills|worker-profiles|tests|trail>
```

**Subcommands**

- `skills` — Audit skill corpus coverage and metadata (`--inventory` checks certification skill inventory freshness)
- `worker-profiles` — Audit worker profile and skill cross-checks
- `tests` — Validate behavior-to-test capability traceability (`--corpus` checks test-file inventory)
- `trail` — Review mutation audit trail

## construct certify

Inspect and run scenario-based certification under .construct/certification/

**Usage**

```bash
construct certify list|show|scenarios|models|demos|parity|document-io|status|gate|run <scenario-id>|compare
```

**Subcommands**

- `list` — List recorded certification run ids
- `show` — Show one certification run record as JSON
- `scenarios` — List available certification scenarios with model tier
- `models` — List routable certification models (free by default)
- `demos` — Canonical demo scenario catalog for Tauri/web/VHS parity
- `parity` — Cross-surface demo parity report (--write persists under tests/certification/demos/)
- `document-io` — Export matrix over every output format (--certified hard-fails on a format skipped for a missing engine)
- `status` — Roll up certification posture across capabilities and surfaces
- `gate` — Release candidate gate — stale or failing release-critical certification evidence blocks
- `run` — Execute a scenario (live requires CONSTRUCT_CERTIFY_LIVE=1; paid requires CONSTRUCT_CERTIFY_ALLOW_PAID=1)

## construct cleanup

Release dev-agent memory pressure by cleaning stale helper and bridge processes

**Usage**

```bash
construct cleanup [--dry-run] [--quiet] [--pressure-release] [--pressure-only] [--disk-only]
```

**Options**

| Flag | Description |
|---|---|
| `--dry-run` | Show what would be cleaned without changing anything |
| `--quiet` | Minimal output |
| `--pressure-release` | Also kill stale dev-agent and leaked VHS demo-recorder processes |
| `--pressure-only` | Pressure release only — skip disk cleanup |
| `--disk-only` | Disk cleanup only — skip pressure release |

## construct doc

Verify or inspect auditability stamps on Construct-generated markdown files

**Usage**

```bash
construct doc <verify|inspect>
```

## construct docs:check

Check for missing how-to guides (alias for `docs check`)

**Usage**

```bash
construct docs:check
```

## construct docs:reconcile

Reconcile docs against the registry

**Usage**

```bash
construct docs:reconcile
```

## construct docs:site

Regenerate generated reference pages under docs/guides/reference/

**Usage**

```bash
construct docs:site [--check]
```

## construct docs:update

Regenerate AUTO-managed doc regions (alias for `docs update`)

**Usage**

```bash
construct docs:update
```

## construct docs:verify

Validate documentation quality (alias for `docs verify`)

**Usage**

```bash
construct docs:verify
```

## construct impact

Change-impact analysis — map changed files to affected tests, capabilities, and procedures

**Usage**

```bash
construct impact [files…] [--stdin] [--run] [--json]
```

## construct rules

Rule and hook reference telemetry rollup

**Usage**

```bash
construct rules usage [--since=30d]
```
