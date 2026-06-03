---
name: <verb-led-id>
scope: "<one paragraph: what it covers, what it does not>"
observable_outcome: <how someone outside the role tells this skill happened — a concrete artifact, not "understands X">
prerequisites:
  - <skill-id or capability that must exist before this one is useful>
provenance:
  - <citation: post-mortem, public framework, competency model, with URL>
roles:
  - <role-id that uses this skill>
---

# <Skill display name>

## What this skill produces

<Concrete output, Bloom-style: not "knows X" but "produces Y". Name the artifact and what makes it correct. Example: "a runbook whose diagnostic flowchart branches to a fix in ≤3 steps", not "understands incident response".>

## When to invoke it

<Triggers. What the operator or upstream persona is doing when this skill is the right call. Include the signal that distinguishes it from adjacent skills.>

## Prerequisites and composition

<What must be true or done first, and the skills typically chained before and after. A skill with unmet prerequisites produces confident-looking but wrong output.>

## Competency rubric

<What the skill looks like at each level. The author of an artifact should be able to place their work on this scale.>

| Level | What it looks like |
|-------|--------------------|
| Novice | <produces the artifact but misses edge cases / evidence / failure paths> |
| Competent | <covers the happy path and the common failure modes; cites sources> |
| Expert | <anticipates the non-obvious failure, calibrates confidence, leaves the next person a reproducible trail> |

## Failure modes

<How this skill breaks when misapplied — distinct from anti-patterns. What does a wrong-but-plausible output look like, and what signal reveals it? When should the operator escalate or stop?>

## Anti-patterns

<Ways this skill gets misapplied; what looks similar but is not this skill.>

## Worked example

<A short, concrete instance: the trigger, the artifact produced, and why it meets the observable outcome. One real example removes more ambiguity than a page of guidance.>
