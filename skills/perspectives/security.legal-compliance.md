---
name: perspectives-security-legal-compliance
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [policy, task-context]
artifactType: guidance
perspective: security.legal-compliance
applies_to:
  - security
inherits: security
version: 2
scopes:
  - rnd
cap: 1
---
# Legal & Compliance Overlay

Additional failure modes on top of the security core.


### 1. Compliance theater
**Symptom**: producing policy documents to pass audit while the implementation doesn't match.
**Why it fails**: real incidents expose the gap; regulators and customers lose trust faster than they were gained.
**Counter-move**: each policy commitment maps to a testable control in the code or process. No control, no commitment.

### 2. Data retention without deletion
**Symptom**: a retention policy on paper; no automated purge job in production.
**Why it fails**: PII accumulates; GDPR/CCPA deletion requests can't be honored; breach blast radius grows.
**Counter-move**: implement retention as scheduled deletion at the storage layer. Test the purge quarterly.

### 3. Consent as checkbox
**Symptom**: a single pre-checked "I agree" that bundles analytics, marketing, and third-party sharing.
**Why it fails**: fails GDPR specificity requirements; CCPA opt-out obligations get buried.
**Counter-move**: granular consent per purpose; opt-in unchecked; withdrawal as easy as granting.

### 4. AI features without disclosure
**Symptom**: shipping an AI-powered feature without telling users their data trains or feeds a model.
**Why it fails**: growing disclosure obligations (EU AI Act, FTC guidance); trust loss if discovered later.
**Counter-move**: disclose AI use, data flow, and opt-out path in-product. Update privacy policy in the same change.

### 5. License drift in dependencies
**Symptom**: adding a GPL or AGPL dependency to a proprietary product without review.
**Why it fails**: contaminates the license of the whole product; costly to unwind later.
**Counter-move**: automated license scan in CI; allowlist policy per product tier.

## Methodology

**Map obligations to controls through a risk register, not a checklist.** For each regulation in scope (GDPR, CCPA, HIPAA, EU AI Act, …), enumerate the obligations, and for each record: the control that satisfies it, where that control lives in code or process, its owner, and the residual risk if it fails. An obligation with no mapped control is an open finding; a control with no test is compliance theater. This register is the bridge between legal text and the system — it is what lets you answer an auditor (or an incident) with evidence rather than prose.

**Frame risk in business terms.** Rate each gap by likelihood × impact, where impact spans regulatory penalty, contractual liability, and trust. This lets non-lawyers prioritize: a low-likelihood/high-penalty gap (a deletion path that exists but is untested) and a high-likelihood/low-penalty one demand different responses. Translate "the regulation says X" into "if we don't do X, the exposure is Y" so the trade-off is decidable by the people who own the budget.



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **security.legal-compliance**.

### Framing
Obligation → control → evidence map for in-scope regimes.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
Which commitment has no testable control?

### Anti-fabrication
Never invent legal advice or assert "we are compliant" without counsel/evidence.

### Cross-persona handoffs
Escalate to human counsel for novel legal questions; block ship on unsigned high-risk commitments.

### Self-check (authorship)
- [ ] Framing questions answered
- [ ] Template sections populated or explicitly unknown
- [ ] Triggered specialists consulted or queued with dates
- [ ] Strongest counter-argument named
- [ ] No unsourced load-bearing claims

## Self-check before shipping
- [ ] Each in-scope obligation maps to a control, owner, and residual-risk note in a register
- [ ] Gaps rated by likelihood × impact (penalty, liability, trust)
- [ ] Policies map to testable controls
- [ ] Retention enforced by automated deletion
- [ ] Consent granular, opt-in, withdrawable
- [ ] AI use disclosed in-product and in policy
- [ ] Dependency licenses scanned and allowlisted
