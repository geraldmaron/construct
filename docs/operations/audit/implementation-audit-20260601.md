# Implementation Audit — Construct (2026-06-01)

A dated snapshot assessing whether Construct's implementation is best-practice aligned and actually
efficient, effective, and optimized for what it is: a solo-first, safety-gated AI orchestration
meta-system that sits on top of Claude Code / OpenCode / Codex / Cursor.

Every load-bearing claim below cites a file, line count, or command output reproducible from `main`
at commit `89c8555`. Where something was inferred rather than measured, it is marked `[unverified]`.

> **Update — §8 supersedes inference.** Sections 1–7 are a static read. Several conclusions about the
> learning loop in §4–§5 were later **tested empirically on a clean, isolated instance** and partly
> **refuted** — see **§8 Empirical validation**. Where §8 and the earlier sections disagree, §8 wins:
> it ran the code; the earlier text only read it.

---

## 1. Scope & method

Static read of the repository on `main`: `bin/construct`, `lib/`, `tests/`, `.github/workflows/ci.yml`,
`package.json`, `CHANGELOG.md`, and `docs/`. Metrics gathered via `wc -l`, `find`, `grep`, and
`node -e` against `package.json`. No code was run beyond read-only git/grep. This is a structural and
best-practice audit, not a line-by-line correctness review and not a security review (those have their
own gates: `.github/workflows/ci.yml` jobs `audit`, `secret-scan`, and the `cx-security` specialist).

## 2. What Construct is / does

CLI entrypoint (`bin/construct`) → specialist registry (`specialists/registry.json`) → profile-aware
routing → unconditional enforcement hooks (`lib/hooks/*.mjs`) → durable state in `.cx/` plus a local
vector index. A single persona (`construct`) routes work to ~28 `cx-*` specialists, each with a model
tier, tool allowlist, skill set, and postcondition contracts. Learning loops capture observations to
`.cx/` and feed a local embedding daemon (`lib/embed/daemon.mjs`).

## 3. Strengths (substantiated)

**Test posture is strong and purpose-built.**
- 271 `*.test.mjs` files under `tests/`, including 46 functional and 5 hook-specific suites.
- Tests run on Node's built-in runner via `scripts/run-tests.mjs` (`package.json` `test` script) —
  no heavyweight test framework dependency.
- CI (`.github/workflows/ci.yml`) is hand-built, not a template: real jobs are `changes`, `test`,
  `lint`, `evals`, `audit`, `secret-scan`, `postgres-integration`, `dashboard-integration`,
  `live-llm-tests`, gated by an aggregator `ci-required`. Path-aware change detection scopes work to
  what changed; PR runs single-runner, `main` runs a fuller matrix.
- Postgres + pgvector integration is exercised in CI (`postgres-integration` job), not just mocked.

**Runtime footprint is deliberately lean.**
- Pure ESM (`package.json` `"type": "module"`), Node `>=20`.
- **6** production dependencies: `@huggingface/transformers`, `@modelcontextprotocol/sdk`,
  `@xenova/transformers`, `js-yaml`, `node-webvtt`, `postgres`. **0** devDependencies. 6 optional deps.
- The dashboard server (`lib/server/index.mjs`) uses the raw Node `http` module — no Express/Vue/Next
  in the runtime path.

**Documentation is treated as code.**
- `CHANGELOG.md` follows Keep-a-Changelog with an `[Unreleased]` section and 19 versioned headings;
  last entry dated 2026-06-01.
- README uses AUTO-regenerated regions; `construct docs:update --check` is wired into the release gate
  (`package.json` `release:check`).
- Artifact-lint (`lib/comment-lint.mjs`) enforces a no-fabrication prose pass on `docs/specs/prd/`, `docs/decisions/adr/`,
  `docs/decisions/rfc/`, `.cx/knowledge/`, etc.

**Safety is built into the toolchain, not bolted on.**
- Hooks fire unconditionally; `tests/hooks/no-skip-vars.test.mjs` actively forbids reintroducing
  `CONSTRUCT_SKIP_*` / `ALLOW_*` / `QUIET_*` bypass env vars.
