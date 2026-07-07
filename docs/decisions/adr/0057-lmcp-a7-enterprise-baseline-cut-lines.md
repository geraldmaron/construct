<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0057: Enterprise baseline cut lines — LMCP-A7

- **Date**: 2026-07-03
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner), Construct maintainers (cx-architect)
- **Relates to**: ADR-0033 (platform capability registry), ADR-0056 (deny-by-default policy and audit schema)
- **Tracking**: LMCP-A7

## Problem

Enterprise capabilities are selectable by mode (`CONSTRUCT_MODE=enterprise`) but every capability in the enterprise tier is marked `not-implemented` in the runtime. Without explicit cut lines, agents and operators face two bad outcomes: they either silently operate in a degraded state they believe meets the enterprise baseline, or they block indefinitely waiting for capabilities that do not exist.

The evidence:

- `lib/mode-capabilities.mjs` — the enterprise capability set lists `tenant-isolation`, `rbac`, `isolated-workers`, `signed-mcp-allowlists`, and `mandatory-audit` all as `not-implemented`
- `CONSTRUCT_TENANT_ID` is defined in the config schema and referenced in `lib/intake/queue.mjs:46` but the value is never propagated into actor identity, audit records, or policy rules
- `construct status` and `construct doctor` do not distinguish between a capability that is active and one that is declared but not implemented — both appear identical in output
- No existing test exercises `mode=enterprise` with a capability assertion; the mode is reachable but unverified

The pattern is a silent fabrication hazard: a caller sets `mode=enterprise` expecting isolation guarantees and receives none, with no signal of the gap.

## Decision

A four-way partition of enterprise capabilities, with each partition having a distinct runtime and documentation contract:

### IMPLEMENT-NOW (in the LMCP follow-up branch)

These capabilities are close enough to implementable in the current codebase that deferral is unjustified:

- **Tenant field propagation** — `tenantId` (sourced from `CONSTRUCT_TENANT_ID`) is injected into actor identity objects, audit log records, and policy rule evaluation context. Every request that carries a tenant ID propagates it end-to-end. No tenant isolation (worker separation) is implied by this; propagation is data plumbing only.
- **Deny-by-default policy semantics** — per ADR-0056, the policy engine must default to deny when no matching rule exists. This is the foundational correctness requirement for any access-control claim.
- **Mandatory audit log** — per ADR-0056 audit schema, all policy decisions (allow and deny) and all capability invocations in enterprise mode are written to the audit log. The schema is defined; the wiring is the implementation gap.

### FAIL-CLOSED until built (`mode=enterprise` → hard error, not silent degradation)

These capabilities are architecturally non-trivial and cannot be approximated. Faking them is worse than refusing:

- **Tenant isolation** — separate worker processes scoped per tenant, with no cross-tenant memory or filesystem access. Not implementable as a thin shim; requires process-spawn changes and a resource governor. Until built, `mode=enterprise` with `tenant-isolation` requested returns an error: `"tenant-isolation is not yet implemented; mode=enterprise is not safe for multi-tenant deployment"`.
- **Isolated workers** — separate spawn per tenant request (one worker process per request, not pooled). Depends on the same process-spawn infrastructure as tenant isolation. Same fail-closed rule applies.

The runtime error for fail-closed capabilities must be surfaced at startup (during `construct doctor`) and at request time. It must not be a warning; it must be a hard error that prevents the request from proceeding.

### LATER (not this LMCP wave)

These capabilities are valid enterprise requirements but have no near-term implementation path and no customer-validated urgency:

- **Signed pack allowlists** — cryptographic verification of pack manifests before loading. Depends on a signing infrastructure (key management, manifest signing at publish time) that does not exist.
- **Remote MCP authorization** — OAuth2/OIDC authorization for remote MCP server connections. Requires a token exchange flow and per-server credential management beyond the current `secretEnvKeys` model.
- **RBAC** — role-based access control beyond the `CONSTRUCT_ROLE` environment variable. Requires a role definition schema, a role assignment mechanism, and integration with the policy engine that is itself still being built.

LATER capabilities are not fail-closed; they simply do not exist. They must not appear in `construct status` output or `construct doctor` capability lists as anything other than `"not yet available"`.

### NOT-ADVERTISED (remove from docs and status output until proven)

Any capability listed as `not-implemented` in `lib/mode-capabilities.mjs` that does not fall into IMPLEMENT-NOW or FAIL-CLOSED must be removed from all user-facing surfaces (`construct status`, `construct doctor`, documentation, README capability tables) until it is proven by runtime code, tests, and packaging.

"Proven" means: a test exercises the capability end-to-end in a consumer install (packed npm install, not just local run), and the capability produces the correct observable output (not a stub return value).

### `construct status` contract for enterprise mode

`construct status` when `mode=enterprise` must emit exactly four categories for each capability:

| Category | Meaning |
|----------|---------|
| `active` | Implemented, tested, and producing correct output |
| `fail-closed` | Not yet implemented; requests requiring it are rejected with a hard error |
| `later` | Planned but not in this release wave; no runtime effect |
| (absent) | Not advertised; removed from output |

The status output must never show a `not-implemented` capability as `active`. If the mode-capabilities map contains a capability with no category, it defaults to absent (not shown).

## Alternatives considered

- **Soft-warn on all not-implemented capabilities**: emit a warning at startup but allow the request to proceed. Rejected because it preserves the silent fabrication hazard — callers who do not read startup output believe they have the capability.

- **Block `mode=enterprise` entirely until all capabilities are implemented**: prevent mode selection until the full enterprise feature set is complete. Rejected because IMPLEMENT-NOW capabilities (tenant propagation, audit log, deny-by-default) are genuinely deliverable now and are valuable to operators even without full isolation.

- **Remove enterprise mode from the config schema**: treat enterprise as future-only. Rejected because `CONSTRUCT_TENANT_ID` and related env vars are already in operator-facing documentation; removing mode selection would be a breaking change for any early adopter.

## Consequences

- `lib/mode-capabilities.mjs` is updated to reflect the four-way partition for each enterprise capability.
- `lib/intake/queue.mjs` and actor identity construction are updated to propagate `tenantId` (IMPLEMENT-NOW).
- Startup and request-time code adds hard-error guards for FAIL-CLOSED capabilities when `mode=enterprise`.
- `construct status` output for enterprise mode is restructured to show only `active`, `fail-closed`, and `later` categories.
- Documentation and capability tables are pruned to NOT-ADVERTISED capabilities.
- Unblocks: LMCP-H1..H6 (enterprise hardening beads that depend on an accurate capability baseline).
