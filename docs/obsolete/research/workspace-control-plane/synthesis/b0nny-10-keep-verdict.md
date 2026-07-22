---
intake: none
---

Obsolete: retained as historical workspace-control-plane research; Construct 2.0 uses Worker Profiles, Workspace Presets, and `.construct/` — see docs/obsolete/legacy-surface-register.md.

# construct-b0nny.10 — Legacy provider `.js` tier verdict

Investigated 2026-07-17 against the X5 finding in
[consolidated-findings.md](consolidated-findings.md) (`Legacy provider .js tier ... likely
superseded by lib/models/`) and
[execution-surfaces-truth-map.md § 7](../subagents/execution-surfaces-truth-map.md).

## Outcome: split verdict, not a single yes/no

The bead named five file families as one "legacy tier." Independent verification shows they
are not one thing: one family is genuinely dead and was deleted; the other three are live,
load-bearing, and in one case are an upstream dependency of the very `lib/models/` tier the
finding assumed had superseded them.

## Deleted

- `lib/dispatch-batch.js` (`canBatch`, `buildBatchPrompt`, `parseBatchResponse`) — zero static
  importers repo-wide (`grep -rn "dispatch-batch"` across `.js`/`.mjs`/`.json` matched only the
  file's own header before deletion), zero name-string dispatch hits for `dispatchBatch`,
  `canBatch`, `buildBatchPrompt`, `parseBatchResponse` in `lib/mcp/`, `bin/construct`, or any
  `*registry*` file, and zero test references anywhere under `tests/`. First committed
  2026-05-08 (`git log --follow --diff-filter=A`, commit `4a113b54`, "initial commit"),
  apparently never wired to a caller. Confirmed via `npm run test:unit` (516 tests / 71 suites,
  0 failures) and `node bin/construct doctor` both before and after removal producing identical
  results (56 passed / 7 warnings / 2 failed, the 2 failures being pre-existing worktree
  environment noise — `core.hooksPath` and cross-surface adapter drift — unrelated to this
  file, confirmed by diffing doctor output with the deletion stashed vs. applied).

## Kept — with caller evidence

### `lib/provider-capabilities.js` + `provider-capabilities-{anthropic,openai,google,deepseek,generic}.js`

Not superseded — `lib/models/` depends on it directly:

- `lib/models/execution-capability-profile.mjs:30` — `import { resolveProviderCapabilitiesSync }
  from '../provider-capabilities.js';` — this is the "single resolved capability record"
  module named in the bead's own framing as the successor tier (construct-6zga.1.8, see its
  file header). Its header states it "Consolidates the four formerly-scattered capability
  producers into one serializable, versioned record" — consolidation of callers, not
  replacement of `provider-capabilities.js`.
- `lib/embedded-contract/model-resolve.mjs:27` — same import, and this module itself has five
  live consumers: `lib/model-policy.mjs`, `lib/ingest/strategy.mjs`,
  `lib/mcp/tools/embedded-contract.mjs`, `lib/orchestration/readiness.mjs`, plus its own test
  files.
- `lib/model-router.mjs:1418-1419` re-exports `resolveProviderCapabilities` /
  `resolveProviderCapabilitiesSync` from this file. `model-router.mjs` is documented in the
  truth map (§7) as having 16 inbound importers.
- `lib/dispatch-batch.js` (deleted above) also imported it, but that was one of four real
  callers, not the only one.
- Directly functionally tested: `tests/functional/w1-provider-adapter-contracts.functional.test.mjs:147-152`
  imports `probeProviderCapabilities` from `lib/provider-capabilities.js` and asserts it
  dispatches to an adapter's `probe()` export. This test is part of the W1 release-hardening
  commit `d55f65fc` ("purge misleading stubs, formalize provider adapter contracts") dated
  2026-05-26 — i.e. this file's adapter-extension surface was deliberately hardened, not left
  as pre-cutover scaffolding.
- Ran clean: `node --test tests/functional/w1-provider-adapter-contracts.functional.test.mjs
  tests/execution-capability-profile.test.mjs tests/embedded-contract-model-resolve.test.mjs
  tests/model-router-validated-wiring.test.mjs` reports 30 tests / 30 pass / 0 fail before any
  change here [source: command run 2026-07-17 in this worktree].

