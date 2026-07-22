---
description: typed Construct artifacts use a human colleague voice — contractions, longer prose rhythm, no em-dash or keynote theater, no LLM tells.
enforced_by: (Worker Profile prompt), skills/docs/artifact-authorship.md, skills/quality-gates/review-work.md
precedence_tier: style
---
# Human voice (typed artifacts)

Artifact prose should read like a careful colleague wrote it under load, not like a corporate LLM and not like a staged keynote. This rule applies to **typed document bodies** Construct Worker Profiles author or review: PRDs, ADRs, RFCs, research, strategy, runbooks, memos, compliance memos, decks sourced from those docs, and similar. It does not reshape machine-readable output (`--json`, registries, contracts, parsed tokens).

Full authorship contract (framing, evidence, triggers): `skills/docs/artifact-authorship.md`. Em-dash ban for all human-facing Construct output also lives in `rules/common/neurodivergent-output.md`.

## 1. Prefer contractions in prose

Use natural contractions (`don't`, `won't`, `can't`, `isn't`, `we're`, `it's`, `that's`, `you'll`, `we're`) in narrative sections. Prefer `it's` over `it is`, `don't` over `do not`, unless an exception below applies.

**Exceptions (do not force contractions):**

- Acceptance criteria and binary pass/fail wording when precision matters
- Legal `shall` / `must` / `must not` and obligation language
- Quoted statute, regulation, or primary source text
- Validators that require exact section titles (for example Competitive Landscape)

## 2. Avoid spaced em dashes

Do not use spaced em dashes (` — `) or Unicode em dash (U+2014) as rhetorical theater. Prefer a period, comma, colon, or parentheses. The output quality gate already fails Unicode em dashes on orchestration outputs.

## 3. Prefer longer, connected sentences

Write in complete thoughts that can carry a clause or two. Mix in a shorter sentence when a point needs a hard stop, but don't default to staccato one-liners. Punchy fragments stacked for drama feel gimmicky and read like marketing or a kids' movie script.

**Prefer:** a sentence that names the stake, the constraint, and the next action in one pass.  
**Avoid:** a parade of three-word sentences meant to sound profound.

## 4. Mild warmth, not performance

It's fine for prose to feel human and slightly encouraging when the content earns it. It isn't fine to moralize, mythologize the reader, or stage "quiet wagers" and destiny language. Earn attention with clarity and respect for time, not with inspirational theater.

Refuse (non-exhaustive):

- Keynote / campaign cadence (oratorical repetition, sermon beats, destiny talk)
- Disney-movie uplift ("believe", "the room leans in", courage-as-sauce)
- Celebrity or public-speaker mimicry checklists
- Softening obligation language into vibes

## 5. Refuse common LLM tells

Do not pad with empty authority. Short refuse set (non-exhaustive):

- `delve` / `delve into`
- `landscape` outside a required section title
- `robust`, `leverage` (as filler verbs)
- `it's important to note`, `In today's…`, `This ensures that…`
- Stacked empty tricolons (`X, Y, and Z` with no concrete referents)
- Sterile restatements of masthead fields already in YAML frontmatter

## 6. Sound human and inclusive

Write for named roles and contexts. Name who is helped or harmed if the artifact ships wrong. Stay concrete and skeptical of fluff. Depth and anti-fabrication still win: never invent facts to sound warmer (`rules/common/no-fabrication.md`).

## Enforcement

- Generation path: `skills/docs/artifact-authorship.md` Human voice bar; Worker Profile `skillEmphasis` includes `docs/artifact-authorship`; shared `_shared/validation-contract.md`.
- Review path: `skills/quality-gates/review-work.md` and `skills/quality-gates/verify-quality.md` flag AI-voice / em-dash theater / keynote-gimmick cadence on artifact changes.
- Runtime: orchestration `output-quality-gate` bans Unicode em dashes (U+2014).

## Bypass

There is no bypass for style theater that makes artifacts sound machine-written or performatively inspired. If a required section title or legal exact wording conflicts, keep the required wording and apply this rule to surrounding prose.
