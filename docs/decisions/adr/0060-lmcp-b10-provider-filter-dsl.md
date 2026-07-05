<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0060: Provider filter DSL semantics + config placement — LMCP-B10

- **Date**: 2026-07-03
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner), Construct maintainers (cx-architect)
- **Relates to**: ADR-0052 (unified extension/provider manifest — `configSchema`), ADR-0053 (living graph — observation nodes), ADR-0056 (policy/approval/identity model)
- **Tracking**: LMCP-B10-DEC. Blocks LMCP-B11 (enforce filters at poll/read), LMCP-B12 (`construct provider add|configure`). Soft-blocks LMCP-B14, LMCP-P1-DEC (filter-block reference).

## Problem

Users cannot scope what a connected provider feeds Construct. Two facts from the current repo:

- `lib/providers/contract.mjs` defines `validateAllowlist()` plus a per-provider allowlist schema (`github → repoAllowlist/repoAllowGlob`, `atlassian-jira → projectAllowlist`, `atlassian-confluence → spaceAllowlist`, `slack → channelAllowlist`, `salesforce → objectAllowlist`). Grepping `lib/` for callers returns **zero** — the allowlist is dead code. Nothing enforces it during polling.
- There is no field-level filtering (assignee/status/priority/label/updated-since) anywhere except `lib/embed/providers/jira.mjs`, which supports `project`/`projects`/`jql`/`fields` per source. That is the only filtering precedent and it is Jira-specific.

Consequence: a connected Jira instance ingests everything the credential can see. A PM cannot say "only project ABC, only issues assigned to my team." Provider config errors surface silently at poll time (or not at all), not at configure time.

## Decision

Adopt a **portable normalized filter core with native-query passthrough as an escape hatch**, enforced provider-side when possible and plane-side always, configured in project scope and validated against the manifest `configSchema`.

### 1. Filter grammar

A provider filter block has two layers. The normalized layer is the portable contract every provider kind honors; the passthrough layer is an optional provider-native escape hatch.

```jsonc
{
  "scope": {                     // per-kind container allowlist (which containers are visible)
    "projects": ["ABC"],         // jira project keys / salesforce objects
    "repos": ["org/app"],        // github repos (exact)
    "repoGlob": ["org/*"],       // github repos (glob)
    "channels": ["C123"],        // slack channels
    "spaces": ["ENG"]            // confluence spaces
  },
  "predicates": {                // normalized field-level filter (portable core)
    "assignee": ["me", "team:platform"],
    "statusCategory": ["in-progress"],   // normalized: to-do | in-progress | done
    "priority": ["high", "highest"],
    "label": ["security"],
    "updatedSince": "P14D"       // ISO-8601 duration or absolute timestamp
  },
  "nativeQuery": "project = ABC AND sprint in openSprints()"  // optional passthrough
}
```

- **`scope`** replaces the dead `*Allowlist`/`*AllowGlob` fields in `contract.mjs` with one normalized container. The existing per-provider field names map onto `scope` keys; `validateAllowlist()` is rewritten to validate `scope` and is finally given callers (LMCP-B11).
- **`predicates`** is the **portable core**: a small, closed, normalized field-predicate set — `assignee`, `statusCategory`, `priority`, `label`, `updatedSince`. Normalized values (e.g. `statusCategory` ∈ {to-do, in-progress, done}) mean the same filter expresses identically across Jira, GitHub, Salesforce. This is the subset LMCP-B11 guarantees on every provider.
- **`nativeQuery`** is the **escape hatch**: when a provider has a richer native query language (Jira JQL, GitHub search syntax), the operator may pass it through verbatim. It is provider-specific and non-portable by construction. When both `predicates` and `nativeQuery` are present, `nativeQuery` is applied provider-side and `predicates` is applied as an additional plane-side AND — the effective filter is their conjunction, never their union (least privilege).

Rejected: a single new query DSL invented by Construct. It would duplicate JQL/GitHub-search poorly and force operators to learn a fourth dialect. The normalized subset + passthrough gives portability where it matters and full power where the provider already offers it.

### 2. Config placement

The filter block lives in **project scope**, not in the extension manifest.

- The **manifest** (ADR-0052 `configSchema`) declares *which* filter keys a provider kind accepts and their types — it is the schema, the shape contract. A Jira manifest's `configSchema` permits `scope.projects`, `predicates.*`, `nativeQuery`; a Slack manifest permits `scope.channels`, `predicates.label`/`updatedSince`, no `nativeQuery`.
- The **instance filter values** live in `.cx` project config, on the per-source record already present in `lib/embed/config.mjs` `sources[]` (which today carries `provider`, `refs`, `intervalMs`). A new `filter` field on each source holds the block above.
- At configure time (`construct provider add|configure`, LMCP-B12), the filter block is validated against the resolved manifest `configSchema`. **A filter that references a key the manifest does not permit is a configure-time error with the offending key named** — not a silent poll-time no-op.

