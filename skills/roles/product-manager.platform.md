<!--
skills/roles/product-manager.platform.md — Anti-pattern guidance for the Product-manager.platform (platform) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the product-manager.platform (platform) domain and counter-moves to avoid them.
Applies to: cx-product-manager.
-->
---
role: product-manager.platform
applies_to: [cx-product-manager]
inherits: product-manager
version: 1
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

## Self-check before shipping
- [ ] Platform actor and owned boundary are explicit
- [ ] Compatibility, migration, and deprecation are covered
- [ ] Admin, audit, observability, and failure recovery requirements exist
- [ ] Integration contracts are testable
