# Skill scorecards (Phase H)

Instrument: structural checks from `scripts/lint-skill-spec.mjs` and
`scripts/lint-skill-policy.mjs`, token/size from file bytes, dogfood evidence
from `docs/internal/skill-use-ledger.md`. A/B lift and cross-host load
observation are **unmet** unless a row says otherwise — ledger dogfood is prior
evidence, not qualification by itself (clean-slate §63).

Token estimate = `ceil(chars / 4)`.

## Operational skill

| Field | construct |
|-------|-----------|
| structural validity | Agent Skills frontmatter; short posture |
| token size | ~400 |
| trigger precision / recall | unmeasured (host routing) |
| A/B lift | unmet |
| cross-host / cross-model | unmet as observed load |
| composition | N/A (not stacked with method records) |
| known failure cases | teaching CLI verbs / staff theater (PR #12 class) |
| **decision** | **KEEP** — only skill `init` auto-installs |

## Method skills

| Skill | ~tokens | Structural | Ledger gates | A/B | Decision |
|-------|--------:|------------|--------------|-----|----------|
| investigative-research | ~1543 | valid; progressive disclosure | multiple yes rows | unmet | **REWRITE landed** (references/); substance **KEEP** |
| adversarial-review | ~1363 | valid; progressive disclosure | yes rows | unmet | **REWRITE landed**; substance **KEEP** |
| decision-framing | ~1286 | valid; progressive disclosure | yes rows | unmet | **REWRITE landed**; substance **KEEP** |
| requirements-structuring | ~1174 | valid; progressive disclosure | yes rows | unmet | **REWRITE landed**; substance **KEEP** |
| context-mapping | ~1323 | valid; progressive disclosure | yes rows | unmet | **REWRITE landed**; substance **KEEP** |
| intake | ~1125 | valid; progressive disclosure | yes row; distinct from requirements | unmet | **KEEP** (packaging rewrite only) |
| written-voice | ~1300 | valid; progressive disclosure | yes/no rows; no global house style | unmet | **KEEP** as **opt-in** — off `--all` / never auto-install |

### Intake vs requirements-structuring

**KEEP both.** Intake turns a messy multi-concern request into an execution
plan; requirements-structuring turns a settled intent into a buildable
artifact. Merge would collapse two jobs. Revisit only with an A/B that shows
one skill's presence changes the other's outcomes.

### Generated lens packs (`construct skills pack`)

**Out of product auto-install.** Staff/concerns ≠ persona skills. Pack remains
an explicit developer subcommand; `init` never runs it.

## Eval harness

`node scripts/skill-scorecard.mjs` prints structural validity and token size
for every shipped skill. It does not invent A/B lift.

## Gaps named honestly

- No cross-host observed-load packet in this phase.
- No A/B qualification pass (would be billed spend beyond session access if
  run as a gate).