Rationale: the schema is a property of the provider kind (ships with the manifest, same for everyone); the values are a property of the engagement (this project, this team's scope) and belong in the git-tracked `.cx` config where they are reviewable.

### 3. Enforcement point

Two-tier, defense-in-depth:

1. **Provider-side pushdown (preferred).** When the provider supports server-side filtering, the filter is compiled into the request: `scope` + `predicates` + `nativeQuery` → JQL for Jira, search qualifiers for GitHub, API query params elsewhere. Pushdown minimizes data transfer and blast radius.
2. **Plane-side post-fetch predicate (universal fallback).** After fetch, before any observation is created, the normalized `predicates` and `scope` are re-evaluated in-process. This is mandatory even when pushdown ran — it is the backstop for providers with no server-side filtering and the enforcement of the `predicates`-∧-`nativeQuery` conjunction.

**Invariant: a filtered-out item never becomes an observation.** The filter runs strictly before observation creation in the poll/read path (`lib/embed` poll loop), so a dropped item leaves no trace in the living graph (ADR-0053). Absence of pushdown degrades efficiency, never correctness.

### 4. Audit shape

Each poll records, in the poll's telemetry/trace record, a `filterApplied` block:

```jsonc
{
  "filterApplied": {
    "scope": { /* effective scope */ },
    "predicates": { /* effective predicates */ },
    "nativeQuery": "…",          // present only if passthrough used
    "pushdown": true,            // did provider-side pushdown run
    "fetched": 214,              // items returned by provider
    "admitted": 12               // items that passed the plane-side predicate
  }
}
```

`fetched` vs `admitted` makes over-broad credentials and mis-scoped filters visible: a large gap means the credential sees far more than the engagement needs. This block is the auditable record that the least-privilege intent was actually enforced.

## Filter block JSON schema stub

Ships at `lib/providers/filter-schema.mjs` (or `.json`), referenced by per-kind manifest `configSchema` via `$ref`:

```jsonc
{
  "$id": "construct:provider-filter",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "scope": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "projects":  { "type": "array", "items": { "type": "string" } },
        "repos":     { "type": "array", "items": { "type": "string" } },
        "repoGlob":  { "type": "array", "items": { "type": "string" } },
        "channels":  { "type": "array", "items": { "type": "string" } },
        "spaces":    { "type": "array", "items": { "type": "string" } }
      }
    },
    "predicates": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "assignee":       { "type": "array", "items": { "type": "string" } },
        "statusCategory": { "type": "array", "items": { "enum": ["to-do", "in-progress", "done"] } },
        "priority":       { "type": "array", "items": { "type": "string" } },
        "label":          { "type": "array", "items": { "type": "string" } },
        "updatedSince":   { "type": "string" }
      }
    },
    "nativeQuery": { "type": "string" }
  }
}
```

## Alternatives considered

- **Invent a Construct filter DSL** (uniform grammar across all providers). Rejected: reimplements JQL/GitHub-search worse and adds a dialect operators must learn; the normalized subset covers the common portable cases and passthrough covers the rest.
- **Filter values in the manifest.** Rejected: the manifest ships with the provider and is the same for every consumer; per-engagement scope belongs in reviewable `.cx` project config.
- **Plane-side filtering only** (no pushdown). Rejected on efficiency and blast radius — pulling an entire Jira instance to drop most of it in-process is wasteful and exposes data the engagement never needed to touch. Pushdown when available, plane-side always.
- **Keep the `*Allowlist` fields as-is and just add callers.** Rejected: they are container-only, cannot express field-level predicates, and are per-provider ad hoc. `scope` subsumes them under one normalized shape.

## Consequences

- `validateAllowlist()` in `lib/providers/contract.mjs` is rewritten to validate the `scope` block and is wired into the poll/read path — the dead code becomes live enforcement (LMCP-B11).
- A PM can scope a company Jira to one project and their team's issues; a filtered-out issue never enters the graph.
- Provider config errors (unknown filter key) surface at configure time with the key named (LMCP-B12), not silently at poll time.
- Every poll carries a `filterApplied` audit block; `fetched` vs `admitted` exposes over-broad credentials.
- LMCP-B11 (enforce filters at poll/read) and LMCP-B12 (`construct provider add|configure` with manifest-validated filter config) are unblocked. LMCP-B14 and LMCP-P1-DEC reference this filter block.
