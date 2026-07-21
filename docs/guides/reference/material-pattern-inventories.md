<!--
docs/guides/reference/material-pattern-inventories.md — read-only inventories produced by
construct-tsyfe.1.1, construct-tsyfe.1.2, and construct-tsyfe.1.3. Evidence for
ADR-0001 amendment, patterns-schema-validation-canonical, patterns-registration-canonical,
and patterns-error-tombstone-canonical follow-up beads. No runtime behavior documented here
is changed by this file; re-grep cited paths when consolidating.
-->

# Material pattern inventories

Investigation-only matrices for the construct-tsyfe.1 epic (Material Pattern Consolidation). Each section maps implementations to callers, JSON Schema feature subsets, registration entry points, or lifecycle/error/deprecation conventions. Re-verify with `rg` before migration work; line counts are approximate (`wc -l` on 2026-07-20, branch `feat/workspace-control-plane`).

Related: [In-Tree Implementations](./in-tree-implementations.md) (zero-npm hand-rolled components outside validation), [Hooks Inventory](./hooks-inventory.md).

---

## 1. Schema validation (construct-tsyfe.1.1)

### 1.1 Six named implementations (bead scope)

| Implementation | LOC | Status | Primary export | Error shape |
|---|---:|---|---|---|
| `lib/config/schema.mjs` | 288 | active | `validateProjectConfig(raw, { partial })` | `{ valid: boolean, errors?: string[] }` |
| `lib/flows/schema.mjs` | 90 | active | `validateSchema(schema, value)` | `{ valid: boolean, errors: string[] }` |
| `lib/providers/instance-config.mjs` | 216 | active | `validateInstanceConfig(providerId, configSchema, config)` | `{ valid: true }` or `{ valid: false, errors: string[] }` |
| `lib/registry/custom-schema.mjs` | 146 | active | `validateCustomWorkerProfile`, `validateCustomTeam` | `string[]` (empty = pass) |
| `lib/specialists/schema.mjs` | — | **retired** | — | Replaced by `lib/registry/custom-schema.mjs` (Worker Profile cutover); no file on disk |
| `lib/contracts/validate.mjs` | 615 | active | `validateContractsFile`, `validateHandoff`, `validateArtifactPostconditions` | `{ ok: boolean, errors: string[] }` |

All six named sites carry explicit no-AJV/zod intent in file headers or comments (`lib/config/schema.mjs:4-6`, `lib/flows/schema.mjs:7-11`, `lib/providers/instance-config.mjs:15-18`, `lib/registry/custom-schema.mjs:5-8`). `package.json` no longer lists `zod` as an optionalDependency (removed per CHANGELOG Unreleased); AJV appears only transitively via `@modelcontextprotocol/sdk` and is used in **tests only** (`tests/schema-validation.test.mjs:9` imports `AjvJsonSchemaValidator` from the MCP SDK).

### 1.2 JSON Schema keyword coverage (grep-provable)

| Implementation | `$ref` | `anyOf` / `oneOf` | `format` | Other supported keywords |
|---|---|---|---|---|
| `lib/config/schema.mjs` | no | no | no | Hand-rolled `FIELD_RULES`: `type`, `enum`, `required`, nested `fields`, `maxLength`; not JSON Schema |
| `lib/flows/schema.mjs` | no | no (union via `type: []`) | no | `type`, `properties`, `required`, `enum`, `items`, `additionalProperties`, `minimum`/`maximum`, `minLength`/`maxLength`, `minItems`/`maxItems` |
| `lib/providers/instance-config.mjs` | no | no | no | `type`, `properties`, `required`, `enum`, `pattern`, `minimum`/`maximum`, `additionalProperties`; delegates `filter` to `validateFilterConfig()` |
| `lib/registry/custom-schema.mjs` | no | no | no | Domain rules (regex IDs, skill refs, fence paths); not JSON Schema |
| `lib/contracts/validate.mjs` (`collectSchemaShapeErrors`) | no | no | no | `required`, `enum`, nested `properties`, array `items` on `lib/contract-schemas/*.json` |
| `lib/providers/provider-card.mjs` | **partial** (`#/$defs/*` only) | no | no | Same subset as contracts plus `$ref` resolution into schema root |

