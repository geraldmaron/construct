<!--
cx_doc_id: pending
created_at: 2026-06-19
status: proposed
-->
# ADR-0044: Tool-repo root layout hygiene via audit alignment

- **Date**: 2026-06-19
- **Status**: accepted
- **Deciders**: Construct maintainers (cx-architect)
- **Relates to**: ADR-0002 (layered architecture), ADR-0027 (host footprint), ADR-0035 (extend-not-rebuild), ADR-0043 (Oracle meta-controller)

## Problem

The Construct **tool repository** accumulated legacy top-level directories (`dashboard/` Vite dist, root `providers/` contract tree) and duplicated init lane definitions (`lib/init-unified.mjs` vs `lib/init-docs.mjs`). ADR-0002 describes logical layers (`core/`, `providers/`, `dashboard/`) that no longer match the physical tree (`lib/`, `apps/dashboard/`, `bin/`). Contributors see 23+ root directories with overlapping names (`schemas/` vs `lib/schemas/`, `registry/capabilities.json` vs `platforms/capabilities.json`).

User projects never receive root `dashboard/` or `providers/` from `construct init`. Cleanup is **maintainer/repo hygiene**, not a user upgrade migration.

## Decision

1. **Delete legacy root paths** in maintainer PRs: `dashboard/`, root `providers/`.
2. **Consolidate duplicated init lanes** into `lib/init/doc-lanes.mjs`; `init-docs.mjs` remains a thin docs-only entrypoint; `npm run docs:init` deprecates to `construct init --docs-preset=*`.
3. **Move provider contract harness** to `lib/providers/contract/` (interface, registry, contract-tests, adapters).
4. **Rename handoff JSON schemas** from `lib/schemas/` to `lib/contract-schemas/` (distinct from root `schemas/` registry JSON Schema).
5. **Detect regressions** via audit phase `scripts/audit/03c-root-layout.mjs`, wired into:
   - `tests/functional/audit-ratchet.functional.test.mjs`
   - `scripts/alignment/census.mjs` (`rootLayout` section)
   - Oracle read model (`alignmentCensus.rootLayout` → `repo-layout-legacy` gap)
6. **Do not** add user-facing `construct doctor --fix-*` flags for tool-repo dirs. Doctor `--fix-*` remains ADR-0027 host/project footprint only.

## Physical root map (logical → actual)

| Logical (ADR-0002) | Physical path |
|---|---|
| core | `bin/`, `lib/` |
| providers | `lib/providers/` (data-source adapters), `lib/providers/contract/` (contract harness), `lib/embed/providers/` (embed daemon) |
| dashboard | `apps/dashboard/` → `lib/server/static/` |
| runtime | `lib/embed/`, `lib/service-manager.mjs` |
| deploy | `deploy/` |

Org surface cluster (documented, not merged): `specialists/`, `registry/`, `platforms/`, `schemas/`, `profiles/`, `personas/`, `commands/`, `skills/`, `rules/`, `templates/`.

## Consequences

- `release:check` ratchet blocks reintroduction of legacy root dirs.
- Oracle surfaces layout drift when census `rootLayout.clean === false` (tool repo).
- Contract schema paths in `specialists/contracts.json` use `lib/contract-schemas/`.

## Verification

```bash
node scripts/audit/03c-root-layout.mjs
node scripts/alignment/census.mjs --ratchet
npm test
```
