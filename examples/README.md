# Prompt Example Fixtures

This directory holds shipped example fixtures for Construct's public persona and internal role layers.

Use it for three things:

- golden examples: canonical strong behavior worth preserving
- bad examples: labeled failure modes that should fail review/eval
- boundary and adversarial examples: ambiguity, escalation, stale context, and injection pressure

Best practice in this repo:

- keep the public persona and internal specialist prompts lean and rule-based
- keep most examples here as regression fixtures, not embedded into prompt bodies
- use bad examples as critique and eval assets, not as raw few-shot prompt content
- add in-prompt examples only when behavior is hard to specify precisely in rules

## Layout

```text
examples/
├── personas/
│   └── construct/
│       ├── golden/
│       ├── bad/
│       ├── boundary/
│       └── adversarial/
└── internal/
    └── roles/
        ├── architect/
        ├── engineer/
        ├── orchestrator/
        ├── qa/
        └── reviewer/
```

## Fixture format

Each fixture is markdown with YAML frontmatter.

Required frontmatter:

- `id`: stable fixture id
- `surface`: `persona` or `internal-role`
- `name`: fixture target name, such as `construct` or `engineer`
- `category`: `golden`, `bad`, `boundary`, or `adversarial`
- `verdict`: `pass` or `fail`
- `summary`: one-line purpose

Recommended frontmatter:

- `references`: prompt or role files this fixture exercises
- `tags`: stable labels for filtering and future eval harnesses

Required body sections:

- `## User`
- `## Expected`

Bad fixtures should also include:

- `## Why This Fails`

## Coverage policy

Required public coverage:

- `construct`: at least one `golden`, `bad`, `boundary`, and `adversarial`

Required internal coverage:

- `architect`, `engineer`, `reviewer`, `qa`, and `orchestrator`: at least one `golden` and one `bad`

## Authoring rules

- Keep fixtures short and behaviorally specific.
- Prefer one core contract per fixture.
- Name the expected behavior in repo terms: branch confirmation, approval boundary, routing, verification, blocker surfacing, anti-pattern avoidance.
- For bad examples, show the failure plainly and explain why it violates the surface contract.

See `docs/prompt-surfaces.md` for the canonical public-vs-internal taxonomy.

## Scope

These fixtures are shipped examples and regression assets. They are not yet executed by a model harness, but the structure is designed so a future evaluator can consume them without reshaping the corpus.
