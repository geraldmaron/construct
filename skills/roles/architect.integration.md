<!--
skills/roles/architect.integration.md — Anti-pattern guidance for the Architect.integration (integration) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the architect.integration (integration) domain and counter-moves to avoid them.
Applies to: cx-architect.
-->
---
role: architect.integration
applies_to: [cx-architect]
inherits: architect
version: 1
---
# Integration Architect Overlay

Additional failure modes on top of the architect core.

### 1. Designing only the successful exchange
**Symptom**: the sequence diagram stops after a 200 response.
**Why it fails**: real integrations fail through retries, partial writes, timeouts, duplicate deliveries, and stale credentials.
**Counter-move**: document idempotency keys, retry/backoff policy, dead-letter paths, and reconciliation flows.

### 2. Unclear source of truth
**Symptom**: two systems can update the same entity without conflict rules.
**Why it fails**: data divergence becomes a support problem that cannot be diagnosed from logs.
**Counter-move**: name the system of record, conflict strategy, sync direction, and repair workflow.

### 3. Credentials as an implementation detail
**Symptom**: auth setup, rotation, scopes, and revocation are left to engineering.
**Why it fails**: integrations become fragile and over-privileged.
**Counter-move**: define credential lifecycle, least-privilege scopes, secret storage, and audit events.

## Self-check before shipping
- [ ] Failure modes include retries, duplicates, partial failure, and reconciliation
- [ ] System of record and conflict resolution are explicit
- [ ] Credential lifecycle and scopes are designed
- [ ] Observability covers cross-system correlation IDs
