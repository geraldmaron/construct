<!--
skills/operating/change-management.md (Change Management)
Use when categorizing a technical or organizational change, designing
a rollout plan, or determining what approval gates are appropriate.
Covers the Type 1 / Type 2 door framework, irreversibility analysis,
and rollback planning.
-->

# Change Management

Use when a change needs to be categorized by reversibility, when designing rollout gates, or when the team is uncertain how much approval process a change warrants.

## Type 1 / Type 2 door framework

From Jeff Bezos's 1997 Amazon shareholder letter, widely adopted in engineering practice.

**Type 1 (one-way door):** irreversible or nearly irreversible decisions. Once made, you cannot easily go back. These deserve deliberation proportional to their irreversibility.

**Type 2 (two-way door):** reversible decisions. If the outcome is not what you expected, you can reverse course. These should be made quickly and by the smallest appropriate team.

**The error to avoid:** treating Type 2 decisions as Type 1. This is over-process and slows velocity. The inverse error (treating Type 1 as Type 2) is less common but more costly, it produces outcomes you cannot undo.

## Irreversibility analysis

Before applying process overhead, characterize the change:

| Dimension | Questions |
|---|---|
| Data | Does this destroy, transform, or expose data in a way that can't be undone? |
| External commitments | Does this change a customer-facing API, SLA, or contractual commitment? |
| Infrastructure | Does this change cost structure, provider lock-in, or architectural constraints? |
| Organizational | Does this change team structure, ownership, or decision authority in ways that are hard to reverse? |
| Regulatory | Does this trigger compliance obligations that, once triggered, can't be untriggered? |

A change that answers "yes" to any of these is at least partially Type 1. The more "yes" answers, the more deliberation is warranted.

## Rollout gate design

**Principle:** the smaller the blast radius of a failure, the fewer gates are needed before the next stage.

**Standard progressive rollout:**
1. Shadow (traffic mirroring, no user impact)
2. Canary (1-5% of traffic, monitored closely)
3. Staged (10% → 25% → 50% → 100%, with soak time at each stage)
4. Full rollout

**Gate criteria (decide before rollout starts):**
- What metrics are you watching?
- What threshold triggers a rollback?
- Who has authority to advance to the next stage?
- Who has authority to pause or roll back?

Gates without pre-defined criteria become political. Define the criteria before anyone has invested in the outcome.

## Rollback planning

**Rule:** if you don't have a rollback plan before you deploy, you don't have a plan.

**Rollback plan minimum:**
- What is the rollback action (revert deploy, run migration-down, disable feature flag)?
- How long does rollback take?
- Is there a data migration that can't be reversed? If so, what's the strategy?
- Who executes the rollback, and how are they notified?

**Rollback triggers:**
- Define in terms of observable signals, not opinions. "Error rate > 1% for 5 minutes" is a trigger. "Things feel wrong" is not.

## Approval gates

**For Type 2 changes:** the default should be no approval gate, or approval by the team lead. Adding approval gates to reversible changes is a tax on velocity that buys nothing.

**For Type 1 changes:** approval gates should match the scope of irreversibility:
- Data schema changes with a migration: DBA or senior engineer review.
- External API changes: product owner + customer success (customer impact).
- Infrastructure changes with cost implications: engineering lead + finance stakeholder.
- Organizational restructuring: executive sponsor.

**Anti-pattern:** using approval gates as a substitute for design review. Gates check whether the change is approved; they don't improve the quality of the change. Design review should happen before the gate, not at it.

## Communication plan

For any change with external impact, the communication plan is part of the change plan.

**Minimum elements:**
- Who needs to know (customers, partners, other teams)?
- When do they need to know (before, during, or after the change)?
- What channel (email, status page, in-product, account team)?
- What's the message (what changed, why, what they need to do)?
- Who owns the communication?

For Type 1 changes, write the communication before executing the change, not after.
