---
description: Inventory of asset-quality fixtures — known-good goldens and intentionally-bad anti-fixtures.
cx_fixture_type: asset-quality-inventory
---

# Asset-quality fixtures

Seeds the fixture families for the generated-asset quality program (`construct-cuxq`). Two kinds of fixture:

- **Known-good goldens** — live at `tests/fixtures/artifacts/<type>/golden.md` (27 types). They MUST pass their release gate; covered by `tests/fixtures/artifacts/golden-fixtures.test.mjs` and `tests/artifact-release-gate.test.mjs`. This program does not modify them.
- **Anti-fixtures** — under `anti/`, intentionally-bad artifacts that MUST be rejected by the audit they target. Declared in `anti-fixtures.json`; asserted by `tests/asset-quality/anti-fixtures.test.mjs`.

## Anti-fixture families and lock owners

| Family | Path | Lock owner (epic) |
|---|---|---|
| markdown-presentation | `anti/markdown/` | source-lock (Epic 2) |
| deck | `anti/deck/` | deck-lock (Epic 4) |

Document-export and diagram families are seeded by their own beads (Epic 5 `construct-cuxq.5.1`, Epic 6 `construct-cuxq.6.1`) under their locks, to avoid parallel collisions.

## Enforcement status

Each anti-fixture is `enforced` (the target audit fails it today) or `pending` (no audit exists yet — the entry names the bead that will close the gap). Pending fixtures are explicitly skipped in the test with their bead id, so a coverage gap is visible, never silent.

| Fixture | Audit | Expected signal | Status |
|---|---|---|---|
| md-multiple-h1 | lintDocPresentation | multiple H1 | enforced |
| md-bullet-wall | lintDocPresentation | bullet wall | enforced |
| md-missing-blank-before-heading | lintDocPresentation | missing blank line before heading | enforced |
| md-empty-alt-text | lintDocPresentation | image missing alt text | enforced |
| md-unresolved-placeholders | lintDocPresentation | placeholder | pending `construct-cuxq.2.2` |
| md-empty-section | lintDocPresentation | empty section | pending `construct-cuxq.2.2` |
| deck-dense-paragraph | auditDeckMarkdownLayout | text_dense | enforced |

## Regenerating goldens

Goldens regenerate via `node scripts/generate-artifact-fixtures.mjs`. Anti-fixtures are hand-authored and not regenerated — a generator would normalize away the defect that makes them useful.
