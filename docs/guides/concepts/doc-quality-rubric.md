<!--
docs/guides/concepts/doc-quality-rubric.md — the bar for "research-grade" Construct artifacts.
Defines the dimensions every template and authored document is judged on, and the
per-family expectations. Paired with ADR-0018; the structural subset is enforced by
lib/templates/visual-requirements.mjs (STRUCTURE_REQUIREMENTS).
-->
# Document quality rubric

"Research-grade" means a domain expert in the relevant field would recognize the document as professional work, not a placeholder. Every Construct template and every authored artifact is judged on seven dimensions. The structural ones (completeness, visuals) are mechanically enforced; the rest are review standards.

## Dimensions

1. **Evidence grounding** — every load-bearing claim traces to a verifiable source with a date and an Admiralty grade ([ADR-0017](../../decisions/adr/0017-source-credibility-taxonomy.md)). Cite **inline** with a clickable link or `[source: …]` per [citation.md](../../../rules/common/citation.md); References alone are not enough. No fabrication ([rules/common/no-fabrication.md](../../../rules/common/no-fabrication.md)). *Enforced by citation-validity + optional `--check-links` fetch.*
2. **Methodology / reproducibility** — the document states how it was produced (search terms, sources queried, inclusion decisions) so another person could reproduce it ([research.md §7](../../../rules/common/research.md)).
3. **Confidence calibration** — confidence is stated and tied to source quality, not authorial conviction; the strongest counter-evidence is named.
4. **Completeness** — every section a domain expert expects for this doc type is present and non-empty. *Enforced by `STRUCTURE_REQUIREMENTS`.*
5. **Visual legibility** — the document carries the visual its purpose demands (a runbook a decision flowchart, an incident a timeline, an RFC a sequence diagram), per [doc-visual-matrix.md](doc-visual-matrix.md). Published PDFs use type-specific Typst layouts with bundled product-editorial typography (compact masthead, running header/footer, unnumbered sections, blockquote callouts) and crisp diagram styling with a field-notebook ink accent. Tables use horizontal rules and roomy cell padding so text does not collide with grid lines or figure frames; callout labels sit in-flow (not overdrawn on borders). *Enforced.*
6. **Decision-forcing** — the document drives a decision or action, not just description: it carries the acceptance criteria, severity rationale, kill criteria, or thresholds its family requires. Phased delivery docs also carry a human **Why?** per phase (who benefits, what risk it reduces) — see `skills/docs/artifact-authorship.md`.
7. **Worked example** — templates for non-obvious doc types ship a filled-in example, so an author sees the bar rather than guessing it.
8. **Inclusive / human framing** — named roles and contexts; impact on people who are helped or harmed; avoid ableist or gendered defaults; accessibility is product quality where UI ships.
9. **Multi-persona tension** — substantive fingerprints from recruited Worker Profiles (researcher, architect, privacy/legal, a11y, ops/QA, engineer, reviewer) in Requirements, Risks, and Open questions — not Contributors name-drops alone.
10. **Human voice** — careful-colleague prose: prefer contractions; avoid spaced em dashes and LLM tells; engaging and concrete without fabricating warmth. Exceptions for ACs, legal shall/must, quoted statute, and exact required section titles. See [`rules/common/human-voice.md`](../../../rules/common/human-voice.md) and [`skills/docs/artifact-authorship.md`](../../../skills/docs/artifact-authorship.md).

## Grades

- **Strong** — meets all seven dimensions; an expert would respect it. (e.g. PRD, ADR, RFC, test-plan.)
- **Adequate** — sound structure but missing depth an expert would catch: a named methodology framework, confidence calibration, or decision-forcing element.
- **Thin** — placeholder-level; fails completeness or evidence grounding. Not shippable.

## Per-family expectations

- **Decision docs** (ADR, RFC, PRD, meta-PRD) — rejected alternatives with specific reasons; reversibility/consequences; acceptance criteria; cited evidence for every requirement; Phase Why? on phased PRDs/meta-PRDs; YAML masthead preferred over sterile body Date/Owner blocks.
- **Research docs** (research-brief, evidence-brief, signal-brief, research-finding) — sources table with class + Admiralty grade; observation separated from inference; confidence per finding; counter-evidence; reproducible method.
- **Operational docs** (runbook, incident-report) — severity-to-action mapping; for incidents, root cause separated from contributing factors and trigger, a timeline, and action items with owners and priority ([Google SRE postmortem culture](https://sre.google/workbook/postmortem-culture/)); for runbooks, an error-budget/severity frame and a diagnostic decision tree ([Google SRE error-budget policy](https://sre.google/workbook/error-budget-policy/)).
- **Strategy / business docs** (strategy, prd-business, prfaq) — what-must-be-true, kill criteria, leading and lagging metrics, alternatives rejected.
- **Compliance / privacy** (compliance-memo, DPIA) — obligation→control with verified or `[unverified]` cites; no invented case law; counsel gates before marketing claims; human subjects named by role.

## References

- [ADR-0018 (document quality standard)](../../decisions/adr/0018-document-quality-standard.md), [ADR-0017 (source taxonomy)](../../decisions/adr/0017-source-credibility-taxonomy.md)
- [Google SRE: Postmortem Culture](https://sre.google/workbook/postmortem-culture/), [Error Budget Policy](https://sre.google/workbook/error-budget-policy/)
- [doc-visual-matrix.md](doc-visual-matrix.md), [rules/common/research.md](../../../rules/common/research.md)
