---
type: compliance-signal
forwarded_by: head-of-sales
created: 2026-05-24
---

# Two enterprise prospects asking for EU AI Act compliance posture

Two prospects in our pipeline (both EU-headquartered, both targeting Q3 close) sent compliance questionnaires asking specifically about EU AI Act readiness. Both questionnaires reference Article 9 (risk management) and Article 13 (transparency obligations for high-risk AI systems).

## What we know

- We have not published an EU AI Act compliance statement.
- Our SDK is classified `[unverified]` under the Act — depends on customer use case. Our position should be: AgenticHQ is a general-purpose AI provider; customer apps may be high-risk depending on deployment, and customers are responsible for their own compliance.
- We have basic audit logging (`traces.agent_runs`) but it predates Article 12 (record-keeping) requirements; need legal review of whether our audit format satisfies.

## Open questions

- Is our position (general-purpose provider, customer-responsible) defensible under the Act?
- Do we need to produce a compliance memo for sales to send to these two prospects?
- Are our existing audit logs sufficient as "records of operation"?

## Recommended next step

cx-legal-compliance: review the Act sections cited and produce a memo we can include in sales responses. Memo should cite article numbers and our position with rationale. Sales is asking for turnaround inside 2 weeks (Q3 close pressure).
