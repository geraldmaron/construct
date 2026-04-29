---
cx_doc_id: 019dc8a0-0001-7000-a000-000000000003
created_at: 2026-04-29T00:00:00.000Z
updated_at: 2026-04-29T00:00:00.000Z
generator: construct/cx-architect
body_hash: sha256:placeholder
---

# ADR-0003: Transport-Agnostic Provider Interface

## Status

Accepted

## Context

Construct needs to integrate with external systems — project trackers (Jira, Linear), code hosts (GitHub, GitLab), messaging (Slack, Discord), knowledge bases (Confluence, Notion), and git repos. Each system exposes different APIs via different transports (REST, GraphQL, MCP, CLI, SDK, webhooks).

We need a single abstraction that lets core orchestration dispatch work to any external system without knowing the transport.

## Decision

Define a **provider interface** with a fixed capability matrix. Each provider implements a subset of capabilities and chooses its own transport. Core dispatches through the interface — it never imports transport-specific code.

### Capability matrix

| Capability | Signature | Description |
|---|---|---|
| `read(ref)` | `async read(ref: string, opts?) → Item[]` | Fetch items by reference (ID, path, query shorthand) |
| `write(item)` | `async write(item: object) → WriteResult` | Create or update an item in the external system |
| `search(query)` | `async search(query: string, opts?) → SearchResult[]` | Full-text or structured search |
| `watch(filter, cb)` | `watch(filter, callback) → Unsubscribe` | Poll or subscribe for changes; invoke callback on new items |
| `webhook(event)` | `async webhook(event: object) → void` | Process an inbound webhook event from the external system |

### Provider contract

```javascript
// providers/<name>/index.mjs
export default {
  name: 'github',
  capabilities: ['read', 'write', 'search', 'webhook'],

  async init(config) { /* auth setup, validate config */ },
  async read(ref, opts) { /* ... */ },
  async write(item) { /* ... */ },
  async search(query, opts) { /* ... */ },
  async webhook(event) { /* ... */ },
  // watch omitted — not supported by this provider
}
```

### Provider registry

Providers are registered in `.cx/providers.yaml`:

```yaml
providers:
  github:
    module: '@construct/provider-github'
    auth:
      token_env: GITHUB_TOKEN
    config:
      default_org: myorg

  jira:
    module: '@construct/provider-jira'
    transport: mcp           # hint, not enforced by core
    auth:
      token_env: JIRA_TOKEN
      base_url_env: JIRA_URL
```

### Key rules

1. **Providers are stateless adapters.** Durable state (observations, sessions, cached items) lives in core stores.
2. **Auth is per-provider**, configured via environment variables referenced in providers.yaml.
3. **Unsupported capabilities return a typed error** (`CapabilityNotSupported`), not undefined behavior.
4. **Core never imports transport code.** The provider directory is the boundary.
5. **Provider tests use a shared contract test harness** that validates any implementation against the interface.

### Provider lifecycle

```
init(config) → ready
  ↓
read / write / search / watch / webhook
  ↓
destroy() → cleanup (optional)
```

### Error model

```javascript
class ProviderError extends Error {
  constructor(message, { provider, capability, code, cause }) { ... }
}

// Subclasses:
// CapabilityNotSupported — provider doesn't implement this capability
// AuthError             — credentials missing or rejected
// RateLimitError        — rate limited, includes retryAfter
// NotFoundError         — referenced item doesn't exist
```

## Alternatives Rejected

1. **MCP-only providers** — Forces every external system through MCP, which not all support natively. Adds a translation layer where a direct REST/CLI call would be simpler.
2. **Per-system hardcoded integrations** — No shared interface means each integration is bespoke. Can't write contract tests, can't swap implementations, can't discover capabilities programmatically.
3. **Plugin marketplace model** — Over-engineered for the current stage. Providers are just directories with a known export shape.

## Consequences

- Every new external system integration follows the same pattern.
- Core can enumerate available capabilities at runtime (`provider.capabilities`).
- Contract tests validate any provider against the interface automatically.
- Transport choice is an implementation detail — switching from REST to MCP for a system is invisible to core.
- Providers directory may bring npm dependencies (unlike core, per ADR-0001).
