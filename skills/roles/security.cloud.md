---
name: roles-security-cloud
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Security — Cloud role. Use when reviewing or generating work by cx-security, or when an agent is acting in the Security — Cloud role.
inputs: [cloud-config, iam-policy]
artifactType: guidance
role: security.cloud
applies_to:
  - cx-security
inherits: security
version: 2
profiles:
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

## Self-check before shipping
- [ ] IAM is least-privilege and scoped by workload
- [ ] Public access, encryption, network policy, and secrets are checked
- [ ] Audit logs and drift detection exist
- [ ] Blast radius is explicit
