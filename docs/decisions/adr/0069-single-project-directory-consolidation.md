<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0069: Single project directory — consolidate `.cx/` and `.construct/`

- **Date**: 2026-07-07
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner)
- **Supersedes**: none
- **Relates to**: ADR-0027 (host/project footprint — its `.construct/`-launcher vs `.cx/`-config disposition split is superseded here; its disposition-table mechanism, marker-block injector, and forward-fix/backward-repair migration discipline are affirmed and reused), ADR-0066 (config-layer footprint — its machine-scoped heavy-state split at `~/.construct/projects/<key>/` is unchanged; only the project-local dir name it references moves)

<!-- Owning specialist: cx-architect. -->

## Problem

A consumer project that installs Construct gets two Construct-owned directories at its root: `.construct/` (the per-project launcher — `run.mjs`, `bootstrap.*`, `version`, `cache/`, `plugins/`) and `.cx/` (the config layer — `context.md`/`context.json`, `workflow.json`, custom `org/`, `templates/` overrides, and small runtime markers). Two sibling dot-directories from one tool is a discoverability and mental-model tax: a user opening the project cannot tell which one holds the config they may edit, the two names share no common stem, and every doc has to explain the split before it can explain anything else. The disposition split that motivated two directories (ADR-0027: launcher fully ignored, config layer partly committed text) is a real internal distinction, but it does not require two top-level directories to express — a subdirectory does the same job without the second root.

## Context

ADR-0027 established `.construct/` as the launcher and `.cx/` as the config layer, and ADR-0066 moved the *heavy* runtime state (traces, LanceDB index, docling venv) out to a machine-scoped `~/.construct/projects/<key>/`, leaving `.cx/` holding only committed text plus small runtime markers. After ADR-0066, the two project-local directories are both small, both Construct-owned, and differ only in disposition (launcher = always ignored; config = mostly ignored, some committed text). That difference is expressible as `.construct/launcher/` (ignored) beneath a single `.construct/` root whose top level holds the config surface.

The reference count is asymmetric and shapes the safe path: the `.cx/` literal appears in ~631 sites across the codebase (the config layer is deeply wired), while the `.construct/` launcher literal appears in ~179. A direct string-replace of 800 sites is high-risk. The name is currently hardcoded at every site rather than resolved through one accessor, so the name itself is not a single point of change.

`~/.construct/` (machine-scoped home state, ADR-0066) and `.construct-manifest` (per-adapter uninstall manifests, ADR-0027) share the `construct` stem but are distinct concerns and are unaffected by this decision. The Construct package repo self-hosts: it force-commits its own `.construct/version` pin (`package.json` `version` script, validated by `scripts/pre-release-check.mjs`) while gitignoring the rest of `.construct/` — that self-hosting arrangement moves with the launcher, it is not removed.

## Decision

A consumer project gets exactly one Construct directory: **`.construct/`**. Its top level holds the config surface a user may read or edit (`context.md`, `context.json`, `workflow.json`, custom `org/`, `templates/` overrides, and the small runtime markers that remain project-local after ADR-0066). The launcher and machine-regenerated plumbing move into **`.construct/launcher/`** (`run.mjs`, `bootstrap.sh`, `bootstrap.ps1`, `version`, `stage-state.json`, `cache/`, `plugins/`). `.cx/` no longer exists as a project-root directory.

The name is centralized behind one resolver module (`lib/config-dir.mjs`) before the physical move. Every hardcoded `.cx` / `.construct` literal is migrated to call the resolver, which initially returns the current physical layout (`.cx` for config, `.construct` for launcher) so the migration to the resolver is a pure refactor with zero behavior change. The physical consolidation is then a one-line change to the resolver constants plus a launcher-staging path change plus the migration below — nothing else moves, because every consumer already reads the name from the resolver.

Consumer migration is a real move, not a clean-break flag: a project that already has live `.cx/` content (user-authored `context.md`, custom `org/`) must not lose it. A migration in the ADR-0027 framework relocates `.cx/*` → `.construct/*` and the legacy top-level launcher files `.construct/{run.mjs,bootstrap.*,version,cache,plugins}` → `.construct/launcher/*`, runs automatically on `construct sync` where safe, and is surfaced by `construct doctor` with a one-line remediation where user data is involved. During a transition window both `.cx/` and `.construct/` remain accepted project-root markers so a not-yet-migrated project is still detected.

## Rationale

Centralize-then-flip is chosen over direct string-replace because the resolver makes the 800-site migration mechanical and independently verifiable (a pure refactor: same bytes on disk, tests unchanged), isolating the one genuinely behavior-changing step — the constant flip plus migration — to a small, reviewable surface. It also leaves the name a one-line change forever after, so a future rename (or a per-deployment override) costs nothing.

