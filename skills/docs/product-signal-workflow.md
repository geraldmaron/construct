<!--
skills/docs/product-signal-workflow.md: Synthesize product signals from evidence into the right artifact.
Confidence rubric, contradiction resolution, artifact decision tree, and storage are all defined here.
Follow rules/common/research.md for source-handling policy.
-->
# Product Signal Workflow

Use when: the user asks what customers are asking for, what themes are emerging, whether evidence is strong enough, or what should become a PRD.

## Confidence Rubric

| Level | Criteria |
|---|---|
| **high** | ≥ 3 independent customers mention the same problem verbatim, OR 1 enterprise blocker with revenue at risk named |
| **medium** | 2 independent customers, OR 1 customer with high frequency (≥ 3 mentions), OR corroborated by a competitor signal |
| **low** | 1 customer mention, OR internal opinion without user observation, OR inferred from adjacent evidence |

## Contradiction Resolution

When two signals conflict:
1. Name both signals explicitly: do not average them away.
2. Weight by customer tier (enterprise > growth > SMB) and recency (weight decays after 90 days).
3. Record the contradiction in the signal brief as an open question.
4. Never let a minority signal disappear: it may be the leading indicator.

## Artifact Decision Tree

| Condition | Artifact |
|---|---|
| < 2 independent sources OR < medium confidence | signal brief |
| ≥ 2 independent sources AND ≥ medium confidence AND no strategic mandate yet | evidence brief |
| ≥ 3 sources OR 1 enterprise blocker OR PM has declared this a bet | PRD |
| PRD is approved AND launch narrative needed | PRFAQ |
| Subject is an internal process, agent workflow, or governance mechanism | Meta PRD |
| Artifact is approved AND needs a tracker item | backlog proposal (requires approval gate) |

## Strategy Check

After grouping evidence, check `.cx/knowledge/decisions/strategy/` for any declared strategy documents:
- Signal aligns with a declared Bet → raise priority, note alignment explicitly.
- Signal conflicts with a declared Non-bet → flag the conflict; the user must make an explicit override decision before proceeding.
- No strategy documents exist → continue without blocking; note that strategy grounding is not available.

## Steps

1. **Gather**: collect evidence briefs, customer profiles, field notes, tickets, and research from `.cx/knowledge/` and linked sources.
2. **Group**: cluster by theme, ask, pain point, affected persona, product area, and counter-signal.
3. **Assign confidence**: apply the rubric above; separate observation from inference.
4. **Check strategy**: check `.cx/knowledge/decisions/strategy/`; flag alignment or conflict with Bets and Non-bets if documents exist.
5. **Select artifact**: apply the decision tree; write the artifact; store to the path below.

## Storage

| Artifact | Path |
|---|---|
| Signal brief | `.cx/knowledge/internal/signals/` |
| Evidence brief | `.cx/knowledge/internal/evidence-briefs/` |
| PRD | `docs/prd/` |
| PRFAQ | `docs/prfaq/` |
| Meta PRD | `docs/meta-prd/` |
| Backlog proposal | pending approval gate: do not file until explicit user approval |
