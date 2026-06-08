---
intake: none
intake_rationale: contract decision recorded from empirical isolation testing (two greenfield runs at /tmp/cx-iso-test on 2026-06-04, results in session transcript) and the work plan at ~/.claude/plans/when-contrite-he-knits-wondrous-pumpkin.md; tracked as bd epic construct-jsut.
last_verified_at: 2026-06-04
verified_by: construct · isolated install/init run with HOME override + full diff against pre-flight snapshot
---

# ADR 0027: Host project footprint & non-destructive scaffolding

**Date:** 2026-06-04
**Status:** Accepted
**Deciders:** Construct·Architect
**Supersedes:** none
**Extends:** [ADR 0013](0013-skills-on-disk-layout.md) (skills on-disk layout — clarifies the dual-target claim against current code), [ADR 0025](0025-explicit-activation-model.md) (explicit activation — extends the "good citizen" doctrine from activation into scaffolding).

---

## Problem

A user should be able to `construct init` in any project — fresh or established — and know exactly what was installed, what is correctly tracked, what is correctly ignored, what was preserved, and how to undo it. Empirical isolation testing (2026-06-04, two runs under a throwaway `HOME` and project dir at `/tmp/cx-iso-test`) showed that this is not currently true:

1. The host `.gitignore` written by `construct init` (`lib/init-unified.mjs` ~L958-978) ignores only `.cx/`, leaving six adapter directories — `.claude/`, `.codex/`, `.cursor/`, `.vscode/`, `.opencode/`, `.github/` — to be committed. Construct's own repo `.gitignore` ignores all six as machine-specific generated output. The host setup contradicts the upstream stance.
2. `construct init` invokes `bd init` (`lib/init-unified.mjs:1029-1043`), which produces a 13-file / 1,145-insertion commit on the user's repo without consent. The commit is referentially broken: `.claude/settings.json` is committed but the `.claude/agents/`, `.claude/commands/`, `.claude/skills/` it references are left untracked.
3. `construct install` is documented as machine-scoped but writes to `process.cwd()` — the first test run rebuilt `lib/server/static/index.html` in the real repo and dropped `.cx/project-profile.json` there.
4. `construct.config.json` (the central project config, loader at `lib/config/project-config.mjs`) is never scaffolded by init, so the configuration surface is invisible.
5. `AGENTS.md` and `CLAUDE.md` are scaffolded via `writeStampedIfMissing` (`lib/init-unified.mjs:858-866`) — skip-if-exists, but with no mechanism to add or update Construct-specific guidance idempotently in a file the user owns.
6. `docs/concepts/knowledge-layout.md:18` claims `.cx/knowledge/` is "version-controlled," while `README.md:106` says `.cx/` "must never be committed." Empirically, `.cx/` is fully gitignored and `.cx/knowledge/` does not even exist at init time.
7. `construct uninstall` (`lib/uninstall/uninstall.mjs`) leaves the `dev.construct.pressure-release` LaunchAgent registered, leaves `git config core.hooksPath` set, and leaves the `pgvector/pgvector:pg16` docker image.
8. `construct sync` historically wrote SKILL.md files to `~/.agents/skills/` per [ADR 0013](0013-skills-on-disk-layout.md); current code targets only `<project>/.claude/skills/`, but the older files at `~/.agents/skills/` remain on disk with stale doc-stamp-only frontmatter, causing 141 startup warnings in Codex (`missing field 'description'`) on every session — verified by direct inspection.
9. MCP entries Construct registers (e.g. `github` at `~/.codex/config.toml:63` and `~/.config/opencode/opencode.json:431`) are not reconciled when their referenced env vars become unresolvable; Codex emits "MCP startup failed: Environment variable `GITHUB_TOKEN` for MCP server 'github' is not set" every session.

The pattern is consistent: the existing design treats the install/init/sync surface as fix-forward only — each new version writes what it now considers correct, but never reconciles what prior versions wrote and never asks before mutating files the user owns. The decision-forcing tension is whether to leave this fragmented or codify a single contract for the entire host footprint.

## Context

- Construct embeds into projects that already have history, conventions, `.gitignore`s, agent-instruction files, and CI directories. It runs in a real git repo, on a developer machine, alongside other tools.
- Construct's own repo `.gitignore` is the de facto specification of what's machine-specific vs durable: it ignores `.claude/`, `.codex/`, `.cursor/`, `.vscode/`, `.opencode/`, `.github/prompts/`, `.github/copilot-instructions.md`, `plan.md`, `config.env`, `embed.yaml`, `.cx/`. The host-side `.gitignore` Construct generates today is a strict subset.
- The existing Beads integration in `lib/beads-automation.mjs` already implements a marker-block pattern (`<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:XXXX -->`) for non-destructive injection into `CLAUDE.md`. It is the only place this pattern lives; AGENTS.md uses `writeStampedIfMissing` which can't update.
- The uninstall surface (`lib/uninstall/uninstall.mjs`) already uses `.construct-manifest` files to surgically remove only files Construct authored, preserving user additions. The same manifest model is the natural foundation for sync-time reconciliation.
- The empirical test under HOME override confirmed: `os.homedir()` honors `$HOME`, so machine-state writes can be fully isolated for testing. Two resources do not isolate (the `dev.construct.pressure-release` LaunchAgent label is global per user; the `construct-postgres`:54329 container name/port are hardcoded) — but these are out of scope for the disposition contract itself.