### 1.3 Callers (file:line)

**`validateProjectConfig`**

| Caller | Line | Role |
|---|---:|---|
| `lib/config/project-config.mjs` | 126, 156, 291, 428 | Load/merge/save `construct.config.json` |
| `tests/project-config.test.mjs` | 44-70 | Unit tests |

**`validateSchema` (flows)**

| Caller | Line | Role |
|---|---:|---|
| `lib/flows/state.mjs` | 14, 23 | Flow state seed/merge validation |
| `tests/flows-schema.test.mjs` | 17-64 | Unit tests |

**`validateInstanceConfig`**

| Caller | Line | Role |
|---|---:|---|
| `bin/construct` | 6019 | `construct provider configure` before persist |
| `lib/providers/instance-config.mjs` | 136 | Definition only |

**`validateCustomWorkerProfile` / `validateCustomTeam`**

| Caller | Line | Role |
|---|---:|---|
| `lib/registry/cli.mjs` | 298, 409 | Custom Worker Profile CLI |
| `lib/registry/custom-scaffold.mjs` | 125 | Scaffold path |

**`validateContractsFile` / handoff validators**

| Caller | Line | Role |
|---|---:|---|
| `lib/doctor/watchers/consistency.mjs` | 394-395 | Doctor consistency watcher |
| `tests/functional/w2-contract-enforcement.functional.test.mjs` | 14 | Functional gate |
| `bin/construct` | (via `lint:contracts`) | CI contract lint |

**`validateProviderCardRegistry`**

| Caller | Line | Role |
|---|---:|---|
| `scripts/validate-provider-cards.mjs` | 48 | Release/CI script |
| `lib/providers/provider-card.mjs` | 164 | Loader self-check |

### 1.4 Additional hand-rolled validators (same epic, outside bead's six)

| Module | LOC | Schema / surface | Callers (sample) |
|---|---:|---|---|
| `lib/registry/validator.mjs` | 149 | Unified registry shape (not JSON Schema) | `lib/registry/loader.mjs` via `validateRegistry` |
| `lib/registry/validate.mjs` | 136 | `registry/capabilities.json` cross-ref to disk | `construct registry:validate`, `lib/graph/build-from-registry.mjs:34` |
| `lib/platforms/capabilities.mjs` | 100 | `platforms/capabilities.json` | `loadCapabilities()` consumers (sync, init) |
| `lib/demo-project.mjs` | 190 | `schemas/project-demo.schema.json` subset | Demo scaffold |
| `lib/models/execution-policy.mjs` | 308 | `schemas/execution-policy.schema.json` | Policy load/save |
| `lib/models/behavior-matrix.mjs` | 289 | `schemas/provider-behavior-matrix.schema.json` | Behavior matrix load |
| `lib/improvement/proposal.mjs` | 120 | `schemas/improvement-proposal.schema.json` | Proposal load |
| `lib/evals/dataset.mjs` | 137 | `schemas/eval-dataset.schema.json` | Eval dataset load |
| `lib/certification/run.mjs` | 122 | `schemas/certification-run.schema.json` | `lib/certification/store.mjs:40,66` |
| `lib/worker-profiles/prompt-schema.mjs` | 176 | Prompt frontmatter conventions | `validatePromptFiles`, certification |
| `lib/frameworks/schema.mjs` | 157 | Framework frontmatter | Framework parse path |
| `lib/task-graph/schema.mjs` | 81 | Task graph nodes/edges | `tests/task-graph.test.mjs` |
| `lib/providers/contract.mjs` | — | `validateFilterConfig` (ADR-0060) | Embed daemon, packs, instance-config |
| `lib/providers/filter-schema.mjs` | 54 | Filter grammar (data-only) | Consumed by `contract.mjs` |

