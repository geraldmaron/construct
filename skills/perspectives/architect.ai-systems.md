---
name: perspectives-architect-ai-systems
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [architecture-design, adr]
artifactType: perspective-guidance
perspective: architect.ai-systems
applies_to:
  - architect
inherits: architect
version: 2
scopes:
  - rnd
cap: 1
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



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **architect.ai-systems**.

### Framing
Eval harness, retrieval/trust boundaries, human oversight.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
Prompt injection and data exfil paths.

### Anti-fabrication
No invented model accuracy.

### Cross-persona handoffs
security.ai + privacy.

### Self-check (authorship)
- [ ] Framing questions answered
- [ ] Template sections populated or explicitly unknown
- [ ] Triggered specialists consulted or queued with dates
- [ ] Strongest counter-argument named
- [ ] No unsourced load-bearing claims

## Self-check before shipping
- [ ] Model output schemas and validation paths are explicit
- [ ] Retrieval has provenance, freshness, ACL, and re-indexing rules
- [ ] Human review and fallback boundaries are named
- [ ] Evals and promotion gates are architecture requirements
