<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0018: Document quality standard — a research-grade bar with an enforced structural floor

- **Date**: 2026-06-03
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner)
- **Supersedes**: none
- **Status note (2026-06-29, self-audit construct-rr63.1.2)**: shipped and test-covered — enforced by `lib/templates/visual-requirements.mjs` (`STRUCTURE_REQUIREMENTS`) with `tests/structure-requirements.test.mjs`. Status corrected from `proposed` to reflect ground truth.

<!-- Owning specialist: cx-docs-keeper. Part of the template & prompt research-grade remediation (epic construct-7zrh). -->

## Problem

Construct's templates vary widely in depth: a third are expert-grade, half are usable but shallow, and a few are placeholders that would embarrass the system in front of a domain expert. Nothing defines what "good" is, so quality drifts with whoever last edited a template, and there is no way to tell a thin template from a finished one except by reading it. The same gap lets an authored document skip the sections its domain demands — an incident report with no root-cause/contributing-factor split, a research brief with no confidence calibration — and still pass review.

## Context

ADR-0015 established the enforce-don't-assert discipline and #192 built the machinery: artifact postconditions (`artifact-has-section`, `-section-nonempty`, `-has-mermaid`, `-has-table`, `-table-has-columns`), citation-validity in the artifact lint, and `lib/templates/visual-requirements.mjs`. ADR-0017 added the source taxonomy. What is missing is a stated quality bar and a structural floor that the existing machinery can hold. Most quality dimensions (methodology, calibration, decision-forcing) are judgment and resist mechanical checking; completeness and visual presence do not.

## Decision

Adopt a seven-dimension quality rubric (`docs/guides/concepts/doc-quality-rubric.md`) as the definition of research-grade, and enforce its **structural floor** mechanically: each doc type declares its required sections and visuals in a `STRUCTURE_REQUIREMENTS` map, checked by the postcondition engine, so a template or authored document that omits a required section or visual fails. The judgment dimensions remain review standards stated in the rubric, not gates.

## Rationale

A written rubric makes "thin vs done" a shared, citable standard instead of a matter of taste, and gives every remediation a target. Enforcing only the structural floor matches what is mechanically checkable: completeness and visuals are objective, while methodology quality is not — gating the latter would produce false confidence or block on subjective calls. The floor reuses machinery that already exists, so the cost is a data table and tests, not new infrastructure. This is the same soft-standard-plus-hard-floor split ADR-0015 affirmed.

## Rejected alternatives

- **Leave quality to review.** Rejected: review without a standard is inconsistent and unenforceable, which is how the current spread of thin-to-strong templates arose.
- **Enforce all seven dimensions.** Rejected: methodology, calibration, and decision-forcing are judgment calls; a mechanical check would either rubber-stamp prose that names a method without following it or block legitimate work on a subjective threshold.
- **A numeric quality score per document.** Rejected: a single score hides which dimension failed and invites gaming; a dimension checklist plus an enforced structural floor is more actionable and harder to fake.

## Consequences

Authoring a new doc type now requires declaring its required structure, or the structure test fails. Thin templates have a concrete definition of done and can be remediated against it. Reviewers cite rubric dimensions instead of debating taste. The judgment dimensions still depend on reviewer skill — the standard names them but cannot enforce them, and that limit is explicit rather than hidden.

## Reversibility

Two-way door. The rubric is a document and the floor is additive data + tests; removing them returns to unstandardized templates with no data loss. Revisit if the structural floor proves too rigid for a doc family, in which case that family's requirements are relaxed rather than the standard abandoned.

## References

- `docs/guides/concepts/doc-quality-rubric.md`, `lib/templates/visual-requirements.mjs` (`STRUCTURE_REQUIREMENTS`)
- ADR-0015 (hybrid architecture), ADR-0017 (source taxonomy)
- Google SRE postmortem culture — https://sre.google/workbook/postmortem-culture/