### 1.5 Standalone `schemas/*.schema.json` (18 files)

Validated at runtime by the hand-rolled modules above or by **test-only AJV** (`tests/schema-validation.test.mjs` for `unified-registry.schema.json`). No production `lib/` import of AJV.

| Schema file | Primary validator / consumer |
|---|---|
| `schemas/unified-registry.schema.json` | Test AJV + parity with `lib/registry/validator.mjs` |
| `schemas/capability-registry.schema.json` | Documented target; runtime uses `lib/registry/validate.mjs` cross-ref checks |
| `schemas/project-config.schema.json` | Parity test `tests/audit/f10-registry-drift/schema-parity.test.mjs`; runtime uses `lib/config/schema.mjs` |
| `schemas/provider-card.schema.json` | `lib/providers/provider-card.mjs` |
| `schemas/workspace-preset.schema.json` | `tests/workspace-presets/loader.test.mjs` |
| `schemas/execution-capability-profile.schema.json` | Reference shape in `lib/models/execution-capability-profile.mjs` |
| `schemas/execution-policy.schema.json` | `validateExecutionPolicy` |
| `schemas/provider-behavior-matrix.schema.json` | `validateBehaviorMatrix` |
| `schemas/improvement-proposal.schema.json` | `validateImprovementProposal` |
| `schemas/eval-dataset.schema.json` | `validateEvalDataset` |
| `schemas/certification-run.schema.json` | `validateCertificationRun` |
| `schemas/mcp-tool-output.schema.json` | `tests/functional/mcp-output-contract.functional.test.mjs` |
| `schemas/project-demo.schema.json` | `lib/demo-project.mjs` |
| `schemas/participation-rules.schema.json` | Reference for `lib/orchestration/recruiter.mjs` |
| `schemas/platform-capabilities.schema.json` | Reference (runtime registry is `platforms/capabilities.json`) |
| `schemas/brand-voice.schema.json` | Brand voice tooling |
| `schemas/canonical-terminology.schema.json` | Terminology lint |
| `schemas/demo-recording.schema.json` | Demo recording manifest |

### 1.6 Test coverage (representative)

| Implementation | Tests |
|---|---|
| `lib/config/schema.mjs` | `tests/project-config.test.mjs` |
| `lib/flows/schema.mjs` | `tests/flows-schema.test.mjs` |
| `lib/providers/instance-config.mjs` | `tests/providers/provider-add-configure.test.mjs` (CLI e2e) |
| `lib/registry/custom-schema.mjs` | Via registry CLI / scaffold tests |
| `lib/contracts/validate.mjs` | `tests/functional/w2-contract-enforcement.functional.test.mjs`, doctor watcher |
| `lib/providers/provider-card.mjs` | `tests/provider-card-schema.test.mjs`, `tests/functional/provider-card-registry.functional.test.mjs` |

---

## 2. Tool, provider, and host registration (construct-tsyfe.1.2)

### 2.1 Three registration families

| Family | Entry point | Registration mechanism | Primary consumers |
|---|---|---|---|
| **MCP tools** | `scanToolModules({ dir })` in `lib/mcp/tool-registry.mjs:53` | Files matching `lib/mcp/tools/*.tool.mjs` export `TOOL_DEFS` + `TOOL_HANDLERS` | `lib/mcp/server.mjs:205-208` merges scan with `HARDCODED_TOOL_DEFS`; `tests/functional/mcp-dynamic-tool-registration.functional.test.mjs` |
| **Providers** | `resolveProviders({ rootDir, env })` in `lib/providers/registry.mjs:119` | Built-in `lib/providers/<id>/index.mjs`, `lib/extensions/manifests/*.manifest.json`, overrides in `.construct/providers.json` / XDG `providers.json` | `lib/status.mjs:738`, embed daemon, `construct provider *`, `tests/extensions/manifest-providers.test.mjs` |
| **Host** | Split across three modules (see below) | Env/process/config probing and disposition tables, not a single registry | `construct sync`, `construct doctor`, certification, orchestration |

