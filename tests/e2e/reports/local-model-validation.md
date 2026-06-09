<!--
tests/e2e/reports/local-model-validation.md — OpenCode + Ollama local-model "word salad" investigation.

Executed 2026-06-09 (bead construct-k6fu). Reproduces the repetition collapse, measures the exact
payload reaching Ollama via a recording proxy, and bisects the trigger across models, context windows,
tool counts, and samplers. Conclusion: the collapse is model-specific (qwen2.5-coder:7b), not a Construct
bug; capable models run the identical payload coherently. Evidence and per-arm numbers inline.
-->

# Local-model validation — OpenCode + Ollama "word salad"

**Date:** 2026-06-09 · **Branch:** `research/capability-registry` · **Bead:** construct-k6fu
**Method:** `opencode run` driven headlessly through a recording reverse-proxy
(`tests/helpers/ollama-record-proxy.mjs`) that measures the exact payload reaching
Ollama, plus direct `/v1` and native-API replays to bisect the trigger. All numbers
are proxy-measured; token counts are char/4 estimates.

## Reproduction

`opencode run` + `qwen2.5-coder:7b` returns degenerate repetition
(`" client client client … ver ver"` in the user's screenshot;
`"given given given"` / `"having having"` in the harness) for any prompt, including
trivial ones.

## Measured payloads (model: qwen2.5-coder:7b unless noted)

| Profile | MCP servers | Tools | sys tok | total in tok | Output |
|---|---|---:|---:|---:|---|
| Default agent, full config | all 5 | **133** | 2586 | **36,410** | word salad |
| Vanilla | none | 10 | 2586 | 8,196 | word salad |
| Pruned (`fixed`) | construct-mcp only | 78 | 2584 | 22,370 | word salad (7b) |
| Pruned + cx32k variant | construct-mcp only | 78 | 2586 | 22,372 | no repetition, weak |
| Vanilla + cx32k variant | none | 10 | 2586 | 8,203 | **word salad** |

The last two rows are decisive: with a real 32k window (cx32k Modelfile variant),
22k and 8k payloads both fit — yet 8k still word-salads. **Truncation is not the
(sole) cause.**

## Bisection (direct `/v1`, bypassing OpenCode)

| Request | Model | Result |
|---|---|---|
| trivial "say hello" | qwen2.5-coder:7b | ✅ "Hello! How can I assist you today?" |
| simple msg, no tools | qwen2.5-coder:7b | ✅ coherent |
| small system + 2 tools | qwen2.5-coder:7b | ✅ "This …" |
| **OpenCode system prompt, no tools** | qwen2.5-coder:7b | ❌ "given given given" |
| OpenCode prompt, temp 0.0 / 0.3 / 0.7 | qwen2.5-coder:7b | ❌ all collapse |
| OpenCode prompt + native `repeat_penalty 1.3` | qwen2.5-coder:7b | ❌ collapse |
| **exact OpenCode body** | **qwen3-coder:32k** | ✅ coherent + correct tool call |
| exact OpenCode body | devstral:24b | ✅ "This is a Capstone Project." |
| exact OpenCode body | qwen2.5-coder:7b | ❌ "given given given" |

Empirical capability probe (`provision-context.mjs --probe`):
`qwen2.5-coder:7b: COLLAPSED (repeat=0.58, tool=false)`.

## Findings

1. **The word salad is model-specific.** `qwen2.5-coder:7b` degenerates on OpenCode's
   agentic system prompt regardless of context window, tool count, temperature, or
   repeat_penalty. The **identical** Construct + OpenCode payload runs coherently and
   uses tools correctly on `qwen3-coder:32k` and `devstral:24b`. It is not a Construct
   bug and is not fixable via configuration.
2. **`num_ctx` is forwarded but ignored.** OpenCode sends `num_ctx` in the `/v1` body,
   but Ollama's OpenAI-compatible endpoint does not honor it — the runtime window
   stays at Ollama's 4096 default. The only mechanism that sets a real window is a
   Modelfile `PARAMETER num_ctx` (`ollama create`), confirmed by `ollama show`.
3. **Tool overload is real and only `mcp.<id>.enabled:false` reduces it.** The full
   surface is 133 tools / ~36k input tokens (≈34k from tool schemas). Per-agent
   `permission: "deny"` and `tools: {glob:false}` did **not** drop tool schemas from
   the payload (both still sent 78); disabling a whole MCP server did
   (133→78→10). 36k exceeds even a 32k window, so the heavy external servers must be
   off for the full surface to fit a small-model window.
4. **Samplers belong in the Modelfile.** `repeat_penalty`/`num_ctx` are Ollama-specific
   and dropped over `/v1`; `frequency/presence_penalty` are the wrong knob for Qwen.
   Only `temperature` and `stop` survive the boundary.

## What Construct changed (this branch)

- **Roster suppression** on native-subagent hosts (OpenCode) — construct prompt
  3942→3016 tokens; tool-bound `orchestration_policy` micro-prompt instead.
- **Context-extended Modelfile variants** auto-provisioned for any tool-capable
  model lacking a baked `num_ctx`, regardless of size (`lib/ollama/provision-context.mjs`);
  registered in place of the raw tag. Capability does not track parameter count, so
  size is not a gate — `devstral:24b` needs a real window as much as a 7B does.
- **MCP pruning** on the orchestrator via OpenCode `permission` (github / context7 /
  sequential-thinking / memory / heavy construct-mcp denied).
- **Sampler hygiene** — only `temperature` + ChatML `stop` emitted; no
  `num_ctx`/`repeat_penalty`/`frequency`/`presence`.
- **Agentic-coherence probe** — empirical model-capability check, surfaced at sync.

## Recommendation to users

Use an agentic-capable local model (verified here: `qwen3-coder:32k`, `devstral:24b`).
Run `node lib/ollama/provision-context.mjs --probe --model=<id>` before relying on a
model. `qwen2.5-coder:7b` is not reliable for agentic OpenCode use.
