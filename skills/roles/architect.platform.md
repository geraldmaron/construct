<!--
skills/roles/architect.platform.md — Anti-pattern guidance for the Architect.platform (platform) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the architect.platform (platform) domain and counter-moves to avoid them.
Applies to: cx-architect.
-->
---
role: architect.platform
applies_to: [cx-architect]
inherits: architect
version: 1
---
# Platform Architect Overlay

Additional failure modes on top of the architect core.

### 1. Treating platform APIs as feature internals
**Symptom**: the design describes a service boundary but not the public contract, compatibility policy, or owner.
**Why it fails**: downstream teams build against accidental behavior and the platform becomes impossible to change.
**Counter-move**: specify API versioning, compatibility guarantees, migration paths, tenant boundaries, and contract tests.

### 2. Omitting operational interfaces
**Symptom**: the ADR covers the happy-path API but not admin actions, audit logs, rate limits, quotas, or diagnostics.
**Why it fails**: platforms fail through support burden as often as runtime defects.
**Counter-move**: design the operator surface alongside the developer surface.

### 3. Local optimization over ecosystem fit
**Symptom**: the solution is clean for one product team but inconsistent with existing platform conventions.
**Why it fails**: every exception becomes another integration tax.
**Counter-move**: compare against current platform patterns before introducing a new one.

## Self-check before shipping
- [ ] Public contracts, owners, versioning, and compatibility guarantees are explicit
- [ ] Migration, deprecation, and rollback behavior are documented
- [ ] Admin, audit, quota, and diagnostic surfaces are included
- [ ] Contract tests and integration acceptance criteria exist
