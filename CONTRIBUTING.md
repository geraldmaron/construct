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

- Node 18 or later
- npm 9 or later

```bash
npm install
```

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
npm run lint:prose
npm run lint:profiles
```

All eight must exit 0. The release pipeline in `docs/maintenance/release-and-deploy.md` runs the same checks before any artifact ships.

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
| `specialists/registry.json` | Source of truth for all agents on all platforms |
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

## GitHub Pages

The documentation site at `https://geraldmaron.github.io/construct/` is built automatically on every push to `main`. No manual step is needed.

If you are setting this up from scratch: enable GitHub Pages in the repo settings with **source = GitHub Actions**.

## After structural changes

```bash
node ./bin/construct doctor
node ./bin/construct sync
```

`doctor` verifies the system is healthy. `sync` regenerates all platform adapters from `specialists/registry.json`.

## Tone

This is an open source side project. Docs should sound like a person wrote them. Short sentences. No em-dashes. No marketing voice. If you find a doc that drifts from that, fix it inline or open a PR that does.

## PR descriptions

A PR description tells the reviewer what changed and how to evaluate it. No process narration, no tone rationale, no self-congratulation. See `docs/STYLE.md` for the full rule set and examples.

## Releasing

The canonical reference is `docs/maintenance/release-and-deploy.md`. Run `npm run release:preflight` locally, tag `vX.Y.Z`, push. The release workflow handles npm + Docker + binaries + Homebrew + GitHub Release. No manual steps.
