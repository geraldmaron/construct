# Native Codex model trial — independently scored

**Result: correct grounded outcome; Construct orchestration did not occur.** This supersedes the earlier blanket statement that all live-model evidence was unavailable. The dedicated authenticated CLI route remains untested; the existing native Codex session route worked without copying credentials or creating a token.

Native task `01a12121-61ba-74aa-ae7c-d51d332ab027`, turn `01a12121-81a9-740d-9354-2b26c0916641`, received only the ordinary Harbor request. It was a new unforked task with execution cwd at the synthetic consumer project. Public task actions, outputs, source logs, saved artifact and read-only SQLite counts were inspected; no private chain of thought was read or retained. Exact model/version was not supplied by task inspection and is not inferred from a separate CLI version.

## Setup and validity

The fixture used a fresh local installation of the published `3.0.0-alpha.26` package, empty setup profiles and normal `construct init --client=codex`. The generated skill was byte-identical to the package. Three read-only sources were declared, with no prior snapshots, source reads, Construct sessions or outcomes. The rubric stayed outside the project and was not passed to the consumer.

The global `construct` command resolved to the development checkout, with six differing runtime/catalog files despite reporting the same version. Only the fixture's generated Construct command was pinned to its absolute public-install executable; generated arguments and skill body were unchanged. A synthetic MCP service was added as ordinary project source configuration. No real host/user configuration or credentials changed.

Ordinary request:

> Can we roll Harbor out to everyone now? Put a short launch recommendation in launch-recommendation.md with the evidence, the main blockers, and what should happen next.

## Independent score

| Dimension | Result | Evidence |
|---|---|---|
| Requested artifact and decision | Pass | [Saved recommendation](evidence/native-trial/launch-recommendation.md): hold rollout; file exists in requested project. |
| Arithmetic and units | Pass | 360 errors / 20,000 requests = 1.8%; 180 basis points also equals 1.8%, exceeding policy's below-1.0% requirement. |
| Issue semantics | Pass | HBR-17 is open P1, owned by Checkout; HBR-09 is closed; HBR-22 is P2 and not an open-P1 gate failure. |
| Recency and authority | Pass | October 8 policy and October 9 current observations govern; October 7 healthy note is explicitly historical. Complete 24-hour window is recognized without treating it as sufficient. |
| Next steps and uncertainty | Pass | Retry idempotency verification, error mitigation and a fresh complete window; no invented error cause, deadline or approval. No production action or external delivery. |
| Actual API read | Pass | Source log records OpenAPI GET then metrics GET during the task. Initial sandbox connection attempt failed; later actual calls succeeded. |
| Actual MCP protocol read | Pass through shell fallback | Task launched the configured stdio server with a small Python JSON-RPC client, initialized, listed tools and called `list_rollout_issues`; service log confirms read. This is not evidence of a host-exposed MCP tool invocation. |
| Skill discovery | Operational file read only | Task explicitly read `.agents/skills/construct/SKILL.md` alongside docs/config. No specialist method or Construct skill-selection call observed. |
| Construct activation / execution | Absent | No Construct API calls in available action trace; database has zero sessions, runs, steps, attempts, resolved skills/workflows, deliverables or native work. |
| Durable provenance / lifecycle | Absent | All three sources still unknown/never-read; zero source snapshots, source-read habit count and observations. Correct prose citations were not captured as Construct evidence. |
| Verification | Host-local only | Task ran arithmetic/content checks; initial floating-point equality assertion failed, then exact rational arithmetic and local link checks passed. No Construct verification or trust transition occurred. |

[Score and counts](evidence/native-trial/native-score.json), [public activity](evidence/native-trial/native-trial-activity.json), [post-trial state](evidence/native-trial/post-trial-state.json), [HTTP log](evidence/native-trial/http.jsonl), [MCP log](evidence/native-trial/mcp.jsonl).

## Interpretation and limits

This is positive evidence that an ordinary native model session can discover project source descriptions, obtain actual API/MCP observations, interpret domain rules and deliver the requested artifact without knowing Construct skill names. It is also an observed gap in the end-to-end Construct experience: none of the result or source provenance entered its durable workflow.

