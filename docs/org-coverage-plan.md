# Base org coverage: the plan to a full organizational surface

Filed 2026-08-10 against epic construct-yx7. This document is the review
packet for the plan; the beads are the operative plan. If this page and a
bead disagree, the bead is the record.

## The thesis, restated so the plan can be checked against it

Organizations run on contracts that exist only in human heads: the review
that always happens before a launch, the question legal always asks, the
person who always notices the date is not real. Teams adopting AI assume it
fills those gaps. It does not, because nobody wrote them down. Construct
codifies them: each concern a seasoned cross-functional team covers becomes
a routable domain, a deepening lens, a deliverable with checkable slots,
and a challenge gate — measured, never asserted. The contract work already
shipped (grounded PRDs, asks, citations) is the wedge, not the product.
This plan builds out the base org so Construct solves problems for teams,
not just for the contract-hardening use case.

## Titles map to concerns, not to personas

The stakeholder's org list — Directors, VPs, PMs, Tech Leads, Engineers,
Product Managers, Designers, Application, Platform, Support, UX, Legal,
Program Management, Strategy, Execution, Conflict resolution, Research,
Requirements gathering — maps onto Construct's architecture as concerns
owned, because Construct routes by concern (the namer implicates domains
from the outcome; nobody types a role name, per STRATEGY's end-state UX).
The target tree:

| Seat in a human org | Concern (domain) | State today | Plan |
|---|---|---|---|
| Product Manager | product-scoping | routed + product lens | shipped |
| TPM / Program Manager | program-sequencing | routed + program lens | shipped |
| Counsel | contracts, privacy, employment | routed + legal lens (dogfood-only) | shipped |
| Compliance officer | compliance | routed + compliance lens (dogfood-only) | shipped |
| Accessibility specialist | accessibility | routed, default template | shipped (design lens may deepen it) |
| Finance / billing | commerce-tax | routed, default template | shipped |
| Analyst / data | measurement (new) | lens shipped, **unroutable** | construct-nmh (wave A repair) |
| Engineer | the host is the engineer | lens exists, **unroutable**, thin by design | construct-xhe (record or route) |
| Security engineer | security | routed, **no lens** | construct-phe (wave B) |
| Director / VP | strategy-alignment (new) | missing | construct-alo (wave B) |
| Architect / Tech Lead / Platform | system-design (new) | missing | construct-gzw (wave B) |
| Support / Ops / on-call | operations (new) | missing | construct-sqx (wave B) |
| Designer / UX | user-experience (new) | missing | construct-xh7 (wave B) |
| Requirements gathering | ask protocol + ask surface | protocol shipped | construct-9gb (existing) |
| Conflict resolution | decision inbox, commitment 11 | shipped | construct-ej6 measures the new pairs |
| Research | acquisition-ladder rung | named, undisciplined | construct-b1c (wave C) |
| Execution | dispatch + completion ladder | shipped | — |

Altitude (Director/VP vs IC) is carried by concerns, not by a level field:
the strategy-alignment domain asks the bet-level questions, program and
product ask the plan-level ones, the host does the work-level ones. A
separate altitude mechanism was considered and rejected for now: it would
be mechanism without a measurement, and the concern mapping covers every
seat the stakeholder named. Revisit only if a real run shows a question no
concern owns.

## What the audit found (divergence record, 2026-08-10)

The "construct site" is the repo's document surface — README, STRATEGY,
GLOSSARY, RESEARCH-DECISIONS, CHANGELOG, docs/ — the package homepage
points at the GitHub README and no hosted site exists.

1. **Two shipped packs are unreachable.** The analyst and engineering
   lenses have no domain wired (`domains: []` in lenses.ts), so the namer
   can never dispatch them, while STRATEGY Phase 4 counts both among the
   six packs at real depth. Repair: construct-nmh, construct-xhe.
2. **Five postconditions are fossils.** postconditions.ts registers rules
   for v2 role names (reviewer, security, debugger, operations, designer)
   no v3 dispatch can produce. Deletion: construct-j5k; wave-B packs
   define their own postconditions fresh.
3. **STRATEGY naming drift.** Phase 4 says "program manager, technical
   program manager"; code ships `program` and `product` lenses and no TPM
   exists anywhere. Dated amendment: construct-a8j.
4. **Criterion-state drift.** STRATEGY Phase 4 reads as if pack depth and
   two tuned families are settled; CHANGELOG records the program pack
   reopened on a changed prompt and the two-families criterion unmet
   (TUNED_FAMILIES is Claude only). Dated qualifiers: construct-a8j.
5. **security is the only high-stakes domain with no lens.** It routes to
   the default treatment. Lens: construct-phe.
6. **Tracker state is clean.** 178 beads, 19 open, none stale, none
   claimed; every orphan flag traced to a benign cause (branch not merged,
   pre-convention closes, or commits that touched without finishing). No
   bead was pruned because none was found dead.

## The wave plan

**Wave A — repair (may land now).** Fixing what is claimed shipped but
does not work is reconciliation, not the "new roles" STRATEGY Phase 5
forbids pre-acceptance: construct-nmh (measurement domain wires the
analyst pack), construct-xhe (engineering lens: record the deliberate
ceiling or route it), construct-j5k (delete fossil postconditions),
construct-a8j (doc reconciliation, dated amendments for Gerald's
ratification). Adjacent existing bugs stay in their own lanes:
construct-4t8, n9d, j99, 8yi, z34, jnf.

**Gate — Phase 5 stakeholder acceptance.** Gerald reads and accepts or
rejects the packets (docs/stakeholder-acceptance-phase-5.md Case 1 is
waiting; construct-9xq is the Phase 4 packet). No wave-B bead dispatches
before acceptance is recorded. If Gerald wants breadth to start sooner,
that is a dated STRATEGY amendment only he can make.

**Wave B — the missing concerns.** One independence bead first:
construct-pmn, corpus plants authored by a non-Claude family (a corpus and
its subject never share an author), blocking every pack close. Then five
packs, each in the Phase 4 shape (domain + lens + playbook + plant +
clean-context runs + tests): construct-alo strategy-alignment,
construct-gzw system-design, construct-sqx operations, construct-xh7
user-experience, construct-phe security lens. Rubrics for the new
personas pre-committed before any judging: construct-nn4.

**Wave C — cross-cutting skills.** construct-b1c gives the research rung
a discipline (licensed tools, provenance, a stop rule). construct-ej6
plants and measures a two-sided conflict between new concerns
(strategy-alignment vs system-design). construct-6gi makes the org tree
legible on the doc surface once it exists.

**Wave D — exit.** construct-gzk: one real outcome per new concern
through the shipped surface, recorded as packet cases, each defect filed
the same day, Gerald accepts or rejects. That is the epic's close.

## What this plan deliberately does not do

No altitude mechanism (covered above). No orchestration runtime
(commitment 1; RESEARCH-DECISIONS §13 — frameworks in that space are
hosts, not competitors). No marketing/sales/HR-operations concerns: the
stakeholder's list did not reach them and no run has surfaced them; they
are the natural wave after D if real outcomes implicate them. No
cross-user claims anywhere, per STRATEGY Phase 5 as amended.
