---
intake: none
---

<!--
70-test-infra-verdict.md — Internal escape-analysis audit of Construct's test infrastructure.
Renders an evidence-decides verdict (rebuild / restructure / extend) on the suite the maintainer
is "considering completely nuking." Every load-bearing claim cites a repo path, commit hash, or
bead id. Read 00-methodology.md for the rubric, evidence rules, and section template.
-->

# 70 — Test Infrastructure Verdict (escape analysis)

Date: 2026-06-10 · Branch: research/capability-registry · Bead: construct-fhzv (parent construct-r0r2)

The maintainer is "considering completely nuking the current test infrastructure" because "it has
not effectively caught issues with Construct." This document mines every shipped-and-fixed bug,
classifies which layer *should* have caught each, and lets the resulting distribution decide the
verdict. The nuke hypothesis and the keep hypothesis are both held open until the escape table is
built.

---

## 1. Inventory — what the suite is today

**Counts** (reproducible commands inline; run from repo root):

| Layer | Count | Command |
|---|---|---|
| Unit, top-level (`tests/*.test.mjs`) | 232 | `ls tests/*.test.mjs \| wc -l` |
| Unit, nested (`tests/*/*.test.mjs`, excl. functional/e2e) | 270 | `find tests -name '*.test.mjs' -not -path 'tests/functional/*' -not -path 'tests/e2e/*' \| wc -l` |
| Functional (`tests/functional/**`) | 80 (`.test.mjs`; 77 with the `.functional.` infix) | `find tests/functional -name '*.test.mjs' \| wc -l` |
| e2e harness files, opt-in (no `.test.mjs` suffix) | 12 | `find tests/e2e -name '*.mjs' ! -name '*.test.mjs'` |
| Total `.test.mjs` in suite | 352 | `find tests -name '*.test.mjs' \| wc -l` |
| Total test LOC | 44,477 | `find tests -name '*.test.mjs' -exec cat {} + \| wc -l` |
| 24 topical subdirs | capabilities, doctor, embed, extractors, flavors, hooks, init, intake, integrations, knowledge, outcomes, perf, profiles, providers, qa, registry, roles, sync, tags, workflows, … | `ls -d tests/*/` |

INFERENCE: this is a large, mature suite (~352 files, ~44k LOC). A self-reported count of "2387 pass
/ 0 fail" for the unit suite appears in two recent fix commit bodies (54557d4, 3a6dc41) — the suite
runs in the thousands of assertions, not dozens.

**Stated philosophy.** The functional layer has an explicit discipline doc
(`tests/functional/README.md:48-52`): *"CI is a backstop, not a primary gate… The vector-index
regression in A1's first commit is the canonical example: `addObservation` was async, the hook forgot
to await it, every unit test passed, and the vector write was killed by `process.exit`. A functional
test that asserted `vectors.json` exists would have caught it locally in seconds."* The functional
pattern (`tests/functional/README.md:26-33`) mandates a fresh `mkdtempSync` dir, spawning the *real*
binary or importing the *real* module ("no mocks beyond what production uses"), asserting on durable
artifacts, and verifying the next-step contract.

**Runner.** `scripts/run-tests.mjs` enumerates files in Node (not a shell glob, for Windows parity)
and forwards to `node --test` — the stdlib `node:test` runner, zero third-party test framework
(`scripts/run-tests.mjs:50-94`). Default timeout 30s, raised to 180s for dashboard-build/LLM suites
(`scripts/run-tests.mjs:81-88`).

**Host-sterility guard.** The runner fingerprints the real user tool configs
(`~/.config/opencode/opencode.json`, `~/.claude/settings.json`, the Ollama model store) before and
after the run and fails the *whole* run with the drifted path named if any test leaked a write into
real host state (`scripts/run-tests.mjs:92-108`; helper `tests/helpers/sterile-host-env.mjs`,
documented `tests/helpers/README.md:12-71`). This guard exists because the local-model investigation
(bead `construct-k6fu`) polluted the live `opencode.json` and created real Ollama variants
(`tests/helpers/README.md:15-20`) — a real escape that the guard now prevents from recurring.

