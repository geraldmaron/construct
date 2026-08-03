# Changelog

## Unreleased

### Added
- Repository bootstrap: TypeScript (erasable-syntax-only) source tree, `node --test` suite running natively via type-stripping, no build step required for development.
- `kernel/paths` — the sole module permitted to read environment or home directory; every other module receives an injected `Paths`.
- `kernel/verify/claims` — tier-1 deterministic no-fabrication check (load-bearing claims must carry a citation or an explicit `[unverified]` tag).
- Sterile test fixture builder (`tests/harness/sterile.ts`) rooting every filesystem-touching test in a real tmpdir.
- Parity lints: no committed absolute paths (`scripts/lint-no-absolute-paths.mjs`), glossary discipline against `GLOSSARY.md` (`scripts/lint-glossary-parity.mjs`).
- Packaged-install smoke test (`scripts/smoke-packaged-install.sh`): build, pack, install into a scratch project, run the CLI — the consumer experience, tested before any consumer exists.
- CI: test + lint + typecheck, a read-only-`HOME` sterile run, and the packaged-install smoke, as three separate jobs.
- `construct doctor` and `construct version` — the first two CLI commands.
- `construct cleanup` — detects and removes predecessor (v2) traces on a project checkout and a user's machine: the `.construct/launcher/` directory, manifested `.claude/agents/`+`.claude/commands/` files, Construct-managed keys in `.claude/settings.json`/`.mcp.json`, the `.construct/` state dir and scaffold files (`AGENTS.md`, `plan.md`), a Construct-set `core.hooksPath`, the XDG state/data/cache dirs, `config.env`, the lib symlink, the local Postgres compose file, and memory-MCP registrations in Claude/OpenCode/Codex configs. `--dry-run`, `--yes`/`--yes --all` (auto- vs ask-risk), `--scope=project|machine|all`, `--keep-state`. Ported from construct-legacy's `lib/uninstall/uninstall.mjs`; Docker container/image removal and the macOS LaunchAgent unload are not yet ported (tracked as a follow-up, not silently dropped).
- `kernel/store` — the SQLite storage substrate (via built-in `node:sqlite`, adding no dependency), serving all three Phase 2 consumers from one shape: the tracker projection mirror, the append-only work log, and the decision inbox. Append-only is enforced by database triggers rather than by caller discipline (commitments 14 and 15); a store written by a newer schema is refused rather than silently used; timestamps and paths are injected, so the substrate reads neither the clock nor the environment.
- `kernel/tracker/reconcile` — the predecessor's reconciliation ported on top of that substrate, made clock-free (v2 defaulted `reconciledAt` to `new Date()`). The field-authority rule is now enforced through real persisted state: a tracker-owned change is absorbed into the snapshot, a domain-owned change is reported as drift and never clobbered, and an issue deleted from the tracker marks its projection drifted without deleting domain work.
- `STRATEGY.md` carried forward from the predecessor with three amendments from adversarial review: workspace-scoped lessons by default (commitment 6), kernel-owned completion state with per-role capability tokens (commitment 14), and a self-monitoring commitment (16) as the direct countermeasure to the predecessor's undocumented strategic drift.

### Context
This repository supersedes `construct-legacy` (the v2 codebase, archived). See STRATEGY.md for the rebirth rationale and the full phase plan.
