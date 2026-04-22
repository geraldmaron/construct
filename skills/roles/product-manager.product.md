<!--
skills/roles/product-manager.product.md — Anti-pattern guidance for the Product-manager.product (product) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the product-manager.product (product) domain and counter-moves to avoid them.
Applies to: cx-product-manager.
-->
---
role: product-manager.product
applies_to: [cx-product-manager]
inherits: product-manager
version: 1
---
# Product PM Overlay

Additional failure modes on top of the product-manager core.

### 1. Persona theater
**Symptom**: the document names a generic user such as "admin" or "customer" without describing the workflow, pressure, or context they are in.
**Why it fails**: generic personas cannot drive product tradeoffs; every stakeholder imagines a different user.
**Counter-move**: anchor the persona in a concrete job, trigger, current workaround, and success condition.

### 2. Workflow gaps hidden behind feature language
**Symptom**: requirements describe screens or features but skip the before, during, and after steps of the user journey.
**Why it fails**: engineering can ship the feature while the actual workflow still breaks at handoff points.
**Counter-move**: write the end-to-end user workflow and mark where the new capability changes behavior.

### 3. Adoption assumed
**Symptom**: success depends on users discovering, trusting, and repeatedly using the feature, but the PRD says nothing about adoption.
**Why it fails**: usable features still fail when activation, migration, onboarding, or trust are unresolved.
**Counter-move**: include the first-use path, repeat-use trigger, and measurable adoption signal.

## Self-check before shipping
- [ ] Persona includes workflow context, not just role title
- [ ] End-to-end user journey is explicit
- [ ] Adoption path and repeat-use trigger are named
- [ ] Success metric measures user outcome, not shipped scope
