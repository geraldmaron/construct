# ADR 0032: Small Model Context Methodology & Platform-Native Orchestration

## Status
Accepted | revised 2026-06-09 after empirical validation — see `tests/e2e/reports/local-model-validation.md`

## Context
Running local Ollama models (e.g. Qwen 7B) inside OpenCode produced severe repetition
collapse ("word salad" — `"client client … ver ver"`). An empirical investigation
(recording proxy + direct `/v1` and native-API bisection, 2026-06-09) overturned the
original hypotheses in this ADR and established the actual mechanics:

1. **Context is not settable from `opencode.json`.** OpenCode reaches Ollama through
   the OpenAI-compatible `/v1` endpoint. `num_ctx` is forwarded in the request body
   but **Ollama's `/v1` endpoint does not honor it** — the runtime window stays at
   Ollama's 4096 default. `repeat_penalty` (Ollama-specific) is likewise dropped. Only
   OpenAI-standard params (`temperature`, `stop`, `top_p`, `frequency/presence_penalty`)
   survive the boundary. The only way to set a real context window is a Modelfile
   `PARAMETER num_ctx` baked via `ollama create`.

2. **Tool overload dominates the payload.** A full Construct session serializes ~133
   MCP tool schemas (~34k tokens) plus the system prompt — ~36k input tokens. Per-agent
   `permission: "deny"` and `tools: {glob:false}` do **not** remove a tool's schema from
   the payload (they only gate execution); only disabling a whole MCP server
   (`mcp.<id>.enabled:false`) reduces the count.

3. **The collapse is model-specific.** `qwen2.5-coder:7b` degenerates on OpenCode's
   agentic system prompt regardless of context window, tool count, temperature, or
   repeat_penalty. The identical payload runs coherently — with correct tool calls — on
   `qwen3-coder:32k` and `devstral:24b`. Capability is not predictable from parameter
   count and must be probed empirically.

The earlier hypotheses — "cap context at 8k" and "inject `repeat_penalty 1.15` via
config" — are falsified: capping cannot be done over `/v1`, and the injected penalty is
silently dropped.

## Decision
A small-context local-model methodology with four pillars plus capability honesty:

### 1. Platform-Native Orchestration Alignment
Do not inject the static specialist roster into the system prompt on hosts with native
subagent routing (OpenCode, VS Code, Cursor). They get a tool-bound micro-prompt and
resolve the chain at runtime via the `orchestration_policy` MCP tool. Hosts without
native routing (Claude Code, Codex) still receive the roster. Implemented in
`scripts/sync-specialists.mjs` `buildPrompt()`.

### 2. Real Context Windows via Modelfile Variants
For any tool-capable model lacking a baked `num_ctx` (size is not a gate —
capability does not track parameter count), auto-provision a context-extended
variant (`<model>-cx<N>k`) via `ollama create` with `num_ctx`,
`repeat_penalty`, and ChatML `stop` baked in, and register the variant in place of the
raw tag. Implemented in `lib/ollama/provision-context.mjs`, wired through
`platforms/opencode/sync-config.mjs`.

### 3. Tool-Surface Reduction
Prune the orchestrator's tool surface with OpenCode `permission` denies, and for
local-first setups disable heavy external MCP servers (`mcp.<id>.enabled:false`) — the
only lever that actually shrinks the serialized schema — so the surface fits a
small-model window.

### 4. Sampler Hygiene in the Right Place
`opencode.json` emits only boundary-surviving params (`temperature`, `stop`). The real
sampler settings (`num_ctx`, `repeat_penalty`, stop tokens) are baked into the Modelfile
variant. Never emit `frequency_penalty`/`presence_penalty` — the wrong knob for Qwen.

### 5. Capability Honesty
Some small models cannot do agentic tool use no matter how the context and tools are
tuned. Construct provides an empirical coherence probe
(`provision-context.mjs --probe`) and steers users toward agentic-capable local models
rather than silently registering a model that will collapse.

## Consequences
- **Positive:** Capable local models (qwen3-coder, devstral) run the full Construct loop
  coherently; payload shrinks enough to fit a 32k window; users get an honest signal
  about model suitability instead of inexplicable word salad.
- **Negative:** Modelfile variants consume extra Ollama metadata (layers are shared, so
  disk cost is negligible) and depend on `ollama create`. Models that fail the coherence
  probe simply are not usable for agentic work — Construct surfaces this rather than
  papering over it.
