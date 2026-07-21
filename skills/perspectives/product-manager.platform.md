---
name: perspectives-product-manager-platform
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [prd, api-spec]
artifactType: guidance
perspective: product-manager.platform
applies_to:
  - product-manager
inherits: product-manager
version: 2
scopes:
  - rnd
cap: 1
---
# Platform PM Overlay

Additional failure modes on top of the product-manager core.

### 1. Treating developers as one persona
**Symptom**: "developer" is used as the user for APIs, SDKs, admin surfaces, and operational workflows.
**Why it fails**: platform builders, application developers, security admins, and operators have different incentives and failure modes.
**Counter-move**: name the platform actor precisely and describe the system boundary they own.

### 2. Contract changes without migration
**Symptom**: the PRD introduces API, schema, permission, or configuration changes without compatibility and migration requirements.
**Why it fails**: platform work breaks downstream systems even when the feature itself works.
**Counter-move**: include versioning, backwards compatibility, rollout, migration, and deprecation behavior.

### 3. Operational burden omitted
**Symptom**: requirements describe setup but not monitoring, failure recovery, supportability, or admin controls.
**Why it fails**: platform capabilities become toil generators after launch.
**Counter-move**: add observability, auditability, rate limits, fallback behavior, and support diagnostics as product requirements.



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **product-manager.platform**.

### Framing
Internal developer/operator audience; decision is adopt/migrate/keep.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
Does this create a platform tax without a measured adopter benefit?

### Anti-fabrication
No invented adoption counts or API call volumes.

### Cross-persona handoffs
Ops + security for multi-tenant or shared-service changes.

### Human voice
Follow `rules/common/human-voice.md` and the Human voice bar in `skills/docs/artifact-authorship.md`: prefer contractions; avoid spaced em dashes; refuse LLM tells; careful colleague tone. Exceptions: ACs, legal shall/must, quotes, exact section titles.

### Self-check (authorship)
- [ ] Framing questions answered
- [ ] Template sections populated or explicitly unknown
- [ ] Triggered specialists consulted or queued with dates
- [ ] Strongest counter-argument named
- [ ] No unsourced load-bearing claims
- [ ] Human voice bar met (contractions; no em-dash theater; no AI tells)

## Self-check before shipping
- [ ] Platform actor and owned boundary are explicit
- [ ] Compatibility, migration, and deprecation are covered
- [ ] Admin, audit, observability, and failure recovery requirements exist
- [ ] Integration contracts are testable
