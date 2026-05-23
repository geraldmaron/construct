---
title: Embed
description: Embed commands for Construct.
---

# Embed

| Command | What it does |
|---|---|
| `construct artifact` | Generate or list structured artifacts (PRD, ADR, RFC) |
| `construct embed` | Manage embed mode: continuous monitoring and snapshot production |
| `construct providers` | List registered providers and test their capability contracts |

## construct artifact

Generate or list structured artifacts (PRD, ADR, RFC)

**Usage**

```bash
construct artifact <generate|list> [--type <prd|adr|rfc>] [--title <title>]
```

**Subcommands**

- `generate`
- `list`

**Options**

| Flag | Description |
|---|---|
| `--type <type>` | Artifact type: prd, adr, or rfc |
| `--title <title>` | Title for the new artifact |
| `--owner <name>` | Owner / author name (PRD, RFC) |
| `--status <status>` | Initial status (ADR: Proposed|Accepted|Deprecated) |
| `--dry-run` | Print generated content without writing to disk |

## construct embed

Manage embed mode: continuous monitoring and snapshot production

**Usage**

```bash
construct embed <start|stop|status|snapshot> [--config <path>]
```

**Subcommands**

- `start`
- `stop`
- `status`
- `snapshot`

**Options**

| Flag | Description |
|---|---|
| `--config <path>` | Path to embed.yaml (default: ./embed.yaml) |

## construct providers

List registered providers and test their capability contracts

**Usage**

```bash
construct providers [list|test <name>]
```

**Subcommands**

- `list`
- `test`
