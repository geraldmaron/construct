# Persona and skill research

A persona in Construct is the prompt that runs when a specialist is dispatched. A skill is a reusable competency that one or more personas draw on. Both have to be built from research, not invented, or the system routes work to the wrong shape and the operator pays for it in bad outputs.

This page is the methodology. It draws from the standard literature on user-research personas (Cooper, Goodwin), organizational design (Galbraith STAR, Lawrence and Lorsch differentiation), and competency modeling (Bloom-style observable outcomes). It also reflects what Construct has observed in its own operation.

## Why this matters

The default failure mode of "let's add a persona" is to write a one-line role, name it after a job title, and ship. The result is a persona that:

- has no clear capability boundary, so it tries to do everything
- has no failure mode declared, so the operator can't tell when to escalate
- has no handoff contract, so it stalls in coordination
- has no provenance, so when it underperforms there is no record of where the assumptions came from

The methodology below makes each of those explicit.

## Persona research method (Goodwin / Cooper)

The persona pattern from Cooper and Goodwin is built on behavioral data, not demographic guessing. Construct applies the same rule to AI personas: behavior, not job titles.

For each new persona, gather:

- **Interviews or contextual inquiries.** Talk to four to eight actual practitioners doing this work. Not their managers, not their job descriptions.
- **Behavioral patterns.** What do they actually do during a day, what tools do they use, what do they decide on their own, what do they escalate?
- **Goals.** What does success look like to them? Not the org's goals, theirs.
- **Frustrations.** What slows them down, what they get blamed for that is not their fault.
- **Evidence sources.** Cite the interviews, the docs, the public job postings, the postmortems.

The output is a persona artifact with the following sections, exactly:

```
# <Role display name>

## Goals
- ...

## Frustrations
- ...

## Decision rights
- Decides: ...
- Escalates: ...

## Handoffs
- Hands off to: ... when ...
- Receives from: ... when ...

## Output contract
- Format: ...
- Depth: ...
- Citations: required | encouraged | none

## Failure modes
- ...

## Evidence
- Source 1: ...
- Source 2: ...
```

Without evidence, the persona is opinion. Reject it at review.

## Departmental structure (Galbraith / Lawrence-Lorsch)

A profile groups personas into departments. The grouping is not cosmetic; it determines who hands off to whom and where ambiguity stalls.

Use the Galbraith STAR test: strategy drives structure drives roles. A department exists if it has:

- A **distinct charter**, written in one paragraph. What it owns. What it does not own. Who it hands off to.
- A **clear boundary** with adjacent departments. Lawrence and Lorsch's differentiation framing: the more the work differs in time horizon, certainty, and orientation, the more the boundary needs to be drawn.
- **Stable membership.** A role belongs to one department in a given profile. Cross-department contributions go through handoffs, not dual citizenship.

Common groupings that work:

- **By function**: Engineering, Product, Quality, Operations. Good for stable, repeatable work.
- **By output type**: Platform teams, Product teams. Good when output domains diverge.
- **By process stage**: Discovery, Build, Operate. Good when the same person does similar work across many domains.

The four curated Construct profiles use functional + process-stage groupings.

## Skill research

A skill is an observable competency that one or more personas draw on. Skills are composable; a role is a composition of skills, not a monolith.

Each skill artifact must declare:

- **Name.** Short, verb-led ("plan-feature", "review-architecture", "score-trace").
- **Scope.** One paragraph. What it covers, what it does not.
- **Observable outcome.** How does someone outside the role tell this skill happened? Bloom-style: not "knows X" but "produces Y".
- **Provenance.** Citation to where this skill came from. Internal post-mortem, public framework (e.g. RICE prioritization), competency model.
- **Roles that use it.** Cross-reference; the loader checks consistency.

A skill without an observable outcome is a vibe, not a skill. Reject at review.

## Validation

A persona ships when:

1. Its sections are filled out from evidence (not invented).
2. Its decision rights and handoffs are non-overlapping with adjacent personas.
3. Its output contract is precise enough that another role can consume it.
4. It scores well on a persona-eval: ten representative scenarios, the persona produces outputs that match the contract.

The classifier already has a golden test; persona quality should be evaluated the same way. The `cx-reviewer` specialist owns the persona-eval phase (via its evaluator overlay).

## When to add vs reuse

Default to reuse. Twenty-eight specialists is enough for most software-R&D loops; the profiles that exist today reuse 80%+ of them. Add a new persona only when:

- The behavioral pattern is not covered by any existing persona.
- The new pattern survives differentiation: it is not just a flavor of an existing role.
- The role has a stable charter that does not bleed into adjacent ones.

For "kind-of-like-engineer-but-for-games" cases, use a flavor overlay in `skills/roles/engineer.games.md`. The cap of six flavors per role per profile keeps that mechanism from sprawling.

## Caps and why they exist

- **80 roles per profile** (was 40). Real orgs have hundreds of job titles; a useful AI org-in-a-box maps to dozens. Cap exists to keep the sync pipeline bounded.
- **12 departments per profile**. Above twelve, the org chart loses meaning and most teams collapse some.
- **20 roles per department**. Lawrence and Lorsch found differentiation drops above this point; the department becomes a holding pen.
- **24 intake types**. Each type must be distinct, observable, routable. Above this, the taxonomy loses distinctness.
- **12 stages**. A loop with more than twelve stages is two loops in a trench coat.

Caps are bounds, not targets. Most well-shaped profiles use a fraction.

## Where the methodology lives in the lifecycle

The phases in `docs/guides/concepts/profile-lifecycle.md` map to this methodology:

- **Discover** runs the persona research method, owned by `cx-researcher` (via its ux-researcher overlay).
- **Frame** runs Galbraith STAR for departmental structure, owned by `cx-product-manager`.
- **Architect** runs the skill composition and reuse check, owned by `cx-architect`.
- **Validate** runs the persona-eval and classifier-eval, owned by `cx-reviewer` (via its evaluator overlay).
- **Promote** is the operator decision; the PR description cites the evidence.
- **Monitor** runs the health rollup; failures here re-open Discover.
- **Archive** retires a profile with the final health report as evidence.

Skip any of these and the profile is a guess.