**Fourth consumer of capability data:** `lib/graph/build-from-registry.mjs` ingests `registry/capabilities.json` (via `loadCapabilityRegistry` / unified registry) into the LCI graph (`lib/graph/build-from-registry.mjs:1-26`).

### 2.2 MCP tool registry detail

| Export | Line | Callers |
|---|---:|---|
| `scanToolModules` | 53 | `lib/mcp/server.mjs:205`, `tests/mcp-tool-output-schema-guard.test.mjs:79`, `tests/functional/mcp-dynamic-tool-registration.functional.test.mjs` |
| `DEFAULT_TOOLS_DIR` | 32 | Default scan root |
| `TOOL_MODULE_SUFFIX` | 33 | `.tool.mjs` |

**Overlap/gap (tools):** LMCP-B5 self-registration covers only `*.tool.mjs` files. The catalog's majority (~75+) remains hand-maintained in `lib/mcp/server.mjs` (`HARDCODED_TOOL_DEFS`). A new tool author must discover whether to edit `server.mjs` or add a `.tool.mjs` file; there is no single registration doc beyond module headers.

**Relation to `registry/capabilities.json`:** Product capabilities (orchestration, ingest, document types) are **not** MCP tool IDs. No automatic link from capability rows to `TOOL_DEFS`.

### 2.3 Provider registry detail

| Export / path | Line | Callers |
|---|---:|---|
| `resolveProviders` | 119 | `lib/providers/registry.mjs:173` (`resolveProvider`), `lib/status.mjs:738`, `tests/providers-contract.test.mjs`, `tests/extensions/manifest-providers.test.mjs` |
| `assertProviderContract` | via `contract.mjs` | Every loaded provider module |
| `BUILT_INS` (deprecated) | 40 | Compat list from manifests; `deprecate` metadata construct-tsyfe.8.18 |

**`lib/providers/` subdirectory vs registries**

| Directory | Manifest (`lib/extensions/manifests/`) | `registry/capabilities.json` | `registry/provider-cards.json` |
|---|---|---|---|
| `atlassian-confluence` | yes | no dedicated row (product caps are ingest/workflow typed) | no (cards track npm/binary deps, not data-source adapters) |
| `atlassian-jira` | yes | no | no |
| `contract` | (adapter tree) | no | no |
| `directory` | yes | no | no |
| `feedback` | yes (no `lib/providers/feedback/` factory dir) | no | no |
| `github` | yes | no | no |
| `salesforce` | yes | no | no |
| `slack` | yes | no | no |

**Overlap/gap (providers):** Data-source providers are discovered via **extension manifests** + optional `lib/providers/<id>/index.mjs`, while `registry/provider-cards.json` catalogs **runtime dependencies** (npm packages, binaries like pandoc/docling). The two registries serve different layers; neither lists the other's entries. `registry/capabilities.json` (27 rows, ~1047 lines) describes product capabilities (orchestration.routing, ingest.docling, etc.), not provider module IDs.

**Instance config (separate from registration):** `lib/providers/instance-config.mjs` persists per-project `.construct/providers/<id>.json`; configured via `construct provider add|configure` (`bin/construct:5956-6022`).

### 2.4 Host detection / readiness / disposition

