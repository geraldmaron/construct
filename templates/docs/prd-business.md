# Business PRD: {title}

- **Date**: {YYYY-MM-DD}
- **Owner**: {name}
- **Status**: draft | in-review | approved | shipped | deprecated

<!--
Strategic bets, market positioning, business model changes, partnerships,
pricing, and make-vs-buy. This is NOT a feature spec.

Use prd.md for customer-facing product capabilities (12-section Phase→FR→AC).
Use prd-platform.md for internal platform / API / SDK consumers.
Use meta-prd.md for product operating-system / process requirements.

Owning specialist: product-manager (or business-strategist when recruited).
Before drafting: rules/common/framing.md + get_skill("docs/artifact-authorship")
  + get_skill("perspectives/product-manager").

NATIVE SPINE (do not invent parallel top-level headings):
  The bet → Market thesis → Problem and opportunity → Strategic goals
  → Alternatives rejected → What must be true → Competitive analysis
  → Make vs. buy vs. partner → Go-to-market implications → Financial frame
  → Kill criteria → Risks → Constraints → Open questions → References

Depth means: falsifiable bet, sourced market claims, kill criteria that can
actually stop the work, and adversarial FMEA under Risks. Prefer unknown /
[unverified] with owner + decision-by date over fabrication.
-->

## The bet

{One or two sentences: what we are committing to and why now. Must be falsifiable.}

| Field | Value |
|---|---|
| Commitment | {concrete bet} |
| Time box | {horizon or unknown} |
| Decision sought | {approve / kill / defer / reshape} |
| Owner | {name} |

## Market thesis

{One paragraph: market shape, buyer behavior, where value accrues. Every later decision links back here or challenges it.}

| Claim | Observation vs inference | Source |
|---|---|---|
| {market shape claim} | observation / inference | {URL+date / report / unknown} |
| {buyer behavior claim} | observation / inference | {…} |

## Problem and opportunity

{What is broken in the market or business today? What does the opportunity look like at full scale? Pain + size of prize with evidence.}

| Evidence source | Type | What it shows | Link / id |
|---|---|---|---|
| {interview / filing / ticket / research} | qualitative / quantitative | {claim} | {path or URL + access date} |
| {second independent source} | … | … | … |

If fewer than two sources exist, mark **research-required** and open a research task before locking the bet.

## Strategic goals

**Goals** (business outcomes, not activity; 3–5 max):

1. {Position / revenue / defensibility / optionality outcome}
2. {…}
3. {…}

**Non-goals** (protect focus):

| Non-goal | Why deferred |
|---|---|
| {explicitly out of scope} | {reason} |
| {adjacent follow-up} | {reason} |

## Alternatives rejected

No strawmen. For each credible path:

| Alternative | What it is | Why rejected | Reconsider if |
|---|---|---|---|
| {path A} | {concrete} | {specific reason + evidence} | {trigger} |
| {path B} | {…} | {…} | {…} |

## What must be true

Conditions that must hold for the bet to pay off. Make them monitorable.

| Assumption | Leading signal | Owner | Review by |
|---|---|---|---|
| {condition} | {observable metric or event} | {name} | {YYYY-MM-DD} |

## Competitive analysis

Business model lens (unit economics, distribution, defensibility). Not feature parity tables that ignore economics.

| Competitor / alternative | Business model | Distribution | Defensibility | Our stance | Source |
|---|---|---|---|---|---|
| {name or unknown} | {observed} | {…} | {…} | match / differentiate / defer | {URL+date or unknown} |

Do not invent market share or pricing. Prefer `unknown` / `[unverified]`.

## Make vs. buy vs. partner

| Option | Cost | Control | Speed | Strategic leverage | Decision |
|---|---|---|---|---|---|
| Build | {or unknown} | {…} | {…} | {…} | chosen / rejected |
| Buy | {…} | {…} | {…} | {…} | … |
| Partner | {…} | {…} | {…} | {…} | … |

If not applicable, write **N/A** with one sentence why.

## Go-to-market implications

{Pricing, packaging, channels, positioning. What motion this requires from sales, marketing, or customer success.}

| Motion | Change | Owner | Evidence |
|---|---|---|---|
| Pricing / packaging | {…} | {…} | {or unknown} |
| Channel | {…} | {…} | {…} |
| Positioning | {…} | {…} | {…} |

## Financial frame

Range of outcomes, not only the upside case. Refuse fabricated ROI.

| Item | Low | Base | High | Confidence | Source |
|---|---|---|---|---|---|
| Revenue model | unknown | unknown | unknown | low | [unverified] — owner: {name} by {YYYY-MM-DD} |
| Cost structure | unknown | unknown | unknown | low | [unverified] |
| Unit economics | unknown | unknown | unknown | low | [unverified] |

## Kill criteria

Without this, bad bets survive longer than they should.

| Leading indicator | Threshold | Action when crossed | Owner |
|---|---|---|---|
| {metric or signal} | {numeric or behavioral} | revisit / reshape / abandon | {name} |

## Risks

### Market, execution, and competitive risks

| Risk | Likelihood | Impact | Mitigation or accept-with-rationale |
|---|---|---|---|
| {risk} | low / med / high | low / med / high | {action} |

### Legal, privacy, and compliance triggers

Complete even if the requester never mentioned legal. Route fired rows to
`security.privacy` / `security.legal-compliance` before approval.

| Trigger | Present? | Specialist | Gate before ship |
|---|---|---|---|
| Payments / money movement | yes / no / unknown | security.legal-compliance | PCI/contract controls or N/A |
| Contracts / ToS / licenses | yes / no / unknown | security.legal-compliance | counsel or policy owner named |
| PII / accounts / identity | yes / no / unknown | security.privacy | retention + deletion path named |
| Export controls / regulated markets | yes / no / unknown | security.legal-compliance | counsel named |
| AI processing / model training | yes / no / unknown | security.ai + privacy | disclosure plan |

### Adversarial challenge (FMEA)

| Failure mode | Effect | Cause | S×O×D (1–10) | Mitigation or accept-with-rationale |
|---|---|---|---|---|
| {highest-cost wrongness of this bet} | {who hurts} | {why} | {product} | {action} |

## Constraints

| Constraint | Type | Hard / soft | Implication |
|---|---|---|---|
| {budget / timeline / team / regulatory / partner} | {…} | hard / soft | {how it shapes the bet} |

## Open questions

| Question | Owner | Decision needed by |
|---|---|---|
| {unknown that could reshape the bet} | {role} | {YYYY-MM-DD} |

## References

- {market research / interviews / filings / financial models / prior decisions / URL + access date / bead id}