- The no-fabrication rule is contract-enforced on specialist handoffs
  (`specialists/contracts.json` postconditions).
- Custom comment policy is machine-checked (`construct lint:comments`, a CI job), banning inline/narrative
  comments most codebases tolerate.

## 4. Weaknesses / risks (substantiated, prioritized)

**P1 — No automated style, type, or coverage instrumentation.**
- No ESLint, Prettier, or coverage config at root, and none in devDependencies (`c8/nyc/eslint/prettier`
  all absent). Style and dead-code discipline rest on the custom comment-lint plus human review.
- Consequence: unused variables, unreachable branches, inconsistent naming, and accidental `require()`
  in an ESM file are not caught mechanically. The comment-lint is excellent at what it does but operates
  on comments, not on the AST.

**P2 — Widespread bindingless `catch {}` with silent fallback.**
- `grep -rn "catch {" lib/` returns **734** matches — `catch` blocks with no error binding, which by
  construction cannot log or inspect the error. Example pattern in `lib/status.mjs:34` and four more
  sites in the same file: read-optional-JSON returns `null` on any failure with no telemetry.
- Not all 734 are bugs — many are legitimate "best-effort optional read" fallbacks. But the pattern is
  uniform enough that a genuine fault (corrupt state file, permission error) is indistinguishable from
  "file absent." There is no centralized error sink for these swallows. `[unverified]` how many mask
  real faults — that needs per-site review.

**P3 — Large entry-point and server files.**
- `bin/construct` is **5,962** lines; `lib/server/index.mjs` is **2,288**; `lib/embed/daemon.mjs`
  **1,382**; `lib/init-unified.mjs` **1,270**; `lib/mcp/server.mjs` **1,158**; `lib/cli-commands.mjs`
  **915**. These are dispatchers and wizard flows, not tangled god-objects, but the size raises the cost
  of navigation, review, and onboarding, and makes per-command testing harder than per-module testing.

**P4 — Conditional tests skip silently.**
- The `live-llm-tests` CI job runs only when an API key is present; absent the key it is skipped without
  surfacing a signal in PR feedback. A regression in the live-LLM path can land green. `[unverified]`
  whether any non-LLM coverage compensates.

**P5 — On-disk weight.**
- `node_modules` measured ~1.1 GB `[unverified — single local measurement, dominated by workspace build
  tooling, not the runtime path]`. Two transformer libraries (`@huggingface/transformers` and
  `@xenova/transformers`) are both present for local embedding; whether both are needed at runtime is
  worth confirming.

## 5. Efficiency / effectiveness / optimization read

**Effective for its stated job: yes.** The architecture matches the goal — a safety-gated solo-first
orchestrator. Unconditional hooks, contract postconditions, and the no-fabrication enforcement are the
right primitives for "an AI system you can trust to run unattended," and they are tested, not aspirational.

**Efficient: yes, with one caveat.** The lean dependency surface, raw-`http` dashboard, built-in test
runner, and path-aware CI all reflect deliberate cost control. The caveat is developer-time efficiency:
the absence of ESLint/Prettier/coverage shifts mechanical checks onto humans, which scales poorly if the
contributor count grows beyond one or two.

**Optimized: appropriately, not prematurely.** Lazy module loading, a pluggable storage backend
(filesystem default, optional Postgres), and a supervised embedding daemon are sensible. There is no
caching layer and no coverage-driven hot-path optimization — correct for current scale, and the report
flags nothing that warrants optimization work today.

**Net:** This is well-engineered for its intent. The gaps are tooling-hygiene gaps (P1, P2, P4), not
architectural defects. They become more costly as the team grows; none block current operation.

## 6. Prioritized recommendations (implementation deferred)

1. **Add ESLint flat-config + Prettier as a CI `lint` sub-step** (effort: S). First step: add
   `eslint.config.mjs` with `no-unused-vars`, `no-undef`, and an ESM-only rule; wire `eslint .` into the
   existing `lint` job in `.github/workflows/ci.yml`. Highest value-per-effort — closes P1.
