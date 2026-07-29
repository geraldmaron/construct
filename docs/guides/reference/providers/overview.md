<!--
docs/guides/reference/providers/overview.md: Capability matrix and plugin model for Construct data-source providers.

Covers the five built-in providers and how to add custom providers via the plugin contract.
-->

# Providers Overview

Providers connect Construct to external systems: GitHub, Jira, Confluence, Slack, Salesforce, and any custom source you add. They are stateless adapters: credentials flow in from environment variables, query results flow out as plain objects.

## Capability matrix

| Provider | read | search | watch | write | webhook |
|---|:---:|:---:|:---:|:---:|:---:|
| GitHub | yes | yes | — | — | yes |
| Atlassian Jira | yes | yes | — | — | — |
| Atlassian Confluence | yes | yes | — | — | — |
| Slack | yes | yes | — | — | — |
| Salesforce | yes | yes | — | — | — |

> **Note:** This matrix covers the read/search data-source providers under `lib/providers/<name>/`. `write` is implemented separately by the governed-write contract adapters under `lib/providers/contract/adapters/` (GitHub, Jira, Confluence only — construct-9oi4.10), reached through the `provider_write` MCP tool, not through the providers in this matrix. `watch` is not implemented for any provider in either layer — a prior version of this note claimed a Slack contract adapter under `lib/providers/contract/adapters/slack/` implemented `write`/`watch`, but that adapter (and a sibling `git` adapter) had zero production importers and no governed-write wiring; both were removed as dead code (construct-u5lv). `webhook` (this matrix) is supported by GitHub only.

Capability definitions:

| Capability | What it means |
|---|---|
| `read` | Fetch a single named resource (issue, page, repo, record) |
| `search` | Query by keyword or structured expression (JQL, CQL, SOQL) |
| `watch` | Subscribe to a real-time event stream (not implemented in this matrix's providers or the governed-write contract adapters) |
| `write` | Create or update a resource (not implemented in this matrix's providers; implemented for GitHub/Jira/Confluence only through the governed-write contract adapters — construct-9oi4.10) |
| `webhook` | Verify and acknowledge an inbound webhook payload |

## List active providers

```bash
construct provider list
```

Prints each provider's id, display name, capabilities, and health status.

## Test a provider connection

```bash
construct provider test github
construct provider test atlassian-jira
```

Calls the provider's `health()` method and prints the result. Useful for confirming credentials are set correctly.

## Plugin model

You can extend Construct with custom providers (internal systems, third-party APIs, or alternate integrations) without modifying Construct's source code.

A provider is an npm package (or a local `.mjs` file) that exports a `create` factory conforming to the contract. See [docs/providers/authoring.md](authoring.md) for the full spec.

### Register a plugin

Add the provider to `~/.config/construct/providers.json` for all projects, or to `.construct/providers.json` for a single project:

```json
{
  "providers": [
    {
      "id": "my-internal-api",
      "package": "@my-org/construct-provider-internal",
      "options": {}
    }
  ]
}
```

Alternatively, reference a local file:

```json
{
  "providers": [
    {
      "id": "my-internal-api",
      "package": "./providers/internal-api.mjs",
      "options": {}
    }
  ]
}
```

Resolution order when multiple entries declare the same id: project `.construct/providers.json` wins over global `~/.config/construct/providers.json`, which wins over built-in.

### Validate plugins

```bash
construct plugin validate
```

Loads every discovered plugin manifest and checks the contract. Reports missing fields, undeclared capabilities, and type errors before they surface at runtime.

## Circuit breaker

Every provider method (`read`, `search`, `watch`, `write`, `webhook`) is wrapped with a per-provider circuit breaker. After 5 consecutive failures the breaker opens and requests fail immediately for a 30-second cooldown window. This prevents a downed remote system from blocking agent turns.

The `health()` method is not wrapped: it is the probe operators use to inspect breaker state.
