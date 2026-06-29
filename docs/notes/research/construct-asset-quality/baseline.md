---
intake: none
---

# Asset Quality Program — Phase 0 Baseline

Status: read-only baseline. No code changed. No Beads created. No agents dispatched.
Date: 2026-06-29
Working branch: `audit/best-practice-alignment` (clean tree)

## 1. Working tree

`git status --short` → empty. Clean tree, so the prompt's dirty-tree isolation concern does not apply this run.

## 2. Existing Beads relevant to asset quality

`bd list` → 24 issues (18 open, 4 in_progress). One is directly in scope:

| ID | Status | Title | Relevance |
|---|---|---|---|
| `construct-amfg` | in_progress, P1 | Artifact generation: polish PDF layout and list fidelity | Directly overlaps Epic 5 (PDF export quality). Must be reconciled — not duplicated — when the bead tree is finalized. |

No existing epic covers visual/render certification. The chat-TUI epic (`construct-m4gw`) is unrelated (terminal rendering, not generated artifacts).

## 3. Test status

Full suite NOT re-run this session (plan-and-stop scope; re-running 3544 tests is wasted spend for a planning pass). Most recent recorded state from session context:
- `npm run release:check` — passed; 3544 tests, 0 failures, 42 skipped; docs/checks/comment-lint/certification/template gates green.
- Treat as the baseline-green reference. Wave 2 will re-establish green before any implementation lands.

## 4. CLI surface (probed live)

| Command | Exists | Notes |
|---|---|---|
| `construct artifact validate\|workflow` | yes | Manifest structure, citation, reviewer checks; `workflow --apply` runs *local validation/export after approval*. Truthful plan/run reporting already present. |
| `construct publish <md> [--to=...]` | yes | Release gate + export to pdf/docx/deck/pptx/html/rtf/odt/epub/tex/txt/md/mdx; `--figures` renders d2/mermaid; `--no-gate` escape hatch; `--strict` exit 2. |
| `construct certify list\|run\|gate\|status` | yes | Scenario-based certification under `.cx/certification/` with a release-candidate gate that blocks on stale/failing evidence. |

Takeaway: this is **extend-not-greenfield**. Release gate, multi-format export, figure rendering, and a certification harness already exist.

## 5. Manifest / contract surface (read live)

`specialists/artifact-manifest.json` — registry-first, **27 artifact types** (prd, prd-platform, adr, rfc, research-brief, runbook, postmortem, strategy, memo, prfaq, one-pager, threat-model, system-design, security-review, …).

Each artifact entry declares: `vibeProfile`, `template`, `primaryOwners`, `structureRequirements[]`, `visualRequirements[]`, `releaseGate`.

`specialists/artifact-manifest.schema.json` `$defs`: `visualRequirement`, `releaseGate`, `workflowDefaults`, `validation`, `outputs`, `artifactEntry`.

### Load-bearing observations (grounded, drive the gap thesis)

1. **`visualRequirements` are source-level only.** The `check` vocabulary observed is `artifact-has-mermaid` and `artifact-table-has-columns` — i.e. "does the Markdown source contain a mermaid block / a table with these columns." Nothing renders the exported artifact and inspects the pixels/layout. *(prd entry, manifest)*
2. **`releaseGate` schema has only source-level fields:** `structuralLint`, `citationLint`, `proseMinimum`, `requiredReviewers`, `optionalReviewers`. No render gate, no visual-review gate, no accessibility gate, no completion-state field. *(schema `$defs.releaseGate`)*
3. **`outputs` is defined in the schema (`formats[]` + `branding` enum) but NO artifact declares it.** Output formats are inferred at publish time, not declared per artifact type. So "which formats must this type ship in, and at what gate level" is not expressible today. *(manifest scan: 0/27 declare `outputs`)*
4. The completion vocabulary is binary in practice: validated/exported ≈ done. There is no declared distinction between planned / authored / structurally-valid / source-linted / exported / file-valid / renderable / screenshot-captured / visually-reviewed / accessibility-reviewed / approved / completed.

These four are the spine of the program: the contract surface is excellent at *source* QA and silent about *rendered-output* QA.

## 6. Key file sizes (audit scoping)

| File | Lines |
|---|---|
| `lib/deck-export-pptx.mjs` | 1152 |
| `lib/contracts/validate.mjs` | 628 |
| `lib/document-export.mjs` | 534 |
| `lib/diagram.mjs` | 302 |
| `lib/artifact-release-gate.mjs` | 237 |
| `lib/templates/visual-requirements.mjs` | 93 |
| `lib/templates/doc-presentation.mjs` | 63 |

All 28 audit-referenced files exist (`OK` on every path). The 11 subagent assignments are grounded — no missing-file dead ends.

## 7. Unverified assumptions (to confirm in audit, not asserted here)

- Whether `construct publish --figures` actually *renders* mermaid/d2 to an image or only passes a filter (the source-only path suggests rendering can be skipped). [unverified]
- Whether `lib/deck-export-pptx.mjs` (1152 lines) already does post-export XML bounds checks vs. only generation. [unverified]
- Whether any path captures a screenshot/page-image of any exported format. Probable answer: no. [unverified]
- Whether `tests/e2e/lib/artifact-quality.mjs` asserts on rendered output or on source. [unverified]
- Degradation behavior when a renderer (libreoffice/headless chrome/mermaid-cli/d2) is absent — typed and reported, or silent skip-and-pass. [unverified]

## 8. Scope decision for this run (per owner)

User selected **Plan & stop** + **Draft Beads first, confirm**. Therefore this pass produces:
- this baseline,
- a drafted bead tree (epic + 12 child epics + audit beads) in `synthesis/final-bead-tree.md` — NOT written to the `bd` tracker,
- traffic-jam analysis with selected resolutions (`traffic-jams.md`),
- 11 ready-to-dispatch subagent assignments (`subagent-assignments.md`) — NOT dispatched.

Stop point: before any `bd` write, before any agent dispatch, before any implementation.
