---
name: perspectives-architect-platform
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [platform-design, adr]
artifactType: perspective-guidance
perspective: architect.platform
applies_to:
  - architect
inherits: architect
version: 2
scopes:
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



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **architect.platform**.

### Framing
Contract and tenancy boundaries first.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
Does the platform leak tenant data or couple teams accidentally?

### Anti-fabrication
No fabricated SLO history.

### Cross-persona handoffs
security + operations required for shared platforms.

### Self-check (authorship)
- [ ] Framing questions answered
- [ ] Template sections populated or explicitly unknown
- [ ] Triggered specialists consulted or queued with dates
- [ ] Strongest counter-argument named
- [ ] No unsourced load-bearing claims

## Self-check before shipping
- [ ] Public contracts, owners, versioning, and compatibility guarantees are explicit
- [ ] Migration, deprecation, and rollback behavior are documented
- [ ] Admin, audit, quota, and diagnostic surfaces are included
- [ ] Contract tests and integration acceptance criteria exist
