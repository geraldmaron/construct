---
name: strategy-research
description: >-
  Review a strategy against the work and capacity it directs: kernel, initiatives with owners and work, capacity ranges with assumptions, cited conflicts. Never velocity as capacity.
license: Apache-2.0
metadata:
  version: 1.0.0
  source: geraldmaron/construct
---
# Strategy and research

A pack of obligations for whether a strategy can be believed against the
work and the people it claims to direct, and for research that must
survive a hostile reader. It normalizes what the sources say, finds
conflicts deterministically before it reads for meaning, states capacity as
ranges with assumptions, and hands decisions to their owners.

## 1. Scope - and when to stand down

Engage when strategies, initiatives, roadmaps, work-tracking, and people or
capacity sources must be compared, or when a claim someone will bet on
needs research. Stand down on a single delivery plan (program-delivery),
on one feature's scope (product-management), and on funded work that only
needs status. Applying nothing is a designed outcome.

## 2. Obligations

Every deliverable carries `references/obligations.md`: kernel,
normalization, deterministic conflicts, capacity, semantic conflicts,
decisions. Two sources' authority is never assumed: a work tracker is
authoritative for work items, not for ownership; an HRIS for reporting
lines, not for capacity; a profile for nothing.

## 3. Doctrine

A strategy is a diagnosis, a guiding policy, and coherent actions (Rumelt),
and a document without them is a wish list; where-to-play and how-to-win
choices are its testable content (Lafley and Martin). Situational awareness
precedes plays (Wardley). Capacity is bounded by cognitive load and team
interaction modes (Team Topologies) and estimated from explicit assumptions
with throughput history as evidence, never as the figure (DORA). Inside
views produce infeasible commitments; reference classes correct them
(Kahneman). Similar wording in two documents is not a contradiction and
different wording is not agreement; a conflict is two commitments that
cannot both hold, cited. Research follows the investigative-research
method when present. Sources with review dates are in
`references/sources.md`; never invent an owner, an allocation, or a figure.

## 4. Procedure

1. Read the declared sources and their authority per claim type; cite the
   constitution's owners and decision rights.
2. Normalize: initiatives, owners, dates, dependencies, allocations,
   constraints, skills, operational load, throughput history; each cell
   cites its source.
3. Run the deterministic checks: unowned, unworked, unmeasured initiatives;
   work with no initiative; double allocation; dates before dependencies.
4. Derive capacity ranges from stated assumptions; reject velocity offered
   as capacity and say why.
5. Review for semantic conflicts: commitments that cannot both hold, each
   cited to both texts.
6. Write `assets/strategy-execution-review.md` with freshness and
   assumptions at the top; hand each recommended decision to its owner.

## 5. Checks

Deterministic before judgment: every material finding cites its sources;
no capacity figure derives from velocity; every initiative row has an owner
cell that is a citation or the word unowned. The kernel's
`no_velocity_as_capacity` validator gates the deliverable.

## 6. Limits and escalation

This pack recommends; it never decides, assigns an owner, or supplies a
number the sources lack. Vector similarity is never used to adjudicate a
conflict. Where two sources disagree and neither is declared authoritative
for the claim, the disagreement is the finding.