| Module | LOC | Entry exports | Callers (sample) |
|---|---:|---|---|
| `lib/host-capabilities.mjs` | 348 | `detectHostCapabilities`, `detectHostRawSignals`, `hostProbe`, `findAvailablePort` | `lib/adapters-sync.mjs:38`, `lib/init-unified.mjs:727-729`, `lib/doctor/host-config.mjs:20`, `lib/certification/host-adapter-certification.mjs:87`, `lib/orchestration/runtime.mjs:95` |
| `lib/host/readiness.mjs` | 109 | `classifyHostReadiness`, `HOST_READINESS_REASONS` | `lib/certification/host-adapter-certification.mjs:146`, `tests/audit/f04-host-readiness/readiness-state-machine.test.mjs`, doctor VS Code readiness functional test |
| `lib/host-disposition.mjs` | 103 | `IGNORED_PATTERNS`, `ADAPTER_DIRS`, `missingIgnorePatterns`, `isConstructPackageRepo` | Init/gitignore writers, `lib/reconcile/adapter-prune.mjs`; **not** harness detection |

**Overlap/gap (host):** "What host am I on?" (`host-capabilities`), "Is VS Code MCP config healthy?" (`host/readiness`), and "What files should gitignore?" (`host-disposition`) are three unrelated contracts with no shared registration type. `platforms/capabilities.json` (+ `lib/platforms/capabilities.mjs`) is a fourth host-data registry for sync behavior (hooks, MCP allowlists).

**Relation to `registry/capabilities.json`:** Rows like `surfaces.opencode-primary` and `mcp.tool-budget.trim` reference product behavior, not entries in `detectHostCapabilities()` output.

---

## 3. Operation lifecycle, error shapes, deprecation (construct-tsyfe.1.3)

### 3.1 Stateful writes without documented lock convention

Plain `fs.writeFileSync` (or equivalent) on shared JSON/JSONL paths, with no repo-wide locking helper:

| Site | Line | Persist path | Notes |
|---|---:|---|---|
| `lib/providers/instance-config.mjs` | 52-57 | `.construct/providers/<id>.json` | One file per provider id reduces collision; still no lock |
| `lib/config/project-config.mjs` | 345 | `.construct/config.json` / project config | Whole-file rewrite |
| `lib/embed/approval-queue.mjs` | 292-297 | `.construct/approvals/queue.jsonl` or XDG `approvals/queue.jsonl` | Full-file rewrite on every transition |
| `lib/mcp/broker.mjs` | 98 | Broker store JSON | Whole-file rewrite |
| `lib/model-router.mjs` | 1063, 1310 | Cooldown + env files | Concurrent CLI could race |
| `lib/cost-ledger.mjs` | 59 | Ledger JSON | Whole-file rewrite |
| `lib/certification/store.mjs` | 59, 102 | Certification run records | Whole-file rewrite |
| `lib/roles/gateway.mjs` | 386, 436 | Pending roles JSONL | Append/rewrite |

**Regression guard (provider config):** `tests/providers/provider-add-configure.test.mjs:60-68` asserts `construct provider add` refuses to clobber an existing instance config (CLI-level guard, not a reusable lock primitive).

### 3.2 ApprovalQueue fix as candidate template

Prior cross-process overwrite class: an external `construct approvals` decision was not visible to a long-running embed daemon holding an in-memory queue.

**Fix shape (current code):**

1. `ApprovalQueue.reloadFromDisk()` (`lib/embed/approval-queue.mjs:264-275`) re-reads JSONL before scans that must see external decisions; failures leave in-memory state intact (`#readItemsFromDisk` returns `null` on error, lines 308-323).
2. Embed daemon calls `reloadFromDisk()` before draining approved write intents (`lib/embed/daemon.mjs:737-740`).
3. Persist uses full-file rewrite (`#persist`, lines 292-297); correctness relies on reload-before-read, not file locking.

Historical note: bead evidence cited CHANGELOG `construct-4uxq0.9.9`; that entry is no longer at CHANGELOG.md:25 (content shifted). The durable description lives in `lib/embed/approval-queue.mjs` header and reload API comments.

### 3.3 Error-result shapes (CLI / MCP / hooks)

Distinct shapes found (each with file:line example):

