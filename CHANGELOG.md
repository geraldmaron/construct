# Changelog

All notable changes to this project will be documented here.

## Unreleased

### Added
- `lib/mcp/tools/project.mjs` — `agentHealth`, `summarizeDiff`, `scanFile`, `projectContext`, `workflowStatus` extracted from `lib/mcp/server.mjs`
- `lib/mcp/tools/document.mjs` — `extractDocumentText`, `ingestDocument`, `inferDocumentSchemaTool`, `listSchemaArtifactsTool`
- `lib/mcp/tools/storage.mjs` — `storageStatus`, `storageSync`, `storageReset`, `deleteIngestedArtifactsTool`
- `lib/mcp/tools/skills.mjs` — `listSkills`, `getSkill`, `searchSkills`, `getTemplate`, `listTemplates`, `agentContract`, `orchestrationPolicy`, `listTeams`, `getTeam`; `orchestrationPolicy` now includes `draftTask` for non-immediate requests (auto-workflow-intake)
- `lib/mcp/tools/workflow.mjs` — `workflowInit`, `workflowAddTask`, `workflowUpdateTask`, `workflowNeedsMainInput`, `workflowValidate`, `workflowImportPlan`
- `lib/mcp/tools/telemetry.mjs` — `cxTrace`, `cxScore`, `sessionUsage`, `efficiencySnapshot`
- `lib/mcp/tools/memory.mjs` — `memorySearch`, `memoryAddObservations`, `memoryCreateEntities`, `memoryRecent`, `sessionList`, `sessionLoad`, `sessionSearch`, `sessionSave`
- `readProviderCooldowns`, `writeProviderCooldown`, `isProviderOnCooldown` in `lib/model-router.mjs` — per-provider cooldown persistence at `~/.cx/provider-cooldowns.json` with a 5-minute window
- `selectFallbackModel` in `lib/model-router.mjs` — high-level failover entrypoint: classifies hook input, skips cooldown-blocked providers, resolves a tier candidate from the registry fallback list
- `lib/telemetry/backfill.mjs` — `backfillSparseTraces`, `triggerAutoBackfillIfSparse`, `runTelemetryBackfillCli`; `buildStatus` calls `triggerAutoBackfillIfSparse` fire-and-forget when coverage < 35%; observation IDs are stable (SHA-256 of `backfill:<traceId>`)
- `construct telemetry backfill` CLI command
- `lib/schema-infer.mjs` — `inferDocumentSchema`, `inferUnifiedSchema`, `runInferCli`
- `lib/schema-artifact.mjs` — `writeSchemaArtifact`, `readSchemaArtifact`, `listSchemaArtifacts`
- `construct infer` CLI command
- `memory_search` MCP handler now uses `buildHybridSearchResultsAsync`
- `lib/bootstrap.mjs` idempotency fix; `lib/memory-stats.mjs` memory usage reporting
- Tests: `tests/bootstrap.test.mjs` (5), `tests/memory-stats.test.mjs` (11), `tests/model-router.test.mjs` (+6 cooldown/failover), `tests/opencode-runtime-plugin.test.mjs` (+3 structured output), `tests/orchestration-policy.test.mjs` (+3 auto-workflow-intake), `tests/telemetry-backfill.test.mjs` (6); total suite 417/417

### Changed
- `lib/mcp/server.mjs` reduced from 1,823 to 776 lines — pure dispatcher importing from `lib/mcp/tools/*`
- `lib/hooks/model-fallback.mjs` rewritten — provider-aware, direct `.env` write via `selectFallbackModel`; `construct models --apply` is last-resort only
- `buildTaskPacketFromIntent` in `lib/workflow-state.mjs` now forwards `fileCount`, `moduleCount`, `introducesContract`, `explicitDrive` from options to `routeRequest` so track classification is consistent with the caller's context


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
