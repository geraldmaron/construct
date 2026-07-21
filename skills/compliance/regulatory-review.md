---
name: compliance-regulatory-review
description: Use this skill when conducting a compliance review before shipping features that handle user data, financial transactions, AI decisions, or regulated content.
inputs: [artifact, data-flow, dependency-manifest]
artifactType: compliance-review
---
# Regulatory Review

Use this skill when conducting a compliance review before shipping features that handle user data, financial transactions, AI decisions, or regulated content.

## Pre-Ship Compliance Checklist

### Data handling

- [ ] All personal data fields documented with purpose and legal basis
- [ ] Retention periods defined and enforced
- [ ] Encryption at rest and in transit for sensitive data
- [ ] Data subject rights endpoints implemented and tested
- [ ] Cross-border data transfer mechanisms in place

### Licensing

- [ ] Dependency license audit completed (no copyleft surprises)
- [ ] Third-party SDK terms reviewed for data sharing obligations
- [ ] Attribution requirements satisfied for open-source dependencies

### AI features

- [ ] AI disclosure in place for all AI-generated content
- [ ] High-risk AI decisions have human oversight mechanism
- [ ] Model version and prompt tracked for audit
- [ ] Bias testing completed for consequential decisions

### Security

- [ ] Authentication and authorization tested
- [ ] Input validation on all user-facing endpoints
- [ ] No hardcoded secrets in source code
- [ ] Security headers configured (CSP, HSTS, etc.)

### Accessibility

- [ ] WCAG 2.2 AA for public-facing surfaces (measure contrast; exercise keyboard + SR)
- [ ] Contractual Section 508 / EN 301 549 obligations identified or marked N/A
- [ ] Screen reader and keyboard navigation tested with evidence

## Artifact output

Prefer `templates/docs/compliance-memo.md` for the obligation→control register.
Prefer `templates/docs/dpia-or-privacy-assessment.md` when personal data processing is novel or high-risk.
When case law or reporter cites appear, run `skills/compliance/case-law-research.md` (CourtListener citation verify; never invent holdings).
Call `get_skill("docs/artifact-authorship")` before drafting; follow `rules/common/human-voice.md` for prose (keep legal shall/must and quoted statute exact).

## Review Process

1. **Inventory**: list all data types collected, stored, or processed by the feature
2. **Classify**: map each data type to a regulation (GDPR, CCPA, HIPAA, PCI-DSS, etc.) using **primary** regulation text
3. **Gap analysis**: compare current implementation against regulatory requirements
4. **Remediation**: fix gaps before shipping, document accepted risks in Remediation Plan
5. **Evidence**: collect audit evidence (test results, screenshots, config exports, verified cites)
6. **Sign-off**: document the reviewer, counsel gate, date, and scope — never claim “compliant” without counsel

## Common Compliance Gaps

- Terms of service not updated to reflect new data processing
- Cookie consent banner missing for new tracking mechanisms
- Data processing agreement not in place for new third-party vendor
- Privacy policy silent on AI processing activities
- Deletion endpoint that soft-deletes but never hard-deletes
- Backup retention that exceeds the documented data retention period
- Fabricated or unverified case-law citations in reviews
- Marketing claims (“GDPR compliant”, “enterprise-ready”) without counsel gate
