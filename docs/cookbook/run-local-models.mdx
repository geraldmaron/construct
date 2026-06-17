---
title: Run Construct with Local Models (Ollama + OpenCode)
description: Make local Ollama models work with Construct's orchestration layer in OpenCode — and avoid the "word salad" repetition collapse.
---

Construct's orchestration layer (a sizable system prompt plus MCP tool schemas) is
demanding for small local models. Run it wrong and a model produces repetition collapse
— `"client client client … ver ver"` word salad — instead of answers. This page
explains why, and how Construct sets local models up to work.

## The three things that break local models

### 1. `opencode.json` cannot set the context window
OpenCode talks to Ollama over the OpenAI-compatible `/v1` endpoint, which has no field
for the context window. Ollama serves every model at its **4096-token default** unless
told otherwise — and `num_ctx` set in `opencode.json` is **silently ignored** over
`/v1`. A Construct session's tool schemas overrun 4096 and the model collapses.

**Fix:** the context window must be baked into the model with a Modelfile. Construct
auto-provisions a context-extended variant for each tool-capable model that lacks a
baked `num_ctx` — any size, since capability does not track parameter count:

```bash
construct sync   # creates e.g. qwen2.5-coder:7b-cx32k via `ollama create`, registers it
```

You can also do it by hand, or set `OLLAMA_CONTEXT_LENGTH` when launching Ollama:

```bash
printf 'FROM qwen2.5-coder:7b\nPARAMETER num_ctx 32768\n' | \
  ( cat > /tmp/Modelfile && ollama create qwen2.5-coder:7b-cx32k -f /tmp/Modelfile )
```

Pick the registered `…-cx32k` variant in OpenCode's model picker. Override the window
with `CONSTRUCT_LOCAL_NUM_CTX=16384 construct sync`.

### 2. Too many tools
A full Construct session exposes ~133 MCP tools (~34k tokens of schema) across five
servers — far more than a small-model window holds, and enough to dilute attention even
when it fits. OpenCode's per-agent `permission: "deny"` does **not** remove a tool's
schema from the payload; only disabling a whole MCP server does. And the per-agent prune
on the `construct` orchestrator never reaches the built-in **Build/Plan** agents — those
still see every globally-registered server.

So when your default OpenCode model is local (`model: "ollama/…"`), `construct sync`
**automatically disables** the heavy external servers in the global `opencode.json`,
keeping `construct-mcp`:

```jsonc
// opencode.json — written by sync when the default model is ollama/…
"mcp": {
  "github":             { "enabled": false },
  "context7":           { "enabled": false },
  "memory":             { "enabled": false },
  "sequential-thinking":{ "enabled": false }
}
```

That brings the surface to ~78 tools (~22k tokens), which fits a 32k window, and it
applies to every agent (Build/Plan included). Switch your default back to a cloud model
and the next sync restores the full surface.

### 3. Some models simply can't do it
Context and tools aside, **model capability is model-specific and not predictable from
size.** In testing, `qwen2.5-coder:7b` collapses into repetition on OpenCode's agentic
system prompt no matter how it's configured, while `qwen3-coder:32k` and `devstral:24b`
run the **identical** Construct payload coherently with correct tool calls.

Probe a model before relying on it:

```bash
node lib/ollama/provision-context.mjs --probe --model=qwen2.5-coder:7b
# qwen2.5-coder:7b: COLLAPSED (repeat=0.58, tool=false)
node lib/ollama/provision-context.mjs --probe --model=qwen3-coder:32k
# qwen3-coder:32k: COHERENT (repeat=0.0, tool=true)
```

## Recommended local models
Verified agentic-capable for Construct + OpenCode: **`qwen3-coder:32k`**,
**`devstral:24b`**. Avoid `qwen2.5-coder:7b` for agentic work.

## Samplers
Over `/v1`, only OpenAI-standard params reach the model (`temperature`, `stop`).
Ollama-specific ones (`num_ctx`, `repeat_penalty`) are dropped — set those in the
Modelfile. Construct never emits `frequency_penalty`/`presence_penalty` (the wrong knob
for Qwen). Construct emits `temperature: 0.1` and ChatML `stop` tokens.

## Tool-call reliability
Prompt-only tool calling from small models fails some of the time. Construct reduces
that two ways it controls: it prunes the tool surface for local models (so attention
isn't diluted), and the OpenCode orchestrator micro-prompt carries a **worked few-shot
example** of an `orchestration_policy` call — small models call tools far more reliably
with one shown.

Two stronger techniques are **not reachable** from Construct because OpenCode owns the
`/v1` request and the generate→parse→retry turn loop:

- **Grammar / JSON-schema constrained decoding** (invalid tokens masked at sampling,
  >99%/step) — OpenCode uses the standard OpenAI tool-call format, not Ollama's `format`
  grammar passthrough, so Construct cannot inject a grammar.
- **A bounded re-prompt loop on malformed tool output** — the OpenCode plugin hooks
  observe and mutate *pre-call* params but cannot intercept the model's generated
  tool-call output to force a retry. That loop is OpenCode's to own.

Both are tracked for upstream support; neither is faked locally.

## Verifying
Reproduce and measure the payload your model actually receives:

```bash
node tests/e2e/local-model-ab.mjs --model=qwen3-coder:32k --profile=fixed
```

See `tests/e2e/reports/local-model-validation.md` for the full investigation.
