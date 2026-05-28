---
title: Integrations
description: Integrations commands for Construct.
---

# Integrations

| Command | What it does |
|---|---|
| `construct creds` | Manage provider credentials (set, rotate, revoke, list) |
| `construct ollama` | Manage local Ollama models |
| `construct providers` | Provider status, circuit-breaker reset, and resource discovery |

## construct creds

Manage provider credentials (set, rotate, revoke, list)

**Usage**

```bash
construct creds <list|set|rotate|revoke|test>
```

## construct ollama

Manage local Ollama models

**Usage**

```bash
construct ollama status|pull|test
```

## construct providers

Provider status, circuit-breaker reset, and resource discovery

**Usage**

```bash
construct providers <status|discover>
```
