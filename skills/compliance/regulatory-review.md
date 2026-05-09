<!--
skills/compliance/regulatory-review.md — Regulatory Review — Pre-ship compliance review checklist and process.

Use this skill when conducting a compliance review before shipping features that handle user data, financial transactions, AI decisions, or regulated content.
-->
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

- [ ] WCAG 2.1 AA compliance for public-facing surfaces
- [ ] Screen reader and keyboard navigation tested

## Review Process

1. **Inventory**: list all data types collected, stored, or processed by the feature
2. **Classify**: map each data type to a regulation (GDPR, CCPA, HIPAA, PCI-DSS, etc.)
3. **Gap analysis**: compare current implementation against regulatory requirements
4. **Remediation**: fix gaps before shipping, document accepted risks
5. **Evidence**: collect audit evidence (test results, screenshots, config exports)
6. **Sign-off**: document the reviewer, date, and scope of the review

## Common Compliance Gaps

- Terms of service not updated to reflect new data processing
- Cookie consent banner missing for new tracking mechanisms
- Data processing agreement not in place for new third-party vendor
- Privacy policy silent on AI processing activities
- Deletion endpoint that soft-deletes but never hard-deletes
- Backup retention that exceeds the documented data retention period
