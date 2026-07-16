# ADR-0092: Single project-identity derivation — git-origin-hash canonical, explicit config override

- **Date**: 2026-07-16
- **Status**: proposed
- **Deciders**: Gerald Dagher
- **Supersedes**: none
- **Resolves**: `construct-4uxq0.4.10` (ADR-J); promotes and formalizes the decision already tracked in the open bead `construct-36w10`

## Problem

Construct has three independent, sometimes-divergent answers to "which project is this," and no single one of them is authoritative:

- `lib/state-root.mjs:95` `deriveProjectKey(projectRoot)` — hashes the normalized git origin remote (`remote:<normalized-url>`), falling back to a hash of the canonical (symlink-resolved) absolute path when there is no remote.
- `lib/orchestration/store.mjs:88` `projectKey(config, cwd)` — `config?.deployment?.projectName || cwd || 'default'`.
- `lib/embed/daemon.mjs:111` `resolveRootDir(env, cwd)` — `CX_DATA_DIR` override, else walk up from `cwd` (capped at 10 levels, `PROJECT_WALKUP_MAX`) looking for a directory containing `.construct/context.md`, else `homedir()`.

`truth-matrix.md` row 41 (`docs/notes/research/2026-07-continuous-work-audit/truth-matrix.md:56`) records this as `contradicted`: "A single logical project can appear as 2-3 different identities depending on subsystem."

## Context

`lib/state-root.mjs`'s own module header already flags the divergence, in the exact language it uses today (lines 14-16):

> "derives 'which project is this' independently (config projectName or raw cwd) — the two can disagree for the same repo; tracked as construct-36w10, not fixed here (unifying them changes existing users' state at both sites)."

Reading the three functions directly confirms the shapes:

