# ADR-0033: Platform Capability Registry

- **Date**: 2026-06-10
- **Status**: accepted
- **Deciders**: Construct maintainers (cx-architect)
- **Supersedes**: none

## Problem

Construct renders one persona and a roster of specialists onto six host platforms (Claude Code,
Codex, OpenCode, Cursor, VS Code, Copilot), each with different capabilities: some route subagents
natively, some run hooks, some accept MCP servers, some take only instructions, some need TOML and
others JSON, and only one provisions local-model context windows. Today that capability knowledge is
scattered as inline branches and duplicated literals across the sync and init code: the host
enumeration exists as `HOST_KEYS` in one file and `HOST_FLAG_KEYS` plus a display-name map in
another; the "which hosts route natively" fact lives in an inline `hasNativeSubagents` map; the
"which hooks are safe at global scope" fact is a hardcoded allowlist; Copilot's instructions-only
nature is embedded in its sync function; local-model provisioning is a conditional buried in the
OpenCode sync path.

This contradicts the project's stated "agnostic, no hard-coding per platform" principle and has a
concrete cost: a capability fact must be changed in several places to stay consistent, adding a host
means editing many functions rather than adding data, and there is no single artifact a reader can
consult to answer "what can platform X do." The proliferation audit also surfaced an unjustified
asymmetry that this scatter hides — the 28-specialist roster is injected always-on for Claude while
the natively-routing hosts omit it — which is exactly the kind of per-host decision that should be
declared and reviewable, not implicit.

## Context

OpenCode config semantics were confirmed against upstream source (deep-merge precedence, project can
disable a globally-enabled MCP server, no per-session tool filter) — see
`docs/notes/research/2026-06-construct-audit/20-opencode-ecosystem.md`. ADR-0027 already established a
declarative disposition table for the host *footprint*; this ADR extends the same declarative posture
to host *capabilities*. ADR-0032 depends on a clean place to declare local-model provisioning per host.

## Decision

Introduce a single declarative source of truth, `platforms/capabilities.json`, validated by
`schemas/platform-capabilities.schema.json` and loaded through `lib/platforms/capabilities.mjs`. Each
host entry declares: `id`, `displayName`, `hasNativeSubagents`, `hooks` (`supported` plus the
`globalAllowlist`), `instructionsOnly`, `supportsMcp`, `configFormat`, `configPaths`
(`global`/`project`), `agentPrefix`, and `localModelProvisioning` (`"modelfile"` | `"none"`). The
loader validates on load, derives `HOST_KEYS` from the data, and fails loud on an unknown host. The
sync and init code consume the loader; the inline branches and duplicated literals are deleted.

The refactor is behavior-preserving: the acceptance bar is byte-identical sync output for every host
before and after, proven by a golden-diff functional test.

## Rationale

A declarative registry makes every per-host difference a reviewable data row rather than a code path,
which is the only way the "agnostic, no hard-coding" principle can be true rather than aspirational.
It collapses the duplicated host enumerations to one derived list, gives reviewers a single artifact
to audit (including the roster asymmetry, which becomes a visible `hasNativeSubagents`-driven row
rather than buried logic), and turns "add a host" into "add a row plus one adapter." It is also the
natural carrier for the per-host flags the OpenCode/local-model tranche needs (`localModelProvisioning`,
and downstream the trim-scope and capability-honesty wiring), so those land as data, not new branches.

## Rejected alternatives

- **Leave the inline branches as-is.** Rejected: the literals are already duplicated and drift-prone,
  the principle is stated repeatedly in the codebase's own rules, and every subsequent workstream in
  this tranche would add more branches to the same functions, compounding the problem.
- **A TypeScript/JS module of exported constants instead of JSON + schema.** Rejected: a JSON file with
  a JSON Schema is validatable, diffable, and consumable by non-JS tooling and tests without importing
  the sync runtime; the capability set is pure data with no behavior, so code adds nothing but a place
  for logic to creep back in.
- **Per-host capability fields scattered into the existing `specialists/registry.json`.** Rejected:
  that registry is about agents and their tools, not host platforms; conflating the two axes is the
  same category error this ADR is correcting and would make both files harder to reason about.

## Consequences

- Adding or changing a host capability is a data edit plus, at most, one adapter function; the change
  is visible in one reviewable file.
- The duplicated host enumerations collapse to one derived source; an unknown host fails loud at load
  rather than silently falling through a branch.
- Sync gains a load-time validation dependency on the schema; a malformed registry stops sync early
  with a clear error (intended — fail loud over silent misconfiguration).
- Later workstreams (trim scope, capability honesty, declared model strategy) attach to registry rows
  instead of adding inline conditionals.

## Reversibility

Two-way door. The registry is an internal refactor with byte-identical output; reverting means
re-inlining the data, which the golden-diff test makes mechanically safe. The schema and loader are
additive and carry no external contract.

## References

- `docs/notes/research/2026-06-construct-audit/80-synthesis.md` (item 3, OpenCode config semantics; the
  hard-coding inventory)
- `docs/notes/research/2026-06-construct-audit/20-opencode-ecosystem.md`
- ADR-0027 (host footprint disposition table — the declarative precedent)
- ADR-0032 (small-model methodology — consumes `localModelProvisioning`)
