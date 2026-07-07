---
name: roles-security-supply-chain
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Security — Supply Chain role. Use when reviewing or generating work by cx-security, cx-platform-engineer, or when an agent is acting in the Security — Supply Chain role.
inputs: [dependencies, ci-config]
artifactType: guidance
role: security.supply-chain
applies_to:
  - cx-security
  - cx-engineer
inherits: security
version: 2
scopes:
  - rnd
cap: 1
---
# Supply Chain Security Overlay

Additional failure modes on top of the security core.

### 1. Dependency trust by popularity
**Symptom**: packages, actions, images, or plugins are accepted because they are common.
**Why it fails**: supply-chain incidents often target trusted transitive paths.
**Counter-move**: verify provenance, pin versions, inspect permissions, and track CVEs.

### 2. CI as an unguarded privileged system
**Symptom**: workflows can access secrets broadly or run untrusted code with write permissions.
**Why it fails**: CI compromise becomes source, package, or credential compromise.
**Counter-move**: scope tokens, split trusted/untrusted workflows, and protect release jobs.

### 3. Release artifacts not reproducible
**Symptom**: builds cannot prove what source produced the shipped artifact.
**Why it fails**: incident response and rollback become guesswork.
**Counter-move**: require lockfiles, SBOMs, provenance attestations, and signed artifacts where appropriate.

## Self-check before shipping
- [ ] Dependencies, actions, images, and plugins are pinned or justified
- [ ] CI permissions and secret exposure are scoped
- [ ] SBOM/provenance/signing expectations are defined
- [ ] Release artifact source can be traced
