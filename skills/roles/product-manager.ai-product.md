<!--
skills/roles/product-manager.ai-product.md — Anti-pattern guidance for the Product-manager.ai-product (ai product) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the product-manager.ai-product (ai product) domain and counter-moves to avoid them.
Applies to: cx-product-manager.
-->
---
role: product-manager.ai-product
applies_to: [cx-product-manager]
inherits: product-manager
version: 1
---
# AI Product PM Overlay

Additional failure modes on top of the product-manager core.

### 1. Demo behavior mistaken for product behavior
**Symptom**: the PRD describes the happy-path model output but not variance, refusal, hallucination, or tool failure.
**Why it fails**: AI products fail at the distribution edges, not in the demo prompt.
**Counter-move**: define expected behavior, unacceptable behavior, fallback behavior, and review thresholds.

### 2. No evaluation loop
**Symptom**: quality is described subjectively, with no dataset, rubric, trace, or regression check.
**Why it fails**: model and prompt changes silently alter product behavior.
**Counter-move**: require eval fixtures, scoring criteria, trace capture, and promotion gates.

### 3. Human trust treated as UI copy
**Symptom**: the PRD says users should trust the system but does not define evidence, citations, control, or correction paths.
**Why it fails**: users need to understand when to rely on the system and how to recover when it is wrong.
**Counter-move**: specify grounding, explainability, review controls, feedback capture, and correction workflows.

## Self-check before shipping
- [ ] Expected, unacceptable, and fallback behaviors are defined
- [ ] Evaluation dataset, rubric, and promotion gate are specified
- [ ] Traceability and correction paths are product requirements
- [ ] Human review boundaries are explicit
