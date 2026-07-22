---
name: strategy-prioritization-methods
description: "Use when: a backlog, roadmap, or set of bets must be ordered by value and the call is being made on gut feel rather than a defensible method — selecting and applying RICE, WSJF/cost-of-delay, value-effort, Kano, risk-reduction, or mandatory-vs-discretionary, with the uncertainty and the counterargument made explicit."
inputs: [backlog, roadmap-candidates]
artifactType: prioritization-rationale
triggers:
  - prioritize
  - prioritization
  - backlog ranking
  - roadmap prioritization
  - rice score
  - wsjf
  - cost of delay
  - value versus effort
  - which to build first
  - what to build next
---
# Prioritization methods

A ranked backlog is a claim: "this order captures the most value under our constraints." The claim is only credible if the method, its inputs, and its sensitivity are shown. Pick the method that fits the decision — a single default (usually a vague value-effort guess) quietly forces every decision into one shape.

## When to use

Use this when ordering more than a handful of candidates where the order actually changes what gets built this cycle, and when someone could reasonably ask "why is this above that?" Use it to produce the *prioritization rationale* that accompanies a backlog proposal or roadmap, not a private spreadsheet.

## When not to use

- One obvious next step, or fewer than ~4 comparable items — ranking theater adds nothing; state the call and move.
- Work that is not actually optional (a security fix, a compliance deadline, keeping the lights on). Score-ranking mandatory work against discretionary value is a category error — partition it out first (see *Mandatory vs discretionary*).
- When you have no signal on either value or effort. Prioritization amplifies inputs; ranking on invented numbers produces false confidence. Get the cheapest real signal first (see the market-research-methods skill).

## Selecting a method

Match the method to what you actually have and what the decision needs:

| Decision shape | Evidence you have | Cadence | Method |
|---|---|---|---|
| Many comparable items competing for one team | Rough reach + effort estimates | Quarterly / planning | **RICE** |
| Continuous flow; delay has real economic cost | Relative value + time-criticality + job size | Sprint / kanban | **WSJF (cost of delay)** |
| Early triage, little data, need speed | Coarse value + effort guesses | Anytime | **Value vs effort** |
| Composing a *feature set* (what must exist vs what delights) | User survey responses | Product definition | **Kano** |
| Novel bet, dominated by unknowns | The riskiest assumption is nameable | Discovery | **Risk-reduction** |
| Obligations mixed in with value work | Deadlines / contracts / policy | Anytime, first | **Mandatory vs discretionary** |

Two methods can compose: partition with *mandatory vs discretionary*, then rank the discretionary set with RICE or WSJF.

## RICE

**Score = (Reach × Impact × Confidence) ÷ Effort.**

- **Reach** — how many entities are affected per time window, in real units (users/quarter, requests/day). Count, don't feel.
- **Impact** — per-entity magnitude on a fixed scale (3 massive, 2 high, 1 medium, 0.5 low, 0.25 minimal). Fixing the scale keeps items comparable.
- **Confidence** — how much the estimates are backed by data: 100% (measured), 80% (some evidence), 50% (educated guess). This is where a hunch gets taxed.
- **Effort** — person-months, including design, build, and verification.

Walkthrough: estimate each factor from a named source, compute the score, sort descending, then run the sensitivity check below before committing.

**Symptom**: every item lands at 80% confidence and Impact 2 — the scores cluster and the ranking is really alphabetical.
**Counter-move**: force spread. If two items can't be told apart on a factor, you're missing the signal that would separate them; go get it or mark them a deliberate tie.

## WSJF (cost of delay)

**WSJF = Cost of Delay ÷ Job size.** Cost of Delay = user/business value + time criticality + risk-reduction/opportunity-enablement (each relative, e.g. a 1–10 or Fibonacci scale). Sequence highest WSJF first — it is the economically optimal order when a single team processes a queue.

Use it when *when* something ships changes its value (a launch window, a competitor move, a decaying opportunity) — the dimension RICE ignores.

**Symptom**: job size is estimated in the same breath as value, and big-but-urgent items always lose to small-but-trivial ones.
**Counter-move**: size the job independently of its value, and check that time-criticality reflects a real external clock, not manufactured urgency.

## Value vs effort

A 2×2: value (high/low) against effort (high/low). Do quick wins (high value, low effort) first; schedule big bets (high value, high effort) deliberately; drop money pits (low value, high effort); batch fill-ins (low value, low effort). Fast, coarse, honest about being coarse — a triage step, not a final ranking.

**Symptom**: everything is plotted as high-value/low-effort.
**Counter-move**: rank *within* each quadrant, and require that at least some items sit in the quadrants nobody likes — if nothing is a money pit, the effort axis is being gamed.

## Kano

Classifies features by how presence/absence maps to satisfaction: **Basic** (must-be — absence angers, presence is unnoticed), **Performance** (linear — more is better), **Delighter** (excites when present, not missed when absent), plus Indifferent and Reverse. Elicited with paired functional/dysfunctional survey questions. Use it to *compose a set* — ship all Basics, compete on Performance, sprinkle Delighters — not to produce a single linear order.

**Symptom**: Delighters are prioritized while a Basic is still missing.
**Counter-move**: no Delighter ships until every Basic is covered; a missing must-be caps the ceiling of everything above it.

## Risk-reduction (assumption-first)

Under high uncertainty, rank by how much each item retires the *riskiest assumption* — the belief that, if wrong, kills the effort. Sequence to learn fastest and cheapest, then scale what survives. This deliberately overrides value scoring: the highest-value item is worthless if its load-bearing assumption is false.

**Symptom**: the plan front-loads the fun build and defers the one test that could invalidate it.
**Counter-move**: name the assumption that, if false, wastes the most work, and schedule the cheapest test of it first.

## Mandatory vs discretionary

Before any value scoring, split the list. **Mandatory** = non-negotiable: legal/compliance deadlines, security remediation, contractual commitments, keep-the-lights-on. These are gated by obligation, not value — size the *minimum* that satisfies them and slot them by deadline. **Discretionary** = everything competing on value; rank that set with RICE or WSJF.

**Symptom**: a compliance item is sitting in the RICE table with an invented Reach.
**Counter-move**: mandatory work never gets a value score — it gets a deadline and a minimum scope. Scoring it pretends it could lose, which it can't.

## Make the uncertainty explicit

A point-estimate ranking hides how fragile it is.

- **Confidence** travels with each score (RICE builds it in; for others, tag each estimate measured / evidenced / guessed).
- **Sensitivity on the top rank**: recompute the order with the top two or three items' inputs at their plausible high and low bounds. If #1 and #2 swap under reasonable variation, the ranking is *not* decision-grade — present them as a tie and name the one measurement that would break it, rather than manufacturing a false lead.

## Mandatory counterargument

Before publishing the order, write the strongest case **against** your #1 and **for** your #2. If you cannot make that case honestly, you have not stress-tested the ranking — you have rationalized it. Record the counterargument alongside the rationale so a reviewer inherits the strongest objection, not just the conclusion. Hand a genuinely contested call to reviewer rather than resolving it silently.

## Output

Produce a prioritization rationale: the method chosen and *why it fits this decision*, the per-item inputs with their sources, the ranked order, the sensitivity result, and the counterargument. A rank with no visible method or inputs is a preference wearing a number.