2. **Add a lint rule (or comment-lint extension) flagging bindingless `catch {`** in non-test `lib/`
   code, allow-listed where a fallback is intentional (effort: S–M). Forces each of the 734 sites to
   declare "intentional fallback" vs. "needs handling" — closes P2 incrementally without a big-bang
   rewrite. First step: extend `lib/comment-lint.mjs` or add an ESLint `no-empty`/custom rule.
3. **Add coverage reporting with `c8`** on the unit suite, report-only at first (no threshold) (effort:
   S). First step: `c8 node scripts/run-tests.mjs --exclude=tests/functional` in a new non-gating CI
   step, so coverage becomes visible before it becomes enforced.
4. **Make `live-llm-tests` skips loud** (effort: XS). First step: emit a clear "SKIPPED: no API key"
   annotation in the `live-llm-tests` job so green ≠ silently-unverified. Closes P4.
5. **Carve `bin/construct` into per-command modules** behind the existing `lib/cli-commands.mjs`
   registry (effort: L, incremental). Not urgent; do it opportunistically when touching a command group.
   Addresses P3 without a risky rewrite.
6. **Confirm both transformer deps are load-bearing** (effort: XS). First step: grep import sites; if one
   is unused at runtime, drop it to cut install weight (P5).

## 7. Appendix — Gemini subagent branch reuse review

Branch `subagent-Infrastructure---Library-Layer-Agent-self-aafacad9` (HEAD `f5d3021`, 2026-05-19) carries
**25** commits not on `main` and sits **189** commits behind it, in an external Gemini-Antigravity
worktree. Reviewing whether its features already landed independently:

| Feature theme (branch commits) | In `main` today? | Evidence |
|---|---|---|
| `construct upgrade` command | **Yes** | `lib/cli-commands.mjs:516`, `lib/upgrade.mjs`, `bin/construct:26` |
| 1Password `op://` credential resolution | **Yes** (more complete) | `lib/health-check.mjs:170,290`, `lib/integrations/intake-integrations.mjs:28`, `lib/embed/daemon.mjs:85`, `lib/model-router.mjs:355` |
| Intake recommends artifacts + next steps | **Yes** | `lib/intake/classify.mjs`, `lib/intake/session-prelude.mjs`, `lib/intake/feedback.mjs` |
| Project-aware init / checkbox UI / lane picker | **Yes** | `lib/init-unified.mjs` (1,270 lines), `lib/init-docs.mjs` |
| Unified storage layer | **Yes** | `lib/storage/unified-storage.mjs` present in `main` |
| Intake-loop simulation + embed tests | **Yes** | `scripts/simulate-intake-loop.mjs`, `tests/embed/recommendation-store.test.mjs`, `tests/embed/customer-profiles.test.mjs` present in `main` |
| Interactive REPL after `construct dev` | **Removed on branch itself** | branch commit `dbee3dc` reverts it |
| Self-hosted Langfuse compose stack @ image `3.174.1` + IPv6 healthcheck | **No — divergent approach** | branch has `lib/services/langfuse.mjs` + `langfuse/docker-compose.yml`; `main` instead uses `lib/server/langfuse-login.mjs` + `lib/telemetry/langfuse-setup.mjs` and has no bundled compose stack |

**Conclusion:** 24 of 25 commit-themes are superseded — `main` reimplemented them independently and, for
credentials, more completely. The **only** genuinely unmerged artifact is the bundled self-hosted Langfuse
docker-compose stack at image `3.174.1`, which `main` deliberately moved away from (login-based setup).
The branch is safe to delete unless reviving self-hosted Langfuse is desired; nothing else would be lost.

---

## 8. Empirical validation (isolated, full-fidelity)

§4–§5 inferred loop behavior from the dogfooded `.cx/`, which is polluted by test fixtures. To check
those inferences, a clean Construct was stood up in an isolated tmp `HOME` + tmp project (the
`tests/functional` recipe: real `bin/construct`, `--yes --no-docker`, `CONSTRUCT_SKIP_BOOTSTRAP_PROBE=1`),
and the loop was exercised end-to-end. A live module harness (now preserved as
`tests/functional/loop-closure.functional.test.mjs`) asserted each stage.

