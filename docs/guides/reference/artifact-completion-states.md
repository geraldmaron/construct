---
title: Artifact Completion States
description: The ordered completion-state ladder for artifacts, from planned through completed.
---

# Artifact Completion States

An artifact's completion state reflects the highest rung of an ordered 12-state ladder for which it holds re-verifiable evidence. The state is never inferred from content alone; only an explicit evidence object backed by a measurable, reproducible action advances the ladder.

## The Completion Ladder

States are ordered from lowest to highest readiness:

1. **planned** — Artifact is identified and scoped; work is ready to start.
2. **authored** — Initial content written; not yet validated or linted.
3. **structurally-valid** — Markdown parses, frontmatter is valid, required sections present.
4. **source-linted** — Source passes comment style, link integrity, and formatting checks.
5. **exported** — Markdown successfully exported to the requested distribution format (PDF, DOCX, etc.).
6. **file-valid** — Export file passes integrity checks: PDF page count > 0, content roundtrip > 75% key phrases preserved, local references resolve.
7. **renderable** — Export renders to viewable images without errors; visual capture is possible.
8. **screenshot-captured** — Real screenshots taken from the rendered export; evidence is non-degraded.
9. **visually-reviewed** — Human verdict recorded (pass/needs-changes/fail) against an approved rubric; requires non-degraded screenshot evidence.
10. **accessibility-reviewed** — Per-format accessibility checks run and pass (alt text, heading hierarchy, contrast, font floor, text extractability as applicable).
11. **approved** — Final sign-off from stakeholders or reviewers; artifact is cleared for distribution.
12. **completed** — Artifact is published and in active use; completion is confirmed in production.

## The No-Forgery Invariant

A rung is reached **only** when backed by re-verifiable evidence. The `artifact-completion` ledger maintains a chronological record of every advancement and every failed attempt:

- A **successful advancement** records a non-degraded evidence object with a state, actor (who verified), proof (what was measured), and an optional digest (hash or checksum for determinism).
- A **degradation** (a check that could not run) records the miss with a typed reason (`missing-dependency`, `unavailable-renderer`, `unsupported-format`, `headless-limitation`, `skipped-by-policy`) but does **not** advance the ladder. The entry is kept for the record to explain gaps in coverage.

The highest state in the ledger is the achieved state; degraded entries are honest reporting, not failure.

## Gate Levels

Artifact workflows enforce gate levels that determine which checks run before distribution:

| Level | Purpose | Checks | Render |
|-------|---------|--------|--------|
| **fast** | Draft approval, internal review | Structural validity, source linting | No |
| **standard** (default) | Pre-export validation | Structural validity, source linting, export success, content roundtrip | No |
| **render-smoke** | Visual confidence check | All standard checks + render to images, optional diagram quality | Yes |
| **full-certification** | Compliance gate | All render-smoke checks + per-format accessibility at strict level | Yes |
| **human-reviewed** | Production release | All full-certification checks + recorded human visual review verdict | Yes |

## Integration with Workflows

The `artifact-completion` module is consumed by:

- **Manifest validator** — tracks required states per artifact type
- **Publish pipeline** — records evidence from each export step
- **Workflow reporter** — displays the state ladder and current position in run summaries
- **MCP tools** — `artifact_workflow` and `publish_run` report completion ledgers
- **Authoring handoff** — `author_artifact`, `runConstructArtifactLoop`, and `construct publish` return a compact lifecycle object (`planned` through `published`) with the next required action; this is separate from the 12-rung completion ledger above but uses overlapping vocabulary at the user boundary

Use `construct publish --preview` to render an export and inspect screenshots before recording a visual-review verdict.
