---
name: compliance-data-privacy
description: Use this skill when reviewing data collection, storage, processing, or retention for privacy regulation compliance.
inputs: [data-flow, artifact]
artifactType: privacy-assessment
---
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

These are orientation pointers, not load-bearing cites. Before asserting an article number, retention deadline, or “we are compliant” claim in an artifact, verify against primary text or mark `[unverified]` with counsel owner. See `rules/common/no-fabrication.md` and `skills/compliance/case-law-research.md` for precedent.

- **GDPR**: EU residents. Consent must be freely given, specific, informed, unambiguous. Right to erasure is absolute for consent-based processing.
- **CCPA/CPRA**: California residents. Right to know, delete, opt-out of sale/sharing. 12-month lookback on data collection.
- **LGPD**: Brazil. Similar to GDPR. Requires a DPO and legal basis for processing.
- **PIPEDA**: Canada. Consent required for collection, use, and disclosure. Reasonable purpose test applies.

## Anti-fabrication

- Do not invent statute articles, DPA clauses, or supervisory-authority guidance URLs.
- Do not assert “GDPR compliant” / “privacy approved” without named counsel + dated evidence.
- Retention periods, lawful bases, and transfer mechanisms are `unknown` until sourced.
- Prefer `templates/docs/compliance-memo.md` / `dpia-or-privacy-assessment.md` for structured obligation→control work.

## Authorship / voice

Before drafting typed privacy/compliance artifacts, call `get_skill("docs/artifact-authorship")` and follow `rules/common/human-voice.md` (contractions in prose; no em-dash theater; no LLM tells). Keep legal `shall` / `must not` and quoted statute wording exact.