| # | Experiment | Result | Verdict vs. inference |
|---|---|---|---|
| E0 | `init → install → doctor → status --json` on a virgin machine | init exit 0, all artifacts; **42/46 doctor checks pass**; the **one hard failure is "Cross-surface adapter parity"** when no agent surfaces are installed → `doctor`/`install` exit **1** | New finding (real) |
| E1/E5 | seed observations → `searchObservations` → retrieve | capture 5/5; search returns the relevant obs via the offline hashing-bow path | **Refutes "loop is open"** — capture→consume closes automatically |
| E2 | `recordOutcome` → `listOutcomes` | recorded + round-trips; `agent-tracker.mjs:163` calls this on every subagent completion | **Refutes "outcomes broken"** — sparse dogfood = sparse subagent *use*, not a broken feature |
| E3 | `shouldEscalate` on a `/tmp` event | blocked, `reason: 'test-fixture-path'` (`gateway.mjs`) | New escalations **cannot** pollute the queue anymore |
| E3b | append pending → `markResolved` | clears only on explicit resolve; `processBacklog` (session-start) **adds**, never removes | **Narrows "queue accumulates"** to its true cause |
| E4 | `classifyRdIntake` twice | stable `bug → debugger`, deterministic (no LLM) | Confirms intake is deterministic |

**Corrections to the earlier read:**

- **"The learning loop runs open" — refuted.** The primary loop (session → observation via Stop hook +
  `agent-tracker` → injected at `session-start.mjs:127`) closes automatically. Search retrieval works
  offline. Outcomes record automatically.
- **"717 observations → 10 knowledge notes ≈ broken synthesis (70:1)" — withdrawn.** `.cx/observations/`
  and `.cx/knowledge/` are **different stores**, not a producer→consumer pair. Knowledge notes are
  authored by explicit `construct reflect`/`ingest` (`lib/reflect.mjs`); there is **no** automatic
  observation→knowledge distiller. A low knowledge-note count is by design, not a failure. *(Whether an
  auto-distiller is a worthwhile feature is an open question — but its absence is not a defect.)*
- **"Role queue accumulates noise" — confirmed but narrowed.** Two guards already exist: a fixture guard
  (`isTestFixturePath`) that blocks new `/tmp` escalations, and per-session `processBacklog`. The real
  gap is that **pending entries clear only via the manual `construct role` CLI** (`markResolved` /
  `resetPending` in `lib/roles/cli.mjs`) — there is **no auto-resolve or TTL**. So the dogfood's 79
  `cx-secrets` entries are **stale fixtures written before the guard existed**, surfaced at every
  session-start forever. This is the one genuine, actionable loop defect.

**Net:** the system is in better shape than the static read implied. The loop closes; the abstraction
machinery is largely load-bearing (see §9 — only ~2 of 264 `lib` modules are provably dead). The
proportionality concern in §5 stands as a judgment call, not a defect.

## 9. Prune log (conservative — provably-dead only)

Method: skill audit (`lib/audit-skills.mjs`), a `lib` import-graph with dynamic-import/string-path
guards, hook/watcher registration diffs, and git-history dating. Only zero-reference, non-recent,
non-test-depended artifacts were deleted.

**Deleted (verified safe):**

| File | LOC | Evidence | Post-delete check |
|---|---|---|---|
| `lib/storage/unified-storage.mjs` | 550 | zero references anywhere; added in the 1.0.1 release PR (2026-05-20), untouched since, wired to nothing | `doctor` 47/0; `lib/server/index.mjs` + storage tests import clean |

**Kept after reconsideration — NOT dead, aligned with product intent:**

