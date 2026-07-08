<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0072: No-code org authoring API — a stable CRUD surface for specialists, teams, contracts, relationships, fences, and skills

- **Date**: 2026-07-07
- **Status**: proposed
- **Deciders**: Gerald Dagher (owner)
- **Supersedes**: none
- **Relates to**: ADR-0046 (modular org runtime merge — the on-disk `specialists/org/**` tree and `assembleRegistry()` merge this API writes into and reads through), ADR-0047 (specialist vs. flavor taxonomy — the split/flavor rules this API's specialist-create validation must honor), ADR-0056 (LMCP-A6 policy/approval/identity model — the approval semantics `fence.approvalRequired` already expresses, reused here), ADR-0065 (orchestrator-worker consolidation — custom-specialist authoring named a supported capability, "raising the bar on schema validation and hot-reload correctness," construct-rf26.13), ADR-0067 (deterministic flow engine — "contracts" in this ADR's scope means the delegation specs that ADR-0067 attaches to flow steps)

<!-- Owning specialist: cx-architect. -->

## Problem

A user who wants to define or change a specialist, team, contract, fence, or skill binding today has exactly two paths, both code-shaped: run a CLI scaffolder (`construct specialist create [--custom]`, `construct team create`, `construct scope create`) that writes JSON to disk, or hand-edit the JSON directly under `specialists/org/**` (built-in), `.construct/org/**` (project overlay, ADR-0046/ADR-0069), or `~/.construct/org/**` (user-scoped, `lib/registry/custom-scaffold.mjs`). Both paths assume a terminal and a text editor. Neither exposes a request/response shape a UI could bind form fields to, and neither returns errors in a form a visual editor can act on.

Concretely, three gaps block a no-code (visual) editor from being built on top of the current surface:

