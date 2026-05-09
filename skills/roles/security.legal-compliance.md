<!--
skills/roles/security.legal-compliance.md — Anti-pattern guidance for the Security.legal-compliance (legal compliance) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the security.legal-compliance (legal compliance) domain and counter-moves to avoid them.
Applies to: cx-legal-compliance.
-->
---
role: security.legal-compliance
applies_to: [cx-legal-compliance]
inherits: security
version: 1
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

## Self-check before shipping
- [ ] Policies map to testable controls
- [ ] Retention enforced by automated deletion
- [ ] Consent granular, opt-in, withdrawable
- [ ] AI use disclosed in-product and in policy
- [ ] Dependency licenses scanned and allowlisted
