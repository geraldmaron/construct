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
- `STRATEGY.md` carried forward from the predecessor with three amendments from adversarial review: workspace-scoped lessons by default (commitment 6), kernel-owned completion state with per-role capability tokens (commitment 14), and a self-monitoring commitment (16) as the direct countermeasure to the predecessor's undocumented strategic drift.

### Context
This repository supersedes `construct-legacy` (the v2 codebase, archived). See STRATEGY.md for the rebirth rationale and the full phase plan.
