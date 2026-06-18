# Dependency Policy

## Zones

### Core zone: `lib/`, `bin/`

**Allowed:** Node.js built-ins (`node:fs`, `node:path`, `node:crypto`, etc.) plus the two declared runtime dependencies:
- `@modelcontextprotocol/sdk`: MCP server/client protocol
- `postgres`: PostgreSQL client for SQL storage backend

**Not allowed:** Any other npm package without an ADR (see below).

### Services zone: `services/`

Additional runtime dependencies are allowed. Each new dependency requires an ADR in `docs/adr/` answering:
1. What in-tree code does it replace?
2. What is the maintenance cost of keeping the in-tree version vs. adopting the library?
3. What is the security surface (weekly downloads, known CVEs, supply chain history)?

### Tooling zone: `tests/`, `scripts/`

Dependencies are allowed freely. No ADR required. These never ship to end users.

## Adding a core dependency

1. Write `docs/adr/NNNN-<title>.md` using the MADR template (see `docs/adr/0001-zero-npm-core.md` for format).
2. Answer all three questions above in the ADR body.
3. PR must link the ADR. Reviewer confirms the ADR is complete before approving the dependency addition.

## Promotion trigger

Any in-tree implementation that accumulates **3 or more defects in a 6-month window** automatically nominates itself for library replacement review. Create a GitHub issue linking the defects and the relevant section of `docs/in-tree-implementations.md`.

## In-tree implementation inventory

See `docs/in-tree-implementations.md` for the full list of hand-rolled components, their LOC, test coverage, known limitations, and nearest library alternatives.

## Transitive vulnerability remediation

When `npm audit` reports a vulnerability in a transitive dependency of the published CLI, follow this ladder. Higher rungs are preferred — they fix the tree consumers actually install.

**The load-bearing rule:** an `overrides`/`resolutions` pin in this `package.json` protects only this repo's own audit. npm applies `overrides` solely for the top-level project doing an install, so a published library's overrides are ignored by everyone who depends on it. Never rely on `overrides` as the consumer remedy, and never treat a green repo audit as proof the published artifact is clean — that is what `npm run audit:published` checks (it packs the artifact and audits a clean downstream install with no overrides in scope).

Remediation ladder:

1. **Bump the offending direct dependency** to a release line whose transitive graph is already patched.
2. **Replace or remove the direct dependency** when the maintained successor resolves a clean tree (e.g. `@xenova/transformers` → `@huggingface/transformers`).
3. **Demote to `optionalDependencies` or a peer** so a non-essential heavy dependency leaves the default install surface — only when an in-tree or hosted fallback exists (see [ADR 0014](adr/0014-local-embeddings-optional.md)). Optional deps are still installed and audited by default, so this complements but does not substitute for rungs 1–2.
4. **Accept with a documented ADR** only when no upstream fix exists, recording the residual risk and the revisit condition.

A repo-local `overrides` pin is acceptable as defense-in-depth for this repo's own tree, but it is never the line item that closes a consumer-facing advisory.

## Rationale

See `docs/adr/0001-zero-npm-core.md` for the original decision record.
