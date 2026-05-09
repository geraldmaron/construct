<!--
CONTRIBUTING.md — contributor guide for the Construct repository.

Start here if you are contributing code, docs, or agent definitions.
The authoritative source for AI-session rules is CLAUDE.md.
-->

# Contributing to Construct

## Before you start

Read [CLAUDE.md](CLAUDE.md). It lists the protected files, critical rules, and the exact commands to run after structural changes. Deviating from those rules without understanding the cascade is the fastest way to break every downstream platform config.

## Required tools

- Node ≥ 18
- npm ≥ 9

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
node ./bin/construct doctor
node ./bin/construct docs:update --check
node ./bin/construct lint:comments
```

All four must exit 0. If `docs:update --check` fails, regenerate and commit:

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
| `agents/registry.json` | Source of truth for all agents on all platforms |
| `sync-agents.mjs` | Regenerates every platform config |
| `lib/hooks/*.mjs` | Run in every Claude Code session |
| `claude/settings.template.json` | Controls all Claude Code hook config |

## Branches

All work happens on a feature branch. Never commit directly to `main`.

```bash
git checkout -b feat/my-change
# ... make changes ...
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

`doctor` verifies the system is healthy. `sync` regenerates all platform adapters from `agents/registry.json`.
