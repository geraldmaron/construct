<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0055: LMCP-A5 — Specialist/team/profile pack schema, versioning, and prompt-failure rules

- **Date**: 2026-07-03
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner), Construct maintainers (cx-architect)
- **Relates to**: ADR-0037 (specialist prompt format), ADR-0038 (adaptive local prompt composition), ADR-0046 (modular org runtime merge), ADR-0047 (specialist vs. flavor model), ADR-0054 (LMCP-A4, workflow manifest schema)
- **Tracking**: LMCP-A5 (epic: Living Modular Control Plane)

## Problem

There is no pack concept in Construct. Specialists, teams, and prompts are loaded from
one fixed path (`PROMPTS_DIR` pinned to the package installation path). This produces
three compounding defects:

1. **No versioning or compat declaration.** A pack that ships a specialist prompt has no
   way to declare which core version it requires. The loader has no way to reject an
   incompatible pack; it silently loads whatever is on disk.

2. **Missing prompts silently degrade to generic.** `lib/orchestration/worker.mjs:120-127`
   falls back to a generic specialist prompt whenever a named specialist's prompt file is
   absent. The fallback emits no error and sets no flag; callers receive a silently
   degraded run with no indication that the named specialist was not actually used.

3. **Teams and enterprises cannot extend or override the specialist catalog without
   forking the core package.** `specialists/org/**.json` is data-driven (the right
   direction), but the prompt directory and pack registration surface do not exist, so
   the data-driven specialist data has no corresponding extensible prompt delivery path.

## Decision

### Pack manifest schema

Define a **pack manifest** as a JSON document at `{pack_root}/pack.manifest.json`:

```jsonc
{
  "id": "string",                        // stable slug, e.g. "@myorg/research-pack"
  "version": "string",                   // semver of this pack release
  "compatVersion": "string",             // semver range of compatible construct core versions
  "teams": ["string"],                   // team ids contributed by this pack
  "specialists": ["string"],             // specialist ids contributed or overridden
  "prompts": {                           // map: specialist-id → relative path within pack
    "cx-researcher": "prompts/researcher.md"
  },
  "perspectives": ["string"],            // named perspectives contributed
  "modelTierHints": {},                  // per-specialist model tier preferences
  "toolGrantsRequested": ["string"],     // tools this pack's specialists need
  "workflowContributions": ["string"],   // workflow manifest ids contributed (see ADR-0054)
  "handoffContracts": [{}],              // typed handoff contract definitions
  "outputContracts": [{}],               // typed output contract definitions
  "gates": ["string"],                   // named policy gates this pack registers
  "tests": ["string"],                   // paths to pack integration test fixtures
  "docs": "string",                      // path or URL to pack documentation
  "installConditions": ["string"],       // conditions that must be met to install
  "enableConditions": ["string"],        // conditions that must be met to enable at runtime
  "deprecation": {                       // optional: marks pack as deprecated
    "since": "string",                   // version at which deprecation began
    "message": "string",                 // human-readable deprecation notice
    "replacement": "string"              // id of the replacing pack, if any
  }
}
```

All fields are optional except `id`, `version`, and `compatVersion`. Unknown fields are
ignored (forward-compat). The loader validates the manifest on install and on load.

### Pack install locations

Packs are discovered from two locations, in addition to the built-in package:

1. **User packs** — `~/.config/construct/packs/{pack-id}/pack.manifest.json`
2. **Project packs** — `.cx/packs/{pack-id}/pack.manifest.json`

Project packs take precedence over user packs for any `id` conflict. Built-in
specialists (shipped with the core package) are always available and treated as the
lowest-precedence source. A pack listed in `.cx/packs/` but absent on disk is a hard
error at startup.

### Prompt resolution order

When resolving the prompt for a specialist id:

1. **Active packs** — search installed packs in install-priority order (project packs
   before user packs, both before builtin), return the first match from the `prompts`
   map in that pack's manifest.
2. **Project prompts** — `.cx/prompts/{specialist-id}.md` (project-local overrides).
3. **Built-in prompts** — package `PROMPTS_DIR/{specialist-id}.md`.

