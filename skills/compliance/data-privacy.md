<!--
skills/compliance/data-privacy.md — Data Privacy — GDPR, CCPA, and data protection compliance patterns.

Use this skill when reviewing data collection, storage, processing, or retention for privacy regulation compliance.
-->
# Data Privacy

Use this skill when reviewing data collection, storage, processing, or retention for privacy regulation compliance.

## Data Classification

| Category | Examples | Handling |
|----------|----------|----------|
| PII | Name, email, phone, address, IP | Encrypt at rest, minimize collection |
| Sensitive PII | SSN, financial data, health data, biometrics | Encrypt + access control + audit log |
| Pseudonymous | Hashed identifiers, device IDs, session tokens | Still personal data under GDPR |
| Anonymous | Aggregated statistics with k-anonymity | Generally exempt |

## Privacy by Design Checklist

- [ ] Data minimization: collect only what is necessary for the stated purpose
- [ ] Purpose limitation: document why each data field is collected
- [ ] Storage limitation: define retention periods and auto-deletion schedules
- [ ] Lawful basis: identify legal basis for each processing activity (consent, contract, legitimate interest)
- [ ] Data subject rights: implement access, rectification, erasure, portability, and objection endpoints
- [ ] Cross-border transfers: verify adequacy decisions or standard contractual clauses for international data flows
- [ ] Breach notification: document the process for 72-hour supervisory authority notification

## Code Review Triggers

Flag these patterns in code:

- Logging PII to stdout, application logs, or third-party analytics
- Storing PII in plain text without encryption
- Passing PII in URL query parameters
- Retaining data beyond the documented retention period
- Third-party SDK calls that transmit user data without documented DPA
- Cookie or tracking pixel placement without consent management
- Email addresses used as primary keys (makes deletion cascades hard)

## Regulation Quick Reference

- **GDPR**: EU residents. Consent must be freely given, specific, informed, unambiguous. Right to erasure is absolute for consent-based processing.
- **CCPA/CPRA**: California residents. Right to know, delete, opt-out of sale/sharing. 12-month lookback on data collection.
- **LGPD**: Brazil. Similar to GDPR. Requires a DPO and legal basis for processing.
- **PIPEDA**: Canada. Consent required for collection, use, and disclosure. Reasonable purpose test applies.
