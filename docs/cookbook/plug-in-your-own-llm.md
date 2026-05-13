---
title: Plug in your own LLM
description: Swap models per tier (reasoning / standard / fast) — Anthropic, OpenAI, OpenRouter, Ollama, or any OpenAI-compatible endpoint.
---

Construct doesn't hardcode a single LLM. It assigns three tiers — `reasoning`, `standard`, `fast` — and each specialist declares which tier it uses. Swapping providers is a config change, not a code change.

## The tier model

Three tiers. Every specialist uses one of them.

- **`reasoning`** — slow, expensive, best at long-context analysis and architectural decisions. Defaults to Claude Opus.
- **`standard`** — everyday work. Defaults to Claude Sonnet.
- **`fast`** — quick lookups, low-stakes responses. Defaults to Claude Haiku.

Specialists declare their tier in `agents/registry.json`. Changing the tier→model mapping changes the model for every specialist on that tier.

## Inspect current assignments

```bash
construct models
```

Shows the active tier→model mapping plus the fallback chain per tier. Output looks like:

```
reasoning  →  anthropic/claude-opus-4-7
standard   →  anthropic/claude-sonnet-4-6
fast       →  anthropic/claude-haiku-4-5

Fallbacks (used on rate-limit or model-unavailable):
  reasoning: [openrouter/anthropic/claude-opus, openrouter/meta-llama/llama-3.3]
  standard:  [openrouter/anthropic/claude-sonnet, openrouter/openai/gpt-4o-mini]
  fast:      [openrouter/anthropic/claude-haiku, openrouter/openai/gpt-4o-mini]
```

## Swap one tier

```bash
construct models --apply --tier=reasoning --model=openrouter/anthropic/claude-opus-4-7
```

This writes to `agents/registry.json` under the `models` block. The change takes effect on the next session-start. No `construct sync` needed.

For a temporary swap (single session), set the env var instead:

```bash
export CONSTRUCT_MODEL_REASONING=openrouter/anthropic/claude-opus-4-7
```

## Swap to a non-Anthropic provider

Any OpenAI-compatible endpoint works. The model identifier is whatever the provider expects.

**OpenRouter:**

```bash
construct models --apply --tier=standard --model=openrouter/openai/gpt-4o
```

OpenRouter exposes most major models through one API. Set `OPENROUTER_API_KEY` in your environment or `~/.construct/config.env`.

**OpenAI direct:**

```bash
construct models --apply --tier=standard --model=openai/gpt-4o
```

Set `OPENAI_API_KEY`.

**Ollama (local):**

```bash
construct models --apply --tier=fast --model=ollama/llama3.3:70b
```

Ollama needs to be running locally (`ollama serve`). No API key. Construct talks to `http://localhost:11434` by default; override with `OLLAMA_HOST`.

**Any OpenAI-compatible endpoint:**

```bash
construct models --apply --tier=standard --model=custom/my-model \
  --endpoint=https://my-host.example.com/v1
```

The `custom/<id>` prefix routes through the generic OpenAI-compatible client.

## Prefer free / local models

```bash
construct models --apply --prefer-free
```

Walks the registry and remaps each tier to the cheapest available model. Useful for development, exploration, and when you don't want to burn cloud credits on routine work.

## Configure fallbacks

Each tier has a fallback chain. If the primary model returns rate-limit, model-unavailable, or a timeout, Construct walks the chain in order. Configure the chain:

```bash
construct models --apply --tier=reasoning --fallback=openrouter/anthropic/claude-opus,openrouter/meta-llama/llama-3.3
```

Empty fallback (`--fallback=`) disables fallback for that tier — strict mode.

## Verify

```bash
construct models
construct doctor
```

`doctor` checks that the active models are reachable (it does a `models list` call against each provider). If a model is configured but the API key is missing, doctor reports it as a critical failure.

## Per-specialist override

Most of the time you swap by tier — but a single specialist can override its tier with a direct model:

```json
{
  "name": "performance-auditor",
  "role": "Performance specialist",
  "model": "openrouter/openai/o1-preview",
  "model_tier": "reasoning"
}
```

When `model` is set, it overrides the tier mapping for this specialist only. Use sparingly — it defeats the point of the tier model.

## Track cost across providers

`construct cost` aggregates token spend across all configured providers. The dashboard's Doctor page shows live per-persona burn. If you swap to a new provider, `construct optimize` can rebalance specialists to the new cost curve.

## What about embeddings?

Embedding model is separate from LLM model. See [Plug in a retrieval backend](/cookbook/plug-in-retrieval-backend) for swapping embedders.

## Reference

- [`construct models`](/reference/cli/models-and-integrations) — every flag.
- [`agents/registry.json`](https://github.com/geraldmaron/construct/blob/main/agents/registry.json) — the `models` block + per-specialist overrides.
- [Concepts → Local-first](/concepts/local-first) — model swap implications for the offline story.
