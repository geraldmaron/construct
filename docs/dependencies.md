# Dependency Policy

## Zones

### Core zone — `lib/`, `bin/`

**Allowed:** Node.js built-ins (`node:fs`, `node:path`, `node:crypto`, etc.) plus the two declared runtime dependencies:
- `@modelcontextprotocol/sdk` — MCP server/client protocol
- `postgres` — PostgreSQL client for SQL storage backend

**Not allowed:** Any other npm package without an ADR (see below).

### Services zone — `services/`

Additional runtime dependencies are allowed. Each new dependency requires an ADR in `docs/adr/` answering:
1. What in-tree code does it replace?
2. What is the maintenance cost of keeping the in-tree version vs. adopting the library?
3. What is the security surface (weekly downloads, known CVEs, supply chain history)?

### Tooling zone — `tests/`, `scripts/`

Dependencies are allowed freely. No ADR required. These never ship to end users.

## Adding a core dependency

1. Write `docs/adr/NNNN-<title>.md` using the MADR template (see `docs/adr/0001-zero-npm-core.md` for format).
2. Answer all three questions above in the ADR body.
3. PR must link the ADR. Reviewer confirms the ADR is complete before approving the dependency addition.

## Promotion trigger

Any in-tree implementation that accumulates **3 or more defects in a 6-month window** automatically nominates itself for library replacement review. Create a GitHub issue linking the defects and the relevant section of `docs/in-tree-implementations.md`.

## In-tree implementation inventory

See `docs/in-tree-implementations.md` for the full list of hand-rolled components, their LOC, test coverage, known limitations, and nearest library alternatives.

## Rationale

See `docs/adr/0001-zero-npm-core.md` for the original decision record.
