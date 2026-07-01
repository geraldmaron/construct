<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0050: The provider worker holds a scoped, governed web capability (unified WebGrant)

- **Date**: 2026-07-01
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner), Construct maintainers (cx-architect)
- **Relates to**: ADR-0019 (execution-capability descriptive contract), ADR-0020 (local orchestration runtime, inline prepare-only), ADR-0021 (provider worker backend), ADR-0017 (Admiralty grading), ADR-0037 (specialist prompt format), F08 (untrusted-content labeling)
- **Tracking**: construct-bcbo.15

## Problem

The orchestrator prompt tells the model "web access lives with the researcher — route it via `orchestration_run`", and the cx-researcher persona instructs it to "fetch every URL". But no execution path wired those tools: the provider worker ran every specialist as a tool-less completion, and specialists went internal (no host subagent carries WebSearch/WebFetch). A model told to fetch URLs with no fetch tool refuses or **fabricates** — a direct collision with Construct's no-fabrication rule (`rules/common/no-fabrication.md`). This was filed as construct-bcbo.15 after a four-agent adversarial investigation and reproduced live in an OpenCode host: a request that asked the agent to "validate you can connect to the internet before proceeding" proceeded without connecting.

The lens model (ADR-0020/0021 — specialists are reasoning prompts; live capabilities come from the host or a governed MCP surface) is deliberate. The defect was the mismatch between what the system *claims* the researcher can do and what the worker *provides*.

## Decision

The provider worker backend may run a **bounded tool loop for web-capable specialists only** (currently the researcher, which declares `liveWebAccess: true`), refining the ADR-0020/0021 "worker performs no tool-augmented reasoning" boundary. A single `resolveWebCapability` resolver returns a typed **WebGrant** in strict priority:

- **governed** (`WEB_SEARCH_URL` set): the worker runs a client tool-use loop and executes `web_search` via Construct's own `lib/mcp/tools/web-search.mjs` — F08 governance by construction; the model never touches a raw fetcher.
- **provider-native** (no `WEB_SEARCH_URL`): Anthropic's `web_search_20250305` server tool, or OpenRouter's `openrouter:web_search` server tool (the deprecated `:online`/web-plugin forms are not used). Every returned citation is re-graded through the single grader so `trust:'untrusted'` + Admiralty + confidence hold identically.
- **host-delegated** (explicit `CONSTRUCT_ORCHESTRATION_WEB_DELEGATE`): a tool-capable host executes and returns already-governed evidence, re-validated fail-closed on ingress.
- **unavailable** (nothing resolves): a typed `capability-unavailable` degradation that forces an honest insufficient-evidence refusal, and degrades the run.

**F08 is preserved because `governWebResults` (extracted to `lib/mcp/tools/web-search-governance.mjs`) is the ONLY producer of web evidence on every path** — governed executes it directly; provider-native re-grades each citation through it; the remote ingress guard re-runs it fail-closed so an out-of-repo service cannot inject ungoverned or trusted web text. Anthropic native web search is used only in provider-native mode with mandatory re-grading, never as a shortcut around F08 on the governed path.

## Alternatives considered

- **Provider-native only** (drop the governed loop): reaches the web without `WEB_SEARCH_URL` but makes F08 always a re-grade (never by-construction) and abandons Construct's own governed fetcher when it is configured. Rejected as the primary; kept as the no-`WEB_SEARCH_URL` fallback.
- **Governed loop only** (Construct's `web_search` always): strongest F08 guarantee, but cannot reach the web on the machine's primary provider (OpenRouter) without `WEB_SEARCH_URL`, so it always lands on the honesty guard there. Rejected as the sole design; adopted as the top-priority mode.
- **Honesty guard only** (no real web, just stop lying): closes the fabrication hazard but never fulfills the routing promise. Rejected as insufficient; retained as the `unavailable` terminal state.
- **Keep the lens boundary** (no worker tools): leaves the orchestrator prompt's claim false. Rejected — this ADR is exactly the decision to supersede that boundary for web-capable specialists.

## Consequences

- Web-capable specialists reach the web on both configured providers with and without `WEB_SEARCH_URL`; every result the specialist sees is `trust:'untrusted'` + Admiralty-graded.
- When no path resolves, the run is `degraded` with `degradationReason: 'capability-unavailable'` and the specialist is instructed to refuse rather than fabricate.
- The worker tool loop is bounded by `CONSTRUCT_WORKER_TOOL_ROUNDS` (default 4); provider-native Anthropic `pause_turn` continuation is bounded by the same cap.
- Non-web specialists and inline/prepare-only runs are unchanged; a prepared web-capable task records `webCapability: 'prepare-only'` so a host never infers web it did not reach.
- Live end-to-end web requires the operator's provider keys (and, for Anthropic native, org-level web-search enablement); the mechanism, governance, and honesty guard are proven by unit tests with mocked providers.
