# ADR-0096: State-root consolidation — three physical roots into a documented, minimal set

- **Date**: 2026-07-16
- **Status**: accepted
- **Deciders**: Gerald Dagher
- **Supersedes**: none
- **Resolves**: `construct-4uxq0.4.11` (ADR-K); depends on `construct-4uxq0.4.10` / ADR-0092 (single project-identity derivation); executed by `construct-4uxq0.14.3`

## Problem

Construct writes durable state to three physically distinct roots, each resolved through its own module, with no single document describing which data class belongs in which root. Two of the three roots were also keyed by independent notions of "which project is this" (truth matrix row 41), so a single logical project could fragment its own state across identities depending on which subsystem touched it.

## Decision

1. **Ratify three roots with explicit ownership** (no collapse):
   - **`~/.construct/projects/<key>/`** — machine-scoped per-project heavy state (traces, vector index, orchestration run filesystem store, source-watch cache, budget tracking). Owner: `lib/state-root.mjs`, keyed by the canonical `deriveProjectKey` from ADR-0092.
   - **`~/.local/state/construct/`** — XDG machine-scoped operational state (audit trail, solo-mode approval queues, doctor/embed runtime state, telemetry logs, hook scratch state). Owner: `lib/config/xdg.mjs`'s `doctorRoot()` / `stateDir()`.
   - **`<projectRoot>/.construct/`** — project-local config-layer and small runtime markers (context, workflow, intake, graph, team-mode approval queue). Owner: `lib/config-dir.mjs`'s `configPath()`.
2. **Unifying the `CX_HOME_OVERRIDE` axis and the `doctorRoot()`/XDG axis is deferred.** ADR-0084 rejected merging them inside a test-isolation fix; this ADR ratifies they remain two distinct roots with distinct override mechanisms.
3. **Identity derivation is owned by ADR-0092**, not this ADR. Root ownership above assumes one canonical `deriveProjectKey`; `construct-4uxq0.14.3` converged `orchestration/store.mjs` and `embed/daemon.mjs` onto it.
4. **`PROJECT_MARKERS`'s `.cx` entry stays** — intentional backward-detection per ADR-0074, not a defect to remove here.
5. **Filesystem migration tooling ships separately from this ADR.** `scripts/migrate-project-identity.mjs` (dry-run by default, `--apply` to copy) merges surviving path-hash buckets into the canonical remote-hash directory and flags homedir()-fallback buckets for manual review only. Source buckets are never deleted automatically.

## Consequences

- Positive: one ownership table for all three roots; ADR-0092 identity convergence and ADR-0096 root documentation unblock local-production-readiness work that depended on both (`construct-4uxq0.14.3`, `construct-36w10`).
- Negative / cost: postgres rows keyed by the pre-ADR-0092 cwd-based `projectKey` still require a separate database migration when using team/enterprise postgres mode.
- Live-code stale `~/.cx` path prose in `lib/`, `bin/`, `scripts/`, and `docs/guides/` was already corrected on this branch (construct-b0nny.13/.7); historical ADRs and research notes retain point-in-time references intentionally.

## Reversibility

Low for applied filesystem migration (copied data must be reconciled manually if reverted). The ADR itself and the dry-run tooling are high-reversibility.

## References

- `docs/decisions/adr/0092-single-project-identity-derivation.md` (ADR-J, accepted)
- `docs/decisions/adr/0084-test-isolation-hermetic-state-roots.md`
- `docs/decisions/adr/0074-single-project-directory-consolidation.md`
- `docs/guides/concepts/project-scopes.md` (ownership table for operators)
- `lib/state-root.mjs`, `lib/config/xdg.mjs`, `lib/config-dir.mjs`
- `scripts/audit-project-identity.mjs`, `scripts/migrate-project-identity.mjs`
- `construct-4uxq0.14.3`, `construct-36w10`
