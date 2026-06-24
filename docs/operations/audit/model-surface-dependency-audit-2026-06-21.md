# Model → Surface Dependency Audit (2026-06-21)

Bead `construct-rmk8.5` (epic `construct-rmk8`, related to the governed-loop epic `construct-6zga.1`). Independently-runnable, dependency-led audit of the path from canonical configuration through model resolution, capability resolution, provider dispatch, prompt/tool policy, evidence verdicts across surfaces, and the (not-yet-built) specialist evaluation loop.

Per the directory README, this is a dated snapshot: it records what was true on 2026-06-21. Correct current behavior in the canonical docs, not here.

## Method & evidence basis

- **Source reading** — every load-bearing claim cites a file and symbol the reader can re-verify (`rules/common/no-fabrication.md`).
- **Runtime trace evidence** — `construct impact <file>` against the dependency graph (`lib/graph/*`). The graph was **rebuilt on 2026-06-21** before querying; see [Stale-graph finding](#stale-graph-finding-the-live-one).
- **Test evidence** — `npm test` on 2026-06-21: 3241 tests, 3201 pass, 0 fail, 40 skip.
- **Evidence age** — last commit touching each module (`git log -1 -- <file>`).

## Summary

The model→surface path is healthy at the two ends and fragmented in the middle:

- **Provider dispatch** (`resolveLanguageModel`) is centralized through the Vercel AI SDK with one regex branch per provider family — clean, but it branches on the model-id prefix, which `construct-6zga.1.3` is chartered to remove.
- **Evidence verdicts** (`lib/chat/evidence.mjs`, landed 2026-06-21) are a versioned public contract with verified parity across terminal / SSE / export / JSONL / resume. This edge is in good shape; `construct-6zga.1.1` closed it.
- **Capability resolution is the gap**: behavior is derived from **four un-unified representations**, most of them name/size heuristics, with no single source of truth and inconsistent versioning. This is precisely the territory of `construct-6zga.1.4` (behavior matrix) and `construct-6zga.1.8` (ExecutionCapabilityProfile).

**No new follow-up beads are warranted.** Every verified gap already maps to an existing bead. Filing duplicates would violate the audit's own acceptance criterion ("only verified gaps produce bounded follow-ups"). Two concrete spec refinements for `6zga.1.8` are recorded below.

## Slice 1 — configuration → model resolution → capability profile

| Edge | Producer | Consumer | Source of truth | Contract / version | Tests | Runtime evidence | Evidence age |
|---|---|---|---|---|---|---|---|
| config → model selection | `lib/chat/config.mjs` (`saveChatConfig` → `.cx/chat-config.json`); `specialists/registry.json` (tier models) | `lib/chat/web-session.mjs` (`ensureWebChatRuntime`), `lib/chat/model-picker.mjs` | `.cx/chat-config.json` (`session.model`, `session.modelMode`) | `CONFIG_SCHEMA_VERSION=1` (`lib/config/schema.mjs`) | `chat-model-resolution.functional`, `model-resolver-no-defaults-chain.functional` | `impact lib/model-router.mjs` → 7 caps, 80 tests | model-router 2026-06-20 |
| model-id → provider family | `lib/model-router.mjs` `PROVIDER_FAMILY_TIERS` (regex `test(modelId)`); `lib/provider-capabilities.js` `resolveAdapterKey` | `apps/chat/engine/ai-sdk-agent.mjs` `resolveLanguageModel` | `PROVIDER_FAMILY_TIERS` array | regex on model-id prefix; **no version field** | `model-router.test.mjs`, `model-router-local.test.mjs` | in graph | 2026-06-20 |
| model → **capability profile** | **four producers, un-unified** (see below) | `web-session.mjs` (`capabilityTier`), `system-prompt.mjs`, `lib/mcp/tool-budget.mjs`, `model-picker.mjs` (badges) | **none — fragmented** | mixed (see below) | `capability-tier.test.mjs`, `provider-poll.functional`, `w1-provider-adapter-contracts.functional` | `impact provider-poll` → 5 caps, 17 tests (post-rebuild) | poll 2026-06-21 |

The four capability producers and why they do not compose:

| Producer | What it knows | Evidence kind | Persistence / version | Keyed by |
|---|---|---|---|---|
| `lib/provider-capabilities.js` (+ `-anthropic/-openai/-google/-deepseek/-generic`) | cacheControl, cacheMechanism, cacheTTL, structuredOutput, maxContextWindow, tokenRatio, annotationFormat | static declaration; optional adapter `probe()` (W1) | `~/.cx/provider-capabilities.json`, 24h TTL, **no schema version** | **adapter family**, not resolved model |
| `lib/models/provider-poll.mjs` | reasoning, tools, vision, context | **measured** — live provider API (`supported_parameters`, `architecture.input_modalities`) + name inference for OpenAI | none (in-memory per poll) | resolved model |
| `lib/model-router.mjs` (`parseModelSizeB`, `inferSmallModelProfile`, `resolveCapabilityTier`, `MODEL_OPERATING_PROFILES`) | size tier (`full`/`mid`/`floor`), prompt-token budgets | name/size regex heuristic | none | model-id string |
| `lib/ollama/capability-store.mjs` | agentic coherence verdict (`COHERENT`/`COLLAPSED`), tool-call ability | **measured** — `doctor --probe-local` | `~/.cx/local-models.json`, `STORE_VERSION=1`, **digest-keyed staleness** | local model + digest |

**Keystone for 6zga.1.8:** `lib/ollama/capability-store.mjs` already implements the exact pattern the ExecutionCapabilityProfile wants — versioned, measured, staleness via content digest, "probe don't trust," refusing to record failed probes. The profile should **generalize this store**, not reinvent it, and absorb the other three producers as evidence sources (`provider_metadata` ← provider-capabilities, `live_probe` ← provider-poll + the Ollama probe, `operator_override`, `unknown`).

## Slice 2 — profile → adapter → tool/prompt policy

| Edge | Producer | Consumer | Source of truth | Contract / version | Tests | Gap → bead |
|---|---|---|---|---|---|---|
| capability tier → system prompt | `model-router.mjs` `resolveCapabilityTier`, `resolveModelOperatingProfile` | `lib/chat/system-prompt.mjs` `buildSystemPrompt` (`CHAT_SYSTEM_SMALL` vs full) | `MODEL_OPERATING_PROFILES` | `capabilityTier ∈ {full,mid,floor}`; no version | `chat-system-prompt-tier.functional`, `capability-tier.test` | tier from name/size, not measured → `6zga.1.2`, `6zga.1.8` |
| model → provider adapter | `ai-sdk-agent.mjs` `resolveLanguageModel` (regex per family); W1 extension points (`probeProviderCapabilities`, `registerRefreshAdapter`, `setCachedContentResolver`) | `loop-driver.mjs`, `chat-loop.mjs` | `resolveLanguageModel` inline branching | returns AI SDK `LanguageModel`; **no normalized usage/cancellation/retry/error-classification contract** | `w1-provider-adapter-contracts.functional`, `chat-model-resolution.functional` | dispatch branches on prefix; error classification scattered in `lib/chat/openrouter-fallback.mjs` → `6zga.1.3` |
| model → tool budget | `lib/mcp/tool-budget.mjs` `isLocalModel` (name heuristic: `local/`, `ollama`, `localhost`) | MCP tool registration | `decideTrim` | boolean | covered indirectly | name heuristic, not profile → `6zga.1.2`, `6zga.1.8` |

## Slice 3 — normalized events → evidence verdict → web/terminal/export/resume

| Edge | Producer | Consumer | Source of truth | Contract / version | Tests | Runtime evidence | Status |
|---|---|---|---|---|---|---|---|
| tool results → evidence verdict | `lib/chat/evidence.mjs` `deriveEvidenceVerdict` | `chat-loop.mjs` (web/SSE), `tui/turn-block.mjs` (terminal), `export.mjs`, `session-persist.mjs` (JSONL/resume) | `lib/chat/evidence.mjs` | `EVIDENCE_SCHEMA_VERSION=1`; `migrateEvidenceVerdict` for legacy | `chat-evidence.test.mjs` (4/4), `chat-export/-session-restore/-turn-block.functional` | `impact evidence.mjs` → 4 caps, 15 tests incl. all four surfaces | **HEALTHY** — closed by `6zga.1.1` (committed `9eb8909`, unpushed) |

This is the one model-adjacent edge with a single versioned source of truth, migration for old data, and verified cross-surface parity. It is the template the capability layer should follow.

## Slice 4 — specialist prompt/skill/contract → outcome/evaluation loop

| Edge | Producer | Consumer | Source of truth | Tests | Gap → bead |
|---|---|---|---|---|---|
| specialist registry → prompt composition | `specialists/registry.json`, `personas/*.md`, `skills/roles/` | orchestration policy, prompt composer | `specialists/registry.json` | `specialist-prompt-emit` fixtures, `lint:contracts`, `lint:agents` | healthy for composition |
| specialist outcome → evaluation | telemetry exists (`construct review`, `cx_trace`, `cx_score`) | — | none — **the governed loop is not built** | — | by design → `6zga.1.5/1.6/1.7` |

The evaluation loop is absent because it is the planned work, not a defect. Telemetry primitives exist but no versioned dataset, held-out evaluation gate, or approval-gated controller does.

## Verified gaps and disposition

| # | Verified gap | Evidence | Disposition |
|---|---|---|---|
| 1 | Capability source-of-truth is fragmented across four modules | Slice 1 table | **relate** → `6zga.1.8` (consolidate), `6zga.1.4` (matrix as evidence producer) |
| 2 | `~/.cx/provider-capabilities.json` cache has no schema version | `provider-capabilities.js` `writeCapabilityCache` writes `{fetchedAt, capabilities}` only | **fold into `6zga.1.8`** spec — version the profile store (cf. `STORE_VERSION`/`EVIDENCE_SCHEMA_VERSION`) |
| 3 | Capability cache keyed by adapter family, not resolved model | `provider-capabilities.js` sync/probe paths use `cache[adapterKey]`; only the async path passes full `modelId` to the adapter | **fold into `6zga.1.8`** spec — key by configured provider + requested + resolved model + protocol + timestamp |
| 4 | No normalized provider-execution adapter contract (usage/cancellation/retry/error-class) | `resolveLanguageModel` returns a raw SDK handle; error classification lives in `openrouter-fallback.mjs` | **relate** → `6zga.1.3` |
| 5 | Behavior derived from name/size heuristics | `parseModelSizeB`, `inferSmallModelProfile`, `resolveCapabilityTier`, `tool-budget.isLocalModel`, OpenAI inference in `provider-poll` | **relate** → `6zga.1.4` (hermetic baseline), `6zga.1.8` (measured profile) |
| 6 | Dependency graph was stale → `construct impact` gave wrong results | graph generated 2026-06-20 00:41; `provider-poll.mjs`/`model-router.mjs`/`evidence.mjs` changed 2026-06-21; rebuild flipped `provider-poll` from "not in graph / 0 tests" to "5 caps / 17 tests" | **relate** → `rmk8.4` (graph-staleness watcher); this audit is live evidence it is real |

## construct impact validation (acceptance #4)

`construct impact` correctly identifies affected tests and surfaces for a changed model/provider/prompt contract — **once the graph is current**:

- `lib/provider-capabilities.js` → 7 capabilities, 80 tests
- `lib/model-router.mjs` → 7 capabilities, 80 tests
- `lib/models/provider-poll.mjs` → 5 capabilities, 17 tests (was 0 against the stale graph)
- `lib/chat/evidence.mjs` → 4 capabilities, 15 tests, including `chat-export`, `chat-session-restore`, `chat-turn-block` (the surfaces it feeds)

## Stale-graph finding (the live one)

The most important runtime finding is procedural: querying the dependency matrix without rebuilding it first produced a **false** "provider-poll is untracked, 0 tests" result. The graph is a derived artifact (`.cx/graph/*`, gitignored) with no automatic refresh on file change — exactly the gap `rmk8.4` ("wire `onFileChange` … doctor graph-staleness watcher") is deferred against. Until that lands, `construct impact` / `construct matrix` must be preceded by `construct matrix build`, or callers risk acting on stale evidence. This raises the practical priority of `rmk8.4`.
