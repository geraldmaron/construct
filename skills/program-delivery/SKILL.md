---
name: program-delivery
description: >-
  Review a plan, schedule, or status for claims that cannot all hold: dates, dependencies, capacity, risks, decision rights. Not what or how to build.
license: Apache-2.0
metadata:
  version: 1.0.0
  source: geraldmaron/construct
---
# Program delivery

A pack of obligations for plans and their truthfulness: which claims in a
plan cannot all hold, what chain sets the date, what capacity really is,
who owns each risk, and what a status update owes its reader. It decides
neither what to build nor how.

## 1. Scope - and when to stand down

Engage when a plan, schedule, commitment, or status is about to be relied
on by people who will act on it. Stand down on what-to-build and
how-to-build questions and on a single task with no plan around it.
Applying nothing is a designed outcome.

## 2. Obligations

Every deliverable carries `references/obligations.md`: claim consistency,
critical path, capacity, risks with owners, status honesty, decision
rights. Capacity is always a range with its assumptions written out.

## 3. Doctrine

A plan is a set of claims about the future; the review's first job is to
find the two that cannot both hold and cite both. The end date is set by the
resource-constrained chain (critical chain), not by the longest list.
Throughput history (DORA) is evidence for a capacity estimate, never the
estimate itself; capacity comes from people, availability, skills,
operational load, and history, stated as a range with assumptions. Adding
people late does not add capacity (Brooks). Status is prose about what
happened and what did not (Berkun); a color without its sentence is not a
status. Sources with review dates are in `references/sources.md`; never
invent a date, a dependency, or a headcount.

## 4. Procedure

1. Read the plan and the declared work-tracking and calendar sources; cite
   every date, dependency, and allocation to where it came from.
2. Run the deterministic conflict checks: date ordering against
   dependencies, double allocation, dependencies on unstaffed or undated
   work.
3. Trace the critical path and name the constrained resource.
4. Derive capacity ranges from explicit assumptions; reject any velocity
   figure offered as capacity and say why.
5. Attach an owner, trigger, and decision timing to each risk.
6. Write `assets/delivery-plan-review.md` or `assets/status-update.md`;
   raise every conflict to the owner the constitution names.

## 5. Checks

Deterministic before judgment: every claim cites a source; no capacity
figure is derived from velocity; every risk has an owner; the deliverable
has a summary, findings, and assumptions. The kernel's
`no_velocity_as_capacity` validator gates the deliverable.

## 6. Limits and escalation

This pack never resolves a conflict between commitments; it names the
owner. It never supplies a date or a headcount the sources lack. Contract
and financial exposure in a plan goes to governance-risk as issue spotting.
