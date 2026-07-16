# ADR-0093: State-root consolidation — three physical roots into a documented, minimal set

- **Date**: 2026-07-16
- **Status**: proposed
- **Deciders**: Gerald Dagher
- **Supersedes**: none
- **Resolves**: `construct-4uxq0.4.11` (ADR-K); depends on `construct-4uxq0.4.10` (ADR-J, single project-identity derivation); blocks `construct-4uxq0.14.3` (project-identity + state-root consolidation execution) and the "purge stale `~/.cx` comments" deletion-list item

## Problem

Construct writes durable state to three physically distinct roots, each resolved through its own module, with no single document describing which data class belongs in which root. A contributor adding a new persistent file has to reverse-engineer the convention from precedent rather than read a decision. Two of the three roots are also keyed by independent notions of "which project is this" (truth matrix row 41: `lib/state-root.mjs:95`'s `deriveProjectKey` — git-origin hash or path hash — versus `lib/orchestration/store.mjs:88`'s `projectKey` — config `deployment.projectName` or raw `cwd` — versus `lib/embed/daemon.mjs:111`'s `resolveRootDir` — `CX_DATA_DIR` override, or a `.construct/context.md` walk-up, or `homedir()` fallback), so a single logical project can fragment its own state across identities depending on which subsystem touched it.

## Context

**This ADR is sequenced after ADR-J (`construct-4uxq0.4.10`, single project-identity derivation) and depends on its outcome.** At the time of writing, `docs/decisions/adr/0092-single-project-identity-derivation.md` does not yet exist — a sibling agent is drafting it in parallel. This document proceeds on the bead's stated working assumption (identity must unify on one derivation before physical roots consolidate, or a root-consolidation migration keys data under the wrong identity) but **must be re-checked against ADR-0092's actual Decision section before ratification**: if ADR-J lands on a different derivation than `deriveProjectKey`, or defers unification, the target shape and migration plan below need re-validation against that outcome.

### What the truth matrix says (rows 41-42)

`docs/notes/research/2026-07-continuous-work-audit/truth-matrix.md`:

- **Row 41** (Project identity derivation): "Three independent, sometimes-divergent derivations (tracked `construct-36w10`, open P3)... A single logical project can appear as 2-3 different identities depending on subsystem." Status: contradicted.
- **Row 42** (Test isolation infrastructure): "`sterile-host-env.mjs`'s leak guard only fingerprints `audit-trail.jsonl`, never `approvals/queue.jsonl` — same defect class fixed for one sibling path, not extended to the other." Status: contradicted.

Row 42 is the defect `docs/decisions/adr/0084-test-isolation-hermetic-state-roots.md` fixes directly — extending the test-leak fingerprint to every real-state-file class `doctorRoot()` resolves. ADR-0084's own Rejected Alternatives section explicitly declines to solve the deeper problem and hands it here:

> "**Unify `doctorRoot()` onto the `CX_HOME_OVERRIDE` axis...** Rejected for this ADR: would merge two home-resolution axes... That is a larger architectural move than a test-isolation fix warrants, and the audit's own target architecture flags the broader state-root question as a separate, low-reversibility decision." (ADR-0084, Rejected alternatives)
> "Revisit alongside the state-root consolidation work the audit already flagged as a separate, lower-reversibility decision (ADR-K in the audit's numbering) rather than folding it into this P0." (ADR-0084, Rejected alternatives)

This ADR is that flagged, lower-reversibility decision. ADR-0084 fixed the *symptom* (the test guard's blind spot) without touching the *cause* (two independent home-resolution axes, one of which is honored by `CX_HOME_OVERRIDE` and one of which is not). This ADR addresses the cause, but confines itself to a **target-shape decision** — actual migration of real user data is out of scope here (see Decision).

### The three physical roots, verified

**1. `~/.construct/projects/<key>/` — machine-scoped per-project heavy state, via `lib/state-root.mjs`.**

Resolved by `resolveStateRoot`/`resolveStateDir`/`resolveStatePath` (`lib/state-root.mjs:120-147`), keyed by `deriveProjectKey` (`lib/state-root.mjs:95-100`): the normalized git origin remote when one exists, else a SHA-256 hash of the canonical (symlink-resolved) absolute project path. Anchored to `homeDir()` (`lib/paths.mjs`), which honors `CX_HOME_OVERRIDE` — this is the axis ADR-0084 confirmed `doctorRoot()` does **not** participate in. 21 files import from `state-root.mjs`. Verified data classes actually stored here by call site:

| Data | Call site |
|---|---|
| Source-watch repo cache + metadata | `lib/sources/repo-cache.mjs:76,80` |
| Source-watch cursor state | `lib/sources/watch.mjs:42` |
| Source staleness ledger | `lib/sources/staleness-ledger.mjs:18` |
| Budget tracking | `lib/resources/budget.mjs:63` |
| Telemetry traces | `lib/telemetry/client.mjs:56` |

Plus, per the module's own header (`lib/state-root.mjs:8-22`): the vector index (LanceDB) and task graphs. The module header also documents a second, non-project-keyed sub-scope, `~/.construct/runtime/` (`resolveSharedRuntimeDir`, `lib/state-root.mjs:156-161`), for machine-shared state whose cost scales with the binary, not the project (the docling venv).

**2. XDG state, `~/.local/state/construct/` — via `doctorRoot()` in `lib/config/xdg.mjs:55-59`.**

```js
export function doctorRoot(homeDir = os.homedir(), env = process.env) {
  const override = env.CONSTRUCT_DOCTOR_ROOT;
  if (typeof override === 'string' && override.trim()) return override;
  return stateDir(homeDir, env);
}
```

Honors `CONSTRUCT_DOCTOR_ROOT` and (via `stateDir`) `XDG_STATE_HOME` — never `CX_HOME_OVERRIDE`. The module header (`lib/config/xdg.mjs:18-20`) states this was a deliberate clean break from the legacy `~/.cx` telemetry/doctor fallback at the time of the XDG migration: "there is no legacy `~/.construct/*` read here. Existing installs re-run `construct install --footprint=user`." ADR-0084 §Context enumerates the real data classes at risk here from a grep of every production `doctorRoot()` caller (~90 call sites): audit trail, approval queues (`approvals/queue.jsonl`, `role-pending.jsonl`, `destructive-approvals.json`), Oracle state, embed-daemon runtime state, doctor watcher state, telemetry logs, cost/model tracking, hook runtime scratch state (the widest class by file count), session/status reporting, performance reviews, sandboxes, contract violations, orchestration readiness, scheduler logs, and setup/misc one-off logs. That table is not reproduced here in full — see ADR-0084 §Context for the complete class-to-call-site mapping, verified directly against the codebase in that ADR.

**3. Project-local `.construct/` — via `lib/config-dir.mjs`, resolved relative to the project root, not the home directory.**

`configPath(projectRoot, ...segments)` (`lib/config-dir.mjs:52-54`) resolves under `<projectRoot>/.construct/`. Per the module header (`lib/config-dir.mjs:3-19`), this root holds two dispositions in one directory: the config-layer surface a user may read or edit (`context.md`/`context.json`, `workflow.json`, custom `org/`, template overrides, small runtime markers) at the top level, and machine-regenerated launcher plumbing (`run.mjs`, `bootstrap.*`, `version`, `cache/`, `plugins/`) nested at `.construct/launcher/`. 101 call sites use `configPath()`; verified data classes include `context.md`/`context.json` (`lib/context-state.mjs:15,19`), `workflow.json`/observations (`lib/observation-store.mjs:64,109`), intake pending/processed/skipped/quarantine (truth-matrix row 34), handoffs (`lib/tracking-surfaces.mjs:186`), agent-log (`lib/artifact-reviewers.mjs:26`), degradation log (`lib/status.mjs:228`), and per truth-matrix row 20, team-mode's project-local approval queue (`.construct/` in team mode; XDG state in solo mode — the same logical data class splits across roots 2 and 3 depending on deployment mode).

### `PROJECT_MARKERS`'s legacy `.cx` entry — read and characterized, not assumed a bug

`lib/config-dir.mjs:42-44`:

```js
export const PROJECT_MARKERS = [CONFIG_DIR_NAME, '.construct', '.cx'].filter(
  (m, i, arr) => arr.indexOf(m) === i,
);
```

The comment immediately above it (`lib/config-dir.mjs:37-41`) states the intent directly: "Directory basenames that mark a Construct project root, in preference order. The transition window keeps both accepted so a not-yet-migrated project (still on the pre-consolidation layout) is still detected." ADR-0074 (`docs/decisions/adr/0074-single-project-directory-consolidation.md`) — the consolidation this references — confirms the same intent independently in its own Decision section: "During a transition window both `.cx/` and `.construct/` remain accepted project-root markers so a not-yet-migrated project is still detected" (ADR-0074 §Decision), and frames the migration as "a real move, not a clean-break flag: a project that already has live `.cx/` content... must not lose it." ADR-0074's Reversibility section adds: "The transition-window dual-marker acceptance means a mixed fleet (some projects migrated, some not) is detected correctly throughout."

**Conclusion: `PROJECT_MARKERS`'s `.cx` entry is intentional backward-detection, not a bug or an inconsistency with ADR-0074.** ADR-0074 never removed `.cx` recognition — it explicitly designed the transition window to keep recognizing it, precisely so `construct doctor` can find and migrate a still-unmigrated project rather than silently failing to detect it as a Construct project at all. The bead's framing ("still recognizes legacy `~/.cx` post the ADR-0074 XDG migration") conflates two different `.cx` concerns that this ADR's roots separate cleanly: `PROJECT_MARKERS`'s `.cx` is the **project-root config-layer marker** ADR-0074 consolidated (root 3, project-local, by design still detected), not the **global telemetry/doctor fallback root** `lib/config/xdg.mjs` clean-broke away from (root 2, machine-scoped, no legacy read). The bead's premise that these are the same stale reference does not hold under direct reading of both ADRs and both code sites; what *is* real is the volume of stale prose elsewhere describing `~/.cx` as if it were still live (next section).

### Stale `~/.cx` references — real count

`grep -rln "~/\.cx\b" lib/ docs/ --include="*.mjs" --include="*.md" | grep -v node_modules`:

- **83 files**, **148 matching lines**, split across `lib/` (comments/docstrings) and `docs/` (guides, runbooks, research notes, other ADRs).

Sampled directly: `lib/sandbox.mjs:18` ("lives under `~/.cx/sandboxes/<id>/`"), `lib/project-root.mjs:37` ("so `~/.cx/` doesn't make..."), `lib/host-disposition.mjs:18` ("`~/.cx/` — user-scope telemetry fallback"), `lib/config/xdg.mjs:50` ("formerly rooted at `~/.cx`") — the last of these is itself accurate history, not a stale claim of current behavior; several others describe `~/.cx` as a still-live path in header prose written before the XDG migration and never updated. This ADR does not attempt to classify each of the 148 lines individually — that classification (accurate-history comment vs. stale-as-if-live comment) is the deletion-list item this ADR blocks (see Consequences), not work performed here.

## Decision

1. **Ratify the three-root shape as the target architecture, each with a documented, singular data-class ownership**, rather than inventing a fourth root or collapsing to one:
   - **`~/.construct/projects/<key>/`** (machine-scoped, `CX_HOME_OVERRIDE`-aware, keyed by `deriveProjectKey`): heavy, regenerable-but-expensive per-project state whose cost scales with the project (vector index, task graphs, traces, source-watch cache, budget tracking). Owner: `lib/state-root.mjs`.
   - **`~/.local/state/construct/`** (machine-scoped, XDG-conformant, `CONSTRUCT_DOCTOR_ROOT`/`XDG_STATE_HOME`-aware): durable operational state that is either genuinely global (not project-specific — cost ledgers, model pricing cache) or project-adjacent but small (audit trail, approval queues in solo mode, Oracle state, doctor/embed runtime state, telemetry logs, hook scratch state). Owner: `lib/config/xdg.mjs`'s `doctorRoot()`/`stateDir()`.
   - **`<projectRoot>/.construct/`** (project-local, resolved relative to cwd, not home): the config-layer surface a user reads/edits (`context.md`, `workflow.json`, custom `org/`) plus small runtime markers and (team mode only) the project-local approval queue. Owner: `lib/config-dir.mjs`.
2. **Unify the `CX_HOME_OVERRIDE` axis and the `doctorRoot()`/XDG axis is explicitly deferred, not decided here** — this ADR ratifies that they remain two distinct roots with distinct override mechanisms (consistent with ADR-0084's rejection of unifying them inside a test-isolation fix), rather than merging root 1 and root 2. A future ADR may revisit merging them; this document does not propose it because no evidence gathered here shows the split itself is wrong, only that it is under-documented and its test-isolation blind spot (row 42) needed fixing independently (done, ADR-0084).
3. **Resolve the identity-derivation split (truth matrix row 41) as a precondition, owned by ADR-J** — this ADR's root-ownership table above is written in terms of "per-project" without re-deriving which of the three identity functions (`deriveProjectKey` / `projectKey` / `resolveRootDir`) is canonical. That is ADR-J's decision, not this one's; this ADR's target shape assumes ADR-J converges on a single derivation and that whichever root moves to depending on it is re-keyed consistently, not that any one of the three current derivations is presumptively correct.
4. **`PROJECT_MARKERS`'s `.cx` entry stays, unchanged** — it is intentional backward-detection per ADR-0074, not a defect this ADR needs to fix.
5. **No migration code is authorized by this ADR.** This document fixes the *target shape* and ownership table. Actual movement of real, existing user-machine state (relocating files, changing what `deriveProjectKey`/`doctorRoot`/`configPath` resolve to for a project that already has data under the old resolution) is real user-data migration with real data-loss risk if done wrong, and is explicitly deferred to `construct-4uxq0.14.3`, which is blocked on both this ADR and ADR-J. Classifying and purging the 148 stale `~/.cx` comment lines found above is also deferred, as a separate deletion-list item this ADR unblocks but does not perform.

## Rationale

The repo's own convention (per `CLAUDE.md`, "prefer clean breaks over back-compat for genuine consolidation") argues for collapsing to fewer roots where the data doesn't need per-project machine/XDG/project-local distinction. But every one of the three roots verified above is load-bearing for a real distinction that direct reading confirms: root 1 exists because the module header states heavy state must "survive upgrades and never pollute a repo" and is anchored to home regardless of toolkit install location (`lib/state-root.mjs:24-29`); root 2 exists because XDG conformance is itself the point (config/state/cache separated so each is independently backed-up/synced/pruned, per `lib/config/xdg.mjs:1-21`); root 3 exists because project-local, git-adjacent config a user commits and edits cannot live under the user's home directory at all. None of the three is redundant with either other one once you read what actually lives in each — the fix this ADR proposes is documentation and ownership clarity, not root collapse, which is why the Decision explicitly declines to invent a fourth root or merge the three into fewer.

Deferring actual migration to `construct-4uxq0.14.3` follows directly from the bead's own reversibility framing: "Reversibility: low (real user data migration)." A target-shape ADR with zero code change is reviewable and reversible; a migration that moves or re-keys real state on a developer's or user's machine is not something to authorize inside the same document that first proposes the target shape, especially while the shape still depends on an ADR (0092/ADR-J) that has not landed yet.

## Rejected alternatives

- **Collapse all three roots into one.** Rejected: direct reading of each root's actual contents (above) shows each serves a distinct, real constraint (upgrade-survival + no-repo-pollution for root 1; XDG conformance for root 2; git-adjacency + user-editability for root 3). Collapsing would either pollute a project repo with machine state or lose XDG conformance for state that has no reason to be project-scoped.
- **Unify `CX_HOME_OVERRIDE` and the XDG axis now, inside this ADR.** Rejected for the same reason ADR-0084 rejected it: merging two home-resolution axes with ~90+21 production call sites, several binding at module load time, is a materially larger and separately-reversible-rated change than a target-shape document should authorize in one pass. Left as a candidate future ADR.
- **Perform the migration now, in this ADR.** Rejected: the bead explicitly rates this low-reversibility (real user data), and the target shape itself is not yet safe to execute against — it depends on ADR-J's identity-derivation outcome, which had not landed at the time this document was drafted. Migrating against an unconfirmed target risks re-keying data twice.
- **Treat `PROJECT_MARKERS`'s `.cx` entry as a bug and remove it here.** Rejected after reading both `lib/config-dir.mjs:37-44` and ADR-0074's Decision/Reversibility sections directly: the entry is a documented, intentional transition-window detection mechanism, not drift. Removing it would break detection of any project that has not yet run the ADR-0074 migration.
- **Fold the stale `~/.cx` comment purge into this ADR's execution.** Rejected: this ADR is a decision document, not a cleanup pass; the 148-line, 83-file count found here is the input to a separately scoped deletion-list item (blocked by this ADR, not performed by it), consistent with how the bead frames "purge stale comments" as downstream work.

## Consequences

- Positive: the three roots now have one document describing what actually lives in each and why, closing the "reverse-engineer the convention from precedent" gap. `PROJECT_MARKERS`'s `.cx` entry is confirmed correct-as-is, closing that specific question without a code change. The real count of stale `~/.cx` prose (83 files / 148 lines) replaces the bead's unquantified "widespread" claim with a verifiable number.
- Negative / cost: no code changes ship from this ADR — the identity-fragmentation problem (row 41) and the stale-comment volume (148 lines) remain exactly as found until their respective downstream work lands. This ADR intentionally does not close either.
- Blocks: `construct-4uxq0.14.3` (project-identity + state-root consolidation execution) cannot proceed until this ADR is ratified *and* re-validated against ADR-0092's actual Decision section (per the sequencing note in Context). The "purge stale `~/.cx` comments" deletion-list item is blocked on this ADR's root-ownership table existing as the reference for classifying which of the 148 lines are genuinely stale versus accurate history.
- Follow-up: re-check this ADR's Context and Decision sections against `docs/decisions/adr/0092-single-project-identity-derivation.md` once it lands, before treating this ADR as ratified for execution purposes.

## Reversibility

Low, matching the bead's own rating — **but only for the migration this ADR explicitly defers, not for this document itself.** The ADR as written (target shape, ownership table, zero code change) is high-reversibility: reverting it is a doc change. The low-reversibility rating attaches to `construct-4uxq0.14.3`'s eventual execution — once real per-project state is physically relocated or re-keyed under a unified identity derivation, undoing that requires an inverse migration against live user-machine data, which is exactly the risk this ADR keeps out of scope. Ratification of this document is explicitly not authorization to run migration code; that requires separate, explicit user sign-off per the bead's "Owner: User" designation, at the point `construct-4uxq0.14.3` is actually implemented.

## References

- `docs/notes/research/2026-07-continuous-work-audit/truth-matrix.md`, rows 41-42
- `docs/decisions/adr/0084-test-isolation-hermetic-state-roots.md` (the sibling ADR that fixed row 42's symptom and explicitly deferred this root-consolidation question to "ADR-K in the audit's numbering")
- `docs/decisions/adr/0074-single-project-directory-consolidation.md` (the ADR that introduced `PROJECT_MARKERS`'s transition-window dual-marker design, confirmed here as still-intentional)
- `docs/decisions/adr/0092-single-project-identity-derivation.md` (ADR-J — did not exist at the time this document was drafted; re-check against its actual Decision before ratifying this ADR for execution)
- `lib/state-root.mjs:1-162` (root 1: `deriveProjectKey`, `resolveStateRoot`/`resolveStateDir`/`resolveStatePath`/`resolveSharedRuntimeDir`, read in full)
- `lib/config/xdg.mjs:1-65` (root 2: `doctorRoot()`/`stateDir()`, read in full)
- `lib/config-dir.mjs:1-75` (root 3 + `PROJECT_MARKERS`, read in full)
- `lib/orchestration/store.mjs:81-88` (`projectKey` — the second identity derivation truth-matrix row 41 flags)
- `lib/embed/daemon.mjs:104-117` (`resolveRootDir` — the third identity derivation truth-matrix row 41 flags)
- `construct-36w10` (open P3 bead tracking the identity-derivation fragmentation itself)
- `construct-4uxq0.4.11` (this ADR's own bead, ADR-K), `construct-4uxq0.4.10` (ADR-J, depended on), `construct-4uxq0.14.3` (blocked execution bead)
