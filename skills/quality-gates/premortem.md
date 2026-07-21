---
name: quality-gates-premortem
description: "Use when: a plan or design needs a premortem — imagining it has already failed and working backward to the failure modes — before committing to it."
inputs: [plan-or-design]
artifactType: risk-list
---
# Premortem

Use this skill when a plan, design, or proposal needs to be stress-tested before commitment, by imagining it has already failed.

A premortem inverts optimism: instead of asking "will this work?", it asserts "it's six months later and this failed — why?". Stating failure as a given frees people to name risks that politeness or momentum would otherwise suppress.

## Steps

1. **Set the frame**: "It is <horizon> from now. This shipped and failed badly. Write the post-mortem headline."
2. **Generate failure modes** independently across categories: technical (it didn't work), adoption (no one used it), operational (it broke in prod), people (the owner left), external (a dependency/market moved).
3. **For each failure mode**, state the mechanism (how it leads to failure), a rough likelihood (low/med/high), and the earliest observable signal that it is happening.
4. **Separate the fatal from the survivable.** A premortem's value is finding the one or two failures that would be unrecoverable.
5. **Propose a cheap probe or guardrail** for each high-likelihood or fatal mode — something that would surface it early.
6. **Name the assumption** each fatal failure depends on, and whether it has been validated.

## Output shape

```
## Failure modes
| failure | category | likelihood | earliest signal | guardrail |
|---|---|---|---|---|

## Fatal (unrecoverable) modes
- <failure> — depends on assumption: <assumption> (validated? yes/no)
```

## Verification bar

- Failure modes are concrete mechanisms, not vague worries ("it might be hard").
- Each fatal mode names the specific assumption it rests on.
- Likelihoods are stated as judgments, labeled as such — not presented as data.
- When the plan is an artifact (PRD, ADR, strategy), also check fabrication risk: invented metrics, unsourced legal claims, missing Phase Why?, skipped cross-persona triggers. See `rules/common/no-fabrication.md` and `skills/docs/artifact-authorship.md`. Flag AI-voice / em-dash theater against `rules/common/human-voice.md`.