**CI.** `.github/workflows/ci.yml`: PR runs a single Ubuntu/Node-22 runner; push-to-main fans out to
Ubuntu+macOS × Node 20/22 (`ci.yml:124-128`). Path filters skip the heavy `test` job on doc-only PRs
(`ci.yml:43-123`). A `ci-required` aggregator gates branch protection and treats *skipped* as pass
(`ci.yml:331-350`). Live-LLM tests run only weekly/on-dispatch, never per-PR (`ci.yml:296-323`); the
opt-in live A/B harness (`tests/e2e/local-model-ab.mjs`) and `tests/e2e/host-suite.mjs` carry no
`.test.mjs` suffix and are run by hand (`tests/helpers/README.md:61-69`).

**The `CONSTRUCT_EMBEDDING_MODEL=hashing` override.** CI sets this on the `test` and `evals` jobs
(`ci.yml:130, 229`). It swaps the 384-dim Xenova/all-MiniLM model for a 256-dim deterministic hashing
embedder so CI needs no 90MB model download and no network. This override is itself a *source of two
escapes* (see table rows for `construct-w1am` and commit e125224) — a tell that the test environment
diverges from production in ways that hid real bugs.

---

## 2. Escape mining — bugs that shipped, then were fixed

Sources mined: `git log --oneline --grep=fix -n 200`, `git log --oneline --grep=bug -n 100`,
`git log -E --grep='race|hang|leak|deadlock|ENOTEMPTY' -n 60`, CHANGELOG.md (1607 lines), and the
beads tracker (`bd show`). "Escape" = a defect that reached a tag/main and was later repaired, or a
P1/P2 bug filed against a shipped version. Classification asks: which layer *should* have caught it?

Layers: **unit** (pure logic, in suite) · **functional** (real module/binary in tmpdir, in suite) ·
**host-emulation** (real host driving Construct over its real surface: MCP/CLI/IDE — `node:test`-able,
partially built) · **live-e2e** (real LLM / real OpenCode `run` / real network) · **untestable**
(third-party/platform behavior, genuinely hard).