- `lib/server/telemetry-login.mjs` (100 LOC) — initially deleted as "zero-reference, superseded by
  `langfuse-login.mjs`," then **restored**. It is the *vendor-neutral* login bridge (keyed on
  `CONSTRUCT_TELEMETRY_URL`, works against any compatible deployment); `langfuse-login.mjs` is the
  Langfuse-specific one. Given the stated intent to stay telemetry-vendor-agnostic (§12), the generic
  bridge is the seed to build on, not remove. Currently unwired — the dashboard still calls the
  Langfuse-specific bridge — so wiring it in is the agnostic move (§12).

**Flagged-orphans resolution (line-by-line dependency cross-check):** each candidate was re-verified for
*export-name* consumers, not just filename references — which corrected two earlier calls.

- `lib/services/pattern-promotion-service.mjs` (167 LOC) — **removed.** Zero consumers of `promotePatterns`.
  Wiring it would mean a daemon job that autonomously rewrites curated `skills/roles/*.md` from
  observations — unsafe self-modification that violates the curation discipline. (Telemetry enum label
  cleaned in `lib/telemetry/skill-calls.mjs`.)
- `lib/embed/jobs/vector-sync.mjs` (198 LOC) — **removed.** Zero consumers of `runVectorSync`; the test's
  only mention was a tempdir *name* string, not an import. Its local path would duplicate the synchronous
  hashing-bow embedding; its neural/pg path is unvalidatable here.
- `lib/bootstrap/lazy-install.mjs` (161 LOC) — **removed.** Zero consumers of `lazyInstall`; no call seam.
  Inaccurate `architecture.mdx` / `resources.mjs` references describing it as active were corrected.
- `lib/hooks/proactive-activation.mjs` — **kept.** The map called it `@unwired`, but cross-check found a
  **live CLI consumer**: `bin/construct:5121` (`activation:status`) imports `getActivationSummary` /
  `getActivationStats`. Only the *event-source* side is unwired; the module is not dead.
- `lib/knowledge/postgres-search.mjs` (132 LOC) — **kept.** Recent (2026-05-28), a coherent pgvector
  implementation staged for the Postgres backend. `postgresTagSearch` is async + embedding-based while
  `knowledgeSearch` is sync + text — wiring is a validated pg-integration feature, not cleanup. Retained
  as staged infrastructure; the `architecture.mdx` description is accurate (capability, not a false
  "already wired" claim).

**Found NOT prunable (false positives the guards caught):**

- **0 skills.** `audit-skills` reports 55 "orphan" skills, but all are consumed at runtime via
  `get_skill("roles/NAME")` (`lib/role-preload.mjs`) or referenced in specialist prompts. "Not declared
  in the registry" ≠ "unused."
- **0 watchers** unreferenced; **35 of 37 hooks** registered (the 2 exceptions handled above).

**Headline:** of 264 `lib` modules, only a couple are zero-reference, and **only one** (`unified-storage.mjs`)
was both dead *and* not aligned with a product direction — so only one was removed. The codebase is **not**
bloated with dead code — a meaningful counter-signal to the §5 proportionality concern.

## 10. Regression coverage added

`tests/functional/loop-closure.functional.test.mjs` — hermetic, offline-deterministic guards for the
four loop stages above (capture/search/consume, outcome record/read-back, role-queue fixture-guard +
manual-resolve, deterministic intake). Turns the one-time empirical findings into permanent CI guards so
loop-breakage fails the build instead of degrading silently.

## 11. Recommendations — status

1. **Role-pending auto-resolve/TTL — done.** 14-day TTL drops stale entries from listings; `construct
   role prune` compacts resolved/expired/fixture entries on disk (`lib/roles/gateway.mjs`). The live
   queue's 79 entries were pruned to 13 real ones (66 removed: 60 fixture, 6 expired).
2. **Virgin-install parity exit-1 — done (root cause, not severity).** The fix was *not* softening parity
   (an existing test correctly encodes "empty surface = drift"); it was that `construct install` never ran
   the global front-door sync. Install now runs `sync --global` so every user-scope surface is populated
   and a fresh machine passes `doctor` (`lib/setup.mjs`, guarded by `install-parity.functional.test.mjs`).
3. **Five flagged modules — resolved (§9):** removed `pattern-promotion-service`, `vector-sync`,
   `lazy-install`; kept `proactive-activation` (live CLI consumer) and `postgres-search` (staged pg infra).
