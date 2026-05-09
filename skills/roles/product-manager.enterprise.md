<!--
skills/roles/product-manager.enterprise.md — Anti-pattern guidance for the Product-manager.enterprise (enterprise) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the product-manager.enterprise (enterprise) domain and counter-moves to avoid them.
Applies to: cx-product-manager.
-->
---
role: product-manager.enterprise
applies_to: [cx-product-manager]
inherits: product-manager
version: 1
---
# Enterprise PM Overlay

Additional failure modes on top of the product-manager core.

### 1. Buyer and user collapsed
**Symptom**: the same persona is treated as evaluator, buyer, admin, and daily user.
**Why it fails**: enterprise adoption fails when procurement, security, admin, and end-user needs diverge.
**Counter-move**: separate buyer, evaluator, admin, and practitioner requirements.

### 2. Approval path ignored
**Symptom**: the PRD explains why users want the feature but not what blocks the account from adopting it.
**Why it fails**: security review, compliance, data residency, procurement, and rollout controls can be the real product requirement.
**Counter-move**: include adoption blockers and the evidence needed to clear them.

### 3. Rollout treated as launch day
**Symptom**: requirements stop at feature availability.
**Why it fails**: enterprise customers need staged rollout, policy controls, audit logs, documentation, support, and reversibility.
**Counter-move**: specify rollout controls, admin defaults, auditability, enablement, and rollback behavior.

## Self-check before shipping
- [ ] Buyer, admin, evaluator, and user needs are separated
- [ ] Security, compliance, procurement, and rollout blockers are named
- [ ] Audit, policy, and rollback requirements are explicit
- [ ] Customer evidence maps to account-level adoption risk