`.construct/` is chosen as the survivor over `.cx/` because it is the discoverable name — it says what tool owns the directory — which is the whole point of the consolidation from a user's mental model. The cost (it is the ~3.5×-larger migration) is paid once and bounded by the resolver. Tucking the launcher into `.construct/launcher/` rather than leaving it flat keeps the config files a user actually edits at the top level, uncluttered by machine-regenerated plumbing.

A real migration is chosen over ADR-0066's clean-break precedent because the two cases differ: ADR-0066 broke on *heavy runtime state* that is regenerated from scratch with no loss, whereas `.cx/context.md` and custom `org/` are user-authored content — dropping them would violate ADR-0027's citizenship promise. The migration is one-time and visible, consistent with ADR-0027 part 4 (forward-fix and backward-repair).

## Rejected alternatives

- **Keep `.cx/` as the survivor, fold the launcher into it.** ~3.5× less migration surface. Rejected because it keeps the cryptic name — a user still cannot tell from the directory name which tool owns it or that it is safe to open, which is the discoverability problem the consolidation exists to solve.
- **Direct string-replace of all ~800 literals, no resolver.** Fastest to the end state. Rejected because it has the largest blast radius with no safety net, bundles the mechanical rename and the behavior change into one unreviewable diff, and leaves the name hardcoded for the next rename.
- **Leave both directories, add a README pointer in `.construct/` for discoverability.** Lowest effort. Rejected because it treats a structural problem as a documentation problem — two sibling dot-dirs from one tool remains the confusing state regardless of a pointer file.
- **Clean break: new layout on `construct init`, `doctor` flags legacy `.cx/` for manual deletion (ADR-0066 style).** Rejected because `.cx/` holds user-authored content; flagging it for deletion would lose custom specialists, teams, and project context.

## Consequences

- A new resolver module (`lib/config-dir.mjs`) becomes the single source of truth for the project config dir name and the launcher subdir; `lib/project-root.mjs` (`MARKERS`, `cxDir`), `lib/roots.mjs` (`walkUp`), and `lib/host-disposition.mjs` (`IGNORED_PATTERNS`) resolve through it.
- Every `.cx/` and project-root `.construct/` consumer migrates to the resolver — a mechanical but wide-reaching change (~800 sites), landed as a pure refactor before the flip.
- Launcher staging (`lib/install/stage-project.mjs`, `bin/construct-postinstall.mjs`, `lib/init-unified.mjs`) writes into `.construct/launcher/`; the distribution templates (`templates/distribution/{run.mjs,bootstrap.sh,bootstrap.ps1}`) update their self-referential paths; the `sync-specialists.mjs` hook-command generator anchors hooks on `.construct/launcher/run.mjs`.
- `construct doctor` gains a "legacy project layout" detection (a `.cx/` dir or top-level `.construct/run.mjs` present) with a `construct migrate` remediation; the migration relocates live content.
- `walkUp` in `lib/roots.mjs` gains the `$HOME` stop guard `lib/project-root.mjs` already has, so `~/.construct/` (machine scope) does not make the home directory look like a project once `.construct` is the marker.
- The package repo's self-hosted `version` pin moves to `.construct/launcher/version` (`package.json` `version` script, `scripts/sync-construct-version.mjs`, `scripts/pre-release-check.mjs`, `tests/distribution-bootstrap.test.mjs` byte-identity check).
- A fresh `construct init` produces a single `.construct/` directory — verifiable by listing the tree.

## Reversibility

Two-way door on the name (the resolver constant points back at `.cx/`+`.construct/` by reverting one commit), but one-way in practice once consumers migrate: a project that has run `construct sync` under the consolidated layout has relocated its `.cx/` content into `.construct/`, and reverting would require the inverse migration. The transition-window dual-marker acceptance means a mixed fleet (some projects migrated, some not) is detected correctly throughout. Revisit only if the single-directory layout proves to conflict with a host convention that reserves `.construct/` for something else, which would need its own resolution.

## References

- ADR-0027 (host/project footprint — disposition table, marker-block injector, forward-fix/backward-repair migration framework, all reused here; `.construct/`-launcher vs `.cx/`-config split superseded)
- ADR-0066 (config-layer footprint — machine-scoped heavy-state split unchanged; project-local config dir name moves)
- Reference counts (this session, `grep -rln`): `.cx/` ~631 sites, project-root `.construct/` ~179 sites
- config-layer precedent: AGENTS.md, Claude Code skills/plugins model (single committed-text host footprint)
