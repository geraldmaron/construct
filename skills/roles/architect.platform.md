---
name: roles-architect-platform
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Architect — Platform role. Use when reviewing or generating work by cx-architect, or when an agent is acting in the Architect — Platform role.
inputs: [platform-design, adr]
artifactType: role-guidance
role: architect.platform
applies_to:
  - cx-architect
inherits: architect
version: 2
profiles:
  - rnd
cap: 1
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