4. **(open, carried from §6)** Add ESLint + Prettier to the CI `lint` job; add a lint rule for bindingless
   `catch {}`; add report-only `c8` coverage; make `live-llm-tests` skips loud.

## 12. Telemetry vendor-agnosticism (the data plane is already there)

The product intent is to avoid lock-in to Langfuse and prefer an open standard (OpenTelemetry). **The
trace data plane already meets that intent today** — verified by running `lib/telemetry/client.mjs`:

- `resolveTraceBackend` supports five backends: `local`, `langfuse`, `http`, `otel`, `none`
  (`client.mjs:17`). **Default with no env is `local`** (vendor-neutral JSONL in `.cx/traces/`).
- **OTel is a first-class, implemented backend.** With `CONSTRUCT_TRACE_BACKEND=otel` +
  `CONSTRUCT_OTEL_EXPORTER_OTLP_ENDPOINT=<collector>/v1/traces`, `createRemoteClient` builds standard
  **OTLP** payloads (`buildOtlpPayload`, `resourceSpans`/`scopeSpans`/`spans`, `service.name`) and POSTs
  to `/v1/traces` — i.e. it exports to *any* OTLP-compatible backend (Tempo, Honeycomb, Jaeger, Datadog,
  or Langfuse's own OTLP endpoint). Confirmed: the client resolves to `backend: otel`,
  `remoteStatus: configured`.
- A second, richer OTel path exists at `lib/telemetry/otel-tracer.mjs` — a real OTel SDK tracer using the
  **stable GenAI semantic conventions** (`gen_ai.*`), W3C trace-context propagation, and the OTLP HTTP
  exporter, gated on `OTEL_EXPORTER_OTLP_ENDPOINT`, disablable with `CONSTRUCT_OTEL=off`.
- **Langfuse is auto-selected *only* when Langfuse-style keys are present**
  (`CONSTRUCT_TELEMETRY_PUBLIC_KEY` + `_SECRET_KEY`); a bare URL infers the generic `http` backend.

**So "be agnostic, maybe OTel" is not a rewrite — it's already the architecture.** The remaining
Langfuse coupling is confined to the **convenience/UX layer**, not the data plane:

1. `langfuse/docker-compose.yml` + `LANGFUSE_LOCAL` (`lib/service-manager.mjs`) — the bundled local
   self-hosted stack `construct dev` starts. One optional backend, not a dependency of emission.
2. `lib/server/langfuse-login.mjs` — the local-Langfuse one-click sign-in. The login **route** is now
   provider-aware (`/api/services/telemetry/login`, with `/langfuse/login` kept as a back-compat alias):
   an external `CONSTRUCT_TELEMETRY_URL` backend uses the vendor-neutral `telemetry-login.mjs`; local
   Langfuse keeps its zero-touch fallback.
3. `langfuse/docker-compose.yml` + `LANGFUSE_LOCAL` — the bundled local stack, one optional backend.

**Agnostic work completed:**
- OTel/OTLP documented as a first-class backend (§12 above, `docs/guides/concepts/observability.mdx`); the data
  plane defaults to local and selects Langfuse only with Langfuse-style keys.
- Login route made provider-aware; CLI/observability labels relabeled from "Langfuse" to backend-neutral.
- `tests/functional/telemetry-backend-agnostic.functional.test.mjs` asserts `CONSTRUCT_TRACE_BACKEND=otel`
  produces an OTLP client and guards the neutral bridge.
- **Dashboard frontend:** a cross-check found **no** Langfuse-specific link or label in `apps/dashboard`
  or the served `lib/server/static` bundle (the telemetry UI already references `otel`), so there was no
  frontend element to repoint — the UI is already vendor-neutral.

**Remaining (optional):** the bundled local Langfuse stack stays the default convenience backend; offering
a non-Langfuse local collector (e.g. an OTLP→Tempo compose) would complete vendor-neutral *defaults*, but
nothing today is Langfuse-locked at the data-plane or UI level.
