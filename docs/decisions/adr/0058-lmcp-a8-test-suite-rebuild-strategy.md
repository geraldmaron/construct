<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0058: Test-suite rebuild strategy — acceptance-first strangler — LMCP-A8

- **Date**: 2026-07-03
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner), Construct maintainers (cx-architect)
- **Relates to**: ADR-0035 (test strategy extend-not-rebuild), ADR-0052 (unified provider manifest)
- **Supersedes**: ADR-0035 (strategy is changed, not extended)
- **Tracking**: LMCP-A8

## Problem

638 test files exist but cannot be trusted as a safety net. Three independent failure modes make the suite unreliable as a release signal:

**1. Hermetic mocks encode implementation details, not behavior.**
Unit tests mock the collaborators of the unit under test in ways that couple the test to internal function signatures rather than observable behavior. When an implementation changes structurally — even correctly — these tests fail for the wrong reason, or worse, pass when behavior has regressed because the mock short-circuits the actual path.

**2. CI masks optional dependency absences.**
`.github/workflows/ci.yml:132` installs `ink` and `react` before running tests. These are declared optional dependencies — the consumer install path does not include them. By pre-installing them in CI, the test suite never exercises the degradation path that a consumer encounters when optional deps are absent. The gap between "passes in CI" and "works for a consumer" is invisible.

**3. No packed-install acceptance exists.**
There is no test that does `npm pack → clean tmpdir install → construct doctor exits 0`. The test suite validates code paths in the source tree, not the artifact that is actually shipped. Packed-asset parity is checked only locally and only partially.

Additionally: `tests/audit/*.red.mjs` contains 31 intentional-red fixtures (tests that are expected to fail). These are placeholders for capability not yet landed, but their promotion criteria and expiry policy are undefined, so they accumulate without a removal path.

`package.json:61` — `test:visual` is a no-op, indicating prior investment in a surface that was abandoned without replacement.

## Decision

**Strategy 3: Acceptance-first, then staged deletion (strangler pattern).**

Build a trusted acceptance suite first. Use it to establish a green baseline. Delete legacy tests wave-by-wave using a triage rubric, replacing coverage gaps with acceptance tests rather than new unit tests.

### Acceptance contract list

The following acceptance contracts are to be built in LMCP-L beads. Each contract is a test (or test suite) that exercises the real artifact — the packed npm install, the live CLI, the live MCP server — not mocked internals:

| # | Contract | Pass condition |
|---|----------|---------------|
| 1 | **Packed consumer install** | `npm pack` → extract to clean tmpdir → `npm install` in tmpdir → `construct doctor` exits 0 → `construct status` returns `solo-degraded` (no model configured) |
| 2 | **Global install** | `npm install -g` from the packed tarball → same smoke path as contract 1 |
| 3 | **Mode acceptance matrix** | For each mode (`solo` / `team` / `enterprise`) × surface (`CLI` / `MCP` / `OpenCode`): `construct status` returns the correct mode name, the correct capability list per ADR-0057, and no capability marked `active` that is `not-implemented` |
| 4 | **Orchestration smoke** | Configure a model provider → call `orchestration_run` with a simple request → response has `degraded: false`, `tasks` array is non-empty, no hard error |
| 5 | **MCP tool contract** | For each MCP tool in the flat core and `call` gateway: an acceptance test verifies the tool's input schema is satisfied by a well-formed call and the output schema matches the declared response shape |

These contracts are the definition of "the build is shippable." A green acceptance suite overrides legacy test failures as a release gate. A failing acceptance suite blocks release regardless of unit test status.

### Triage rubric for keeping a legacy test

Before deleting a legacy test, apply this rubric. **Keep** if the test meets any of:

- Tests an acceptance contract (behavior visible to a consumer)
- Tests a security boundary (auth, policy, capability gate, input validation)
- Tests a documented invariant (a property stated in an ADR or in module JSDoc)
- Tests an error path that a user would observe (not an internal error that is only logged)

**Delete** if the test meets any of:

- Only tests internal function signatures or private module internals
- Mocks the unit under test's own collaborators in ways that hide the real behavior path
- Encodes a hardcoded implementation detail that changes with refactoring but not with behavior regression
- Duplicates coverage already provided by an acceptance contract

The triage rubric is applied per-test-file by the engineer performing deletion, with the decision recorded in the commit message or a deletion log (`tests/DELETION-LOG.md`).

### Red-fixture integration policy

`tests/audit/*.red.mjs` intentional-red fixtures are governed by the following policy:

- A red fixture is **promoted** to a full passing test when the corresponding bead lands and the capability is implemented.
- A red fixture not promoted within **90 days** of its creation date (recorded in the fixture's file header comment) is **deleted**. Deletion is not a failure; it means the capability was descoped or merged into a different path.
- The 90-day clock starts from the fixture's `@created` annotation. Fixtures without a `@created` annotation are treated as if created on the date this ADR is accepted.

### Deletion waves

Wave 1, Wave 2, and Wave 3 are executed sequentially after the acceptance suite is green:

| Wave | Target | Criterion |
|------|--------|-----------|
| Wave 1 | Tests that duplicate acceptance suite coverage | Acceptance contract already covers the behavior |
| Wave 2 | Tests that fail the triage rubric | Mock-heavy, signature-coupled, or detail-encoding tests |
| Wave 3 | Orphaned fixtures | Red fixtures past the 90-day promotion deadline |

Each wave is a separate PR with a deletion log entry and a post-wave CI run confirming the acceptance suite is still green.

### CI fix

Remove the pre-installation of `ink` and `react` from `.github/workflows/ci.yml` (currently at line 132). Optional dependencies must be absent in the CI environment used for acceptance testing to validate the consumer install path. A separate CI job (e.g., `test:with-optionals`) may install them to exercise the enhanced-display path, but the primary acceptance job must not.

## Alternatives considered

- **Strategy 1 — delete all unit tests, rewrite from scratch**: fastest path to a clean suite but destroys any existing coverage of real invariants. Rejected because the rubric identifies a non-trivial subset of legacy tests that test real behavior.

- **Strategy 2 — extend existing tests without deletion**: add acceptance tests on top of the existing 638. Rejected because the existing suite is actively misleading — it provides false confidence via CI-pre-installed deps and mock-short-circuited paths. Extending it without deletion preserves the false signal.

- **ADR-0035 "extend not rebuild"**: the prior strategy was correct when the test suite was smaller and more trusted. The evidence (CI masking, mock coupling, no packed acceptance) shows the suite has crossed the threshold where extension is no longer sufficient. This ADR supersedes ADR-0035.

## Consequences

- A green acceptance suite becomes the primary release gate; legacy test failures do not block release if acceptance is green and the triage rubric justifies the legacy failure.
- CI pre-install of optional deps is removed; optional-dep degradation paths are now validated in CI.
- Red fixtures older than 90 days are automatically candidates for deletion in Wave 3; engineers must annotate new fixtures with `@created`.
- The deletion log (`tests/DELETION-LOG.md`) provides an audit trail for each deleted test file.
- Unblocks: LMCP-L1..L8 (acceptance contract implementation beads).
