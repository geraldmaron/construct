<!--
CONTRIBUTING.md. Contributor guide for the Construct repository.

Start here if you are contributing code, docs, or agent definitions.
The authoritative source for AI-session rules is CLAUDE.md.
-->

# Contributing to Construct

Construct is an open source project I started to learn. Contributions are welcome. The notes below cover how the repo wants to be touched.

## Before you start

Read [CLAUDE.md](CLAUDE.md). It lists the protected files, the critical rules, and the exact commands to run after structural changes. Deviating from those rules without understanding the cascade is the fastest way to break every downstream platform config.

## Required tools

The toolchain is pinned in [`.tool-versions`](.tool-versions) — the single source of truth read by `mise`, `asdf`, and CI (`actions/setup-node` via `node-version-file`). Install [mise](https://mise.jdx.dev) (or asdf) and let it provision the pinned Node and Terraform:

```bash
mise install        # installs Node + Terraform pinned in .tool-versions
corepack enable      # activates the npm pinned by package.json "packageManager"
npm ci               # deterministic install from the committed lockfile
```

- **Node**: pinned in `.tool-versions`; the published CLI supports Node `>=20` (`engines`), and CI tests against Node 20 and 22.
- **npm**: pinned via `package.json` `packageManager` (Corepack); `npm ci` for reproducible installs.
- **Terraform**: pinned in `.tool-versions` for the deploy modules under `deploy/terraform/`.

Without mise/asdf, install Node matching `.tool-versions` manually and run `npm ci`.

### npm `devdir` warning (Cursor / npm 11.2+)

If every `npm run` prints `npm warn Unknown env config "devdir"`, the cause is usually **Cursor sandbox** injecting `npm_config_devdir` for node-gyp cache routing — not a Construct repo setting. npm 11.2+ warns on unknown `npm_config_*` keys before your script runs.

**Silence it in your shell:**

```bash
unset npm_config_devdir NPM_CONFIG_DEVDIR
```

Add that to `~/.zshrc` if the variable persists across Cursor sessions. Construct strips `devdir` from **nested** npm/npx spawns (`scripts/npm-run.mjs`, postinstall, upgrade); the outer `npm run` warning remains until you unset the variable. Prefer direct invocation when noisy: `node scripts/...`, `construct doctor`, or `npm test` (which runs `node scripts/run-tests.mjs` but still warns on the outer npm).

### Brand prose (marketing voice and naming)

`lib/hooks/brand-prose-lint.mjs` blocks edits to governed docs/templates that introduce marketing voice, retired fonts, or miscapitalized CLI references. Run `node scripts/audit/03d-brand.mjs` for a full-repo sweep. Refresh a stale `.cx/construct_guide.md` with `construct init:update` (proposal) or `construct init:update --apply-guide` (template replace with backup).

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/). A `.gitmessage` template is included. Wire it locally:

```bash
git config --local commit.template .gitmessage
```

Types: `feat` `fix` `refactor` `docs` `test` `chore` `perf` `ci`

## Before opening a PR

Run the full gate:

```bash
npm test
npm run test:functional
node ./bin/construct doctor
node ./bin/construct docs:verify
node ./bin/construct docs:update --check
node ./bin/construct lint:comments
npm run lint:js
npm run lint:scopes
npm run graph:gate
```

All nine must exit 0. The release pipeline in `docs/operations/maintenance/release-and-deploy.md` runs the same checks before any artifact ships. `graph:gate` (LMCP-C8) rebuilds the living workflow/capability graph and fails on strict-mode validate drift — a workflow with zero tests, a capability with a missing doc, a provider without a manifest, or a declared-but-unregistered surface.

### npm scripts wrap the gates; CI calls the scripts

Every gate has one implementation. The `package.json` script is a thin wrapper over `bin/construct` (or a single canonical script under `scripts/`), and CI invokes the script — not a second copy of the command. So `.github/workflows/*.yml` runs `npm run lint:comments`, `npm run doctor`, `npm run docs:update -- --check`, `npm run gates:audit`, `npm run evals -- retrieval`, and friends; the workflow never re-spells `node ./bin/construct <cmd>` for a gate. Flags pass through after `--` (`npm run docs:update -- --check`). `release:check` chains the same wrappers in one command. Add or change a gate in `package.json`, and CI picks it up without a parallel edit.

The few exceptions below are substrate-required and stay as `node ./bin/construct <cmd>` in `release:check`; they have no thin wrapper because `bin/construct` is the substrate (ADR-0039 — the CLI is the spine, every other surface is a thin client over it):

