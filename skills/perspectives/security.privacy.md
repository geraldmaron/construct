---
name: perspectives-security-privacy
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [data-flow, task-context]
artifactType: guidance
perspective: security.privacy
applies_to:
  - security
inherits: security
version: 2
scopes:
  - rnd
cap: 1
---
# Privacy Security Overlay

Additional failure modes on top of the security core.

### 1. Data collection without minimization
**Symptom**: events, logs, prompts, or exports include fields because they might be useful later.
**Why it fails**: unnecessary data increases breach, compliance, and deletion risk.
**Counter-move**: require purpose, minimization, retention, deletion, and consent/legal basis for personal data.

### 2. PII hidden in operational paths
**Symptom**: support tools, traces, analytics, or embeddings store sensitive data outside primary databases.
**Why it fails**: privacy reviews often miss secondary stores.
**Counter-move**: inventory every store and transfer path, including telemetry and vector indexes.

### 3. Deletion impossible to prove
**Symptom**: user deletion removes primary records but not logs, caches, exports, or embeddings.
**Why it fails**: deletion obligations require complete lifecycle control.
**Counter-move**: define deletion propagation, retention exceptions, and evidence of completion.



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **security.privacy**.

### Framing
Data classes, purposes, retention, subject rights.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
Can we honor deletion and access requests end-to-end?

### Anti-fabrication
No invented DPIA conclusions.

### Cross-persona handoffs
legal-compliance when lawful basis or DPIA is unclear.

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
- [ ] Purpose, minimization, retention, and legal basis are explicit
- [ ] Telemetry, traces, exports, and embeddings are included in the data map
- [ ] Deletion and access requests have end-to-end handling
- [ ] Sensitive data is redacted before logs or prompts
