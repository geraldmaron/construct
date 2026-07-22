# Dependency Policy

## Zones

### Core zone: `lib/`, `bin/`

**Allowed:** Node.js built-ins (`node:fs`, `node:path`, `node:crypto`, etc.) plus the two declared runtime dependencies:
- `@modelcontextprotocol/sdk`: MCP server/client protocol
- `postgres`: PostgreSQL client for SQL storage backend

**Not allowed:** Any other npm package without an ADR (see below).

### Services zone: `services/`

Additional runtime dependencies are allowed. Each new dependency requires an ADR in `docs/decisions/adr/` answering:
1. What in-tree code does it replace?
2. What is the maintenance cost of keeping the in-tree version vs. adopting the library?
3. What is the security surface (weekly downloads, known CVEs, supply chain history)?

### Tooling zone: `tests/`, `scripts/`

Dependencies are allowed freely. No ADR required. These never ship to end users.

Static analysis (`knip`, `dependency-cruiser`) lives here as `devDependencies`. ADR-0001 restricts the **installed CLI runtime** in `lib/` and `bin/` — its Context section (lines 18–23) frames the restriction around `npm install -g construct` supply-chain risk for end users. `devDependencies` are stripped from consumer installs and are not subject to the ADR-0001 amendment gate. Run them via:

```bash
npm run static:knip    # unused files/exports/deps (warn-first in CI)
npm run static:cruise  # dependency direction rules (warn-first in CI)
```

Both tools use explicit entry-point inventories (`knip.json`, `.dependency-cruiser.cjs`) so findings reflect shipped surfaces rather than orphan false positives.

## Adding a core dependency

1. Write `docs/decisions/adr/NNNN-<title>.md` using the MADR template (see `docs/decisions/adr/0001-zero-npm-core.md` for format).
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

**LanceDB pin note (2026-07):** `@lancedb/lancedb` stays in `optionalDependencies` (ADR-0081) and is pinned to `0.30.0` rather than `0.31.x`. `0.31.0` added an unused nested optional `@huggingface/transformers` → `sharp` chain that failed both repo and `audit:published` high audits; Construct never imports that nest (see `docs/notes/research/lancedb-vs-sqlite-vec-benchmark.md`). Revisit when an upstream LanceDB line ships without the vulnerable `sharp` (<0.35) path or with a patched transitive tree.

## OSV scanning, license policy, and exceptions

Supply-chain scanning runs in `.github/workflows/supply-chain.yml`:

- **OSV scan** (`google/osv-scanner-action`) against `package-lock.json`
- **Dependency review** (`actions/dependency-review-action`) on pull requests, using allow/deny lists from `.github/license-allowlist.json`

Both jobs are **warn-first** until the initial finding set is triaged. Promotion to blocking: flip `continue-on-error` to `false` once every remaining finding has a dated entry in `.github/supply-chain-exceptions.json` or is fixed. The OSV job uses the docker `osv-scanner-action` (not a reusable-workflow `uses:` call) so warn-first `continue-on-error` remains valid YAML. Dependency review passes `allow-licenses` only — the action rejects pairing allow and deny lists.

**Exceptions** mirror the `LEGACY_EXEMPT_SHAS` pattern in `scripts/lint-commits-pr.mjs`: each entry requires `id`, `reason`, and `expires` (`YYYY-MM-DD`). Expired entries fail `npm run supply-chain:exceptions` (also runs in CI before scans).

Local checks:

```bash
npm run supply-chain:exceptions
npm run supply-chain:gate    # composed release go/no-go (construct-tsyfe.10.7)
```

## Rationale

See `docs/decisions/adr/0001-zero-npm-core.md` for the original decision record.