### `lib/token-engine.js` + `token-estimator-{anthropic,openai,google,deepseek,default}.js`

Live production dependency of two independent consumers:

- `lib/prompt-composer.js:38` — `import { estimateTokens, estimatePromptTokens,
  estimateTokensSync } from './token-engine.js';`. `prompt-composer.js` itself has real
  callers: `lib/mcp/tools/telemetry.mjs`, `lib/opencode-runtime-plugin.mjs`,
  `scripts/sync-specialists.mjs`, `scripts/migrate-specialist-prompt-frontmatter.mjs`, and is
  covered by `tests/prompt-composer.test.mjs`, `tests/specialist-prompts.test.mjs`,
  `tests/specialist-prompt-format.test.mjs`.
- `lib/certification/prompt-budget.mjs:12` — `import { estimateTokensSync } from
  '../token-engine.js';`, consumed by `lib/certification/runner.mjs` (the certification
  pipeline's `prompt-budget-audit` gate) and covered by
  `tests/certification/prompt-budget.test.mjs` and
  `tests/certification/p2-surface-harness.test.mjs`.

`token-estimator-*.js` are reached only through `token-engine.js`'s own internal dynamic-import
dispatch table (same per-provider-adapter pattern as `provider-capabilities.js`), which is the
expected shape for this tier, not evidence of orphaning.

### `lib/cache-strategy.js` + `cache-strategy-{none,openai,anthropic,google}.js`

Split within the family itself:

- The base dispatcher `lib/cache-strategy.js` (exports `annotatePrompt`,
  `estimateCacheableTokens`, `resolveCacheTTL`) has **zero callers anywhere in the repo** —
  confirmed by grepping each exported name repo-wide outside the file itself. This function
  layer is not reached in production.
- However `lib/cache-strategy-google.js`'s `annotate` / `setCachedContentResolver` exports are
  reached independently of the dead dispatcher, directly by
  `tests/functional/w1-provider-adapter-contracts.functional.test.mjs:19-22`, which documents
  itself as verifying "the three provider-agnostic extension points formalized in W1" — the
  same `d55f65fc` hardening commit that touched `cache-strategy-google.js` (57 lines changed)
  alongside `provider-capabilities.js` and `providers/auth-manager.mjs`. This is a deliberately
  built, tested extension contract (a resolver a future Gemini file/resource-caching feature
  registers into) with no current registrant, not misleading scaffolding — the same commit's
  message explicitly states it "purge[d] misleading stubs" as a distinct, prior step.
- No production code currently calls `resolveProviderCapabilities` → `cache-strategy.js`'s
  `annotatePrompt`/`resolveCacheTTL` path; `prompt-composer.js` and `dispatch-batch.js` (now
  deleted) were the only two files anywhere that referenced `cache-strategy` by name outside
  the family itself, and neither imports it.

Given one exported surface (`cache-strategy-google.js`'s resolver hook) has a real, passing,
2026-05-26 functional test that predates this program and documents an intentional
provider-agnostic contract, deleting the family risks breaking a deliberately-hardened
extension point on the strength of an assumption ("superseded") that this investigation
disproves for the sibling `provider-capabilities.js` file it depends on. Recommend leaving the
base dispatcher's dead-callsite status (`annotatePrompt`/`estimateCacheableTokens`/
`resolveCacheTTL`) to a follow-up bead scoped narrowly to that one file, evaluated together with
whoever owns the Gemini caching roadmap — not lumped into a "delete the legacy tier" bead.

## Net effect

- `lib/dispatch-batch.js` deleted; no other file needed cleanup (zero remaining references in
  code, tests, docs, `package.json`, or the sync catalog).
- `provider-capabilities-*.js` (6 files), `token-engine.js` + `token-estimator-*.js` (5 files),
  and `cache-strategy-*.js` (5 files) are kept. 15 of the 20 files named or implied by the
  bead's glob patterns are load-bearing.
- `npm run test:unit` (516/516 pass) and `node bin/construct doctor` (56 passed / 7 warnings /
  2 pre-existing failures, unchanged by this diff) both run clean with `lib/dispatch-batch.js`
  removed.
