---
name: perspectives-security-ai
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [ai-system, task-context]
artifactType: guidance
perspective: security.ai
applies_to:
  - security
  - engineer
inherits: security
version: 2
scopes:
  - rnd
cap: 1
---
# AI Security Overlay

Additional failure modes on top of the security core.

### 1. Prompt injection treated as prompt quality
**Symptom**: hostile instructions in retrieved or user-provided content are handled by stronger wording.
**Why it fails**: model obedience is not a security boundary.
**Counter-move**: separate data from instructions, constrain tools, validate outputs, and deny unsafe actions by policy.

### 2. Tool access too broad
**Symptom**: the model can call tools unrelated to the current task or with unchecked arguments.
**Why it fails**: compromised context can trigger real side effects.
**Counter-move**: scope tools per task, validate schemas, and require approval for destructive or external actions.

### 3. Retrieval leaks data
**Symptom**: vector search ignores tenant, permission, retention, or sensitivity labels.
**Why it fails**: embeddings can bypass normal access-control paths.
**Counter-move**: enforce ACL-aware retrieval, source citation, redaction, and index freshness checks.



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **security.ai**.

### Framing
Model I/O trust, training data rights, eval abuse.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
Prompt injection, data leakage, unsafe tool use.

### Anti-fabrication
No invented red-team scores.

### Cross-persona handoffs
privacy + legal disclosure.

### Human voice
Follow `rules/common/human-voice.md` and the Human voice bar in `skills/docs/artifact-authorship.md`: prefer contractions; avoid spaced em dashes; refuse LLM tells; careful colleague tone. Exceptions: ACs, legal shall/must, quotes, exact section titles.

### Self-check (authorship)
- [ ] Framing questions answered
- [ ] Template sections populated or explicitly unknown
- [ ] Triggered specialists consulted or queued with dates
- [ ] Strongest counter-argument named
- [ ] No unsourced load-bearing claims
- [ ] Human voice bar met (contractions; no em-dash theater; no AI tells)

## Self-check before shipping
- [ ] Prompt injection paths are modeled
- [ ] Tool access is scoped and schema-validated
- [ ] Retrieval respects ACL, tenant, retention, and sensitivity boundaries
- [ ] Unsafe outputs have validation or human review
