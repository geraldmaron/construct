---
intake: none
---

# Subagent Evidence Report: Diagram & drawing quality

## 1. Summary

Construct enforces diagram **syntax presence** via postconditions (artifact-has-mermaid, artifact-table-has-columns) but does not validate diagram **quality, readability, or usefulness**. Diagrams are generated (via `construct diagram` and `construct wireframe`), source-controlled as text (D2, Mermaid, dot), and rendered at publish time through pandoc-ext/diagram with hand-drawn styling. No system currently inspects: diagram purpose/relevance, node density, label presence or readability, happy-path vs. error-path coverage, or sequence-diagram participant coherence. Diagrams are validated for **existence only**, not for **design intent**. Visual rendering (SVG/PNG) happens at publish time but the output is not reviewed or verified for legibility — render failures degrade gracefully to source-only output.

## 2. Evidence table

| Finding | Evidence file | Evidence | Confidence |
|---------|---------------|----------|------------|
| Diagram syntax is enforced via postconditions | lib/contracts/validate.mjs:518–522 | `artifact-has-mermaid` check requires fenced ```mermaid block; optionally verifies diagram kind (flowchart, sequenceDiagram, etc.) by regex on block content | high |
| No diagram quality/density/label validation | lib/contracts/validate.mjs:383–390 | `hasMermaid()` only checks for block presence and optional kind keyword; does not inspect node count, label text, path coverage, or structure | high |
| Diagrams are text-first, source-controlled | lib/diagram.mjs:1–28 | Comment states "renderers are detected at runtime"; diagram.mjs outputs .d2, .dot, or .md (Mermaid) source; wireframe.mjs outputs Mermaid in markdown | high |
| No render output verification | lib/diagram.mjs:286–302 | Render status checked (exit code) but rendered SVG/PNG is not inspected for legibility, density, or label readability; command exits 0 on render failure | high |
| Wireframe generator infers type from description | lib/wireframe.mjs:38–46 | Type inference uses keyword matching (flow, state, sequence, er, user-journey, layout) but does not validate that generated structure fits the described problem | high |
| Node/label density not checked | lib/wireframe.mjs:59–74 | Keywords extracted and seeded into diagram templates, but stop-word filtering and max=8 is not based on any cognitive load or readability study | medium |
| Mermaid syntax-only in wire validation | tests/template-visuals.test.mjs:34–44 | Tests verify template has a ```mermaid block of the right kind; do not inspect block contents for quality, path coverage, or label clarity | high |
| Table column requirements enforced | lib/contracts/validate.mjs:530–541 | `artifact-table-has-columns` requires named columns and ≥1 data row; does not validate table purpose, data density, or relevance to artifact | high |
| Diagram.mjs degrades gracefully to source | lib/diagram.mjs:274–302 | When no renderer is installed or render fails, source file is written and command exits 0; no quality gate exists | high |
| Designer role includes empty/error states | skills/roles/designer.md:26–29 | Role guidance lists "empty states as afterthought" as anti-pattern and requires "empty, loading, error, and end-of-list states as first-class screens" in self-check | high |
| Diagram purpose not referenced in doc-visual-matrix | docs/guides/concepts/doc-visual-matrix.md:6–22 | Matrix requires specific diagram kinds (flowchart, sequenceDiagram, etc.) by document type; does not specify purpose (what the diagram teaches) or quality gates beyond type | high |
| Happy-path + error-path guidance in RFC template | templates/docs/rfc.md:25–37 | Template comment says "include the happy path and at least one error path" but this is prose guidance, not validated | medium |
| Wireframe types inferred but not validated | lib/wireframe.mjs:319–347 | `generateWireframe()` infers type from description and generates scaffold; caller never validates that generated structure answers the stated problem | medium |
| Artifact-manifest defines visual requirements | specialists/artifact-manifest.json:23–46 | PRD requires `artifact-has-mermaid` (diagram: flowchart) and `artifact-table-has-columns`; runbook, rfc, adr, prfaq, incident-report, postmortem, strategy, one-pager, test-plan all have diagram/table requirements | high |
| Publish pipeline renders diagrams but does not QA | lib/publish.mjs:1–80 | `runPublish()` routes to pandoc-ext/diagram for figure rendering; no output validation or render-quality gate documented | medium |
| No render-time quality checks in D2/dot wrappers | lib/diagram.mjs:157–185 | `renderWithD2()` and `renderWithDot()` capture exit code and stderr; do not analyze rendered SVG/PNG for legibility, over-crowding, or label placement | high |

