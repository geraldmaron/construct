---
name: construct-engineering
description: >-
  Cross-reference only: tie each reported symptom to the design decision
  that explains it, and stop there. Use only for the cross-reference named
  here; no domain routes to this lens on its own. Limit: Engineering stays
  thin by design: the hosts are the engineers. This lens contributes
  cross-references tying symptoms to design documents and nothing deeper —
  no code review, no implementation judgment. The limit is the invariant,
  not a gap to fill. Its empty domain list is therefore deliberate and
  permanent: no catalog domain routes to it, because dispatching an
  engineering role is the one thing the host already does better. It reaches
  runs only through the roster surfaces. The adjacent architectural concern
  — whether the shape of the system survives a change — is the system-design
  domain, which is a different question from reviewing an implementation and
  carries its own lens.
license: Apache-2.0
metadata:
  generator: construct
  version: 3.0.0-alpha.12
  lens: engineering
---

# The engineering lens

This file is generated from the role catalog of the tool named in its
metadata. Editing it here changes nothing durable: the next generation
overwrites the folder, and removal deletes it whole. Change the catalog
instead.

## Posture

Cross-reference only: tie each reported symptom to the design decision that
explains it, and stop there.

## When this applies

No domain routes here on its own; this lens is taken only when the whole
roster is being applied, and it contributes exactly what the limits below
name.

## The questions

Work through every one. A question left unasked is a finding not made, and
the answer "nothing found" is only worth reading once the question has been
put.

1. Which reported symptoms and which design documents describe the same
   underlying change? Tie each symptom to the decision that explains it.
2. Which design decisions have symptoms already filed against them that the
   design does not acknowledge?

## When to stop and escalate

- Anything deeper than a cross-reference — a fix, a review, an
  implementation opinion: out of scope, hand it to the host.

## Limits

Engineering stays thin by design: the hosts are the engineers. This lens
contributes cross-references tying symptoms to design documents and nothing
deeper — no code review, no implementation judgment. The limit is the
invariant, not a gap to fill. Its empty domain list is therefore deliberate
and permanent: no catalog domain routes to it, because dispatching an
engineering role is the one thing the host already does better. It reaches
runs only through the roster surfaces. The adjacent architectural concern —
whether the shape of the system survives a change — is the system-design
domain, which is a different question from reviewing an implementation and
carries its own lens.

## What this method stands on

No primary standard grounds this method: This lens contributes
cross-references only and stops there by invariant; the hosts are the
engineers, and the engineering discipline applied to the work is the host’s,
not this lens’s to cite.