| Command | Where it runs | Why it has no npm wrapper |
|---|---|---|
| `registry:validate --unified` | `release:check` | Validates `specialists/org` invariants; called only in the release chain. |
| `registry:generate-docs --check` | `release:check` | Regenerates `docs/guides/reference/capabilities.md` from the registry; release-chain-only drift check. |
| `catalog:validate --check` | `release:check` | Validates living capability catalog edges on `registry/capabilities.json`; release-chain-only drift check. |
| `docs:sync --check` | `release:check` | Regenerates `docs/README.md` `AUTO:catalog-sync` from the capability catalog; release-chain-only drift check. |
| `certify gate` | `release:check` | Release-candidate certification gate; release-chain-only. |
| `review` | `pr-review.yml` | Construct-on-Construct PR reviewer; advisory (`|| true`), with a `command -v construct` fallback to the installed binary. |

`npm run test:functional` includes the **audit-phase ratchet** (`tests/functional/audit-ratchet.functional.test.mjs`): it regenerates the 01-smoke, 02-deadcode, 03-docs, 03b-naming, and 06-audit finders and fails on any finding absent from `scripts/audit/baseline.json` — a new dead module, undocumented flag, orphaned doc, retired-alias/handler-name drift, or a dereferenced audit hook. Fix the drift, or, if intentional, add the id to the baseline.

If your change touches a hook + observation, a profile + classifier, a CLI + durable state, or any other multi-component path, also add a functional test under `tests/functional/`. See `tests/functional/README.md` for the pattern. If `docs:update --check` fails, regenerate and commit:

```bash
node ./bin/construct docs:update
git add README.md docs/
git commit -m "docs: regenerate auto-managed regions"
```

If `lint:comments` flags missing file headers, fix them:

```bash
node ./bin/construct lint:comments --fix
# then hand-audit the stubs it inserted
```

## Protected files

Do not edit these without reading the constraints in CLAUDE.md first:

| File | Why |
|---|---|
| `specialists/org` | Source of truth for all agents on all platforms |
| `scripts/sync-specialists.mjs` | Regenerates every platform config |
| `lib/hooks/*.mjs` | Run in every Claude Code session |
| `platforms/claude/settings.template.json` | Controls all Claude Code hook config |

## Branches

All work happens on a feature branch. Never commit directly to `main`.

```bash
git checkout -b feat/my-change
# make changes
git push -u origin feat/my-change
```

Then open a PR using the provided template.

### Multi-branch integration

When integrating multiple branches (release rollups, batch staging promotion), the rules below apply on top of the regular feature-branch flow. These exist because the prior practice produced three CI-infra breakages in one round (commits `56ff8f4`, `00cb456`, `ce3a9dc`).

- **Never use `git merge -X ours` on a protected branch** (`main`, `staging`). The `-X ours` strategy silently drops conflicting hunks from the other side without surfacing the loss — what looks like a clean merge can ship with regressions invisible to review. If a merge produces conflicts on a protected branch, resolve them explicitly, run the full gate, and have a second reviewer look at the resolved hunks.
- **Keep integration branches off `staging`.** Build the rollup on a throwaway integration branch (e.g. `integrate/2026-06-04`), open it as a PR into `staging`, let the gate run, then merge that single PR. Merging individual feature branches directly into `staging` with `-X ours` recovery hides drift; merging one well-tested rollup PR exposes it to CI before it lands.
- **The nine-check gate (see "Before opening a PR" above) gates entry to `staging`** — not post-hoc cleanup on `staging` itself. If a rollup PR fails any check, fix it on the integration branch and re-run; do not "fix it on staging."
- **Rebase before merging long-lived integration branches** so the diff against `staging` reflects only the integration, not stale upstream noise.

## GitHub Pages

The documentation site at `https://geraldmaron.github.io/construct/` is built automatically on every push to `main`. No manual step is needed.

If you are setting this up from scratch: enable GitHub Pages in the repo settings with **source = GitHub Actions**.

## After structural changes

```bash
node ./bin/construct doctor
node ./bin/construct sync
```

`doctor` verifies the system is healthy. `sync` regenerates all platform adapters from `specialists/org`.

## Tone

This is an open source side project. Docs should sound like a person wrote them. Short sentences. No marketing voice. If you find a doc that drifts from that, fix it inline or open a PR that does.

## PR descriptions

A PR description tells the reviewer what changed and how to evaluate it. No process narration, no tone rationale, no self-congratulation. See `docs/STYLE.md` for the full rule set and examples.

## Releasing

The canonical reference is `docs/operations/maintenance/release-and-deploy.md`. Run `npm run release:preflight` locally, tag `vX.Y.Z`, push. The release workflow handles npm + Docker + binaries + Homebrew + GitHub Release. No manual steps.
