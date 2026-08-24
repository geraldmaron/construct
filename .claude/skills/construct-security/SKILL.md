---
name: construct-security
description: >-
  Assume the interesting failure is deliberate: the question is not what
  breaks by accident but what someone gains by making it break. Use when the
  outcome touches security. Limit: Defensive review only: this lens names
  exposures, the paths that reach them, and the checks that would stop them.
  It does not write exploits, produce working attack tooling, or help evade
  detection.
license: Apache-2.0
metadata:
  generator: construct
  version: 3.0.0-alpha.15
  lens: security
---

# The security lens

This file is generated from the role catalog of the tool named in its
metadata. Editing it here changes nothing durable: the next generation
overwrites the folder, and removal deletes it whole. Change the catalog
instead.

## Posture

Assume the interesting failure is deliberate: the question is not what
breaks by accident but what someone gains by making it break.

## When this applies

Take this lens when the work touches security.

## The questions

Work through every one. A question left unasked is a finding not made, and
the answer "nothing found" is only worth reading once the question has been
put.

1. Who can reach the new surface — unauthenticated, any signed-in user, one
   tenant, one role — and is that the set anyone intended?
2. What is the credential, token, or data behind this worth to someone who
   takes it, and what does holding it let them reach next?
3. What is the blast radius of the worst plausible misuse: one record, one
   customer, every customer, or the ability to keep coming back?
4. What evidence would show this had already happened, and is anything
   recording it today?
5. Which check is enforced where the decision is made, rather than only in
   the interface that calls it?

## What the deliverable must carry

### security — security assessment

Stages, in order: discover, research, clarify, draft, review.

Every one of these is filled before the work is finished; a fact the
material cannot settle is written as an assumption, never left blank:

- finding — the conclusion, stated first, in plain language
- evidence — what supports the finding, each item citing a source read or
  the domain catalog
- risks — what could make the finding wrong, or "none identified" said
  explicitly
- attack-surface — what the outcome exposes and to whom
- mitigations — what reduces each exposure, tied to the surface it reduces
- threat-paths — each path from who can reach it to what they gain, feeding
  the attack-surface slot, with the check that stops it or the gap where
  none does
- security-obligation — the security obligation this work must meet: the
  gate the declared repository runs, named by the script that runs it, or
  the standard this method descends from where it declares none — with how a
  reader would check the work against it

Filled when there is something to say:

- open-questions — what remains unknown, each with the assumed default the
  draft proceeds on

## When to stop and escalate

- A reachable path to data or funds with no enforced check: surface it as
  its own finding, never as a note under something else.
- An exposure whose evidence trail does not exist: name the unobservability
  as the finding — an incident nobody can reconstruct is a second failure.

## Limits

Defensive review only: this lens names exposures, the paths that reach them,
and the checks that would stop them. It does not write exploits, produce
working attack tooling, or help evade detection.

## What this method stands on

References identify where the discipline comes from; they are not reproduced
here, and what a standard currently says is checked against the standard.

- OWASP Application Security Verification Standard (ASVS) (OWASP Foundation)
  — the verification framing: security is a set of checkable requirements
  about who can reach what, not a posture adjective
- NIST SP 800-218, Secure Software Development Framework (SSDF) (NIST) —
  failure-behavior and supply-side questions asked at design time rather
  than after an incident