## Decision

Construct's host-project footprint is governed by a single contract with four parts:

**1. Disposition is explicit and enumerated.** Every artifact Construct creates in a host project carries a documented intended disposition — `tracked`, `ignored`, or `asked-before-modify` — recorded in `.construct-manifest`. The generated host `.gitignore` mirrors `ignored` artifacts 1:1 with Construct's own repo `.gitignore`. No artifact has an implicit disposition.

**2. Mutation of files Construct does not own is marker-managed.** Any file authored by the user (`AGENTS.md`, `CLAUDE.md`, `README.md`, `.gitignore`, `construct.config.json`, `.github/*`) is mutated exclusively through versioned, hash-stamped marker blocks of the form `<!-- BEGIN CONSTRUCT INTEGRATION v:N hash:XXXX --> … <!-- END CONSTRUCT INTEGRATION -->`. The injector preserves byte-for-byte everything outside its markers, deduplicates against sibling marker blocks (e.g. the Beads block), and is idempotent: same hash = no-op, different hash = replace block content only. Init creates files only when missing; sync updates only the marker block.

**3. The install / init / sync boundary is strict.** `construct install` writes only machine state (`~/.construct/`, `~/.claude/` front-door, LaunchAgent registration). It never reads or writes `process.cwd()`. `construct init` writes project state into the given target directory, exactly once per file (skip-if-exists for user-editable scaffolds; idempotent inject-or-update for marker-managed files). `construct sync` reconciles project adapters and prunes orphans. None of the three invokes `git commit` on the host repo without an explicit `--commit-bootstrap` opt-in.

**4. Forward-fix AND backward-repair.** Every change to what Construct installs ships with a migration that repairs state left by prior versions. The repair runs automatically on `construct sync` where it is safe (cleaning stale machine-scope state, reconciling orphan MCP entries, pruning unused adapter dirs, extending the host `.gitignore`). Where automatic repair would touch user data or commit history, `construct doctor` surfaces the drift with a precise one-line remediation command, and `construct migrate <id>` runs the destructive repair only on explicit consent. Migrations are stamped to `~/.construct/migrations.json` so subsequent syncs no-op.

The contract is implemented across the 12 work items tracked under epic `construct-jsut` (children `construct-jlql`, `construct-dhfz`, `construct-e13x`, `construct-81dk`, `construct-7e2o`, `construct-4xy6`, `construct-6xo0`, `construct-73su`, `construct-lb7b`, `construct-r9u3`, `construct-n6h7`, `construct-w9pp`). The migration framework (`construct-w9pp`) lands first; every other item's repair plugs into it.

## Rationale

The current behavior is not the result of intent — it is the cumulative residue of features added one at a time without a contract. Skip-if-exists protects user files in some places but auto-commit overrides them in others; the `.gitignore` writer guards `.cx/` but forgets the six adapter directories; sync changes its target paths between versions but leaves the old paths populated. Each piece behaves reasonably in isolation; the combination breaks the citizenship promise.

A single contract resolves this by making three things first-class: the disposition table (so `.gitignore` generation, `uninstall` coverage, and adapter pruning all read from the same source of truth), the marker-block injector (so updates to agent-instruction files are safe by construction), and the migration framework (so a user upgrading from any prior Construct version can self-heal via one `construct sync`).

The marker-block pattern was chosen over the alternatives below because it preserves the property the user explicitly asked for: Construct can drop in the minimum guidance an agent needs to work seamlessly with `.cx/`, intake, specialists, and beads — without overwriting user content, without duplicating content already present from a sibling integration, and with a versioning model that lets the guidance evolve.

The migration framework was chosen over per-item ad-hoc repair because the same repair shapes (orphan-config reconcile, stale-dir cleanup, gitignore extension, manifest-driven prune) recur across items 1, 5, 6, 10, 11. Folding them into a registry with `detect()` / `apply()` / `safety` gives one auditable list, one place to stamp success, and one user-facing surface (`construct migrate list` / `construct doctor`).

## Rejected alternatives