- `deriveProjectKey` (`lib/state-root.mjs:95-100`): `remote ? sha256('remote:' + normalizeRemote(remote)) : sha256('path:' + canonicalPath(projectRoot))`, truncated to 24 hex chars. `readOriginRemote` shells out to `git remote get-url origin` with `cwd: projectRoot` — since git itself walks up from any subdirectory to find `.git`, this derivation is already both clone-stable (same remote → same key regardless of local checkout path) and subdirectory-stable (same key regardless of how deep in the tree the caller's cwd is), whenever a remote exists.
- `projectKey` (`lib/orchestration/store.mjs:88-90`): `config?.deployment?.projectName || cwd || 'default'` — an explicit config field if set, otherwise the literal, unhashed, un-canonicalized `cwd` string. No fallback to git identity at all.
- `resolveRootDir` (`lib/embed/daemon.mjs:111-117`): `CX_DATA_DIR` env override, else the nearest ancestor of `cwd` (up to 10 levels via `findProjectRoot`, `lib/embed/daemon.mjs:89-101`) containing `.construct/context.md`, else `os.homedir()`. This resolves a *directory*, not a key; that directory is then fed into `resolveStatePath` (`lib/state-root.mjs:142`), which calls `deriveProjectKey` on it — so daemon.mjs is a second, independent path *into* the same hashing logic, using a differently-computed root.

**Concrete divergence, confirmed by code reading, not asserted:**

Take one real repository with a git remote, cloned to two local paths — a common pattern (a working checkout plus a backup or a second machine), e.g. `/Users/alice/work/myproj` and `/Users/alice/backup/myproj-clone`. Assume `config.deployment.projectName` is unset, which is the default for any project that hasn't opted into it.

- `deriveProjectKey` on either path: `git remote get-url origin` returns the same URL from both clones → same `remote:...` hash → **same key**. Traces, observations, and the vector index (everything under `resolveStateRoot`/`resolveStateDir`, e.g. `lib/orchestration/run-store.mjs:27`'s `resolveStateDir(cwd, 'runtime', 'orchestration')`, called with the *raw* `cwd`) land in the same `~/.construct/projects/<hash>/` directory for both clones.
- `projectKey` on either path: `cwd` is the literal path string, `/Users/alice/work/myproj` vs. `/Users/alice/backup/myproj-clone` — **different keys**. Anything scoped by `projectKey` (postgres project-column scoping in `lib/orchestration/runtime.mjs:161`, and `lib/status.mjs:368`'s status lookups) treats the two clones as two unrelated projects.

Same repository, same remote, same logical project — one subsystem merges its state, the other fragments it. This is exactly the scenario `construct-36w10`'s own description states, and it is reproducible with nothing more exotic than `git clone` twice.

A second, independent divergence trigger involves `daemon.mjs`'s walk-up: if `cwd` has no `.construct/context.md` within 10 ancestor levels (a project that hasn't run `construct init` yet, or is nested deeper than the cap in a large monorepo) and `CX_DATA_DIR` is unset, `resolveRootDir` falls back to `homedir()`. Every such invocation, for *any* project in that state, collapses onto the same home-directory-derived key — a coarser and riskier collision than `deriveProjectKey`'s own no-remote fallback (which at least hashes the specific project path, not a shared home directory). This is a narrower, edge-case trigger than the clone scenario above, but it is a real third axis of divergence, not merely a naming difference.

**`construct-36w10`** (`bd show`, read-only, current state): open, P2 (audit-promoted from P3 on 2026-07-16), owned by Gerald Dagher. Its description matches the divergence above verbatim ("Same repo cloned to two paths shares traces/observations/vector index (same deriveProjectKey) but gets separate orchestration-run histories (different cwd), and vice versa"). Its notes record: "AUDIT (2026-07-16, construct-4uxq0): promoted P3->P2. This bead gates ADR-J (single project-identity derivation) and ADR-K (state-root consolidation), both required before E6 (local-production-readiness epic) can proceed." This ADR is the promotion referenced there; `construct-4uxq0.14.3` ("Project-identity + state-root consolidation execution") is recorded as the bead that "absorbs and closes construct-36w10" once ADR-J and ADR-K both land.

## Decision

1. **Canonicalize on `deriveProjectKey`'s existing algorithm** (`lib/state-root.mjs:95-100`): normalized git-origin-remote hash when a remote exists, else a hash of the canonical (symlink-resolved) absolute project path. This becomes the one authoritative "which project is this" function; `lib/orchestration/store.mjs`'s `projectKey` and `lib/embed/daemon.mjs`'s walk-up-then-derive path are execution-work targets (`construct-4uxq0.14.3`) to converge onto it, not alternatives that continue to coexist.
2. **Add an explicit override, not a bare either/or.** A new config field — `deployment.projectKey` (distinct from the existing display-oriented `deployment.projectName`, which `store.mjs` currently misuses as an identity input) — when set, wins over the computed derivation. This follows the same override-wins-over-computed-default shape the codebase already uses for `CONSTRUCT_DOCTOR_ROOT` (`lib/config/xdg.mjs:55-56`, overriding `doctorRoot()`'s computed default).
3. **The override exists to cover cases the automatic hash cannot express**, not to replace it as the default: a monorepo where multiple logical sub-projects share one git remote but need separate state buckets; a fork or mirror that should not inherit the origin's accumulated history; a remote-URL migration (renamed org, hosting move) where an operator wants to preserve continuity with the old key instead of silently starting a new, empty `~/.construct/projects/<key>/`.
4. **This ADR decides the derivation, not the migration mechanics.** A real migration is required before any code changes the live key for existing installs (see Reversibility). That migration is scoped to `construct-4uxq0.14.3` (ADR-K's execution bead), not implemented here.

## Rationale

Git-origin-hash is the only one of the three existing derivations that is already both clone-stable and subdirectory-stable *by construction* — it inherits git's own upward `.git` discovery rather than reimplementing a weaker version of it (contrast `daemon.mjs`'s independent, capped, `.construct/context.md`-based walk-up, which has its own failure mode: `homedir()` fallback collapsing unrelated projects together). Canonicalizing on it is the smallest change that fixes the actual bug: today `state-root.mjs` already gets this right; `store.mjs` and `daemon.mjs` are the two call sites that need to converge, not three sites that all need new logic.

A config-field-only design (the bead's option 2) was seriously considered, but rejected as the *sole* mechanism: it would invert day-one behavior for every existing project from "works automatically because a git remote exists" to "requires an explicit value or silently falls back to something" — and that fallback, to remain useful for the common no-config case, would have to be the computed hash anyway, which makes "config-only" not actually a distinct third option once it's forced to have a sane default. The override is worth adding on top of the computed default specifically because real, non-hypothetical cases (monorepo sub-projects, forks, remote migrations) cannot be expressed by a hash of the remote URL alone, and the codebase already has precedent (`CONSTRUCT_DOCTOR_ROOT`) for exactly this override-over-default shape. This is judged additive, not over-engineering: it is one config field with one precedence rule, not a new subsystem.

## Rejected alternatives

- **Canonicalize on git-origin-hash only, no override (the bead's option 1 as literally stated).** Rejected as insufficiently expressive: it has no answer for monorepo sub-projects sharing one remote, forks that should be treated as distinct projects, or an operator who needs to preserve a key across a remote URL migration. The no-remote path-hash fallback already in `deriveProjectKey` covers local-only projects, so that specific gap is not real — but the other three are.
- **Canonicalize on an explicit config field only (the bead's option 2).** Rejected as primary: it requires every project — including every project that works correctly today with zero configuration — to take on a new required setup step, or else fall back to *something*, and that something has to be the computed hash to avoid a regression, which collapses this option into the hybrid anyway.
- **Canonicalize on `daemon.mjs`'s directory walk-up.** Rejected: its `PROJECT_WALKUP_MAX = 10` cap and `homedir()` fallback are strictly less reliable than git's own upward `.git`-directory discovery that `deriveProjectKey` already benefits from via `git remote get-url origin`, and the `homedir()` fallback actively risks collapsing distinct, unrelated local-only projects into one shared bucket.
- **Leave all three as-is and only document the divergence more thoroughly.** Rejected: the module header in `lib/state-root.mjs` already documents it (lines 14-16, quoted above) and that has not stopped the fragmentation from being live in production data today; `construct-36w10` has been open since 2026-07-11 without a resolution path. Documentation without a canonical decision does not unblock ADR-K or `construct-4uxq0.14.3`.

## Consequences

- Positive: one authoritative "which project is this" function; the common zero-config case (a git remote exists) keeps working exactly as it does today via `deriveProjectKey`; the documented edge cases (monorepo sub-projects, forks, remote migrations) get a real escape hatch instead of silently mis-keying; unblocks `construct-4uxq0.4.11` (ADR-K, state-root consolidation, which explicitly depends on identity being unified first per its own bead text: "identity must be unified first or the consolidation migrates the wrong keys") and `construct-4uxq0.14.3`; resolves the design question `construct-36w10` has tracked as open since 2026-07-11.
- Negative / cost: `store.mjs` and `daemon.mjs` both need code changes to converge on `deriveProjectKey` (or the new override field) instead of their current logic — that is real implementation work, scoped to `construct-4uxq0.14.3`, not done by this ADR. A new config field (`deployment.projectKey`) adds one more piece of documented surface area, and risks confusion with the existing `deployment.projectName` unless the distinction (identity key vs. display name) is documented at the point of introduction.
- **Migration is required, not optional, and is the dominant cost here.** Existing `~/.construct/projects/<key>/` directories on every current install are keyed by whichever derivation is live at each call site today — for filesystem-backed state (traces, observations, the vector index, orchestration run history under `lib/orchestration/run-store.mjs`) that's already mostly `deriveProjectKey`'s git-hash/path-hash today, but `store.mjs`'s `cwd`-keyed postgres project scoping and `daemon.mjs`'s walk-up-or-homedir-derived state are not, and changing the derivation those sites use without a migration would orphan or silently fragment further whatever data already lives under their current keys. At a minimum, the migration this ADR requires (design only — not implemented here) needs to:
  1. Inventory existing `~/.construct/projects/<key>/` directories and any postgres rows scoped by `store.mjs`'s current `projectKey`, and reconstruct, per key, which real project (git remote, or local path) it belongs to.
  2. Compute each project's new canonical key under this ADR's rule (git-origin-hash, or path-hash if no remote, or the explicit override if the project sets one).
  3. Where an old key already equals the new canonical key (true today for most `deriveProjectKey`-backed state), no data movement is needed.
  4. Where an old key differs from the new canonical key (the `store.mjs`/`daemon.mjs` cases), move or merge that data into the canonical directory/scope — merge, not overwrite, when two old buckets map to the same new key (e.g. two clones whose `store.mjs`-keyed run histories were previously separate must union, not clobber one another).
  5. Flag ambiguous cases for manual review rather than merging automatically — in particular any `daemon.mjs` `homedir()`-fallback bucket, which may already mix state from multiple unrelated local-only projects and cannot be safely disaggregated by this migration alone.
  6. Run in a dry-run/report mode first, and preserve old directories until the operator confirms the migration, given the low reversibility below.

  This migration design is `construct-4uxq0.14.3`'s job to implement; this ADR only establishes that it must exist and roughly what it must do before the derivation change ships.

## Reversibility

Low, once the migration in Consequences executes. Before migration, this ADR is a pure paper decision (no code changes) and fully reversible. After migration moves or merges data under the new canonical keys, reverting the derivation would require re-deriving and re-splitting merged state — information that may not be fully recoverable if two old buckets were merged (the union cannot be losslessly un-merged back into "which record came from which original key"). Any implementation of this ADR should treat the pre-migration `~/.construct/projects/<old-key>/` directories as a rollback point and avoid deleting them until the new canonical layout is confirmed correct.

## References

- `docs/notes/research/2026-07-continuous-work-audit/truth-matrix.md:56` (row 41, "Project identity derivation" — `contradicted`)
- `lib/state-root.mjs:14-16` (module header documenting the divergence risk), `lib/state-root.mjs:95-100` (`deriveProjectKey`)
- `lib/orchestration/store.mjs:84-90` (`projectKey`, and its own header noting the divergence)
- `lib/embed/daemon.mjs:89-117` (`findProjectRoot`, `resolveRootDir`)
- `lib/config/xdg.mjs:55-56` (`CONSTRUCT_DOCTOR_ROOT`, precedent for override-over-computed-default)
- `bd show construct-36w10` (the bead this ADR promotes; P2, open, gates ADR-K and `construct-4uxq0.14.3`)
- `construct-4uxq0.4.11` (ADR-K, state-root consolidation — depends on this ADR)
- `construct-4uxq0.14.3` (execution bead — absorbs and closes `construct-36w10` once ADR-J and ADR-K land)
