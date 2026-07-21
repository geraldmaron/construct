# DPIA / privacy assessment: {title}

- **Date**: {YYYY-MM-DD}
- **Author**: security.privacy (cx-security overlay)
- **Status**: draft | privacy-review | counsel-review | accepted | rejected
- **Related artifacts**: {PRD / ADR / RFC / compliance-memo}
- **Not legal advice**: Lawful basis and DPIA necessity are counsel judgments. Mark `[unverified]` until counsel confirms.

<!--
Owning specialist: security.privacy. Escalate to security.legal-compliance when
lawful basis, DPIA necessity, or cross-border transfer is unclear.
Before drafting: get_skill("compliance/data-privacy")
  + get_skill("perspectives/security.privacy").
-->

## Purpose of processing

{Why this processing exists. Link to product outcome — not “because we can.”}

## Data map

| Data element | Category | Source | Retention | Stored where | Shared with |
|---|---|---|---|---|---|
| {email / content / …} | PII / sensitive / other | {user / system} | {period or unknown} | {system} | {parties or none} |

## Necessity and proportionality

| Question | Answer | Evidence |
|---|---|---|
| Is the purpose specific and explicit? | yes / no / unknown | {…} |
| Is data minimized to that purpose? | yes / no / unknown | {…} |
| Can the outcome be achieved with less data? | yes / no / unknown | {…} |

## Risks to individuals

| Risk | Likelihood | Impact | Affected subjects | Mitigation |
|---|---|---|---|---|
| {unauthorized access / oversharing / …} | low / med / high | low / med / high | {who} | {control} |

## Lawful basis (counsel)

| Processing | Proposed basis | Counsel status | Source |
|---|---|---|---|
| {activity} | {consent / contract / legitimate interest / …} | `[unverified]` until counsel | {or unknown} |

## Cross-border / subprocessors

| Transfer / processor | Mechanism | Status | Source |
|---|---|---|---|
| {vendor or region} | {SCC / adequacy / unknown} | `[unverified]` | {…} |

## Deletion and subject rights

| Right / duty | Supported? | How verified | Gap owner |
|---|---|---|---|
| Access / export | yes / no / unknown | {test or unknown} | {name} |
| Deletion / erasure | yes / no / unknown | {test or unknown} | {name} |
| Retention enforcement | yes / no / unknown | {job / policy} | {name} |

## Decision and residual risk

| Field | Value |
|---|---|
| DPIA required? | yes / no / unknown — counsel |
| Ship blocked? | yes / no |
| Residual risk accepted by | {name or unknown} |
| Follow-up | {compliance-memo / engineering beads} |

## References

- {PRD / threat model / retention policy}
- {primary privacy regulation text + access date}