## 3. Existing mechanisms

1. **Syntax validation via postconditions** (lib/contracts/validate.mjs:518–522): `artifact-has-mermaid` enforces presence of a fenced ```mermaid block and optionally verifies the diagram kind (flowchart, sequenceDiagram, etc.) by regex. **Scope: syntax only.**

2. **Document type → visual requirements mapping** (specialists/artifact-manifest.json): 20+ artifact types declare required visuals (flowchart, sequenceDiagram, table with specific columns). **Scope: structure/presence only.**

3. **Template scaffolding** (templates/docs/prd.md, rfc.md, runbook.md, etc.): Each template carries an example diagram fenced block. **Scope: presence, not quality.**

4. **Wireframe generator** (lib/wireframe.mjs): Produces low-fi Mermaid scaffolds from natural-language descriptions. **Scope: automation, not validation.**

5. **Diagram command** (lib/diagram.mjs): Renders D2/Graphviz to SVG/PNG; degrades to source-only when no renderer or render fails. **Scope: rendering only; no quality gate.**

6. **Designer role guidance** (skills/roles/designer.md, cx-designer.md): Requires designed empty/error/loading states and visible primary actions; does not extend to diagrams. **Scope: UI design, not diagrams.**

7. **RFC template prose guidance** (templates/docs/rfc.md): Comment says "include the happy path and at least one error path." **Scope: advisory only, not enforced.**

## 4. Confirmed gaps

1. **No diagram purpose validation**: System does not check whether a diagram answers the question posed in the artifact or is relevant to the context. Presence ≠ usefulness.

2. **No density or readability checks**: No validation of node count, edge count, label length, or visual crowding. A 50-node flowchart with 1-character labels is syntactically valid.

3. **No path coverage validation**: Diagrams are not inspected for:
   - Happy path completeness (entry → success exit).
   - Error/edge-case paths (at least one failure mode per RFC, ADR, runbook).
   - Missing decision branches (flowcharts should have decision diamonds, not just linear nodes).

4. **No label/annotation quality check**: No validation that:
   - Edge labels describe the transition (not "A → B" but "A → B: on success").
   - Node labels are clear and domain-specific (not "Step1", "Step2").
   - Sequence participants are coherent (a sequence diagram for a three-tier system should name the three tiers, not generic "User", "System", "Service").

5. **No render-time quality gate**: SVG/PNG output is not inspected for:
   - Legibility (font size, contrast, line weight).
   - Label overflow or truncation.
   - Overlapping nodes/edges.

6. **Wireframe type inference not validated**: `inferType()` guesses diagram kind from keywords; the generated scaffold is never verified against the stated problem.

7. **No visual-review workflow**: Designer, product manager, or architecture roles do not have a contract that requires them to review or sign off on diagrams before publication.

8. **Render-failure degradation is silent**: When D2 or dot fails, the command exits 0 and writes source only. No warning in the artifact's frontmatter or release-gate output that visuals were not rendered.

## 5. Unconfirmed concerns

1. **Pandoc-ext/diagram rendering quality**: Published PDFs render Mermaid and D2 via a Lua filter; whether hand-drawn styling (`--sketch`, `handDrawn`) produces legible output is not documented or tested. (See diagram-and-demo.md line 27 mention of "hand-drawn distribution styling" but no render QA gate.)

2. **Mermaid syntax validity beyond type**: `artifact-has-mermaid` checks for the keyword (e.g., "flowchart") but not whether the Mermaid source is valid syntax. Invalid Mermaid can render as a broken/empty diagram.

3. **C4Context and architecture diagrams**: doc-visual-matrix.md recommends C4Context for architecture but does not mention how that is enforced or generated.

4. **Table data density**: `artifact-table-has-columns` enforces column presence and ≥1 row; does not validate that table is appropriately sized (empty headers, hundreds of rows, unbalanced cell widths).

5. **Diagram version-control strategy**: Diagrams are source-controlled as text (.d2, .mmd, .dot), but whether reviewers in PRs actually inspect Mermaid/D2 source for quality (or only see "syntax valid") is unknown.

## 6. Asset-quality contract opportunities

1. **Diagram-purpose postcondition**: Add an optional `artifact-diagram-has-purpose` check that inspects a diagram comment or a preceding prose description to verify relevance to the artifact's goal.

2. **Path-coverage postcondition**: For flowcharts, add `artifact-flowchart-has-error-path` that checks for at least one branch other than linear progression. For sequenceDiagrams, add `artifact-sequence-has-note` to verify error/alternate paths are annotated.

3. **Label-density postcondition**: Add `artifact-diagram-label-coverage` that ensures:
   - No unlabeled nodes in the diagram.
   - No edge without a label (or a specific label style, e.g., "request", "success", "timeout").
   - Mermaid source line count / node count ≤ some threshold (e.g., 3 lines per node as a density proxy).

4. **Render-quality gate at publish**: Before finalizing PDF export, optionally inspect rendered SVG for:
   - Minimum font size (≥11pt for body text, ≥8pt for labels).
   - No truncated labels (bounding-box overflow).
   - Minimum visual distinction (nodes should not overlap).

5. **Diagram-review workflow**: Add a visual-review specialist (or extend cx-designer role) to the release gate for artifacts with required diagrams. Contract: designer must sign off that diagram structure, labels, and coverage align with artifact intent.

6. **Wireframe-type validation**: After `generateWireframe()`, add a postcondition that compares inferred type against the stated problem context and flags mismatches.

7. **Render-status frontmatter**: When publish renders diagrams, add a frontmatter field (`diagrams_rendered: true|false`) so consumers (release notes, dashboards, PDF compilers) know whether visuals were rendered or source-only.

## 7. Render or visual-review requirements

1. **Current state**: `lib/diagram.mjs` outputs .d2/.dot/.md; rendering via D2 or Graphviz is **optional** and gracefully degrades. No render-quality check.

2. **Publish-time rendering**: `lib/publish.mjs` routes to pandoc-ext/diagram (mentioned in diagram-and-demo.md); diagram rendering is part of the PDF export pipeline, but output is not inspected.

3. **SVG/PNG legibility**: No system currently renders a diagram and inspects the output for text size, label overflow, or node/edge overlap.

4. **Recommended additions**:
   - Optional render-time QA: scan SVG (via an xpath/SVG-DOM library) for minimum font size, text overflow, node overlap detection.
   - Optional visual-review gate: require cx-designer or cx-architect to inspect rendered output before publication.
   - Frontmatter flag: track whether diagrams rendered successfully (vs. source-only) so later tools know the output quality.

## 8. Tests needed

1. **Diagram syntax invalid but present**: Test that a ```mermaid block with malformed Mermaid (e.g., `flowchart TD A --> B --> C ->`) passes postcondition (it should; today only checks keyword presence).

