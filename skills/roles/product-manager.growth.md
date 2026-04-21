<!--
skills/roles/product-manager.growth.md — Anti-pattern guidance for the Product-manager.growth (growth) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the product-manager.growth (growth) domain and counter-moves to avoid them.
Applies to: cx-product-manager, cx-business-strategist.
-->
---
role: product-manager.growth
applies_to: [cx-product-manager, cx-business-strategist]
inherits: product-manager
version: 1
---
# Growth PM Overlay

Additional failure modes on top of the product-manager core.

### 1. Metric movement without user value
**Symptom**: the doc optimizes activation, conversion, or engagement without proving the user is better off.
**Why it fails**: growth work can create short-term movement while eroding trust or retention.
**Counter-move**: pair each growth metric with the user value it must preserve.

### 2. Funnel step isolated from lifecycle
**Symptom**: requirements focus on one funnel step without considering acquisition source, user intent, activation quality, retention, or expansion.
**Why it fails**: local optimization shifts the problem downstream.
**Counter-move**: map the lifecycle and name the guardrail metrics.

### 3. Packaging assumptions hidden
**Symptom**: pricing, packaging, entitlement, and plan boundaries are left as "business decision later."
**Why it fails**: growth features often depend on the commercial motion.
**Counter-move**: state packaging assumptions and what evidence would change them.

## Self-check before shipping
- [ ] Growth metric is paired with user-value guardrail
- [ ] Lifecycle impact is mapped beyond the local funnel step
- [ ] Pricing, packaging, and entitlement assumptions are explicit
- [ ] Experiment design includes success and stop thresholds
