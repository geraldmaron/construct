<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0056: LMCP-A6 — Policy, approval, and identity model

- **Date**: 2026-07-03
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner), Construct maintainers (cx-architect)
- **Relates to**: ADR-0025 (explicit activation model), ADR-0026 (beads git-native sync), ADR-0029 (install scopes and hook budgets), ADR-0039 (interaction surface model), ADR-0046 (modular org runtime merge)
- **Tracking**: LMCP-A6 (epic: Living Modular Control Plane)

## Problem

The current authority model has three structural defects that make it unfit for team
and enterprise deployment:

1. **Identity is a single env var.** `lib/mcp/server.mjs:1708` reads `CONSTRUCT_ROLE`
   from the environment and treats it as the entire actor identity. There is no tenant,
   no session, no service identity — one string that cannot be audited, cannot be
   revoked per session, and cannot distinguish human from automated actors.

2. **Policy defaults permissive.** `lib/policy/engine.mjs:56-62,189-194` allows any
   tool call that does not match an explicit deny rule. In team and enterprise contexts,
   permissive default means every tool is implicitly authorized until someone writes a
   deny rule — the wrong default for any multi-actor environment.

3. **Approvals are in-memory and lost on restart.** `lib/mcp/broker.mjs:28-33,110-111`
   throws `ApprovalRequired` and tracks rate limits in memory (`:61-71`). The durable
   approval infrastructure (`lib/embed/approval-queue.mjs`,
   `lib/roles/approval-surface.mjs`) exists but is not wired to the broker. A process
   restart loses every pending approval; operators cannot inspect, approve, or deny
   queued requests from outside the running process.

## Decision

### Identity

Two actor classes, each with a distinct identity record:

**Human actor:**
```jsonc
{
  "userId": "string",      // stable identifier (e.g. email or SSO subject)
  "tenantId": "string",    // org/workspace scope
  "sessionId": "string"    // ephemeral per-session token
}
```

**Service actor** (workers, daemons, automated pipelines):
```jsonc
{
  "serviceId": "string",       // stable service name
  "deploymentMode": "string",  // solo | team | enterprise
  "pid": "number"              // OS process id, for log correlation
}
```

Identity is propagated via MCP request context headers:

- `X-Construct-Actor-Id` — `userId` (human) or `serviceId` (service)
- `X-Construct-Tenant-Id` — `tenantId` (omitted in solo)
- `X-Construct-Session-Id` — `sessionId` (human only)

`CONSTRUCT_ROLE` is retained for **bootstrap only** in solo mode, where it sets a
default service actor identity and deployment mode for backward compatibility. In
team and enterprise mode, `CONSTRUCT_ROLE` alone is insufficient — a request
missing valid identity headers is rejected at the MCP boundary.

### Policy

**Deny-by-default in team and enterprise.** Every tool call requires an explicit
allow rule in the active policy. A call that matches no rule is denied with a structured
error naming the tool, the actor, and the missing rule.

**Permissive default preserved in solo.** Current behavior (`allow` when no deny
rule matches) is unchanged in solo mode to preserve backward compatibility for
single-user installs.

Policy rules live in two locations, merged at startup:

1. **Project policy** — `.cx/policy.json` (project-local, committed to the repo)
2. **User policy** — `~/.config/construct/policy.json` (user-local, not committed)

Project policy takes precedence over user policy for any rule conflict. The policy
engine reads the `deploymentMode` from the resolved identity to select the default
stance (deny-by-default vs. permissive). A policy file that omits `deploymentMode`
inherits from the runtime context.

Policy rule shape:

```jsonc
{
  "effect": "allow | deny",
  "principal": { "userId?": "...", "tenantId?": "...", "serviceId?": "..." },
  "action": "tool-id | *",
  "condition": {}    // optional: additional match conditions
}
```

### Approval state

Durable approval record schema:

```jsonc
{
  "approvalId": "string",
  "toolCall": {
    "tool": "string",
    "args": {},
    "surface": "string"
  },
  "requestedAt": "ISO8601",
  "requestedBy": {           // actor identity at request time
    "userId?": "string",
    "serviceId?": "string",
    "tenantId?": "string",
    "sessionId?": "string"
  },
  "tenantId": "string",
  "projectId": "string",
  "state": "awaiting | approved | denied | expired",
  "decidedAt": "ISO8601 | null",
  "decidedBy": {},           // actor identity of decider, or null
  "reason": "string | null",
  "resumeToken": "string"    // opaque token used to resume the blocked call
}
```

**Storage backend by deployment mode:**

- **Team / enterprise** — git-queue backend (per ADR-0026): approval records written
  as commits to the beads-managed queue, persisting across restarts and visible to
  all actors with repo access.
