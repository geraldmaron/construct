---
intake: none
---

# Subagent Evidence Report: Test coverage and release gate audit

> Agent J · model: Haiku · type: Explore (read-only) · Wave 1 · supervised by Opus.
> Structured output rendered by Opus; findings are the subagent's, not yet adjudicated.

## 1. Summary

Construct has 3544 tests across 505 test files with 3529 passing (1 failing, 14 skipped). The suite covers registry validation, MCP health, host parity, lifecycle migrations, and orchestration with 155+ functional tests. However, audit findings show gaps: no dedicated upgrade path fixtures in tests/fixtures; ADR-drift epic covered by only 1 test (adr-stamp-integrity checking body_hash); MCP discovery evaluation lacks systematic testing; best-practice validation minimal (2 tests); self-hosting scenarios untested (0 matches); and some epics like search/learning lack explicit functional scenario mapping.

## 2. Evidence table

| Finding | Evidence (file · observation) | Confidence |
|---|---|---|
| Actual test count confirms baseline: 3544 total tests, 3529 passing, 1 failing, 14 skipped | `tests/functional/audit-ratchet.functional.test.mjs:38` — npm test output shows pass count 3529, fail 1 (audit-ratchet), skipped 14 | confirmed |
| Release gate test suite exists but focuses on version, doctor, docs:verify, lint rules, and certify gate - missing end-to-end upgrade path validation | `tests/functional/release-gate.functional.test.mjs:30-157` — 15 tests in release-gate.functional.test.mjs covering --version, doctor, docs:verify, docs:update --check, docs:site --check, lint:comments, lint:agents, lint:contracts, doctor consistency, migrate --dry-run, daemon contract, rule-verifier, no-misleading-wording, certify gate, CHANGELOG | confirmed |
| ADR-drift epic has minimal coverage: 1 test (adr-stamp-integrity.test.mjs) checking body_hash verification only, no systematic ADR content drift or consistency checks beyond stamped entries | `tests/adr-stamp-integrity.test.mjs:21-30` — adr-stamp-integrity.test.mjs:21-30 contains single test 'every stamped ADR passes body_hash verification', no tests for ADR logical consistency, decision supersession, or undocumented ADR patterns | confirmed |
| Registry epic coverage is comprehensive: registry-validation.test.mjs with 13+ invariant checks, loader and phase tests, plus 6 registry subdirectory tests covering capabilities and catalog validation | `tests/registry-validation.test.mjs:58-80, tests/registry/capability-registry.test.mjs:17-48` — registry-validation.test.mjs describes 13 schema compliance invariants (lines 58-80), tests against real unified registry, registry/capability-registry.test.mjs validates capability registry, 505 total test files with 46 registry-related matches | confirmed |
| Lifecycle epic well-covered: w4-lifecycle-migrations.functional.test.mjs tests planMigrations, dry-run, version stamping, idempotency; models-legacy-config-migration.functional.test.mjs tests backward compatibility | `tests/functional/w4-lifecycle-migrations.functional.test.mjs:33-96, tests/functional/models-legacy-config-migration.functional.test.mjs:65-78` — w4-lifecycle-migrations tests schema version 0->2 migrations, checkCompatibility, runMigrations; models-legacy-config-migration tests CX_MODEL_* legacy variable migration into XDG config | confirmed |
| Host parity epic has 3 dedicated functional tests: host-config-parity validates canonical paths/keys/entry shapes across 6 IDE surfaces, host-mcp-emulation covers MCP server wiring, init-host-footprint tests project footprint | `tests/functional/host-config-parity.functional.test.mjs:60-100` — host-config-parity.functional.test.mjs line 60 tests VS Code .vscode/mcp.json (servers), Cursor .cursor/mcp.json (mcpServers), OpenCode .opencode/opencode.json (mcp), Codex .codex/config.toml, Claude .claude/agents, Copilot .github/prompts | confirmed |
| MCP epic tests exist but lack dedicated discovery evaluation: 46 MCP-related tests found (mcp-protocol-health, mcp-server, mcp-profile-tools, mcp-tools-doc-parity, etc.) but no systematic MCP discovery scenario testing | `tests/mcp-protocol-health.test.mjs:57-70` — grep found 46 files matching MCP pattern; mcp-protocol-health.test.mjs tests probeServer for broken HTTP endpoints but doesn't cover discovery workflows; 18 functional MCP tests focus on connection/parity not discovery evaluation | confirmed |
| Search epic has 58 retrieval/search-related tests (retrieval.test.mjs, engine-eval-retrieval, vector-client, embed-snapshot, knowledge-search) but systematic search scenario coverage unclear | `tests/intake-classifier-accuracy.test.mjs, tests/retrieval-bench.test.mjs` — grep -l 'search\|retrieval\|vector' found 58 test files; retrieval eval tests focus on embedding quality and classification accuracy rather than end-to-end search scenarios | likely |
| Documents epic has 113 document-related tests (doc-metadata, document-io, embed-docs-lifecycle, ingest-*) with functional coverage for export and ingestion but limited quality validation | `tests/functional/document-export.functional.test.mjs, tests/functional/docling-remote-ingest.functional.test.mjs` — 113 files matched 'document\|doc'; functional tests include document-export, docling-remote-ingest, node-native-extraction covering PDF/DOCX extraction but not comprehensive document format coverage | likely |
| Learning epic has minimal test coverage: grep found only 2 test files with 'learning\|training', no dedicated learning loop or feedback mechanism tests | `docs/README.md mentions learning loops but no corresponding functional test suite` — grep -l 'learning\|training' tests/*.test.mjs returned only 2 matches; no systematic coverage of A1-A4 learning workstreams mentioned in docs/README.md | confirmed |
| Best-practice epic has 2 tests (best-practice pattern matches) vs extensive operational guidance in codebase | `scripts/run-tests.mjs:15-16 documents sterility guard requirement but test coverage is indirect` — grep -r 'best.*practice\|best-practice' tests/ returned 2 test files; no systematic validation of recommended patterns like state isolation, sterility guards, or contract compliance | confirmed |
| Self-hosting epic has zero dedicated tests: grep -r 'self.*host\|self-host' tests/ returned 0 matches | `No evidence found for self-hosting test coverage` — No test files address self-hosting scenarios, local model deployment, or offline operational modes | confirmed |
| Orchestration epic well-covered with 14 unit tests (orchestration-policy*, orchestration-runtime, orchestration-worker, etc.) plus 4 functional tests (orchestration-mcp, orchestration-mode-a, orchestration-readiness, claude-orchestration-prompt) | `tests/orchestration-policy.test.mjs, tests/functional/orchestration-mcp.functional.test.mjs` — Find returned 10 unit test files plus 4 functional files; tests cover policy context packets, task graphs, run store (sqlite/postgres), runtime behavior, and worker contract | confirmed |
| No upgrade fixture suite exists in tests/fixtures: fixtures exist for artifacts, routing corpus, MCP tool schemas, golden surfaces, intake, publish, and document I/O but zero upgrade/version migration fixtures | `tests/fixtures/ directory inventory` — ls tests/fixtures/ and find tests/fixtures -name '*upgrade*' -o -name '*version*' -o -name '*migration*' returned no matches | confirmed |
| ADR test coverage incomplete: only 10 ADRs have @enforces markers in tests despite 40 ADRs in docs/decisions/adr/ | `tests/adr-stamp-integrity.test.mjs, docs/decisions/adr/ (40 files)` — grep -r '@enforces ADR-' tests/ returned 10 unique ADRs (ADR-0015,0016,0017,0018,0019,0020,0021,0022,0023,0030) vs 40 ADR files in docs/decisions/adr/ | confirmed |
| CI workflow has change-detection filters that skip heavy test matrix on doc-only PRs, but no explicit per-epic test gate mapping | `.github/workflows/ci.yml:34-288` — .github/workflows/ci.yml uses path filters to conditionally run code, retrieval, deps, agents, docs, docssite, templates, workflow tests; aggregator job ci-required treats skipped as pass | confirmed |
| Pre-release gate script (scripts/pre-release-check.mjs) checks 11 conditions but no epic-specific release validation: version alignment, CHANGELOG, npm test, lint, docs, npm audit, npm pack, npm auth | `scripts/pre-release-check.mjs:30-196` — pre-release-check.mjs runs 11 checks (git status, branch, version, .construct/version, CHANGELOG, npm test, lint:comments, docs:verify, npm audit, consumer audit, npm pack, npm auth) but no per-epic validation gates | confirmed |

## 3. Confirmed gaps

- Self-hosting epic: zero test files found (0 matches for 'self-host' patterns); no functional scenarios for local model deployment or offline modes
- Learning epic: only 2 test files with learning-related keywords despite A1-A4 learning workstreams documented in docs/README.md
- ADR-drift epic: only 1 test (adr-stamp-integrity) checking body_hash; no logical consistency, supersession chain, or undocumented ADR pattern tests
- Upgrade fixtures: no dedicated fixture suite in tests/fixtures for version migration scenarios; reliance on runtime migration testing only
- MCP discovery evaluation: no systematic eval harness for MCP server discovery workflows; existing tests focus on connection/protocol health not discovery
- Best-practice validation: only 2 test files match 'best-practice' patterns; no systematic state isolation, contract compliance, or naming convention enforcement tests
- Epic-to-test mapping: ci.yml workflow filters tests by file path (code, retrieval, deps, agents, docs) rather than by epic; no explicit gate per epic in release:check
- Search scenario coverage: 58 retrieval/search tests focus on embedding quality and accuracy but lack end-to-end search scenario validation

## 4. Unconfirmed concerns

- Registry consolidation: 'bound-orphan triage' test exists but unclear if all consolidation rules are covered end-to-end
- Documents format coverage: 113 document tests exist but scope of format support (Markdown, DOCX, PDF, PPTX) is unclear from grep alone
- Orchestration async/concurrency: orchestration tests focus on policy and runtime but unclear if async scheduling and deadlock scenarios are covered
- Host parity edge cases: host-config-parity tests canonical paths but unclear if env-var override interactions or host-specific legacy config migrations are covered
- ADR enforcement across codebase: 10 ADRs have @enforces markers but unclear if enforcement is tested at implementation level or only at ADR-stamp level

## 5. Registry / config / schema opportunities

- Epic-to-test registry: create a manifest mapping each epic to its test files (e.g., registry.json with epics[].tests array) instead of hardcoded file discovery in CI filters
- Release gate configuration: move pre-release-check.mjs gate list into a declarative schema (gates.json) with per-epic validation rules and skippable conditions
- ADR validation rules: encode ADR lint rules (logical consistency, supersession chains, stamping requirements) in a schema rather than ad-hoc test coverage
- Fixture index: create tests/fixtures/index.json declaring fixture purpose, covered scenarios, and compatible test suites to make fixture reuse discoverable
- MCP discovery eval suite: consolidate 46 scattered MCP tests into a systematic discovery eval harness with dedicated test scenarios for server registration, capability advertisement, and fallback behavior

## 6. Tests needed

- Upgrade path fixtures for v0->current, v1->current with legacy config states (present, absent, partial)
- Self-hosting functional scenarios: local model deployment, offline operation, private MCP server registration
- Learning loop end-to-end tests: persistence across sessions, A1-A4 workstream activation, feedback accumulation and signal decay
- ADR consistency validation: logical consistency checking, decision supersession chain validation, stamping requirement enforcement
- MCP discovery eval suite: server registration, capability advertisement, fallback routing, schema validation
- Best-practice enforcement: state isolation audits, contract compliance checks, naming convention validation
- Search scenario coverage: multi-stage retrieval ranking, relevance feedback, cross-project search scope, vector embedding quality
- Document format coverage matrix: systematic coverage verification for Markdown, DOCX, PDF, PPTX, with corruption handling

## 7. Docs needed

- Test strategy document mapping each epic to its test suite, coverage density (unit/functional/e2e), and known gaps
- Release gate runbook documenting the pre-release-check flow, per-epic validation rules, and when to skip gates
- ADR enforcement policy documenting stamping requirements, logical consistency rules, and how drift is detected
- Fixture catalog documenting purpose, covered scenarios, and compatible test suites for each fixture under tests/fixtures/
- Self-hosting operational guide (if epic is in scope) covering deployment topology, offline mode, local model tuning

## 8. Migration concerns

- ADR-drift epic depends on decision integrity; current 1-test coverage is brittle against undocumented decision patterns
- Learning epic is aspirational; if deferred, should not block release-gate validation
- Self-hosting feature completeness unclear; if not ready, should be removed from release-gate scope and tracking instead as future epic
- MCP discovery eval suite currently scattered across 46 tests; consolidation required to avoid false negatives in discovery workflows
- Upgrade fixtures currently runtime-only (w4-lifecycle-migrations); fixture-based approach would improve reproducibility and catch version-specific state drift

## 9. Questions for Opus

- Are the 11 epics (adr-drift, registry, lifecycle, host-parity, search, mcp, orchestration, documents, learning, best-practice, self-hosting) the canonical set, or should the audit map to a different epic taxonomy?
- Should upgrade fixtures be versioned separately (v0-v1-v2 migration chains) or consolidated into a single versioned state management test?
- Is the current ci.yml path-filter approach (code, retrieval, deps, agents, docs, docssite, templates) sufficient for per-epic test gating, or should it be refactored to explicit epic-to-gate mapping?
- Are the 14 skipped tests intentional deferred work, or should they be triaged and either enabled or converted to unverified concerns?
- Should self-hosting be a release-gate epic (blocking main merge) or a future/aspirational epic (not enforced until feature-complete)?

## 10. Suggested bead updates (proposals only — Opus owns Beads)

- Create upgrade path fixtures for all supported migration scenarios (v0->v1, v1->v2, with legacy config present/absent, partial config states) under tests/fixtures/upgrade/
- Add end-to-end self-hosting functional tests covering local model deployment, offline mode, and private MCP server scenarios in tests/functional/self-hosting-*.functional.test.mjs
- Build dedicated learning loop eval harness in tests/functional/learning-loops-*.functional.test.mjs covering A1-A4 workstreams, persistence, and feedback accumulation
- Implement systematic ADR logical consistency checks (supersession chains, decision conflicts, unstamped modifications) in tests/adr-consistency.test.mjs
- Create per-epic release gate checks in scripts/release-gates/ with validation rules for registry, lifecycle, search, documents, orchestration, MCP, and best-practice epics