2. **Mermaid Syntax validity checker**: Add a test that validates Mermaid source against mermaid-cli's syntax (requires `npm install -g @mermaid-js/mermaid-cli` at test time).

3. **Wireframe type inference edge cases**: Test that `inferType("a user flow for onboarding")` produces "user-journey" and `inferType("database schema")` produces "er", not mismatches.

4. **Render failure graceful degradation**: Test that `construct diagram` produces source file and exits 0 even when D2/dot render fails (currently passes; document as formal test).

5. **Label coverage validation**: Test helpers that count nodes vs. edge labels in Mermaid source to validate density assumptions.

6. **Sequence participant count**: Test that RFC templates with 3-tier sequences name all three participants (not fallback to User/System/Service).

7. **Flowchart decision path coverage**: Test that runbook flowcharts have at least one decision diamond (not all linear nodes).

## 9. Docs needed

1. **Diagram quality rubric** (`docs/guides/concepts/diagram-quality-rubric.md`): Define what makes a diagram useful:
   - Purpose: diagram title or adjacent prose explains what the reader should learn.
   - Density: recommended node count per diagram type (flowchart ≤ 15 nodes; sequence ≤ 5 actors).
   - Labels: all nodes named; edges labeled with decision/action, not generic arrows.
   - Paths: flowchart has a decision (≥1 non-linear branch); sequence has an error note; state has entry/exit.