- **Solo** — in-process store (current behavior), retained for backward compat.

The broker (`lib/mcp/broker.mjs`) is wired to the durable queue backend in
team/enterprise mode. `ApprovalRequired` exceptions hydrate a full approval record
and write it to the queue before surfacing to the caller. Pending approvals survive
process restart and can be resolved by any authorized actor with queue access.

The existing `lib/embed/approval-queue.mjs` and `lib/roles/approval-surface.mjs` are
the implementation targets for this wiring; they are activated (not replaced) by this
decision.

### Audit

Every policy decision — allow, deny, approve, or defer — emits a structured audit
event:

```jsonc
{
  "eventId": "string",
  "timestamp": "ISO8601",
  "decision": "allow | deny | approve | defer",
  "actor": {},           // full actor identity record
  "tenantId": "string",
  "projectId": "string",
  "tool": "string",
  "target": "string",    // resource or surface targeted
  "riskLevel": "string", // from policy rule annotation
  "outcome": "string",   // success | failure | pending
  "correlationId": "string"
}
```

**Audit log storage:**

- **Project-local** — `.cx/audit/YYYY-MM-DD.jsonl` (append-only; one file per day).
  Written on every deployment mode. File is append-only; the runtime never truncates
  or rewrites existing audit lines.
- **Team / enterprise** — audit events are additionally shipped to a configured sink.
  Sink is declared in `.cx/policy.json` as `auditSink: { type: "file" | "remote", ... }`.
  Remote sink failure is logged but does not block the tool call (best-effort shipping).
  The local `.cx/audit/` file is always written regardless of sink configuration.

The policy engine is the sole emitter of audit events; callers do not emit audit events
independently. This ensures every decision is captured exactly once with consistent
schema.

## Rejected alternatives

- **Extend `CONSTRUCT_ROLE` with additional env vars (CONSTRUCT_USER_ID, etc.).**
  A set of env vars approximating the identity record. Rejected: env vars are not
  request-scoped (they are process-wide), cannot represent session boundaries,
  cannot be passed per-call in a multi-tenant MCP session, and cannot be revoked
  without killing the process.

- **JWT-based identity with a signing key.** Each actor receives a signed JWT;
  the policy engine verifies the signature. Rejected for the current phase: introduces
  a key management problem that is out of scope for LMCP-A6, and the MCP header
  propagation model delivers the required properties (tamper-evidence, session scope)
  without cryptographic signing at the transport layer. JWT is a valid evolution path
  for LMCP-J scope if cross-tenant or federated identity is required.

- **Keep in-memory approval store with a persistence hook.** Serialize the in-memory
  map to disk on SIGTERM. Rejected: not crash-safe (SIGKILL, OOM, and hardware events
  lose state), the serialization format is not inspectable by other tools, and it
  cannot support multi-actor approval workflows where the approver is a different
  process or machine.

- **Deny-by-default in solo mode as well.** Unify policy stance across all modes.
  Rejected: solo users rely on the current permissive behavior for local scripting and
  exploratory use; a breaking change here would require every solo user to write a
  policy file before any tool works. The mode-split preserves backward compat.

- **Audit log as a structured database (SQLite).** A queryable local DB instead of
  JSONL. Rejected for the current phase: JSONL is append-only (cannot be corrupted by
  a partial write), requires no schema migration, is inspectable with standard CLI tools,
  and is trivially shippable to remote sinks. A queryable layer can be added over the
  JSONL files without changing the write path.

## Consequences

- Team and enterprise deployments gain deny-by-default policy, durable approvals, and
  per-request actor identity; solo deployments are backward compatible.
- Pending approvals survive process restart in team/enterprise; operators can review
  and resolve them via the git queue without the originating process being alive.
- Every policy decision produces an append-only audit trail in `.cx/audit/`; audit
  records are available for compliance review without a separate logging pipeline.
- `CONSTRUCT_ROLE` is deprecated as an identity mechanism in team/enterprise; tooling
  that sets only `CONSTRUCT_ROLE` must be updated to pass identity headers before
  team/enterprise mode enforcement lands (LMCP-I1 scope).
- The policy engine becomes the required gatekeeper for all tool calls in
  team/enterprise; bypassing it (e.g. calling tools directly without an MCP session)
  produces no audit record and must be treated as an untrusted path.
- Remote audit sink failure is best-effort; operators who need guaranteed delivery must
  configure a local-to-remote relay outside Construct (e.g. log forwarding agent).

**Unblocks**: LMCP-I1, LMCP-I2, LMCP-I3, LMCP-I4, LMCP-I5, LMCP-I6, LMCP-H2, LMCP-H3, LMCP-J2, LMCP-J3, LMCP-J4, LMCP-J5, LMCP-J6
