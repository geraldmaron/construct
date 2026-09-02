# Authoring and qualifying skills and workflows

## A skill

A skill is a directory: `SKILL.md` (Agent Skills frontmatter and body),
`construct.skill.json`, and optional `references/`, `assets/`, `scripts/`,
`schemas/`, and `evals/`. The manifest declares id, title, semantic version,
category, owner, activation and stand-down phrases, interaction classes,
outcomes and deliverable types, inputs and output schemas, required source
types and minimum evidence, capabilities (never tools), action tiers,
versioned skill and workflow dependencies, quality gates, escalation,
licensed-review boundaries, observations (which may not claim success
without naming a run), and eval files. Name and version must agree with the
frontmatter.

Bundles are digested in path order; content that changes without a version
bump fails `npm run lint` through the registry index check.

Project-authored skills live under `.construct/skills/` and may not shadow a
built-in id.

## Evals

`evals/activation.json` lists requests in ordinary language with the
expected outcome, activate or stand down. The activating cases do double
duty: they are fixtures, and the router retrieves over them, so every case
you add teaches Construct one more way a person phrases the need. Write
them the way people talk, not the way the manifest does.

The router does not decide which skill loads; the host model does. The
router orders every skill by how well the person's words match its
description, its activation phrases, and its labeled cases, and hands the
banded list back through `classify_request`. Measured on requests written
after the catalog was final and never used to tune it (`skills/evals/
routing.json`), retrieval alone puts the right skill first about four times
in ten and in the top five about eight times in ten; a host-class model
reading the same descriptions picks it almost every time. Those floors are
asserted in the tests, so a description or phrase change that makes the
ranking worse fails before it ships. A routing case is never copied into a
skill's own eval file, or the measurement stops being held out.

`npm run evals:live` asks a subscription model to pick a skill for every
routing case from the shipped descriptions alone and records the verdicts,
the model, and the date in `skills/evals/live-judge.json`. The test suite
checks that the record covers the current cases; it never runs the model.

Professional packs add `evals/fixtures.json` with positive, negative, edge,
and adversarial cases, and `references/sources.md` with citations, what each
is used for, and review dates; a build that did not re-open a source says so.

## A workflow

A workflow is a directory with `workflow.json`: id, title, semantic version,
purpose, activation and stand-down, interaction class, input schema and
required inputs, steps (id, title, needs, skill and range, capabilities,
sources with freshness, tier, inputs mapped from `input.<key>` or
`steps.<id>.<output>`, outputs, validators, load-bearing, challenge, retry,
timeout), triggers, no-data and stale-data policies, concurrency, dedupe
key, cancellation, deliverable contract, and what it may propose. A step
that reads an upstream output must list that step in `needs`; a load-bearing
step must name a validator; a step may not need itself.

Project-authored workflows live under `.construct/workflows/`.

```bash
construct workflow validate
```

## Qualification

A skill or workflow is qualified when: the manifest validates and agrees
with its frontmatter; the registry index is current; its activating cases
rank first when held out and the routing floors still hold; its fixtures
cover the four kinds; a consuming workflow
resolves against it; and, for anything called working on a host, the
conformance command recorded the run.
