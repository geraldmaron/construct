# ADR-0035: Test Strategy — Extend, Not Rebuild

- **Date**: 2026-06-10
- **Status**: accepted
- **Deciders**: Construct maintainers (cx-architect, cx-qa)
- **Supersedes**: none

## Problem

Bugs have shipped from Construct that the test suite did not catch, and the suite is large enough
(~300 test files, tens of thousands of lines) that the cost of maintaining it is real. The decision-
forcing question is whether the suite's *architecture* is wrong — in which case continuing to invest
in it is throwing good effort after bad — or whether the architecture is sound and the escapes trace
to a different cause that a rebuild would not fix. Choosing wrong is expensive in both directions:
rebuilding a sound suite destroys working regression coverage, while extending a broken one keeps
shipping bugs.

## Context

An escape analysis (`docs/research/2026-06-construct-audit/70-test-infra-verdict.md`) mined 18
shipped-and-fixed bugs from git history, CHANGELOG, and the issue tracker, and classified each by the
test layer that should have caught it. The distribution:

- **67% (12/18)** were catchable by a layer that already exists — the test was missing or wrong. [source: docs/research/2026-06-construct-audit/70-test-infra-verdict.md]
- **22% (4/18)** needed the host-emulation layer, which is already roughly 60% built [source: docs/research/2026-06-construct-audit/70-test-infra-verdict.md]
  (`tests/functional/host-mcp-emulation.functional.test.mjs`, `tests/e2e/local-model-ab.mjs`,
  `tests/helpers/ollama-record-proxy.mjs`, and the in-flight epic for it).
- **11% (2/18)** genuinely require a live model or binary (live-e2e). [source: docs/research/2026-06-construct-audit/70-test-infra-verdict.md]

The suite is integration-weighted (about 65% of files spawn a real binary or import a real `lib/` [source: docs/research/2026-06-construct-audit/70-test-infra-verdict.md]
module; about 22% touch mocks), and the mocks that exist are faithful failure injectors (for example [source: docs/research/2026-06-construct-audit/70-test-infra-verdict.md]
the docling stub exits non-zero to mirror the real provisioning hang). The single most telling fact:
the same fire-and-forget async-write defect shipped twice, six months apart, in two different files —
and that exact class of bug is the functional suite's own canonical example in
`tests/functional/README.md`. The suite re-shipped a bug its own documentation names.

## Decision

Extend the existing test architecture; do not rebuild it. Specifically:

1. **Finish the live-host-session layer.** Complete the host-emulation suite so a real OpenCode (and
   Claude) session can be driven end-to-end against Construct, with retry-and-skip semantics for the
   known headless `opencode run --format json` intermittency (empty output is recorded as a FLAKY-SKIP,
   not a pass and not a hard failure, so the flakiness stays observable).
2. **Add value telemetry where only latency exists.** Hooks carry `@p95ms` budgets but no record of
   how often each fires, blocks, or mutates; rules have no retrieval telemetry at all. Instrument both
   so future consolidation decisions rest on data, not guesses.
3. **Close the discipline gap, not just individual bugs.** When a fix lands for a bug class the suite's
   own docs already name (async write durability, cross-process visibility), the regression test is
   mandatory and the class is added to a checklist the functional README enforces, so a named class
   cannot silently re-ship.

## Rationale

The escape distribution is the decision driver. Two-thirds of escapes were catchable by layers that
already exist, which means the foundation is not the failure — coverage discipline is. A rebuild
addresses the architecture, so it cannot fix a discipline problem; it would instead delete the 65% of [source: docs/research/2026-06-construct-audit/70-test-infra-verdict.md]
integration-weighted tests that are doing real work and reset the regression corpus to zero. The 22% [source: docs/research/2026-06-construct-audit/70-test-infra-verdict.md]
that needed a new layer point not at a rebuild but at *finishing* a layer that is already most of the
way there, which is additive. The twice-shipped, self-named bug class is direct evidence that the
missing ingredient is enforcement of the discipline the suite already documents, not a new suite.

## Rejected alternatives

- **Rebuild the suite from scratch.** Rejected: it would destroy working integration-weighted
  regression coverage to fix a problem (discipline) that a rebuild does not address; only 11% of [source: docs/research/2026-06-construct-audit/70-test-infra-verdict.md]
  escapes were genuinely hard to test, so there is no architectural defect large enough to justify the
  loss. The strongest version of this case — survivorship bias, and the suite's blindness to the
  live-model collapse that motivated the audit — is real but is answered by *adding* the live-host
  layer, not by discarding the rest.
- **Keep the suite unchanged.** Rejected: the host-emulation gap is real (22% of escapes), and the [source: docs/research/2026-06-construct-audit/70-test-infra-verdict.md]
  absence of hook/rule value telemetry means consolidation decisions would stay guesswork. Doing
  nothing leaves both the live-model blind spot and the discipline gap open.
- **Restructure aggressively (re-tier most tests).** Rejected on the evidence: it would be warranted
  only if most escapes needed a non-existent layer or most files were happy-path mocks; the measured
  numbers (22% and 22% respectively) are well below the thresholds that would justify it. [source: docs/research/2026-06-construct-audit/70-test-infra-verdict.md]

## Consequences

- The live-host-session layer becomes the priority test investment; once finished it covers the
  maintainer's top pain (local-model coherence in a real host) and the 22% of escapes that needed it. [source: docs/research/2026-06-construct-audit/70-test-infra-verdict.md]
- Hooks and rules gain value telemetry, unblocking the proliferation-driven consolidation in later
  work without guessing.
- A named-bug-class checklist adds a small, enforced discipline step to fixes; the cost is a slightly
  heavier fix workflow, paid to stop re-shipping known classes.
- The existing unit + functional + e2e layering is affirmed, so contributors keep writing tests in the
  established shape.

## Reversibility

Two-way door. Every change here is additive (a new layer, new telemetry, a checklist); none rewrites
or deletes existing tests. If the live-host layer proves too flaky to be worth it, it can be quarantined
to opt-in e2e without affecting the rest. Falsified-if a re-classification of escapes finds more than
half needed a layer that does not exist, or more than 60% of files prove to be happy-path mocks — either [source: docs/research/2026-06-construct-audit/70-test-infra-verdict.md]
would flip the verdict toward restructure and should trigger a revisit.

## References

- `docs/research/2026-06-construct-audit/70-test-infra-verdict.md` (escape table and distribution)
- `docs/research/2026-06-construct-audit/80-synthesis.md` (item 1)
- `tests/functional/README.md` (the canonical async-write example and the suite philosophy)
- ADR-0029 (per-hook performance budgets — the latency-only baseline this extends)
