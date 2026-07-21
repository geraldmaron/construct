---
name: perspectives-security-supply-chain
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [dependencies, ci-config]
artifactType: guidance
perspective: security.supply-chain
applies_to:
  - security
  - engineer
inherits: security
version: 2
scopes:
  - rnd
cap: 1
---
# Supply Chain Security Overlay

Additional failure modes on top of the security core.

### 1. Dependency trust by popularity
**Symptom**: packages, actions, images, or plugins are accepted because they are common.
**Why it fails**: supply-chain incidents often target trusted transitive paths.
**Counter-move**: verify provenance, pin versions, inspect permissions, and track CVEs.

### 2. CI as an unguarded privileged system
**Symptom**: workflows can access secrets broadly or run untrusted code with write permissions.
**Why it fails**: CI compromise becomes source, package, or credential compromise.
**Counter-move**: scope tokens, split trusted/untrusted workflows, and protect release jobs.

### 3. Release artifacts not reproducible
**Symptom**: builds cannot prove what source produced the shipped artifact.
**Why it fails**: incident response and rollback become guesswork.
**Counter-move**: require lockfiles, SBOMs, provenance attestations, and signed artifacts where appropriate.



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **security.supply-chain**.

### Framing
Dependency, build, and distribution trust.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
What can a malicious package or compromised CI do?

### Anti-fabrication
No invented SBOM findings.

### Cross-persona handoffs
legal for license risk.

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
- [ ] Dependencies, actions, images, and plugins are pinned or justified
- [ ] CI permissions and secret exposure are scoped
- [ ] SBOM/provenance/signing expectations are defined
- [ ] Release artifact source can be traced
