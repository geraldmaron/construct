# Changelog

All notable changes to this project will be documented here.

## Unreleased

### Added
- `memory_search` MCP handler now uses `buildHybridSearchResultsAsync` — queries Postgres `construct_embeddings` via cosine similarity instead of the sync file-only path
- `lib/storage/postgres-backup.mjs` — `stashConstructDb`, `restoreConstructDb`, `purgeConstructDbStashes` for durable pg_dump/restore of the managed `construct-postgres` container (mirrors Langfuse pattern)
- `stopServices` in `service-manager.mjs` stashes the Postgres DB before stopping containers so data survives Docker restarts
- `runSetup` in `setup.mjs` restores the most recent Postgres stash after schema migration so embeddings are available immediately on first sync
- `purgeExpiredData` in `lib/storage/admin.mjs` — TTL-based purge of SQL documents/embeddings, local vector index records, and `.cx/observations/obs-*.json` files; controlled by `CONSTRUCT_DATA_RETENTION_DAYS`
- `storage_sync` MCP handler runs `purgeExpiredData` automatically on each sync (silent no-op when retention is not configured)
- `searchSessions` in `session-store.mjs` now uses hybrid cosine + BM25 ranking with automatic fallback to substring matching when no vectors exist
- `searchEntities` in `entity-store.mjs` now uses the same hybrid ranking; entity vectors stored in `.cx/observations/entity-vectors.json`
- `resetStorage` in `admin.mjs` now wipes observation/session/entity vector files and purges all Postgres stash backups
- `CONSTRUCT_DATA_RETENTION_DAYS` documented in `.env.example`
- `refreshPricingCatalog()` — new export in `langfuse-model-sync.mjs`; fetches the LiteLLM community pricing JSON (no auth, 24h disk cache at `~/.cx/pricing-cache.json`) and rebuilds the in-process catalog; called at plugin init so `estimateUsageCost` uses live rates from the first assistant turn
- `fetchLiteLLMPricing()` — internal function backing `refreshPricingCatalog`; maps LiteLLM's `input_cost_per_token`, `output_cost_per_token`, `cache_read_input_token_cost`, `cache_creation_input_token_cost` fields to the internal pricing entry shape
- `buildPricingCatalog(openRouterModels, litellmModels)` — second argument added; LiteLLM models are layered between OpenRouter (lowest) and static (highest) so Anthropic/Copilot entries always win
- `lib/hooks/stop-notify.mjs` rewritten — replaces hardcoded Sonnet pricing with `estimateUsageCost(model, usage)` using the model ID extracted from each transcript entry; adds per-transcript checkpoint file (`~/.cx/transcript-checkpoints.json`) that records the last processed line so every assistant turn in a Stop cycle is logged, not just the final one
- `sanitizeUsage` in `opencode-runtime-plugin.mjs` now emits `cacheCreation5mInputTokens` and `cacheCreation1hInputTokens` split fields alongside the existing aggregate `cacheCreationInputTokens`
- `estimateUsageCost` in `langfuse-model-sync.mjs` rewritten — computes `input + cacheRead×0.10 + cacheWrite5m×1.25 + cacheWrite1h×2.00 + (output+reasoning)×outputPrice`; returns `breakdown` with per-component costs; residual aggregate cache_creation tokens default to 5m pricing
- `upsertLangfuseModel` now sends a `prices` map with `input`, `output`, `input_cache_read`, `input_cache_write_5m`, `input_cache_write_1h` subtypes to Langfuse; delete-then-recreate on price change
- `tests/langfuse-model-sync.test.mjs` — new test file covering cache pricing math, per-model rate selection, reasoning token billing, residual cache creation fallback, static-over-OpenRouter/LiteLLM precedence, and unknown model handling

### Changed
- `session-store.mjs` embeds session summaries on create/update and stores vectors in `.cx/sessions/vectors.json`
- `entity-store.mjs` embeds entity name + summary on create/update and stores vectors in `.cx/observations/entity-vectors.json`
- `admin.mjs` observation purge logic simplified — removed mixed dynamic-import/require pattern, uses static `readdirSync`/`rmSync` from top-level import
- `langfuse-model-sync.mjs` pricing priority order changed to: static > LiteLLM > OpenRouter (was: static > OpenRouter); `syncModelPricing` now fetches LiteLLM in parallel with OpenRouter and includes those models in the Langfuse upsert pass
- Haiku 4.5 static price corrected to `$1/$5` per million tokens (was `$0.80/$4`)
- `buildPricingCatalog` signature changed from `(openRouterModels)` to `(openRouterModels, litellmModels)` — callers passing only OpenRouter models are unaffected