The resolver returns the resolved path and the source label (pack id, `project`, or
`builtin`) so callers can log provenance.

### Prompt failure matrix

The response to a missing or malformed prompt depends on the deployment mode and
the pack type:

| Scenario | Solo mode | Team / Enterprise mode |
|---|---|---|
| Missing prompt for specialist in an **enabled team or enterprise pack** | Hard failure — throw, surface error, halt orchestration | Hard failure — throw, surface error, halt orchestration |
| Malformed frontmatter in an enabled team or enterprise pack prompt | Hard failure | Hard failure |
| Missing **optional** prompt with no pack declaration | Allowed: explicit visible degraded mode — log warning, use builtin fallback, set `degraded: true` on run result | Hard failure — missing optional prompts are not optional in team/enterprise |
| Builtin prompt absent (package integrity error) | Hard failure | Hard failure |

The generic fallback in `worker.mjs:120-127` that silently substitutes a generic
prompt is **not a valid degraded mode** in any deployment. Its removal is scoped to
LMCP-E2; until then, the loader wraps it to emit a structured warning with source
context and set `degraded: true` on the run so callers can surface it.

### Version compat enforcement

The pack loader checks `compatVersion` (a semver range) against the running core
version at load time:

- Pack `compatVersion` does not satisfy the running core version → **hard error**,
  clear message naming the pack id, its declared range, and the running version.
  The pack is not loaded. There is no silent fallback to a wrong-version pack.
- Pack `version` is a lower semver than a previously installed version of the same id
  → warning logged; the loader continues (downgrade is allowed but flagged).
- A pack marked `deprecation.since` → warning logged on load with the deprecation
  message and replacement id.

### Generic fallback in worker.mjs

The removal of the silent generic fallback (`worker.mjs:120-127`) is **LMCP-E2 scope**,
not this ADR. This ADR defines the contract the replacement must satisfy; LMCP-E2
implements the new resolution path and removes the fallback only after all callers have
been migrated.

## Rejected alternatives

- **Environment-variable PROMPTS_DIR override.** Allow operators to point `PROMPTS_DIR`
  at a custom directory. Rejected: a single directory cannot serve multiple packs,
  does not support versioning or compat checking, and does not provide the
  contribution-point model that team extension requires.

- **Pack as an npm package loaded via `require`.** Packs ship as npm packages; install
  is `npm install`. Rejected: it ties pack delivery to npm, raises supply-chain risk,
  requires running npm in environments where it may not be available, and makes pack
  loading indistinguishable from arbitrary code execution in the core process.

- **Merge all pack prompts into one resolved prompt file at install time.** Pack install
  writes a single merged prompt file. Rejected: concurrent installs race, the merge
  loses provenance (which pack won), and per-specialist overrides require rebuilding
  the entire merged file.

- **Allow silent generic fallback to remain as-is.** Rejected outright: silent degradation
  violates the no-fabrication rule. A run that uses a generic prompt when a named
  specialist was requested produces output the caller cannot trust.

## Consequences

- Pack authors can contribute specialists, teams, prompts, and workflow manifests by
  shipping a directory with a `pack.manifest.json` — no core fork required.
- Missing or malformed prompts in an enabled team/enterprise pack are hard failures;
  operators learn about broken packs immediately rather than silently receiving wrong
  output.
- Solo users retain a visible-degraded-mode fallback for optional prompts, preserving
  backward compatibility for single-user installs without enterprise packs.
- Version compat enforcement means upgrading the core may require updating packs; pack
  authors must maintain `compatVersion` ranges.
- The `worker.mjs` generic fallback remains in place until LMCP-E2 but is wrapped to
  emit structured warnings; no run silently uses generic output without a `degraded`
  flag.
- `PROMPTS_DIR` remains valid for builtin resolution but is no longer the sole prompt
  source; tooling that relies on it as the complete prompt catalog must migrate to the
  pack resolver.

**Unblocks**: LMCP-E1, LMCP-E2, LMCP-E3, LMCP-F1
