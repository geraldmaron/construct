<!--
cx_doc_id: pending
created_at: 2026-06-23
status: proposed
-->
# ADR-0045: Local/global config boundary, docs taxonomy, and a single intake zone

- **Date**: 2026-06-23
- **Status**: proposed
- **Deciders**: Construct maintainers (operator + cx-architect)
- **Relates to**: ADR-0002 (layered architecture), ADR-0027 (host footprint), ADR-0029 (install scopes & hook budgets), ADR-0044 (tool-repo root layout)

## Problem

Three adjacent sources of confusion, each validated against community-adopted patterns rather than assumed:

1. **"content vs docs."** There is no `content/` directory. The docs site (`apps/docs/`) already build-time-reads the single canonical source — repo-root `docs/` — via `apps/docs/lib/docs-source.ts` (`DOCS_ROOT = ../../docs`); no second copy exists. The real confusion lives *inside* `docs/`: ~25 type-named subdirs including look-alike pairs with opposite meanings — `adr`/`decisions`, `prd`/`prds`, `rfc`/`rfcs` — where the **plurals are init-lane templates** (`construct init` clones them downstream) and the **singulars are this repo's own records**, plus an empty `changelog/` shadowing the canonical `changelog.md`. A second axis: both `templates/docs/` and root `templates/docs/` exist.

2. **Intake has three doors.** Intake is already fully project-scoped (no global intake), but it watches three drop zones — root `inbox/`, `.cx/inbox/`, and `docs/intake/` (`lib/config/intake-policy.mjs`) — with no single canonical entry point.

3. **The local/global boundary leaks.** ADR-0029 split user vs project scope, but: project `.env` and user `~/.construct/config.env` silently shadow each other (warn fires only for a hardcoded key subset); `~/.construct/` ignores the XDG base-directory spec; there is no gitignored project-local tier; and precedence/merge semantics are undocumented.

### Community validation (no assumptions)

- **Docs**: a plain `docs/` as source-of-pages is idiomatic when markdown files *are* the pages (Docusaurus, default VitePress). A `content/` collection is only idiomatic with a typed/validated pipeline (Astro content collections, Nextra/Fumadocs, Velite/Zod) — which Construct neither has nor needs. For a monorepo with root `docs/` + a site app, the recommended pattern is **one canonical source the app ingests**, not a second copy. Construct already does this.
- **Config**: the XDG Base Directory spec plus git (`local > global > system`, honors XDG), npm (`project > user > global`), Prettier (deliberately **no** global config, for reproducibility), and Claude Code (`Managed > args > Local .claude/settings.local.json > Project .claude/settings.json > User ~/.claude`, with list-shaped settings **merged**) converge on one principle: **user/global = identity, secrets, personal prefs (must not travel with the repo); project-committed = reproducible & team-shared; project-local = gitignored personal overrides**; most-specific wins; lists merge.
- **Intake**: the Maildir contract (`tmp/` → `new/` → `cur/`, atomic rename for lock-free, race-free handoff) and the `.next/`/`.turbo/`/`.cache/` convention (project working state in a gitignored dot-dir; visible at root only when humans must drop files) both point to **one canonical drop zone with atomic handoff**.

## Decision

### A. Docs taxonomy — regroup; `docs/` stays the single source

1. `docs/` remains the one canonical markdown source; `apps/docs/` keeps reading it (no `content/` collection, no second copy).
2. Collapse the type-named subdirs into a small, intent-revealing taxonomy:

| New top-level | Absorbs | Holds |
|---|---|---|
| `docs/decisions/` | `adr/`, `rfc/`, old `decisions/` façade | This repo's numbered ADRs + RFCs (records) |
| `docs/specs/` | `prd/` | This repo's numbered PRDs/specs |
| `docs/guides/` | `concepts/`, `cookbook/`, `start/`, `reference/`, `contributing/` | How-to + reference for humans |
| `docs/operations/` | `deploy/`, `maintenance/`, `runbooks/`, `incidents/`, `operations/`, `releases/`, `audit/` | Run/operate the system |
| `docs/notes/` | `memos/`, `meetings/`, `notes/`, `research/` | Working notes |

