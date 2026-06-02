---
title: Work
description: Work commands for Construct.
---

# Work

| Command | What it does |
|---|---|
| `construct ask` | One-shot ask against the active knowledge index |
| `construct bootstrap` | Import seed observation corpus into local memory store for cold-start acceleration |
| `construct customer` | Manage customer profiles for product intelligence |
| `construct distill` | Distill documents with query-focused chunking |
| `construct drop` | Ingest file from Downloads/Desktop |
| `construct graph` | Task graph management |
| `construct handoffs` | List and inspect session handoff files in .cx/handoffs/ |
| `construct headhunt` | Create domain expertise overlays |
| `construct infer` | Infer schema from documents |
| `construct ingest` | Convert documents to indexed markdown |
| `construct integrations` | Check and manage external system connections |
| `construct knowledge` | Query, index, or add to the project knowledge base |
| `construct memory` | Inspect memory layer |
| `construct reflect` | Capture improvement feedback from chat session and update Construct core |
| `construct search` | Hybrid search across project state |
| `construct storage` | Manage storage backend |
| `construct tags` | Manage the controlled tag vocabulary (propose, add, deprecate, audit) |
| `construct team` | Team review and template listing |
| `construct wireframe` | Generate wireframes from description |
| `construct workflow` | Instantiate workflow templates (PRD-to-review chains, onboarding, handoffs) |
| `construct workspace` | Manage PM workspaces for multi-PM signal routing |

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

- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`

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

## construct graph

Task graph management

**Usage**

```bash
construct graph <show|update>
```

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
construct ingest <file> [--strict] [--legacy-extractor]
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
construct memory <status|search>
```

## construct reflect

Capture improvement feedback from chat session and update Construct core

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

Team review and template listing

**Usage**

```bash
construct team <list|review>
```

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
construct workflow <list|show|new>
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
