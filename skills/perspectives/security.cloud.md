---
name: perspectives-security-cloud
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [cloud-config, iam-policy]
artifactType: guidance
perspective: security.cloud
applies_to:
  - security
inherits: security
version: 2
scopes:
  - rnd
cap: 1
---
# Cloud Security Overlay

Additional failure modes on top of the security core.

### 1. Overbroad identity
**Symptom**: services run with wildcard permissions, shared roles, or long-lived credentials.
**Why it fails**: one compromise becomes account-wide access.
**Counter-move**: require least privilege, workload identity, rotation, and clear blast-radius boundaries.

### 2. Public exposure by default
**Symptom**: buckets, queues, databases, dashboards, or admin endpoints rely on obscurity or network convention.
**Why it fails**: accidental public access is a common cloud breach path.
**Counter-move**: verify network policy, encryption, logging, and public access blocks.

### 3. No evidence trail
**Symptom**: security controls exist but cannot be demonstrated.
**Why it fails**: incidents and audits require evidence, not intent.
**Counter-move**: ensure audit logs, policy-as-code checks, and drift detection are present.



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **security.cloud**.

### Framing
Shared responsibility, identity, network, data at rest/in transit.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
Blast radius of a single compromised role.

### Anti-fabrication
No invented cloud config audit results.

### Cross-persona handoffs
operations for runtime ownership.

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
- [ ] IAM is least-privilege and scoped by workload
- [ ] Public access, encryption, network policy, and secrets are checked
- [ ] Audit logs and drift detection exist
- [ ] Blast radius is explicit
