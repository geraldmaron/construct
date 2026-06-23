---
title: Integrations
description: Integrations commands for Construct.
---

# Integrations

| Command | What it does |
|---|---|
| `construct creds` | Manage provider credentials (login, set, rotate, revoke, list, test) |
| `construct ollama` | Manage local Ollama models |
| `construct providers` | Provider status, circuit-breaker reset, and resource discovery |

## construct creds

Manage provider credentials (login, set, rotate, revoke, list, test)

**Usage**

```bash
construct creds <list|login|set|rotate|revoke|test>
```

## construct ollama

Manage local Ollama models

**Usage**

```bash
construct ollama <list|pull|run>
```

## construct providers

Provider status, circuit-breaker reset, and resource discovery

**Usage**

```bash
construct providers <status|discover>
```
