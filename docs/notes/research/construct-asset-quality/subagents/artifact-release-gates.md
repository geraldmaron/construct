---
intake: none
---

# Subagent Evidence Report: Artifact release gates

## 1. Summary

The artifact release gate system has three distinct layers: (1) a manifest-driven PostToolUse advisory hook that runs during drafting (non-blocking); (2) a CLI validator (`construct artifact validate`) for explicit pre-commit checks; and (3) a certification runner that validates golden fixtures against the full gate matrix. The gate treats validity as a binary state rather than distinguishing between completion stages (generated/exported/rendered/reviewed/approved). A frontmatter bypass mechanism (`cx_release_gate: bypass` + `cx_release_gate_reason`) exists and is safe because it requires explicit documented justification. No CONSTRUCT_SKIP_* escape hatches are present, confirming policy compliance. The hook is strictly advisory (exit 0 always on PostToolUse, no blocking), suppressed when stderr is not a TTY or in CI/test contexts. Full gating happens in CI via the certification pipeline and during explicit CLI validation.

## 2. Evidence table

| Finding | Evidence file | Evidence | Confidence |
|---|---|---|---|
| Hook is advisory-only, non-blocking | lib/hooks/artifact-release-gate.mjs | Lines 1-16: header states "PostToolUse advisory structure/visual gate"; line 9 "does not block the edit"; line 43 `process.exit(0)` always, regardless of result. | **HIGH** |
| Hook auto-suppresses when not interactive | lib/hooks/artifact-release-gate.mjs | Lines 21-26: `shouldEmitNotice()` returns false when `CI=true`, `NODE_ENV=test`, or `!process.stderr.isTTY`. Complies with project policy (CLAUDE.md: "notice-only signals auto-suppress in non-interactive contexts"). | **HIGH** |
| Full gate runs via CLI validation | lib/artifact-release-gate.mjs | Lines 206-237: `runArtifactValidateCli()` runs `validateArtifactRelease()` with actual file content; exits(1) on `!result.ok`. Documented in `lib/artifact-gate-notice.mjs:34` as the user-facing flow. | **HIGH** |
| Full gate runs in certification/CI | lib/certification/runner.mjs | Lines 52-59: `runGate()` handler for `gate.type === 'artifact-release-gate'` invokes `validateArtifactRelease()` with rootDir context; result.ok determines pass/fail. Line 76: `artifact-golden-audit` gate validates all golden fixtures via `validateAllGoldenArtifactGates()`. | **HIGH** |
| Bypass mechanism exists and is safe | lib/artifact-release-gate.mjs | Lines 168-189: `parseReleaseGateFrontmatter(filePath)` checks for `cx_release_gate: bypass` + `cx_release_gate_reason` in YAML frontmatter. Returns ok=true and `bypassed: true` *only* if reason is present (line 170-179). Errors if bypass set without reason (line 171-179). | **HIGH** |
| No CONSTRUCT_SKIP_* vars in artifact gates | lib/artifact* (all files) | Grep result: zero matches for CONSTRUCT_SKIP, CONSTRUCT_ALLOW, CONSTRUCT_QUIET in artifact-*.mjs or lib/artifact/* files. Confirmed policy compliance. | **HIGH** |
| Gate checks are manifest-driven | lib/artifact-release-gate.mjs | Lines 53-122: `validateArtifactBodyCore()` reads `entry.releaseGate` from manifest (line 62). Invokes `lintDocStructure()`, `lintDocVisuals()`, citation checks, prose minimums, and required reviewers from manifest config. | **HIGH** |
| Gate checks manifest entry | lib/artifact-release-gate.mjs | Lines 132-135, 163-166: Both `validateArtifactBody()` and `validateArtifactRelease()` retrieve artifact entry via `getArtifactEntry(resolvedType)`. Return early with errors if type is unknown. | **HIGH** |
| Gate distingu-ishes between structural, visual, citation, prose, and reviewer checks | lib/artifact-release-gate.mjs | Lines 69-111: Separate checks for `structuralLint` (line 69), `lintDocVisuals()` (line 71), `citationLint` (line 77), `proseMinimum` (line 93), `missingRequiredReviewers()` (line 102). Each configurable per artifact type via manifest. | **HIGH** |
| Typed artifacts identified by path pattern, frontmatter, or explicit arg | lib/artifact-type-from-path.mjs | Lines 14-83: `inferArtifactTypeFromPath()` checks frontmatter `cx_doc_type` first, then directory heuristics (docs/prd, docs/adr, .cx/research), then filename hints. CLI arg `--type=` overrides all. `isArtifactGatePath()` (line 57-63) identifies gate-eligible paths. | **HIGH** |
| Golden fixture matrix written deterministically, no timestamp drift | lib/certification/artifact-gates.mjs | Lines 61-68: `writeArtifactGateMatrixDoc()` writes JSON with deterministic content (no timestamp field), enabling byte-identical regeneration. Comment on line 59-60 explains: "committed gate matrix is a deterministic projection… no wall-clock field." | **HIGH** |
| Required reviewers read from manifest + agent log | lib/artifact-reviewers.mjs | Lines 47-68: `missingRequiredReviewers()` gets required list from manifest (`entry?.releaseGate?.requiredReviewers`), checks against agent log reader (`readAgentLogReviewers()`), and returns missing subset. | **HIGH** |
| Reviewers warning is non-blocking, appears in full gate results | lib/artifact-release-gate.mjs | Lines 102-111: Missing reviewer check returns warning (line 110), not error; final result has ok=true if only warnings (line 115). Hook never blocks on reviewer gaps. | **HIGH** |
| Gate does not distinguish completion states (generated/exported/rendered/approved) | lib/artifact-release-gate.mjs | Lines 155-204: `validateArtifactRelease()` returns result object with `ok` boolean, errors[], warnings[], tone, type, filePath, bypassed flag. No fields for completion state or multi-stage validation. Treats artifact validity as binary. | **HIGH** |
| Oracle read-model surfaces bypass artifacts and reviewer gaps | lib/oracle/artifact-gate.mjs | Lines 80-112: `collectArtifactGateSignals()` gathers bypassed artifacts (line 81), reviewer gaps (line 82), and specialist audit. Returns `bypassed[]`, `bypassCount`, `reviewerGaps[]`, `reviewerGapCount`, `reviewerGateArmed` for dashboard observability. | **HIGH** |
| Citation lint enforced in full gate, advisory on hook | lib/artifact-release-gate.mjs | Lines 77-90: `citationLint` check (part of full gate, line 77) fails gate if citations < 1 and no [unverified] marker. Skipped for shipped templates (line 78). Same check runs in hook via `checkArtifactGateNotice()` but returns advisory only. | **HIGH** |
| Prose minimum configurable per type in manifest | specialists/artifact-manifest.json | Lines 28-34 (prd), 99-105 (adr), 149-159 (research-brief): each type declares `proseMinimum` (e.g. prd=3, adr=2, research-brief=2). Default is 0. Checked in line 93-98 of artifact-release-gate.mjs. | **HIGH** |
| Visual requirements matrix hard-coded + manifest-merged | lib/templates/visual-requirements.mjs | Lines 17-30: STRUCTURE_REQUIREMENTS merges manifest + LEGACY_STRUCTURE. VISUAL_REQUIREMENTS loaded from manifest. Enforced via `validateArtifactPostconditions()` (lines 78-92). | **HIGH** |
| Golden fixture test confirms all types pass their gates | tests/certification/artifact-gates.test.mjs | Lines 16-25: test "all golden artifact fixtures pass release gates" runs `validateAllGoldenArtifactGates()` and asserts `result.pass === true`. Golden fixtures live in tests/fixtures/artifacts/<type>/golden.md. | **HIGH** |
| Hook + CLI + certification form a three-layer stack | lib/hooks/artifact-release-gate.mjs vs lib/artifact-release-gate.mjs vs lib/certification/runner.mjs | Hook (PostToolUse, advisory), CLI (explicit validation, blocks on exit), Certification (golden matrix + CI gate). Each layer independent; hook does not block drafting, CLI blocks pre-commit, certification blocks merge. | **HIGH** |
| CI gates:audit does NOT check artifact release gates | lib/gates-audit.mjs | Lines 43-62: GATE_DEFINITIONS table has no entry for "artifact-release-gate". Audit checks test, retrieval, CVE, secret scan, postgres, docs drift, comment policy, template policy. Artifact gates are part of the certification/evals pipeline (separate), not the per-commit local/CI enforcement audit. | **HIGH** |

## 3. Existing mechanisms

1. **Manifest-driven artifact registry** (`specialists/artifact-manifest.json`):
   - Single source of truth for document types (prd, adr, rfc, research-brief, runbook, memo, prfaq, strategy, incident-report, postmortem, signal-brief, evidence-brief).
   - Per-type declarations: template path, primary owners, workflow skill, tone, structure requirements, visual requirements, release gates.
   - Release gates per type include: `structuralLint`, `citationLint`, `proseMinimum`, `requiredReviewers`, `optionalReviewers`.

2. **Type inference system** (`lib/artifact-type-from-path.mjs`):
   - YAML frontmatter `cx_doc_type` takes precedence.
   - Directory heuristics (docs/prd, docs/adr, .cx/research, etc.).
   - Filename hints (prd, adr, rfc, research, runbook).
   - CLI `--type=` argument overrides all.
   - `isArtifactGatePath()` identifies gate-eligible markdown under docs/** and .cx/research/**.

3. **PostToolUse advisory hook** (`lib/hooks/artifact-release-gate.mjs`):
   - Runs after Write/Edit/MultiEdit on typed documents.
   - Checks structure + visuals via `checkArtifactGateNotice()` (no citation, prose, or reviewer checks).
   - Exit 0 always; no blocking.
   - Auto-suppressed when stderr not TTY, CI=true, or NODE_ENV=test.
   - p95 latency: 80ms (from hooks-inventory.md).

4. **Full validation engine** (`lib/artifact-release-gate.mjs`):
   - `validateArtifactBody()` for in-memory validation (used in CLI and testing).
   - `validateArtifactRelease()` for file-based validation (used in CLI and certification).
   - Checks: structure, visuals, citations, prose minimum, required reviewers.
   - Each check configurable via manifest `releaseGate` block.

5. **Bypass mechanism** (`lib/artifact-reviewers.mjs`):
   - `parseReleaseGateFrontmatter(filePath)` reads YAML frontmatter fields.
   - `cx_release_gate: bypass` + `cx_release_gate_reason: <justification>` enables bypass.
   - Bypass requires reason (lines 170-179 of artifact-release-gate.mjs); fail if reason missing.
   - Oracle signals bypass artifacts for observability.

6. **CLI validator** (`construct artifact validate <path> --type=<type> [--json]`):
   - Explicit per-artifact validation, exit 1 on fail.
   - JSON output mode for tooling integration.
   - Documented in notice hook and artifact-gate-notice.mjs line 34.

7. **Golden fixture certification** (`lib/certification/artifact-gates.mjs`):
   - `validateAllGoldenArtifactGates()` validates all golden fixtures against their type's gate.
   - `artifactGateMatrix()` exports structure + visual requirements per type.
   - Matrix written deterministically to tests/certification/artifacts/gate-matrix.json.
   - CI gate in certification pipeline.

8. **Certification runner integration** (`lib/certification/runner.mjs`):
   - `runGate()` handler (line 52-59) executes artifact-release-gate.
   - `artifact-golden-audit` gate (line 75-77) validates all golden fixtures.
   - Both feed into verdict derivation and run record persistence.

9. **Oracle read-model** (`lib/oracle/artifact-gate.mjs`):
   - `collectArtifactGateSignals()` gathers bypass artifacts + reviewer gaps.
   - Surfaces to dashboard for observability (bypass audit trail, reviewer attendance).

## 4. Confirmed gaps

1. **No completion-state distinction**:
   - The gate treats validity as binary (ok=true/false) and has no fields for completion stages.
   - No way to distinguish: "generated but not exported", "exported but not reviewed", "approved for publication".
   - Implication: an artifact passing the gate is "complete" only in the sense that it meets structural/citation/prose/reviewer criteria. Export, review approval, or publication state are not tracked by the gate itself.
   - Severity: **DESIGN** — not a defect, but a deliberate scope boundary.

2. **Reviewer checks only warn, never block gate**:
   - Missing required reviewers generate warnings (artifact-release-gate.mjs line 110), not errors.
   - Final result ok=true even if reviewersSeen gaps exist.
   - Implication: gate passes before all required specialists see the artifact.
   - Severity: **MODERATE** — reviewer attendance is observed (Oracle signals) but not enforced in the gate itself. Policy may intend enforcement.

3. **Citation lint only checks presence, not depth**:
   - Current check (artifact-release-gate.mjs lines 85-88): citations < 1 AND no [unverified] marker → error.
   - No validation of citation *quality*, format consistency, or accessibility of URLs.
   - Implications: artifacts can pass with single URL or arxiv:XXXX without verifying they support claims in prose.
   - Severity: **MODERATE** — presence gate is pass/fail; depth enforcement would require a separate auditor or reviewer feedback loop.

4. **Gates:audit does not include artifact gates**:
   - lib/gates-audit.mjs GATE_DEFINITIONS table (lines 43-62) has no entry for artifact-release-gate.
   - Implication: the local/CI/branch-protection consistency audit does not verify that artifact gates are configured consistently across drafting (hook), validation (CLI), and certification (CI).
   - Severity: **LOW** — artifact gates are part of the certification/evals pipeline, not the per-commit enforcement audit. But gates-audit could be extended to spot missing golden fixtures or orphaned manifest entries.

5. **No explicit link between manifest types and skill workflows**:
   - Manifest declares `workflowSkill` per type, but no validation that the skill exists or is wired correctly.
   - Severity: **LOW** — caught by skill-inventory certification if skill is missing, but not cross-checked against manifest at gate-execution time.

## 5. Unconfirmed concerns

1. **Do tests adequately cover all artifact types?**
   - tests/artifact-release-gate.test.mjs covers: prd (golden), adr (golden + structure check).
   - tests/functional/artifact-release-gate.functional.test.mjs covers: prd (fail + bypass), adr (success).
   - tests/certification/artifact-gates.test.mjs confirms all golden fixtures pass.
   - **Unverified**: Do all manifest types have golden fixtures? (artifact-gates.test.mjs line 44-46 flags missing fixtures, but does not list which types are missing.)

2. **Does the hook's 80ms budget hold under load?**
   - Documented p95 in hooks-inventory.md line 62: 80ms.
   - Unverified: performance under large artifacts, deep directory trees, or slow disk I/O.

3. **Are citation patterns exhaustive?**
   - artifact-release-gate.mjs lines 38-46 define patterns: http(s)://, arxiv:, [source:], (accessed YYYY-MM-DD).
   - Unverified: whether these cover all domain-specific citation formats (DOI, ISBN, internal doc links, Git URIs, etc.).

4. **Reviewer log format stability**:
   - artifact-reviewers.mjs line 19-27 reads `.cx/agent-log.jsonl`, expects `agent` or `specialist` fields.
   - Unverified: format stability if agent-log schema evolves; error handling if log is malformed.

5. **Frontmatter parser robustness**:
   - artifact-type-from-path.mjs and artifact-reviewers.mjs both parse frontmatter (lines 14-28 and 30-44).
   - Both slice(0, 4096) to limit reads; both catch errors silently.
   - Unverified: behavior on edge cases (frontmatter > 4KB, malformed YAML, quotes in values, binary files).

## 6. Asset-quality contract opportunities

1. **Contract: Artifact type registration**
   - Precondition: new artifact type added to manifest.
   - Postconditions:
     - Template exists at declared path (manifest.artifacts[type].template).
     - Golden fixture exists at tests/fixtures/artifacts/<type>/golden.md.
     - Golden fixture passes its own release gate (validateArtifactRelease).
     - Structure requirements matched by golden fixture (lintDocStructure).
     - Visual requirements matched by golden fixture (lintDocVisuals).
     - No orphaned templates in templates/docs/ without manifest entry.
   - Enforcement: extend artifact-gates.test.mjs to validate completeness; flag missing golden fixtures as critical.

2. **Contract: Release gate manifest integrity**
   - Precondition: entry.releaseGate declared in manifest.
   - Postconditions:
     - If structuralLint=true, structureRequirements is non-empty.
     - If visualRequirements is non-empty, each requirement has a valid `check` function.
     - proseMinimum is a non-negative integer.
     - requiredReviewers is an array; each reviewer role exists in specialists registry.
   - Enforcement: schema validation in artifact-manifest.schema.json + runtime audit in certification.

3. **Contract: Bypass justification completeness**
   - Precondition: artifact has `cx_release_gate: bypass` in frontmatter.
   - Postconditions:
     - cx_release_gate_reason is present and non-empty.
     - Reason is logged to Oracle read-model for audit trail.
     - PR body linking artifact must cite the bypass reason.
   - Enforcement: validateArtifactRelease already requires reason; extend Oracle to emit audit event on bypass.

4. **Contract: Reviewer chain completeness**
   - Precondition: artifact.releaseGate.requiredReviewers is non-empty.
   - Postconditions:
     - All required reviewers appear in .cx/agent-log.jsonl before artifact is committed.
     - Violations surface in Oracle read-model with artifact path, missing reviewer list.
     - Agent log is not truncated or corrupted (hash/signature verification).
   - Enforcement: extend reviewer checks to error (not warn) in certification gate; require explicit bypass if reviewer chain incomplete at commit time.

5. **Contract: Citation authority**
   - Precondition: artifact.releaseGate.citationLint=true.
   - Postconditions:
     - Each citation is resolvable (URL reachable, arxiv ID exists, DOI resolves).
     - Citation appears within 3 sentences of the claim it supports.
     - No orphaned citations (present in artifact but not referenced in prose).
   - Enforcement: integration hook or AI judge (deep-link verification + semantic proximity check).

6. **Contract: Golden fixture currency**
   - Precondition: artifact type exists in manifest.
   - Postconditions:
     - Golden fixture is byte-identical across deterministic re-generation.
     - Gate matrix is byte-identical on every CI run (confirms golden fixtures are stable).
     - If manifest releaseGate changes, golden fixture must be re-validated or re-generated.
   - Enforcement: CI gate compares golden fixture hash against prior run; flag drift as non-critical advisory.

## 7. Render or visual-review requirements

1. **Hook notice needs visual audit**:
   - Current output (artifact-gate-notice.mjs line 31-37) is plain text to stderr.
   - Opportunity: surface violations in a dashboard widget during drafting (similar to context-watch token-budget visualization).
   - Would benefit from: inline artifact-path highlighting, section-name autocomplete suggestions, visual diff of required vs. present sections.

2. **Golden fixture showcase**:
   - Opportunity: docs site gallery of golden artifacts per type, showing passing structure + visuals.
   - Would document: what a "correct" artifact looks like for each type, examples of each visual requirement (mermaid diagram, table format, etc.).

3. **Release gate matrix dashboard**:
   - Gate matrix (tests/certification/artifacts/gate-matrix.json) is JSON; no visual representation.
   - Opportunity: render matrix as a heatmap or table in docs site, showing which types have which checks enabled.

4. **Bypass audit trail**:
   - Oracle collects bypassed artifacts but no dashboard widget surfaces them.
   - Opportunity: session-end notification if any bypasses were used, with links to justification + PRs.

## 8. Tests needed

1. **Comprehensive golden fixture coverage**:
   - Add assertion in artifact-gates.test.mjs (or new test file) to verify every manifest type has a golden fixture.
   - List missing types as critical failure.

2. **Reviewer chain enforcement**:
   - Add test in artifact-release-gate.test.mjs: artifact with requiredReviewers but no agent-log entries should fail gate in certification context (or warn in CLI context).
   - Verify Oracle surfaces gaps correctly.

3. **Bypass audit trail**:
   - Add functional test: artifact with bypass bypasses gate, Oracle logs it, bead linking artifact includes bypass reason.

4. **Citation resolution**:
   - Add optional CI test (gated by `CONSTRUCT_CERTIFY_LIVE=1`): attempt HTTP HEAD on all URLs in golden fixtures; warn on 404/timeout.

5. **Frontmatter edge cases**:
   - Add unit tests for artifact-type-from-path.mjs and artifact-reviewers.mjs:
     - Frontmatter > 4KB (truncated, still parses).
     - Malformed YAML (safely returns null).
     - Non-ASCII characters in field values.
     - Quote escaping in cx_release_gate_reason.

6. **manifest schema coverage**:
   - Add JSON schema validation test: every manifest.artifacts[type].releaseGate matches expected shape.
   - Verify no unknown keys in releaseGate block.

7. **Template + manifest coupling**:
   - Add test: for each artifact type, verify template file exists at declared path.
   - Verify no orphaned templates (templates/docs/*.md without manifest entry).

## 9. Docs needed

1. **Release gate reference** (new or expanded):
   - Per-type release gate configuration guide.
   - Examples: what does structuralLint=true enforce? What are the structure requirements for prd?
   - How to interpret citations errors vs. prose minimum vs. reviewer gaps.
   - Link to artifact-manifest.json as authoritative source.

2. **Bypass justification guide**:
   - When is bypass appropriate? (executive review-only drafts, redacted docs, etc.)
   - How to write a justification that passes audit trail review.
   - Examples of good vs. poor bypass reasons.

3. **Golden fixture gallery**:
   - Docs site page: one golden artifact per type, with annotations explaining structure + visuals.
   - Link from artifact-manifest.json docs.

4. **Reviewer chain setup**:
   - Guide to resolving "requiredReviewers not seen in agent log" warnings.
   - How to log specialist participation in .cx/agent-log.jsonl.
   - When reviewer gaps are acceptable (e.g., early-stage drafts).

5. **Citation format guide**:
   - Supported citation patterns: URLs, arxiv, [source:], (accessed YYYY-MM-DD).
   - How to cite internal docs (relative paths? wiki links?).
   - What counts as a valid citation for citationLint.

6. **Three-layer gate architecture diagram**:
   - Visual explaining hook (advisory) → CLI (validation) → certification (CI enforcement).
   - When each layer runs, which checks each performs, how results feed into each other.

7. **Type inference walkthrough**:
   - Decision tree: frontmatter → directory → filename → failed inference.
   - How to set cx_doc_type in new artifacts.
   - Inference rules for each type (prd, adr, rfc, research-brief, etc.).

## 10. Dependency and degradation concerns

1. **Manifest availability**:
   - Fallback: EMPTY_MANIFEST if manifest not found (artifact-manifest.mjs line 50-52).
   - Implication: artifact types return empty, gate becomes no-op.
   - Risk: silently accepting invalid artifacts if manifest corrupted or missing.
   - Mitigation: artifact-manifest.schema.json should be validated on load.

2. **Agent log dependency**:
   - Reviewer checks require `.cx/agent-log.jsonl` to exist.
   - Fallback: returns empty Set if log missing (artifact-reviewers.mjs line 16-18).
   - Implication: all requiredReviewers marked as missing if log absent.
   - Risk: false positives if .cx/ not initialized in upstream projects.

3. **Golden fixture stability**:
   - Matrix written deterministically; used in CI certification.
   - If golden fixture edited by hand (not regenerated), matrix becomes stale.
   - Risk: matrix-CI discrepancy if commit includes golden fixture hand-edit + stale matrix.
   - Mitigation: CI gate validates golden fixtures always pass; matrix regeneration is deterministic.

4. **Skill availability**:
   - Manifest declares workflowSkill per type; no runtime check that skill exists.
   - Implication: type can be registered without corresponding skill implementation.
   - Risk: users may request artifact type for which no workflow exists.
   - Mitigation: skill-inventory certification flags missing skills; docs encourage co-registration.

5. **Hook execution latency under load**:
   - Hook p95 is 80ms; actual latency depends on artifact size, linting complexity.
   - Risk: hook exceeds budget on large artifacts; visible delay during drafting.
   - Mitigation: async hook execution available; but current implementation is synchronous.

6. **Frontmatter parser robustness**:
   - Parser slices 4KB; assumes YAML-like key: value format.
   - Risk: edge cases (truncated frontmatter, non-UTF8 encoding, embedded frontmatter delimiters) may silently fail.
   - Mitigation: errors caught silently; returns safe defaults (no bypass, no type override).

## 11. Questions for Opus

1. **Should reviewer checks error (not warn) in the certification gate?**
   - Current: missing required reviewers generate warnings; gate still passes.
   - Policy question: is it acceptable for an artifact to be certified/merged before all required specialists see it?
   - Recommendation: clarify intent; if enforcement desired, promote warnings to errors in certification context (keep warnings in CLI for user feedback).

2. **Should completion states (generated/exported/reviewed/approved) be tracked by the gate or by external workflow?**
   - Current gate is binary (valid/invalid); no multi-stage workflow recognition.
   - Design question: should the gate distinguish "draft but not exported" vs. "exported but not reviewed" vs. "ready to merge"?
   - Or should completion states live in the artifact-workflow system or beads tracking?

3. **Should citation depth (semantic proximity, URL reachability) be part of the release gate?**
   - Current: citation presence only (>= 1 citation OR [unverified] marker).
   - Feasibility question: add deep-link validator? AI judge for semantic relevance?
   - Scope question: is this a gate responsibility or a reviewer feedback loop?

4. **Should gates:audit (lib/gates-audit.mjs) include artifact gates?**
   - Current: artifact gates are part of certification/evals pipeline, excluded from per-commit enforcement audit.
   - Coverage question: should the audit check for orphaned manifest entries, missing golden fixtures, or manifest-template coupling?

5. **Should bypass justifications be validated semantically (not just present)?**
   - Current: cx_release_gate_reason just requires non-empty string.
   - Policy question: should bypass reasons match a whitelist (e.g., "executive-review-only", "redacted", etc.)?
   - Or is free-form text sufficient for audit trail?

6. **Should the hook offer autocomplete/suggestions for missing sections?**
   - Current hook output is list of violations; no suggested fixes.
   - UX question: would interactive suggestions (e.g., "missing Problem section; would you like to add one?") improve drafting experience?

## 12. Suggested bead updates

(Note: Bead creation is out of scope for this audit; recommendations below are for Opus or the orchestration team.)

1. **[Enhancement] Promote reviewer warnings to errors in certification context**
   - Title: "enforce requiredReviewers in certification gate"
   - Description: modify lib/certification/runner.mjs to treat missing required reviewers as gate failure (not warning) in certification context. Keep warnings in CLI for user feedback during drafting.
   - Files: lib/artifact-release-gate.mjs, lib/certification/runner.mjs.
   - Tests: artifact-release-gate.test.mjs, artifact-gates.test.mjs.

2. **[Enhancement] Extend gates:audit to include artifact gate coverage**
   - Title: "add artifact gate checks to gates:audit"
   - Description: extend lib/gates-audit.mjs GATE_DEFINITIONS table to verify artifact-release-gate is configured in certification pipeline; check for orphaned manifest entries, missing golden fixtures.
   - Files: lib/gates-audit.mjs, lib/gates-audit-report.mjs.
   - Tests: tests/gates-audit.test.mjs.

3. **[Feature] Add golden fixture gallery to docs site**
   - Title: "render artifact type gallery with golden fixtures"
   - Description: create docs page (e.g., docs/guides/reference/artifact-gallery.md) showcasing golden artifacts for each type, with annotations explaining structure + visual requirements.
   - Files: docs/guides/reference/artifact-gallery.md, apps/docs (if using docs site builder).

4. **[Documentation] Release gate reference guide**
   - Title: "document per-type release gate configuration"
   - Description: create comprehensive reference in docs/guides/concepts/artifact-gates.md explaining gate layers (hook/CLI/certification), per-type config (structuralLint, citationLint, proseMinimum, requiredReviewers), interpretation of error messages.
   - Files: docs/guides/concepts/artifact-gates.md, docs/guides/reference/artifact-manifest.md.

5. **[Test] Comprehensive golden fixture validation**
   - Title: "assert all manifest types have golden fixtures"
   - Description: extend tests/certification/artifact-gates.test.mjs to verify every artifact type in manifest has a golden fixture file. List missing types as test failure.
   - Files: tests/certification/artifact-gates.test.mjs.

6. **[Feature] Bypass audit trail in Oracle**
   - Title: "emit audit event for release gate bypass"
   - Description: extend lib/oracle/artifact-gate.mjs to emit structured audit events when artifact bypasses gate. Include artifact path, bypass reason, timestamp, PR link. Surface in dashboard or session-end report.
   - Files: lib/oracle/artifact-gate.mjs, lib/oracle/audit-events.mjs (new).

7. **[Test] Frontmatter parsing edge cases**
   - Title: "test frontmatter parser robustness"
   - Description: add unit tests for artifact-type-from-path.mjs and artifact-reviewers.mjs covering edge cases: truncated frontmatter, malformed YAML, non-ASCII, quote escaping, binary files.
   - Files: tests/artifact-type-from-path.test.mjs (new), tests/artifact-reviewers.test.mjs (new).