3. **Segregate init-lane templates** out of the records tree: move the plural template dirs (`prds/`, `rfcs/`) and any template content under the shipped `templates/docs/` (e.g. `templates/docs/lanes/`), so "templates cloned downstream" never sit beside "this repo's records." Reconcile `templates/docs/` vs root `templates/docs/` into the single shipped `templates/docs/`.
4. Delete the empty `changelog/` dir (`changelog.md` is canonical).
5. Update `apps/docs/lib/docs-source.ts` (`SKIP_DIRS` + nav), the `construct init` doc-lane source paths (`lib/init/doc-lanes.mjs`), and internal cross-links to the new taxonomy. Extend `scripts/audit/03c-root-layout.mjs` to ratchet the taxonomy.

### B. Config — XDG base dirs + Claude Code tier model

1. **Adopt XDG for user scope**: config → `$XDG_CONFIG_HOME/construct` (default `~/.config/construct`); durable state (vector DB, logs) → `$XDG_STATE_HOME/construct`; regenerable caches → `$XDG_CACHE_HOME/construct`. Honor the env vars; fall back to spec defaults. Replaces the catch-all `~/.construct/`.
2. **Tier model** mirroring Claude Code, most-specific wins:

   `user (global, ~/.config/construct)` ◁ `project committed (construct.config.json)` ◁ `project-local gitignored (construct.config.local.json)`

   List-shaped settings (permission allowlists, `sources.targets`, intake dirs) **merge + dedupe** across tiers; scalars override.
3. **Resolve `.env` shadowing**: document the precedence explicitly and warn on *every* shadowed key, not a hardcoded subset.
4. **Back-compat shim**: read legacy `~/.construct/*` when present, one-time migrate to XDG paths with a notice, and keep reading legacy for a deprecation window (tracked bead).
5. Document the full model in `docs/guides/reference/config.md`; update ADR-0029's user-scope paths.

### C. Intake — one visible root `inbox/`

1. The single canonical human drop zone is root `inbox/` (visible, discoverable).
2. Fold `.cx/inbox/` and `docs/intake/` into `inbox/`; deprecate the extra zones in `intakePolicy` (read legacy + warn during the window).
3. Machine/runtime state stays under gitignored `.cx/` (sessions, traces, lancedb, oracle, **processed** intake).
4. Adopt **Maildir-style atomic handoff**: writers stage then rename into `inbox/`; the watcher consumes only complete files and moves processed items to `.cx/intake/processed/`.
5. Update `lib/config/intake-policy.mjs` defaults + `schemas/project-config.schema.json`, `lib/init-unified.mjs`, the dashboard intake route, and docs.

## Migration & phasing

Each phase is its own bead with a functional test in `tests/functional/`, `construct doctor` + `construct sync` green, docs updated, then merge.

- **Phase 1 — docs taxonomy.** Pure maintainer/repo hygiene; no user-facing migration (ADR-0044 precedent). Lowest risk.
- **Phase 2 — single intake.** Project-scoped; back-compat reads of the old three zones with a deprecation warning.
- **Phase 3 — XDG + tiers.** User-machine migration; ships behind the shim with one-time migrate. Highest risk; last.

## Consequences

- `release:check` / `03c-root-layout` ratchets extend to the docs taxonomy and a config-scope check in `construct doctor`.
- ADR-0029 user-scope paths move to XDG; ADR-0044's physical root map gains `inbox/` and the `docs/` taxonomy.
- Back-compat windows require dual-read code paths (legacy `~/.construct`, old intake zones) until deprecation completes (tracked bead).

## Verification

```bash
node ./bin/construct doctor
node scripts/audit/03c-root-layout.mjs
node ./bin/construct sync && node ./bin/construct list
npm test && npm run test:functional
```