1. **No read/list/update/delete for the entity graph as data.** `lib/registry/custom-scaffold.mjs` exports `createCustomSpecialist()` and `createCustomTeam()` — create only, and only for the two extension tiers, never for the 12-role built-in roster in `specialists/org/specialists/` (verified count: `ls specialists/org/specialists/` = 12 files, `ls specialists/org/contracts/` = 35 files, `ls specialists/org/teams/` = 8 files, this session). There is no `updateCustomSpecialist()`, no `deleteCustomSpecialist()` beyond `lib/registry/org-io.mjs`'s low-level `removeOrgEntityFile()` (which is not schema-validated), and no read function that returns one entity by id rather than the whole assembled registry.
2. **Two different validators, two different error shapes, neither field-addressable in a UI-usable way.** `lib/registry/custom-schema.mjs`'s `validateCustomSpecialist()`/`validateCustomTeam()` return `string[]` — human-readable but positionally unaddressable (a UI cannot highlight "this field" from `"cx-widget: 'fence.allowedPaths' must be a non-empty array..."` without re-parsing the message). `lib/registry/validator.mjs`'s `validate()` (the 13-invariant unified-registry checker covering team ownership, escalation cycles, contract party resolution) already returns structured `{ id, severity, message, location }` objects with a JSON-pointer-shaped `location` (e.g. `#/teams/${teamId}/owner`) — the right shape, but it only runs over an already-assembled registry object, has no per-field pre-write hook, and is never invoked from the create/scaffold path (`custom-scaffold.mjs` calls only `custom-schema.mjs`'s string-array validator, not `validator.mjs`).
3. **No read/write surface for the concepts a visual editor needs beyond specialists and teams.** Fences (`fence.allowedPaths`/`allowedCommands`/`allowedBdLabels`/`approvalRequired`/`deniedActions`, enforced by `lib/roles/fence.mjs#checkAction`) are validated only as a sub-object of a specialist record (`custom-schema.mjs` lines 67-71: "fence" must be `{ allowedPaths: [...] }`) — there is no fence-scoped CRUD or standalone fence-preview function. Contracts (`specialists/org/contracts/*.json`, delegation specs per ADR-0065/0067) have a runtime validator (`lib/contracts/validate.mjs#validateContractsFile`) but no create/update/delete path at all — a contract can only be hand-written as JSON today. Skills have no authoring API in scope here beyond the `skills:` array on a specialist record, which `custom-schema.mjs` validates as a shape (`<bundle>/<skill>` regex) but does not resolve against `skills/**` on disk. There is no route-preview function (e.g. "if I add this specialist to this team with this fence, what would `orchestration_policy` route to it?") and no export/import round-trip function — a user cannot pull the current org state as one payload, edit it, and push it back through a single validated write path.

A visual editor cannot be built on hand-parsed JSON with string-array errors; it needs typed read/write functions per entity kind and field-addressable validation results. This ADR defines that API. It does not design or build the editor itself — that is separate follow-on work.

## Context

The org model this API sits on top of is settled by prior ADRs and not reopened here:

- **Storage layout** (ADR-0046, extended by ADR-0069's directory consolidation): `specialists/org/{groups,teams,specialists,contracts,policies}/*.json` is the built-in tree; `.construct/org/**` is the project overlay; `~/.construct/org/**` is the user-scoped tier (`lib/registry/custom-scaffold.mjs`'s `customOrgDir()`). `lib/registry/assemble.mjs`'s `assembleRegistry(rootDir)` merges builtin → user → project, later tiers winning on id collision — the same precedence ADR-0052 established for provider manifests.
- **Specialist/flavor taxonomy** (ADR-0047): a specialist record's `role`, `skills`, `fence`, and `handoffCandidates` fields, and the split-vs-flavor rule this API's specialist-create/update must not silently violate (e.g. it must not let a caller give two specialists the same `role` in a way that breaks team-owner resolution, `lib/registry/validator.mjs`'s `checkTeamHasOwner`).
- **Roster shape** (ADR-0065): the built-in roster is now a thin core (12 specialists, verified count above; the appendix targets 8-12), with custom specialists and teams named as "a supported, documented capability" whose schema validation and hot-reload correctness the API must meet the bar of (ADR-0065 Consequences: "raising the bar on schema validation and hot-reload correctness, construct-rf26.13").
- **Contracts as delegation specs** (ADR-0067): a contract attached to a flow step carries `producer`, `consumer`, `input`, `output` (`mustContain`/`mustContainOneOf`/`mustMatchEnum`/`schema`), and `postconditions[]` classified `executable` (a `check` this API must be able to preview against a draft artifact) or `advisory` (prose, not mechanically checkable — the API must not pretend these can be red-squiggled).
- **Fences** (found in `lib/roles/fence.mjs`, `specialists/org/policies/file-path-fence.json`, and every `specialists/org/specialists/*.json` record's `fence` field): a fence is a permission boundary object — `allowedPaths` (glob patterns for edit/write), `allowedCommands` (bash prefix match), `allowedBdLabels`, `approvalRequired` (actions needing user yes), `deniedActions`. `computeEffectiveFence()` intersects a specialist's own fence with its team's `forbiddenDecisions`-derived fence — a specialist can never have broader authority than its team grants. This is a real, well-defined concept; the term appears consistently across code and org JSON, not just in the bd issue's framing.
- **Relationship edges**: no code or JSON in this repo uses the literal term "relationship edge." `[unverified]` as a named concept. The real directed relationships in the org graph that an editor would need to draw as edges are: (a) `specialist.handoffCandidates: string[]` — a specialist-to-specialist delegation edge, read by `lib/roles/gateway.mjs` and `lib/roles/manifest.mjs` and validated only as "must be an array" (`custom-schema.mjs` line 73, no check that the listed ids exist); (b) `contract.producer` / `contract.consumer` — a directed edge between two parties, validated by `lib/registry/validator.mjs#checkContractPartiesExist`; (c) `team.escalationPath: string[]` — an ordered role chain, validated for existence and acyclicity by `checkEscalationPathValid`/`checkNoCircularEscalation`; (d) `contract.teamBoundary.{producerTeam,consumerTeam}` — a team-to-team crossing, validated by `checkContractTeamBoundaries`. `lib/registry/catalog.mjs`'s `edges` field is a different, unrelated concept (auto-derived CLI/npm-script/workflow links for `registry/capabilities.json`, not the org graph) and is out of scope here. This ADR's API scope treats "relationship edges" as these four real structures, not as a single unified edge type — because the codebase does not have one.
- **Existing validation as source of truth**: `lib/registry/validator.mjs`'s `validate(registry, opts)` already returns the field-addressable shape (`{ ok, errors: [{id, severity, message, location}], warnings }`) that inline visual validation needs, and already implements 13 invariants across teams/specialists/contracts/policies. `lib/registry/custom-schema.mjs` and `lib/specialists/schema.mjs` implement a second, narrower validator with a `string[]` shape, run only at CLI-scaffold time. Two validators exist today; this ADR does not invent a third.

## Decision

Add `lib/registry/org-api.mjs`: a typed CRUD façade over the existing storage and validation layers. It is the only new write path this ADR adds — no new file format, no new storage location, no new validation engine. It wraps `assembleRegistry()` for reads, wraps `custom-scaffold.mjs` + a new field-addressable validation adapter for writes, and wraps `lib/registry/validator.mjs` + `lib/contracts/validate.mjs` for validation-result reads.

### 1. Entity operations

One function group per entity kind, each following the same signature shape: `list(kind, {rootDir, scope})`, `get(kind, id, {rootDir})`, `create(kind, record, {rootDir, scope})`, `update(kind, id, patch, {rootDir, scope})`, `remove(kind, id, {rootDir, scope, force})`. `kind` is one of `'specialist' | 'team' | 'contract' | 'fence' | 'skill'`.

```js
// lib/registry/org-api.mjs

/** List entities of one kind, merged across builtin/user/project tiers, each row tagged with its source tier and file path. */
export function listEntities(kind, { rootDir = process.cwd() } = {})
  // => { items: [{ id, scope: 'builtin'|'user'|'project', path, ...record }], count }

/** Read one entity by id, resolved through the same tier precedence as assembleRegistry(). */
export function getEntity(kind, id, { rootDir = process.cwd() } = {})
  // => { id, scope, path, record } | null

/** Create an entity in the given tier. Validates before writing; throws only on
 *  caller error (bad kind/scope), never on validation failure — validation
 *  failures return a result object so a UI can render them inline. */
export function createEntity(kind, record, { rootDir = process.cwd(), scope = 'project', force = false } = {})
  // => { ok: true, path, record } | { ok: false, errors: FieldError[] }

/** Patch-update an entity's fields in place (only 'user' or 'project' tier —
 *  builtin entities are read-only through this API, see Rejected Alternatives). */
export function updateEntity(kind, id, patch, { rootDir = process.cwd(), scope = 'project' } = {})
  // => { ok: true, path, record } | { ok: false, errors: FieldError[] }

/** Remove an entity from a writable tier. Refuses if other entities still
 *  reference it (e.g. a team with specialists still assigned) unless force. */
export function removeEntity(kind, id, { rootDir = process.cwd(), scope = 'project', force = false } = {})
  // => { ok: true } | { ok: false, errors: FieldError[] }
```

`fence` is not a top-level file — it is always a sub-object of a specialist record, per the grounding above. `createEntity('fence', ...)`/`updateEntity('fence', ...)` are therefore not separate file operations; they resolve to `updateEntity('specialist', specialistId, { fence: patch })` under the hood, but the API still exposes them as a distinct `kind` because a visual editor's fence-editing panel (path globs, command allowlist, approval toggles) is a distinct UI surface from the rest of a specialist form and benefits from its own validation call (see §3) without re-submitting the whole specialist record. `skill` entities are read-only through this API in this ADR (list/get only) — skill *files* (`skills/**/*.md`) are prose content outside this ADR's CRUD scope; what a specialist record can do is reference an existing skill bundle, which `listEntities('skill', ...)` and `getEntity('skill', ...)` support by walking `skills/**` the same way `lib/registry/consolidation.mjs#collectSkillFiles` already does, so a specialist-edit form can populate a skill picker without hand-typing `<bundle>/<skill>` strings.

### 2. Import/export

```js
/** Export one tier's org state as a single JSON payload — the read side of a round-trip. */
export function exportOrg({ rootDir = process.cwd(), scope = 'project' } = {})
  // => { scope, exportedAt, teams: {...}, specialists: {...}, contracts: {...}, policies: {...} }

/** Validate and write a full org payload back to one tier, atomically per entity
 *  (each entity file is validated before any file is written; on any failure,
 *  nothing is written — no partial import). */
export function importOrg(payload, { rootDir = process.cwd(), scope = 'project', dryRun = false } = {})
  // => { ok: true, written: string[] } | { ok: false, errors: FieldError[] }
```

`exportOrg`/`importOrg` operate on exactly one tier (`user` or `project`; `builtin` export-only) — they do not attempt to export the merged, precedence-resolved view, because writing a merged view back would be ambiguous about which tier an edited entity belongs in. A visual editor's "export config" button exports the tier the user is actively editing.

### 3. Read-only previews

```js
/** Preview which specialist(s) orchestration_policy would route a given
 *  description/skill-set to, without executing anything. Wraps the same
 *  catalog lib/specialists/roster.mjs#buildSpecialistCatalog builds, plus
 *  fence/team resolution, so a UI can show "adding this specialist would
 *  make it eligible for: <matches>" before the record is saved. */
export function previewRoute({ rootDir = process.cwd(), draftSpecialist, description } = {})
  // => { candidates: [{ id, whenToUse, matchReason }] }

/** Preview the effective fence for a specialist given its own fence and its
 *  team's forbiddenDecisions, without writing anything — wraps
 *  lib/roles/fence.mjs#computeEffectiveFence against a draft (possibly
 *  unsaved) specialist + team pair. */
export function previewEffectiveFence({ rootDir = process.cwd(), draftSpecialist, teamId } = {})
  // => { allowedPaths, allowedCommands, allowedBdLabels, approvalRequired, deniedActions }

/** Run the full validation suite (see §4) against a draft entity merged into
 *  the current registry, without writing — the "would this pass?" check a
 *  form submits on every field blur. */
export function validateDraft(kind, draftRecord, { rootDir = process.cwd() } = {})
  // => { ok: boolean, errors: FieldError[], warnings: FieldError[] }
```

Route preview and validation-result reads are explicitly read-only, per the acceptance criteria — "route previews" is CRUD's R, not C/U/D, because a route is computed from the classifier and registry state, not stored.

### 4. Error model — `FieldError`

Every write and preview function above returns errors in one shape, adopted directly from `lib/registry/validator.mjs`'s existing return shape (this ADR extends it, it does not replace it):

```ts
type FieldError = {
  id: string;        // stable rule id, e.g. 'specialist-missing-team', 'fence-empty-allowed-paths'
  severity: 'error' | 'warning';
  message: string;    // human-readable, matches the string a CLI would print today
  location: string;   // JSON-pointer-shaped field path, e.g. '#/specialists/cx-widget/fence/allowedPaths'
  field?: string;      // NEW: the leaf field name alone (e.g. 'allowedPaths'), for direct form-field binding
                        //      without a UI having to parse the JSON pointer
};
```

`location` is `lib/registry/validator.mjs`'s existing convention, reused verbatim — every one of its 13 invariant checks already emits this shape (`checkTeamHasOwner`, `checkContractPartiesExist`, etc., all seen in the source). What's added is `field`, a convenience the visual editor's the bd issue's acceptance criterion needs ("here's where to show the red squiggle") that `location` alone technically supports but a form binder would otherwise have to string-parse for. `lib/registry/org-api.mjs`'s internal validation adapter does two things existing code does not: (a) it converts `lib/registry/custom-schema.mjs`'s `string[]` output into this shape by wrapping each string with a synthesized `id` (kebab-cased from the field name it names) and a `location` derived from the field it already names in its message text — a mechanical, one-time bridging layer, not a rewrite of `custom-schema.mjs`'s actual rules; (b) it runs both validators (`custom-schema.mjs` for the single-record shape checks, `validator.mjs` for the graph-invariant checks) against a draft merged into the current registry snapshot, and unions the results, so a single `validateDraft()` call surfaces both "this field is malformed" and "this field creates a graph inconsistency" errors together.

### 5. Storage — unchanged, this API is the write path in front of it

`createEntity`/`updateEntity`/`removeEntity`/`importOrg` write to exactly the same files `construct specialist create --custom` and hand-editing write to today: `.construct/org/{specialists,teams,contracts,policies}/*.json` for `scope: 'project'`, `~/.construct/org/**` for `scope: 'user'`. No new file format, no database, no new directory. `scope: 'builtin'` is read-only through every write function in this API (see Rejected Alternatives) — a caller attempting `createEntity(..., { scope: 'builtin' })` gets a `{ ok: false, errors: [...] }` result, not a written file.

## Rationale

Wrapping the two existing validators rather than replacing either is chosen because `lib/registry/validator.mjs`'s 13 invariants and `custom-schema.mjs`'s field-level checks are both live, tested, and already correct for their respective scope (single-record shape vs. whole-graph consistency) — reimplementing either inside a new API module would create a second place these rules could drift out of sync with the CLI path that still calls them directly. A thin adapter that unions both outputs into one `FieldError[]` shape is the smallest change that gives a visual editor what it needs.

`location` (JSON-pointer-shaped) plus the new `field` convenience, rather than inventing a different addressing scheme, is chosen because `validator.mjs` already emits `location` on every one of its 13 checks — extending that shape costs one new optional field and zero changes to 13 existing functions, versus a parallel addressing scheme that would need its own mapping back to the same rules.

Fence as a sub-resource of specialist (not a standalone file) reflects what is actually on disk: every fence in the corpus (`grep` across `specialists/org/specialists/*.json`) lives inside a specialist record's `fence` key, and `lib/roles/fence.mjs`'s `computeEffectiveFence()` always takes a specialist id and a specialist's own fence object as input, never a bare fence. Giving fence its own `kind` in the API (rather than folding it entirely into `updateEntity('specialist', ...)`) is chosen anyway because a visual editor's fence panel is a materially different form (path-glob list, command allowlist, approval-toggle grid) from the rest of a specialist record, and a dedicated `previewEffectiveFence()` read lets that panel show live team-intersected authority without a full specialist save round-trip.

Treating "relationship edges" as four distinct real structures (`handoffCandidates`, `escalationPath`, contract `producer`/`consumer`, `teamBoundary`) rather than inventing one unified "edge" entity is chosen because the codebase has no such unification today — adding one would be new modeling work this ADR is not chartered to do (the bd issue scopes this ADR to exposing CRUD over what exists, additive, not a redesign of the underlying org model). Each of the four already has its own validator in `lib/registry/validator.mjs`; the API's job is to expose read/write on the record that carries each edge (specialist for `handoffCandidates`, team for `escalationPath`, contract for the other two), not to build a fifth abstraction.

## Rejected alternatives

- **Allow write operations on `scope: 'builtin'`.** Rejected: the built-in roster (12 specialists, 35 contracts) is shipped and versioned with the package; a no-code editor writing directly into `specialists/org/**` would make every install mutable in a way `construct sync`/upgrade cannot safely reconcile. The existing precedence model (ADR-0046) already gives a user a full override path via `user`/`project` tiers without ever touching builtin files — this API preserves that discipline rather than opening a new way around it.
- **A single unified `Edge` entity type spanning handoffCandidates/escalationPath/contract parties/teamBoundary.** Rejected (see Rationale): no such unification exists in the codebase, and building one is redesign work out of this ADR's charter (additive CRUD over the existing model, not a new model).
- **Replace `lib/registry/custom-schema.mjs`'s string-array validator with a rewritten field-addressable version, retiring the string-array shape.** Rejected: the CLI (`construct specialist create --custom`) and its tests depend on the current string-array messages; rewriting the validator itself risks the exact kind of drift (CLI vs. API disagreeing on what's valid) this ADR's wrapper approach avoids. A bridging adapter over the existing output is lower-risk and reversible independent of the validator's own evolution.
- **A REST/HTTP API surface instead of a JS module façade.** Rejected for this ADR: Construct's zero-npm-dependency Node core (ADR-0001) and its MCP-tool-first integration model (construct-mcp) mean a JS function surface is directly callable from an MCP tool wrapper (future work) without standing up a server; an HTTP layer can be added later as a thin transport over `lib/registry/org-api.mjs` without this ADR needing to decide transport now.
- **Store fence as its own top-level JSON file (`specialists/org/fences/*.json`), decoupled from the specialist record.** Rejected: no such file exists in the corpus today, and every fence consumer (`lib/roles/fence.mjs`, `custom-schema.mjs`) expects it embedded in the owning specialist record; moving it to its own file is a storage-format change this ADR (additive API, not a schema redesign) is explicitly not chartered to make.

## Consequences

- New module `lib/registry/org-api.mjs` becomes the recommended write path for any future no-code UI; `custom-scaffold.mjs`'s `createCustomSpecialist`/`createCustomTeam` remain as the CLI's own call path (the API wraps them, it does not replace the CLI's direct use of them) — `construct specialist create --custom` keeps working unchanged.
- `lib/registry/custom-schema.mjs` gains no new exported functions in this ADR's decision, only a new adapter module (`org-api.mjs`) that consumes its existing `string[]` output — a low-risk, additive dependency.
- A visual editor (the follow-on work this ADR exists to unblock) can be built entirely on `lib/registry/org-api.mjs` without ever hand-parsing `specialists/org/**` JSON or shelling out to the CLI.
- `updateEntity`/`removeEntity` need a reference-integrity check this ADR specifies but does not yet implement in code (e.g. removing a team that still has `specialists[]` assigned, or removing a specialist still named in another's `handoffCandidates`) — implementation work tracked under this ADR's parent epic, not resolved by the ADR text alone.
- `previewRoute` depends on `lib/specialists/roster.mjs#buildSpecialistCatalog`, which currently reads only the assembled registry, not a draft; implementing the "draft-aware" preview requires the catalog builder to accept an in-memory override, a small extension to `roster.mjs` tracked as implementation work.

## Reversibility

Two-way door: `lib/registry/org-api.mjs` is purely additive — it introduces no new storage format, no new validation engine, and no change to any existing CLI command's behavior. Deleting the module reverts to today's state (CLI scaffolding + hand-edited JSON) with zero data migration, because every file `org-api.mjs` writes is byte-identical in location and shape to what `custom-scaffold.mjs` already writes. Revisit if a future visual editor's actual usage reveals the four-separate-relationship-types model (rather than a unified edge abstraction) is too fragmented to bind to a graph-drawing UI component — that would be a scoped follow-up, not a reversal of this ADR's storage/validation decisions.

## References

- `lib/registry/custom-scaffold.mjs` (existing create-only CRUD for user/project tiers), `lib/registry/custom-schema.mjs` (string-array validator), `lib/registry/validator.mjs` (13-invariant, field-addressable `{id,severity,message,location}` validator — the shape this ADR extends), `lib/registry/assemble.mjs` (tier-merge read path), `lib/registry/org-io.mjs` (low-level entity file resolution), `lib/registry/catalog.mjs` (a differently-scoped, unrelated `edges` concept — capability-to-CLI/npm/workflow links, not the org graph)
- `lib/specialists/scaffold.mjs`, `lib/specialists/schema.mjs`, `lib/specialists/prompt-schema.mjs`, `lib/specialists/roster.mjs`, `lib/specialists/postconditions.mjs` (built-in specialist prompt CRUD/validation surface, unchanged by this ADR)
- `lib/roles/fence.mjs` (fence enforcement — `checkAction`, `computeEffectiveFence`), `specialists/org/policies/file-path-fence.json` (the fence policy record)
- `lib/contracts/validate.mjs` (`validateContractsFile`, `validateHandoff`, `validateArtifactPostconditions` — contract/postcondition validation this API's contract preview wraps)
- Verified counts (this session): `specialists/org/specialists/*.json` = 12, `specialists/org/contracts/*.json` = 35, `specialists/org/teams/*.json` = 8
- ADR-0046 (modular org runtime merge), ADR-0047 (specialist vs. flavor taxonomy), ADR-0056 (LMCP-A6 policy/approval/identity model), ADR-0065 (orchestrator-worker consolidation — custom-specialist authoring as supported capability), ADR-0067 (deterministic flow engine — contracts as delegation specs), ADR-0069 (single project directory consolidation — `.construct/org/` path this API writes to)