| Shape | Example location | Pattern |
|---|---|---|
| **A. `{ ok, error }`** | `bin/construct:5959`, `lib/mcp/tools/telemetry.mjs:183` | Boolean success + string error |
| **B. `{ error: string }` only** | `lib/mcp/tools/skills.mjs:51`, `lib/mcp/tools/orchestration-run.mjs:210` | Failure without `ok` field |
| **C. `{ valid, errors[] }`** | `lib/config/schema.mjs:287`, `lib/providers/instance-config.mjs:167-168` | Validation result |
| **D. Contract envelope** | `lib/embedded-contract/envelope.mjs:43-52` | `{ contractVersion, constructVersion, deploymentMode, surface, generatedAt, warnings, data }` via `wrapResponse` / `wrapContractResult`; used by `bin/construct:257-258`, `4555-4565` |
| **E. `{ ok: 'pass'\|'fail'\|'inconclusive', findings[] }`** | `lib/hooks/rule-verifier.mjs:18` | Hook-specific tripartite |
| **F. `throw new Error(...)`** | `lib/embed/approval-queue.mjs:212`, provider load paths | Uncaught exception path |
| **G. CLI `errorln` + `process.exit(1)`** | `bin/construct:4534-4535` (models retired flags) | Human stderr, non-JSON |

**Quantified grep (2026-07-20):** `lib/mcp/tools/*.mjs` mixes shapes A and B in one module (`orchestration-run.mjs`). Hooks generally emit JSON to stdout/stderr per hook contract rather than `{ ok, error }`.

### 3.4 Deprecation / tombstone / compat aliases

| Surface | Implementation | Stated expiration | Current status (2026-07-20) |
|---|---|---|---|
| **`construct matrix`** | Removed; was alias per ADR-0053 | ADR-0053: "2 release cycles" after v1.5.0 | **Removed** — ADR-0053 status note: removed in construct-b0nny.28; `tests/acceptance/packed-install-removed-surfaces.mjs:14-19` probes absence |
| **`construct install --scope=`** | ADR-0071 renamed to `--footprint=` | `--scope` deprecated alias "at least one release" | **`--scope` absent from `lib/setup.mjs`** (only `--footprint=` at 306-316); ADR-0071 follow-up appears landed |
| **`construct models --reset` / `--set=` / `--poll`** | `bin/construct:4532-4535` | Bead cited hand-rolled warn-once | **Hard error** — unknown option exits 1; subcommands `reset`/`set` remain |
| **Shared helper** | `lib/deprecate.mjs:33` (`deprecate()`) | Owner construct-tsyfe.8.18 | Wired at some sites (`lib/document-export.mjs:197`, `lib/document-ingest.mjs:472`); many compat surfaces still use inline comments only |
| **Inline compat comments** | e.g. `lib/providers/registry.mjs:36-38`, `lib/embed/approval-queue.mjs:137-148` | `owner: construct-tsyfe.8.18, expires: 2026-12-31` | Not expired; no automated overrun enforcement |

ADR-0053 documents that the matrix deprecation window **closed** and removal shipped; there is no remaining warn-once alias in `bin/construct` for matrix.

### 3.5 Reusable patterns missing today

- No shared file-lock or atomic-rename write helper for JSON/JSONL state.
- No single MCP/CLI error envelope outside embedded-contract surfaces (orchestration/skills tools ad hoc).
- `lib/deprecate.mjs` exists but most compat surfaces use duplicate inline metadata; no central expiration-overrun checker (noted in construct-tsyfe.8.18 audit handoff).

---

## Maintenance

Re-run inventories when:

- A validator module merges or adds `$ref`/union support
- A new `*.tool.mjs` or provider manifest lands
- Compat alias removal beads change CLI surfaces

Downstream beads: construct-tsyfe.1.4 (registration contract + tool/provider pilots), construct-tsyfe.1.5 (error/tombstone helpers + CLI/MCP pilots), construct-tsyfe.1.6 (schema validation contract + flow validator pilot), construct-tsyfe.1.7 (cross-pattern certification test).
