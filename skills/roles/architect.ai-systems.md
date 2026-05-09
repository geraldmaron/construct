<!--
skills/roles/architect.ai-systems.md — Anti-pattern guidance for the Architect.ai-systems (ai systems) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the architect.ai-systems (ai systems) domain and counter-moves to avoid them.
Applies to: cx-architect.
-->
---
role: architect.ai-systems
applies_to: [cx-architect]
inherits: architect
version: 1
---
# AI Systems Architect Overlay

Additional failure modes on top of the architect core.

### 1. Model behavior as an implicit dependency
**Symptom**: the design depends on a model always following instructions or returning one exact shape.
**Why it fails**: model behavior changes across versions, providers, prompts, and context.
**Counter-move**: define output schemas, validation, retries, fallback behavior, and human review boundaries.

### 2. Retrieval without provenance
**Symptom**: vector search is treated as truth without source attribution, freshness, or permission boundaries.
**Why it fails**: stale or unauthorized context can become generated output.
**Counter-move**: design citation, freshness, access control, and re-indexing paths.

### 3. Evals postponed until after launch
**Symptom**: the ADR names model choice but not the evaluation gate.
**Why it fails**: quality becomes subjective and regressions become invisible.
**Counter-move**: require eval suites, golden traces, failure cases, and promotion criteria as part of the architecture.

## Self-check before shipping
- [ ] Model output schemas and validation paths are explicit
- [ ] Retrieval has provenance, freshness, ACL, and re-indexing rules
- [ ] Human review and fallback boundaries are named
- [ ] Evals and promotion gates are architecture requirements
