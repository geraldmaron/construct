---
title: Work
description: Work commands for Construct.
---

# Work

| Command | What it does |
|---|---|
| `construct bootstrap` | Import seed observations |
| `construct customer` | Manage customer profiles for product intelligence |
| `construct distill` | Distill documents with query-focused chunking |
| `construct drop` | Ingest file from Downloads/Desktop |
| `construct graph` | Task graph management |
| `construct headhunt` | Create domain expertise overlays |
| `construct infer` | Infer schema from documents |
| `construct ingest` | Convert documents to indexed markdown |
| `construct integrations` | Check and manage external system connections |
| `construct knowledge` | Query, index, or add to the project knowledge base |
| `construct memory` | Inspect memory layer |
| `construct reflect` | Capture improvement feedback |
| `construct search` | Hybrid search across project state |
| `construct storage` | Manage storage backend |
| `construct team` | Team review and templates |
| `construct wireframe` | Generate wireframes from description |
| `construct workspace` | Manage PM workspaces for multi-PM signal routing |

## construct bootstrap

Import seed observations

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

- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`

## construct distill

Distill documents with query-focused chunking

**Usage**

```bash
construct distill <dir> [--format=summary|decisions|full]
```

## construct drop

Ingest file from Downloads/Desktop

**Usage**

```bash
construct drop [--list]
```

## construct graph

Task graph management

**Usage**

```bash
construct graph list|show|from-intake
```

## construct headhunt

Create domain expertise overlays

**Usage**

```bash
construct headhunt <domain>
```

## construct infer

Infer schema from documents

**Usage**

```bash
construct infer <file> [--unified]
```

## construct ingest

Convert documents to indexed markdown

**Usage**

```bash
construct ingest <file> [--sync]
```

## construct integrations

Check and manage external system connections

**Usage**

```bash
construct integrations status
```

**Subcommands**

- `[object Object]`

## construct knowledge

Query, index, or add to the project knowledge base

**Usage**

```bash
construct knowledge trends|index|add
```

**Subcommands**

- `[object Object]`
- `[object Object]`
- `[object Object]`

## construct memory

Inspect memory layer

**Usage**

```bash
construct memory stats|consolidate
```

## construct reflect

Capture improvement feedback

**Usage**

```bash
construct reflect [--summary=<text>]
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
construct storage sync|status|reset
```

## construct team

Team review and templates

**Usage**

```bash
construct team review|templates
```

## construct wireframe

Generate wireframes from description

**Usage**

```bash
construct wireframe "<description>"
```

## construct workspace

Manage PM workspaces for multi-PM signal routing

**Usage**

```bash
construct workspace list|create|show|assign
```

**Subcommands**

- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