- **Skip-if-exists everywhere.** The current default for AGENTS.md / CLAUDE.md. Preserves user content but cannot deliver updated guidance — once the file exists, Construct goes silent. Forces users to manually copy in new Beads commands, new `.cx/` paths, new specialist references whenever Construct evolves. Rejected because it makes the guidance surface useless after first init.
- **Rewrite files freely (overwrite mode).** Maximally simple for Construct; user edits are lost. Already used for `.claude/settings.json` (which the test showed produces inconsistent partial state in git when bd-init then sweeps it up). Rejected because it violates the user's explicit constraint: never overwrite content the user may already have.
- **Ship a one-off cleanup script with each release.** Solves backward-repair without the framework. Each release would carry a `scripts/migrate-vN.sh` users run manually. Rejected because users don't run release-note scripts, the scripts diverge from current code over time, and `construct doctor` already exists as the natural surface for surfacing drift.
- **Treat `~/.agents/skills/` and `~/.cx/` as opaque machine state that the user manages.** Avoids the migration cost. Rejected because the empirical evidence is that prior-version Construct populated those paths and current-version Construct cannot reconcile them — telling the user "run `rm -rf` to fix our warnings" is the antithesis of seamless integration.
- **Defer `.gitignore` and adapter-dir disposition to per-user configuration.** Each user picks whether to commit adapters. Rejected because the empirical test showed adapter content carries machine-specific paths (MCP server absolute paths, env-resolved tokens) that should never be committed regardless of preference — disposition is a property of the artifact, not a user choice.

## Consequences

- `construct init` on a fresh repo produces a clean `git status` (zero untracked Construct-generated files) and zero unsolicited commits. On an established repo it preserves pre-existing `CLAUDE.md` / `AGENTS.md` / `README.md` / `.gitignore` byte-for-byte outside the marker blocks.
- `construct sync` becomes the single self-healing entry point: extends the host `.gitignore`, prunes orphan adapter dirs, reconciles MCP entries, cleans up legacy `~/.agents/skills/`, and surfaces a one-line summary of what changed. Idempotent on a fully reconciled machine.
- `construct doctor` gains a "drift" category surfacing every detected legacy condition with its precise `construct migrate <id>` or `git rm --cached` remediation. Already-committed adapter files (from the legacy bd-init commit) are reported but never auto-removed.
- `construct uninstall` covers the LaunchAgent and `core.hooksPath` reversal that the empirical test had to do manually. Docker images stay (other projects may share them) unless `--with-images`.
- Updates to Construct's host-side guidance — new specialist hints, new `.cx/` paths, new commands — flow into existing host files via marker-block hash bumps. User content above and below the block is preserved by construction; tests under `tests/functional/agent-instructions-injection.functional.test.mjs` (new) assert this.
- [ADR 0013](0013-skills-on-disk-layout.md)'s dual-target claim is reconciled with code: either reinstate the `~/.agents/skills/` write (with correct frontmatter from the current helper) or formally retract the dual target and remove the legacy directory via migration. The decision is recorded in `construct-r9u3` and the ADR will be amended once that decision lands.
- A user upgrading from any prior Construct version can run `construct sync` once and reach a clean state. No release-note script, no manual cleanup, no stale warnings on next session.
- The doctrine extends from the project footprint to the user's **global** OpenCode config (`~/.config/opencode/opencode.json`): the ownership boundary — which keys Construct manages versus which belong to the user, and the non-destructive merge rules — is documented in [docs/concepts/opencode-config-ownership.md](../concepts/opencode-config-ownership.md). The github-MCP token reconciliation named in problem #9 lands as an env-ref (`Bearer {env:GITHUB_TOKEN}`) emitted by `syncOpencode`.

## Implementation tracking

Plan: `~/.claude/plans/when-contrite-he-knits-wondrous-pumpkin.md`. Epic: `construct-jsut`. Migration framework: `construct-w9pp` (lands first). All work items carry a "Repair (prior versions)" section that names the migration plug-in.

### §2 conformance note (construct-83ik)

The marker-block injector (`lib/agent-instructions/inject.mjs`) satisfied §2 for new guidance, but `construct init` still pre-wrote a full operating-doctrine body into `AGENTS.md` (via `buildAgentsGuide`) *outside* any marker — so a host repo carried un-fenced Construct content §2 forbids, and the same doctrine leaked into `docs/README.md`, the greenfield `README.md`, and a root-level `construct_guide.md`. The pre-write is removed: `bd init` creates the project skeleton and `injectIntoAgentFile` adds the fenced block as the sole Construct-owned region of `AGENTS.md`/`CLAUDE.md` (symmetric handling). `construct_guide.md` moves to the ignored `.cx/` tree; `docs/README.md` is lane-accurate and tool-command-free; `inbox/` is ignored via `host-disposition.mjs`. Backward-repair for repos written by the non-conformant path: reconcile tasks `legacy-doctrine-strip` and `legacy-guide-decommit` (both `ask`), surfaced by `construct doctor`.