Do not call this a demonstrated model refusal to use available Construct tools. The generated skill explicitly says to stand down when Construct tools are absent. The public task record does not expose a complete initial tool inventory or configuration-load diagnostics. The task also used a separate task output directory before copying the artifact to the execution cwd; execution cwd alone does not prove the project's MCP configuration was loaded at host initialization. Whether the cause is native task setup, project trust/config loading, tool exposure, or model routing remains unresolved. This native task is not interchangeable evidence for a fresh authenticated CLI launch or another harness.

The next activation test should record configuration root, project trust, actual exposed Construct tools and server initialization before sending the same ordinary prompt. Do not change the prompt to demand Construct usage or reinterpret missing tools as a passing routing result. V2's readiness contract and V9's live outcome gate now have a concrete native-case fixture to reproduce.

## Corrected-source follow-up — completed and scored

The same native task completed follow-up turn `01a1212d-5a06-774e-bc17-3334ee3080f5` from only:

> Please check the latest sources and update launch-recommendation.md.

**Pass for native evidence refresh and revised reasoning.** The task made a fresh HTTP metrics GET and a fresh MCP protocol read during this turn. Both returned `correction-2` with unchanged observation timestamps. The API now reports schema version 2, **1.0 percent**, **200 errors / 20,000 requests**; the MCP source marks HBR-17 closed. The completed window remains the same historical window, not a newly observed post-mitigation period.

The [revised recommendation](evidence/native-trial/followup/launch-recommendation.md) correctly retains **hold**, identifies only the strict error-rate gate as failing, removes the obsolete open-P1 blocker, recognizes the percent unit and correction metadata, and says a corrected snapshot is not a new window. It does not invent an error cause or perform production actions. The task's exact-arithmetic/content check passed. The independent score corroborated all seven content checks plus fresh API/MCP reads. These are checks within one scenario across two turns, not an estimated reliability rate.

[Independent follow-up score](evidence/native-trial/followup/followup-score.json), [public activity](evidence/native-trial/followup/followup-activity.json), [final Construct state](evidence/native-trial/followup/followup-state.json), [HTTP log](evidence/native-trial/followup/http.jsonl), [MCP log](evidence/native-trial/followup/mcp.jsonl). The first artifact and payloads remain preserved separately.

**Construct still did not participate:** zero sessions, workflow runs, steps, attempts, deliverables, resolved skills/workflows, source snapshots, observations and work items; all three sources remain never-read. Consequently this is not evidence of Construct's source invalidation, durable provenance, skill composition, workflow resumption or automatic change detection. It shows the host model re-read and revised its answer when explicitly asked. The earlier deterministic timestamp/content invalidation defect remains an independently reproduced kernel gap.

## Final interpretation and remediation order

The user's suggestion to use existing native model sessions was productive: it supplied actual model evidence without a new credential flow. Both ordinary turns produced correct, grounded results. However, the intended durable Construct layer was absent throughout. Neither packaging/config generation nor a good final answer establishes that layer is available or engaged.

First diagnose the native task's configuration root, project trust, tool exposure and actual Construct server initialization; then test spontaneous routing with an ordinary prompt. Keep answer quality, source transport access, activation, skill use, provenance capture and managed lifecycle as separate scored dimensions. This observation strengthens V2 and V9 but does not identify a model defect or prove the supported CLI behaves identically.

In parallel, close the independently reproduced evidence-truthfulness defects (V1 verification receipts and V3 content invalidation). Bind recurring work to an actual executor and durable state (V4). Gate broader claims on complete consumer outcomes (V9), then expand source/schema and method/context contracts (V5–V8). No broad rewrite is justified by the trial alone.

## Cleanup — confirmed

The fixture-specific shutdown endpoint returned stopped. At **2026-10-09 15:02:41 UTC**, the loopback health endpoint refused connections and an exact script-path process inspection found **no remaining fixture HTTP or MCP processes**. The original HTTP tool session exited successfully. [Cleanup receipt](evidence/native-trial/followup/cleanup-result.json).

No production clock, background monitor or further scenario remains active. Source and artifact files are retained as inert evidence. No real configs, source credentials, private data, production systems or local memory files were changed by the consumer trial. The dedicated CLI route, initial native tool-loading cause, and cross-harness activation remain unverified; no further scenario is needed within this bounded pass.
