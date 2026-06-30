---
intake: none
---

# Asset Quality — Risk Register (Phase 3 Synthesis)

Risks to the PROGRAM and to artifact consumers. Severity = (likelihood × consumer/visual impact). Each carries a mitigation tied to an epic.

| # | Risk | Sev | Likelihood | Mitigation | Owner epic |
|---|---|---|---|---|---|
| R1 | Silent render degradation ships a broken artifact as "complete" (raw diagram source / fallback fonts in distributed PDF) | **Critical** | High (paths exist today, see findings §3) | Typed degradation enum; a skipped render downgrades completion state, never forges it; surface a frontmatter/result warning flag | E3, E5, E6 |
| R2 | Visual review becomes subjective/flaky and erodes trust in the gate | **High** | Medium | Hard split deterministic vs judgment (visual-quality-matrix); judgment requires rubric + stored evidence artifact | E3, E8 |
| R3 | Completion-state expansion accidentally lets a state be forged from source (claims "reviewed"/"rendered" without evidence) | **High** | Medium | Every new rung requires an evidence object (actor/timestamp/artifact/digest/proof); reuse workflow's no-forgery invariant; test that no state is reachable without proof | E9, E1 |
| R4 | Render tooling absent in CI/headless → gates either block everything or silently pass | **High** | High | Five gate levels; render-smoke/full-cert only at the levels that declare the renderer required; typed `unavailable-renderer` degradation with explicit reason; reuse `detect()` surface | E11, E3 |
| R5 | Parallel implementation agents collide on golden/snapshot fixtures | **High** | High (if unmanaged) | No goldens in audit (done); one owner per fixture family (deck/diagram/document/source); file locks per bead; fixture-regen gating | E10 |
| R6 | Pixel/visual regression suite makes every local run unbearably slow | **High** | Medium | Visual regression only at full-certification level, never `fast`; rasterization opt-in; CI-only; document the perf budget | E11, E10 |
| R7 | Accessibility reduced to alt-text only, missing contrast/reading-order/headings | Medium | Medium | Per-format a11y matrix enumerating each check + what's not machine-checkable (reported honestly) | E8 |
| R8 | Branding chrome reduces legibility (low contrast, tight spacing) and no test catches it | Medium | Medium | WCAG AA contrast validator on brand tokens; centralized spacing scale; branded-vs-plain comparison fixtures | E7, E8 |
| R9 | New schema fields break the 27 existing artifacts / golden matrix (backward-compat) | Medium | Medium | All new manifest fields optional with safe defaults; regenerate golden matrix deterministically; parity test 27×formats before/after | E1, E10 |
| R10 | Model-based visual review becomes "magic" (claimed without a rendered image) | Medium | Medium | `visual-reviewed` state reachable only with a stored rendered image + rubric + report; CLI/MCP output states exactly what was checked | E3, E9 |
| R11 | `construct-amfg` (existing PDF/list work) diverges from or duplicates Epic 5 | Medium | Medium (already in flight) | Folded into Epic 5 as first slice (note appended to amfg); Epic 5 acceptance subsumes it | E5 |
| R12 | Unauthenticated reviewer log entries spoof required-reviewer sign-off | Medium | Low | Out-of-scope for visual program but filed; flag in Epic 9 completion-state work where reviewer evidence is consumed | E9 (+ security follow-up) |
| R13 | Per-commit gates-audit never checks artifact-gate config drift across hook/CLI/cert | Low | Medium | Add artifact-gate entry to `gates-audit.mjs` GATE_DEFINITIONS | E11 |
| R14 | DOCX/PPTX content silently lost vs source (no roundtrip), undetected | Medium | Medium | Text-extraction roundtrip validators per format (textRatio, missingPhrases) | E5 |
| R15 | Scope sprawl: program tries to build asset classes (image/screenshot/video) before the contract is proven | Medium | Medium | Phase 7 ordering enforced; asset-class registry is a contract proposal (E1), not Wave-2 implementation | E1 |

## Severity rollup
- **Critical: 1** (R1 — the silent-degradation-ships-broken-artifact risk; this is the program's reason to exist).
- **High: 5** (R2–R6 — review reliability, forgeability, tooling availability, fixture collisions, perf).
- **Medium: 8 · Low: 1.**

## Top-3 to retire first (Wave 2–3)
1. **R1** — typed degradation + warning surface. Cheapest high-value win; turns silent failures into honest ones.
2. **R3** — evidence-object schema before any new completion state lands. Protects the truth model.
3. **R4** — gate-level + renderer-availability design before any render implementation. Prevents CI gridlock.
