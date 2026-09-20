# Findings register

Audit examined `staging` at `d8171157cc038096b78429a459cf83dcbca70aea`
(`3.0.0-alpha.25`). Those 17 probes ran on Node 22.16, below the declared
22.18 floor, and were not a full suite. Imported observations stay labeled
as audit observations until this session reproduces them.

| ID | Audit observation | Local verification | Disposition | Linked work | Regression |
|---|---|---|---|---|---|
| A01 | Filename-only discovery; ADR listed without ingesting the decision | Reproduced: `docs/adr/` files are now read; decisions extracted; `docs/architecture-and-state-model.md` discovered by convention | resolved with test | discovery + material | `tests/kernel/project/discovery.test.ts` |
| A02 | Ten-constraint cap silent; fenced example treated as constraint | Reproduced in source; fences skipped; omitted counts in `coverage` | resolved with test | discovery | discovery test for quoted examples |
| A03 | Parent `docs` symlink escaped; file symlink rejected | Containment walks every hop; inside links allowed when real path stays inside | resolved with test | `kernel/safety/containment.ts` | `tests/kernel/safety/containment.test.ts` |
| A04 | Admission dropped provenance | Statements persist locator/span/excerpt/digest/extractor | resolved with test | profile + onboarding | discovery apply-draft test |
| A05 | Refresh stored snapshots without claims | Directory refresh writes observed claims with locator and content digest | resolved with test | source service | source + work tests |
| A06 | Directory hashed path/size/mtime | Inventory digest vs content digest split | resolved with test | directory reader | existing source tests plus content digest |
| A07 | Filter after fixed record limits | `project_context` filters then pages and returns `total`/`truncated` | resolved with test | broker tools | tools.test.ts |
| A08 | Capabilities inferred from interactive, including unscoped write_source | Local session has directory/file reads; unscoped `read_source` is satisfied only by a wired scoped reader; `write_source` is not granted from interactivity | resolved with test | broker-context + provides() | registry host-scope test |
| A09 | Verify accepted failed/empty/null | `verification_result` fail-closed | resolved with test | validators | validators-gates.test.ts |
| A10 | Terminal identical request reused | In-flight work identity only; new invocation gets a new key | source-confirmed then repaired | workflow start | workflow service |
| A11 | Resume consulted current defs | Frozen bindings; digest mismatch returns `re_resolve` | source-confirmed then repaired | workflow claim/submit | workflow service |
| A12 | Cancel/no-data/lease budget incomplete | Cancel persists; expired leases at max attempts fail; no-data continue uses `skipped` | source-confirmed then repaired | steps + workflow | existing runs-steps plus service |
| A13 | Challenge without review artifact | `review_complete` validator | resolved with test | validators | validators-gates.test.ts |
| A14 | Skill checks mostly routing | Routing evals stay labeled as routing; outcome/evidence gates added as validators | locally reproduced as labeling, not expanded live evals | evals + validators | routing evals unchanged; live-host not run |
| A15 | Host instructions disagreed on tracker | AGENTS.md and CLAUDE.md are one native-work contract | resolved | host instructions | deletion-gates / help |
| A16 | Plan/do/verify wrapper didn't enforce blockers | `plan_complete` validator; readiness computed on work items | resolved with test | validators + work | validators-gates + work tests |

A14 live-host held-out comparisons were not run (no new paid API use).
