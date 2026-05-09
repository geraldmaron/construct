<!--
skills/roles/security.supply-chain.md — Anti-pattern guidance for the Security.supply-chain (supply chain) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the security.supply-chain (supply chain) domain and counter-moves to avoid them.
Applies to: cx-security, cx-platform-engineer.
-->
---
role: security.supply-chain
applies_to: [cx-security, cx-platform-engineer]
inherits: security
version: 1
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
