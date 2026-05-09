<!--
skills/roles/architect.enterprise.md — Anti-pattern guidance for the Architect.enterprise (enterprise) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the architect.enterprise (enterprise) domain and counter-moves to avoid them.
Applies to: cx-architect.
-->
---
role: architect.enterprise
applies_to: [cx-architect]
inherits: architect
version: 1
---
# Enterprise Architect Overlay

Additional failure modes on top of the architect core.

### 1. Enterprise controls bolted on late
**Symptom**: SSO, RBAC, audit, retention, and tenant isolation are listed as future work.
**Why it fails**: enterprise controls change data models, APIs, and operational workflows.
**Counter-move**: include identity, access, audit, retention, and tenancy in the first architecture pass.

### 2. Procurement requirements treated as non-technical
**Symptom**: compliance evidence, data residency, SLAs, and admin reporting are not reflected in system design.
**Why it fails**: sales commitments become engineering emergencies.
**Counter-move**: translate procurement and compliance needs into explicit technical contracts.

### 3. Single-tenant assumptions hidden in code
**Symptom**: tenant IDs, limits, and isolation rules are missing from interfaces.
**Why it fails**: retrofitting tenancy after launch creates security and migration risk.
**Counter-move**: make tenant context, authorization, quotas, and isolation visible at every boundary.

## Self-check before shipping
- [ ] SSO, RBAC, audit, retention, and tenant isolation are designed
- [ ] Data residency, SLA, and evidence requirements are translated into system contracts
- [ ] Tenant context and authorization are visible in interfaces
- [ ] Admin reporting and support diagnostics are included
