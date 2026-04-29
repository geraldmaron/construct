---
cx_doc_id: 0001-rfc-embed-yaml-schema
created_at: 2026-04-29T00:00:00.000Z
updated_at: 2026-04-29T00:00:00.000Z
generator: construct/artifact
status: accepted
---
# RFC-0001: Embed Mode YAML Configuration Schema

- **Date**: 2026-04-29
- **Author**: Construct·Architect
- **Status**: Accepted

## Summary

Define a structured YAML schema for configuring Construct's embed mode — the continuous monitoring loop that polls providers, produces snapshots, dispatches output, and queues approval requests. The schema must be human-readable, zero-dependency parseable, and support multi-source, multi-output configurations.

## Motivation

Embed mode needs a durable, file-backed configuration format that:
- Can be committed to a project repo alongside AGENTS.md and plan.md
- Is readable without external YAML libraries (zero-dep core constraint)
- Supports multiple provider sources, configurable polling intervals, multiple output targets, and approval rules per action pattern
- Can be validated at startup with clear error messages

The alternative — env vars or JSON — was rejected because YAML's block syntax is significantly more readable for nested multi-source configs, and the schema is narrow enough that a hand-rolled parser covers it without deps.

## Design

```yaml
version: 1

sources:
  - provider: git
    interval: 300        # seconds; omit for manual-only
    capabilities: [read, search]
  - provider: github
    interval: 600
    capabilities: [read, write]

output:
  - type: markdown
    path: .cx/snapshots/latest.md
  - type: slack
    channel: "#ops"
  - type: log

approval:
  rules:
    - pattern: "pr.*"
      require: human
      timeout: 3600
      fallback: reject
    - pattern: "issue.create"
      require: human
      timeout: 1800
      fallback: proceed
```

**Top-level keys:**
- `version` (required): Schema version, currently `1`
- `sources` (required): Array of provider source configs
  - `provider`: Name matching a registered provider
  - `interval`: Poll interval in seconds (omit to disable auto-polling)
  - `capabilities`: Subset of capabilities to invoke during snapshot
- `output` (required): Array of output target configs
  - `type`: `markdown` | `slack` | `log`
  - `path`: For markdown output
  - `channel`: For Slack output
- `approval.rules`: Array of approval rules
  - `pattern`: Glob-style string matched against action names (e.g. `pr.*`)
  - `require`: `human` | `auto`
  - `timeout`: Seconds before fallback triggers
  - `fallback`: `reject` | `proceed`

**Parser**: Hand-rolled in `lib/embed/config.mjs`. Handles string scalars, integer scalars, arrays of scalars, and nested objects to one level. Does not support anchors, aliases, or multi-document streams.

## Drawbacks

- Hand-rolled parser limits schema to simple structures — no inline flow sequences, no anchors
- Version field requires migration logic if schema evolves
- No JSON Schema validation — schema errors surface at runtime

## Alternatives

### JSON config
Rejected: less readable for multi-source configs; comments not supported; harder to diff in PRs.

### TOML config
Rejected: no zero-dep TOML parser worth embedding; less familiar to most developers than YAML.

### Full `js-yaml` dependency
Rejected: violates zero-dep core constraint (ADR-0001). Provider and dashboard layers may use js-yaml but core embed config cannot.

### Env vars only
Rejected: cannot express multi-source arrays or nested approval rules cleanly.

## Unresolved questions

- Should `interval` support cron expressions in a future version?
- Should `output.slack` support a `provider` reference instead of a hardcoded channel, to route through the registered Slack provider?