2. **Mermaid style guide** (`docs/guides/cookbook/mermaid-style-guide.md`): Conventions for diagram authoring:
   - Node naming (use domain terms, not "A", "B", "C").
   - Edge labels (describe the transition, not just the arrow).
   - Decision branches (use `{...}` for decisions, `[...]` for endpoints).
   - Error paths in sequences (use `Note over` or `autonumber` to mark failure flows).

3. **Diagram review checklist** (extend designer.md or create `skills/roles/designer.diagrams.md`):
   - [ ] Diagram title and adjacent prose explain its purpose.
   - [ ] All nodes named with domain terms.
   - [ ] All edges labeled (or explicitly decision diamonds only).
   - [ ] At least one error or alternate path (flowchart/sequence/state).
   - [ ] Rendered legibly (font ≥11pt, no truncation, no overlap).

4. **D2/dot vs. Mermaid guidance**: Document when to use each (D2 for architecture/diagrams needing sketch mode; Graphviz for legacy; Mermaid for version control + GitHub preview).

## 10. Dependency and degradation concerns

1. **D2 and Graphviz are optional**: lib/diagram.mjs gracefully degrades; no bundled binaries. When absent, source-only output is written. **Concern**: No frontmatter flag indicates source-only status, so downstream tools (PDF compiler, dashboard) may not know rendering failed.

2. **Mermaid CLI required for headless export**: diagram-and-demo.md notes mermaid-cli pulls headless-Chromium (ADR-0001 disallows npm-core dependencies). Mermaid is used for **source generation only** (via wireframe.mjs), not rendering. **Concern**: If a user commits Mermaid source expecting it to render in PDF, publish must have mermaid-cli available or source-only gracefully degrades.

3. **Pandoc-ext/diagram for publish**: Publish pipeline routes to Lua filter for diagram rendering. **Concern**: If pandoc-ext/diagram fails, no fallback is documented. Construct must verify or test this path.

4. **Render-failure feedback is silent**: When D2/dot/Mermaid render fails, the command exits 0. **Concern**: Users may not realize diagrams were not rendered in the output; no warning in logs or frontmatter.

## 11. Questions for Opus

1. **Visual-review gate**: Should diagrams require sign-off from cx-designer or cx-architect as a release-gate postcondition, similar to how cx-reviewer signs off on code review findings?

2. **Render-time QA**: Is it in-scope to add optional SVG analysis (text size, overlap detection) at publish time to catch unreadable diagrams before export?

3. **Mermaid syntax validation**: Should postcondition `artifact-has-mermaid` also validate Mermaid syntax (requires mermaid-cli or similar), or is presence sufficient?

4. **Purpose validation**: Should diagrams require an adjacent prose paragraph or comment stating their purpose, validated as a postcondition?

5. **Wireframe scaffolding**: Should `construct wireframe` output be treated as a starting point that must be manually reviewed, or as a valid first-pass diagram ready to commit?

6. **Density thresholds**: Are there cognitive-load studies or design guidelines Construct should adopt (e.g., max 15 nodes per flowchart, max 5 actors per sequence)?

## 12. Suggested bead updates

1. **Feature: Diagram quality postconditions** — Add `artifact-diagram-has-purpose`, `artifact-flowchart-has-error-path`, `artifact-diagram-label-coverage` checks. (Depends: Mermaid parser / AST walk for node/edge counting.)

2. **Feature: Visual-review gate for diagrams** — Extend release gate: artifacts with required diagrams route to cx-designer for visual review before publish. (Depends: Designer workflow update.)

3. **Feature: Render-status frontmatter** — When publish renders diagrams, track success in frontmatter (`diagrams_rendered: true|false`; `diagram_render_errors: [...]`). (Depends: Publish pipeline instrumentation.)

4. **Docs: Diagram quality rubric** — Write docs/guides/concepts/diagram-quality-rubric.md with density, label, path-coverage guidelines. (No code dependencies.)

5. **Docs: Mermaid style guide** — Write docs/guides/cookbook/mermaid-style-guide.md with naming, edge-label, decision-path conventions. (No code dependencies.)

6. **Test: Mermaid syntax validation** — Add test that invalid Mermaid fails a postcondition (opt-in via `artifact-mermaid-syntax-valid`). (Depends: Mermaid parser availability.)

7. **Refactor: Render-output inspection** — Optionally scan SVG for legibility issues (font size, text overflow, overlap) at publish time. (Depends: SVG DOM library or regex heuristics.)