| # | Bug (shipped) | Fix commit / bead | Should-have-caught layer | Catchable by an EXISTING layer? |
|---|---|---|---|---|
| 1 | A1 reflect hook fire-and-forgot async `addObservation`; `process.exit` killed the vector write — all unit tests green | (the canonical case, `tests/functional/README.md:50`) | functional | YES — existing functional layer; the test that asserts the durable artifact was added |
| 2 | Inbox `recordInboxObservation` fire-and-forget `addObservation` outlived `poll()`, racing teardown → `ENOTEMPTY` on `.cx` cleanup; failed InboxWatcher/maxDepth on ubuntu-node20 + macos-node22 | 9a584ff (#252) | functional | YES — same class as #1; `tests/functional/inbox-watcher-intake-failure.functional.test.mjs` already existed; the await contract was simply untested |
| 3 | Vector-index write race: `mergeInsert`/`createTable` collided under LanceDB optimistic concurrency; ~most writes silently dropped (12 concurrent → 1-4 persisted), so observations weren't searchable; failed CI `test` on ubuntu-node22 | 6df3eea (regression test added in `tests/vector-client.test.mjs`) | functional / unit-concurrency | YES — repro is a 12-concurrent-write unit/functional test; it didn't exist until the fix |
| 4 | LanceDB empty-schema table couldn't resolve its vector column at query time ("No vector column… dimension 384"); Linux-x86 only, not darwin-arm64/qemu | 38cfe51 (NO repro test — diagnosed by elimination in CI) | host-emulation (real Linux) | PARTIAL — needs a real-Linux runtime; CI matrix is the only place it reproduces |
| 5 | vector-client test fixtures hardcoded 384-dim while CI's `hashing` model is 256-dim → "No vector column… 384"; the *real* cause behind the cluster of "No vector column" CI failures, initially misdiagnosed as #4 | e125224 | unit (env-faithful fixtures) | YES — a test-env bug; the fixture should read `getEngineDimensions()`. Caused by the `hashing` override divergence |
| 6 | session-reflect 500ms HARD_BUDGET killed a cold LanceDB write mid-commit under parallel-test load (clean exit, empty stderr); A1 functional test failed deterministically | 27236c7 | functional | YES — the functional test *did* catch it; fix made the budget tunable for the test |
| 7 | `construct sync --dry-run` eagerly loaded the 90MB embedding model (async leak from a sync prompt-composer fn) → 78-89s hang on cold cache, AND learned-patterns injection silently returned empty | bead construct-w1am (CLOSED) | functional (cold-HOME / offline) | YES — a sterile cold-HOME functional test of `sync --dry-run` timing/fetch-count catches it; the bug blew the 60s timeout in `tests/sync-contract.test.mjs`, so a test *did* surface it, late |
| 8 | docling ingest hung indefinitely when docling stalled on first-use venv provisioning/inference; surfaced to MCP client as opaque "reading 'invoke'" timeout | 3a6dc41 (#257/#255), repro added | functional + host-emulation | YES — `tests/functional/mcp-ingest-resilience.functional.test.mjs` (added 9bef4c5) drives the REAL MCP server over stdio with a docling stub; this is the host-emulation pattern |
| 9 | Every MCP tool call could hang the request (not just ingest); stalled/throwing tool blocked until the client timed out | 9bef4c5 (#255), repro added | host-emulation | YES — same stdio-MCP repro; bounded every dispatch |
| 10 | docling `ensureDoclingVenv` blocking `spawnSync` froze the MCP server event loop during first-run provisioning (distinct from #9's per-call path) | 54557d4 (bead construct-mk9s); NO new repro test | host-emulation (real provisioning) | PARTIAL — the freeze only manifests with a real `uv`/venv install; the stub path can't reproduce a real blocking spawn |
| 11 | docling dropped embedded images (`<!-- image -->` only); verified only against *live* docling 2.45.0 | 3a6dc41 (#256) / 54557d4 | live-e2e | NO — image fidelity required a live docling extraction ("needs live verification" admitted in 3a6dc41 body) |
| 12 | agentic-coherence probe false-positived: qwen2.5-coder:7b passed the light probe yet word-salads in real OpenCode 1.15.4 | 4cf02f4 (validated against live Ollama+OpenCode) | live-e2e | NO — only a real OpenCode session exposes the collapse; the unit probe was the thing being fixed |
| 13 | `primaryFromOpenCode` reads `cfg.model` off `readOpenCodeConfig()`'s `{file,config}` wrapper — always `undefined` → model-tier auto-detection silently dead for OpenCode | bead construct-uhdb (OPEN, P3) | unit | YES — a one-assertion unit test on the wrapper shape catches it; env/registry fallbacks masked it so no test ever asserted the wrapper field |
| 14 | `construct sync` detected OpenCode by binary presence only, missing config-file-only installs | e55f500 (NO repro test) | functional (host-config) | YES — `host-config-parity` / `opencode-config-path` functional tests cover this surface |
| 15 | Intake ingest hung indefinitely when the local provider (ollama) was unreachable | bead construct-h8tx.11 (CLOSED) | functional | YES — a functional test with an unreachable-provider stub asserts bounded failure |
| 16 | Local-model investigation polluted live `opencode.json` + created real Ollama variants (the harness ran against the real machine) | bead construct-k6fu → `sterile-host-env.mjs` guard | functional (sterility) | YES — now permanently caught by the runner's fingerprint guard (`scripts/run-tests.mjs:92-108`) |
| 17 | Dashboard ingestion bugs: MIME types, depth limit, stale state, duplicate route, gap-analysis category | 8e55c5a | functional / unit | YES — durable-artifact functional tests on the ingestion pipeline |
| 18 | release-gate / install path leaked writes into real `$HOME`; double "global sync summary"; completion leak | bf6bd0e, 64f6132, 738b18d | functional (host-footprint) | YES — `init-host-footprint` / `install-parity` functional tests |

---

## 3. Analysis — the distribution that drives the verdict

Tallying the "Catchable by an EXISTING layer?" column across the 18 escapes:

- **(i) Catchable by an EXISTING layer, but the test was missing or wrong:** rows
  1, 2, 3, 5, 6, 7, 13, 14, 15, 16, 17, 18 = **12 of 18 (67%)**. [source: escape table and reproducible commands in this document]
- **(ii) Catchable only by a layer that is partial / not-yet-built (real-host / real-Linux / live
  OpenCode session simulation):** rows 4, 8, 9, 10 = **4 of 18 (22%)** — and 8 + 9 were in fact caught [source: escape table and reproducible commands in this document]
  by the *host-emulation* layer once someone wrote the stdio-MCP repro (it exists today).
- **(iii) Genuinely hard / needs a live model or live binary (live-e2e):** rows 11, 12 =
  **2 of 18 (11%)**. [source: escape table and reproducible commands in this document]

**This distribution is decisive.** Two-thirds of escapes were squarely inside the competence of the
*existing* unit + functional layers — the architecture already has a place for them; the test simply
wasn't written, or (rows 5, 7) the CI environment diverged from production (`hashing` override,
warm-cache HOME) in a way the suite didn't model. The smoking gun is the *recurring identical
bug class*: rows 1 and 2 are the **same** fire-and-forget-async-write defect, six months apart, in two
different files — the functional layer's own canonical example (`tests/functional/README.md:50`) re-shipped
because no one applied its lesson to the inbox path. That is a **coverage-discipline failure, not a
foundation failure**. Nuking the suite would destroy 44k LOC of working harness — including the
sterility guard (row 16), the LanceDB concurrency repro (row 3), and the stdio-MCP host-emulation repro
(rows 8, 9) — to fix a discipline problem that nuking does not address.

Only 11% (rows 11, 12) are genuinely untestable below a live LLM / live docling, and Construct already [source: escape table and reproducible commands in this document]
*has* a (gated, opt-in) live-LLM layer for exactly those (`ci.yml:296-323`, `tests/e2e/local-model-ab.mjs`).

**Mock-heaviness.** 76 of 352 test files (22%) mention mock/stub/fake/spy [source: escape table and reproducible commands in this document]
(`grep -rliE 'mock|stub|fake|spy' tests --include='*.test.mjs'`); 70 files spawn a real binary
(`spawnSync`/`execFileSync`/`spawn`), and 230 import a real `lib/` module. So ~65% of files exercise [source: escape table and reproducible commands in this document]
real modules/binaries and only ~22% lean on test doubles — the suite is **integration-weighted, not [source: escape table and reproducible commands in this document]
mock-weighted**. And the mocks that exist are *faithful failure injectors*, not happy-path fakes: the
docling stub is "a python that exits non-zero, recorded in the install marker so provisioning never runs"
(commit 9bef4c5 body) — it reflects the real failure mode (a broken/timing-out extractor) rather than
papering over it. The Ollama stub "emits the exact text shapes `lib/ollama/provision-context.mjs` parses"
(`tests/helpers/README.md:30-36`). This refutes the "suite is mostly testing mocks that don't reflect
reality" hypothesis — verdict does **not** lean aggressive-restructure.

**The one real architectural gap.** Rows 4 and 10 — and the entire local-model frustration motivating
this audit — point at the same missing capability: **simulating a real OpenCode/Claude session
end-to-end without a human.** Row 12 (the probe that passed but word-salads in real OpenCode) is the
purest example: no `node:test`-able layer can see it, because the failure only emerges when a real model
runs inside a real OpenCode runtime under Construct's real injected context.

---

## 4. The host-emulation layer — already partially built

Real-user-surface simulation is **not** a greenfield. `tests/functional/host-mcp-emulation.functional.test.mjs`
(121 lines) already connects to the *real* `lib/mcp/server.mjs` over stdio as an MCP client
(`@modelcontextprotocol/sdk` `StdioClientTransport`), in a sterile own-HOME sandbox, and asserts:
tools are discoverable; `get_skill` returns content byte-identical to the file on disk *and* records the
load in `~/.cx/skill-calls.jsonl` (proving "used", not just "returned"); templates resolve; and
`orchestration_policy` both names a specialist chain for a real PRD request and *doesn't* over-orchestrate
a typo (`host-mcp-emulation.functional.test.mjs:62-120`). The companion epic **construct-2fm8** reports a
5-layer deterministic host-emulation suite green (11 tests: host→MCP emulation, config fidelity/parity,
not-invoking-inert, artifact-quality gate, self-driving runner `tests/e2e/host-suite.mjs`) plus a *gated,
already-executed* real-LLM validation (`tests/e2e/reports/realistic-user-validation.md`: 8/11 confirmed).

**What this covers:** the *deterministic* half — "is the host wired to Construct's surface, and does the
contract machinery (skills, templates, routing) fire?" — over the real MCP transport.

**The gap to a real OpenCode/Claude session end-to-end:** the emulation drives the MCP *server* directly;
it does **not** boot a real `opencode run` with a real local model and observe whether Construct's injected
context survives the `/v1` boundary and keeps the model coherent. Driving `opencode run` headlessly under a
sterile HOME "stalls (first-run migration + `.env.op` resolution)", so the live A/B harness deliberately
uses the *real* HOME and is excluded from `npm test` (`tests/helpers/README.md:61-69`). That is the one
layer that is genuinely missing/manual — and it is exactly what rows 12 and 4 needed. The
`ollama-record-proxy.mjs` (`tests/helpers/README.md:77-82`) is infrastructure already built toward it
(it measures what tool-count/token-budget actually reaches the model).

---

## VERDICT

### Verdict: **EXTEND** (with one targeted layer addition that is already 60% built)

The evidence does not support a rebuild and does not support a no-op "keep." It supports **extend**:
keep the foundation, close the coverage gaps the escape table names, and *promote the partial
host-emulation layer* (construct-2fm8 / `host-mcp-emulation`) toward a real headless-session probe.

- **Current.** ~352 test files / 44k LOC over `node:test`, integration-weighted (65% real-module/binary, [source: escape table and reproducible commands in this document]
  22% mock), with a functional discipline doc, a host-sterility fingerprint guard, a partial [source: escape table and reproducible commands in this document]
  host-emulation layer, and a gated live-LLM layer. CI runs single-runner per PR, full matrix on main,
  with a `hashing` embedding override.
- **Proposed.** (1) Backfill functional repros for the 12 "missing test" escapes, starting with a
  *generic* fire-and-forget-async-write guard so rows 1+2's class cannot re-ship a third time.
  (2) Make the test environment faithful to production where it diverged: assert fixtures read
  `getEngineDimensions()` (row 5), and add a cold-HOME/offline `sync --dry-run` timing+fetch-count test
  (row 7). (3) Promote host-emulation to a *real headless session* probe: extend the `ollama-record-proxy`
  + sterile-HOME work until `opencode run` can be driven non-interactively, closing rows 4/10/12.
  (4) Add the one-assertion unit test for construct-uhdb (row 13). File each as a bead under construct-r0r2.
- **Pros.** Preserves 44k LOC of working, faithful harness (the sterility guard, the concurrency repro,
  the stdio-MCP emulation) that *did* catch real bugs; targets the actual failure mode (discipline +
  one missing layer); cheap relative to a rebuild.
- **Cons.** "Extend" relies on discipline the team has already failed once (the same async-write bug
  shipped twice). Without a mechanical guard, backfilled coverage decays again. Extend also leaves the
  largest single source of maintainer pain (live OpenCode coherence) behind a *manual* harness for now.
- **Reasoning.** 67% of escapes were catchable by an existing layer (§3), 22% by the partial [source: escape table and reproducible commands in this document]
  host-emulation layer (which has *already* caught two — rows 8, 9 — once written), and only 11% need a [source: escape table and reproducible commands in this document]
  live model. A suite that is 67%-discipline-gap + 22%-promote-existing-layer + 11%-already-have-the-layer [source: escape table and reproducible commands in this document]
  is **sound in architecture and weak in coverage** — the textbook EXTEND signature, not a rebuild.
- **Evidence.** `tests/functional/README.md:48-52` (canonical async-write escape); 9a584ff + 6df3eea +
  27236c7 + e125224 + 38cfe51 (LanceDB escape cluster, repros); bead construct-w1am (sync hang);
  9bef4c5 + 3a6dc41 + 54557d4 + bead construct-mk9s (docling/MCP); 4cf02f4 (live-OpenCode probe);
  bead construct-uhdb (dead auto-detection); `host-mcp-emulation.functional.test.mjs` + bead construct-2fm8
  (partial host-emulation); `scripts/run-tests.mjs:92-108` + bead construct-k6fu (sterility guard);
  mock/integration ratios from the `grep` counts in §3.

- **Strongest counter-argument (the case FOR nuke/aggressive-restructure).** "The numbers measure
  *fixed* bugs — survivorship bias. The escapes that matter most (the local-model OpenCode collapse the
  whole audit exists for) are precisely the ones `node:test` *cannot* see, and the suite has 44k LOC that
  generates green checkmarks while the product's headline failure mode sails through. A green suite that
  can't see your #1 failure mode is worse than no suite — it manufactures false confidence
  (`tests/functional/README.md:51`). Rebuild around live-host simulation as the *primary* gate and treat
  unit/functional as secondary." This is the honest case against extend, and it is not weak: rows 11+12
  show the suite is blind to live-model behavior, and the `hashing` override (rows 5, 7) shows the
  environment lies. The reason it loses: nuking the *other* 89% to fix the 11% is disproportionate, and [source: escape table and reproducible commands in this document]
  the live layer it would rebuild toward *already exists in scaffold* (construct-2fm8, `local-model-ab.mjs`,
  `ollama-record-proxy`). You don't burn the house to add a room that's already framed.

- **Falsified-if.** This EXTEND verdict is wrong if any of the following is observed: (a) a fresh,
  systematic re-classification finds that **>50%** of escapes required a layer that does not exist even in [source: escape table and reproducible commands in this document]
  scaffold (would flip to RESTRUCTURE / add-a-layer); (b) the integration-vs-mock audit is re-run with a
  stricter definition and **>60%** of files prove to be happy-path mocks decoupled from real modules [source: escape table and reproducible commands in this document]
  (would flip toward aggressive RESTRUCTURE); or (c) backfilling the 12 "missing test" repros turns out to
  be impossible against the current harness without rewriting the runner/helpers (would mean the
  foundation, not the coverage, is the blocker → REBUILD). Conversely, if backfilling those 12 is
  mechanical and the host-emulation promotion lands on top of the existing `host-mcp-emulation` +
  `ollama-record-proxy` plumbing, EXTEND is confirmed.

### Honest bottom line

The maintainer's frustration is real and *correctly located* — but it is aimed at the wrong target. The
suite did not "fail to catch issues" because it is rotten; it failed because (1) the team didn't write the
functional repro for a bug class its own README names as canonical, and that exact class re-shipped
(rows 1→2), and (2) the one failure mode that actually motivates this audit — local-model coherence inside
a real OpenCode session — sits in the 11% that no in-process test can reach, and that layer is still a [source: escape table and reproducible commands in this document]
manual harness. Nuking would delete the parts that *work* (sterility guard, concurrency repro, stdio-MCP
emulation) and would not, by itself, build the live-session layer. The right move is to **extend**: a
mechanical async-write guard, faithful CI fixtures, the construct-uhdb one-liner, and promotion of the
already-framed host-emulation harness into a real headless OpenCode/Claude session probe.
