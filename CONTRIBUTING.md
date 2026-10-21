# Contributing

Construct is a Node package written in TypeScript that Node runs directly.
This file covers what you need to change it and know the change is good.
The architecture and operating contract are in [AGENTS.md](AGENTS.md); the
docs index is [docs/README.md](docs/README.md).

## Setup

You need Node 22.18 or newer (`engines` in `package.json`). CI runs 22.18 and 24.

```bash
npm install
```

There is no build step for development. Node runs the `.ts` sources as they
are (erasable syntax only), and `bin/construct.mjs` runs `src/` whenever it is
present. `npm run build` compiles `dist/` for packaging only; `prepack` runs it.
Because a dev checkout never runs `dist/`, the packaged path is proven
separately by `npm run smoke`, which installs a real tarball into a scratch
project.

## The gate

Run this before every commit. CI runs the same steps.

```bash
npm run lint && npm run typecheck && npm test && npm run smoke
```

- `lint` runs `biome check` (format and lint over `src`, `tests`, `scripts`,
  `bin`) and then the project's own policy checks: no absolute paths, glossary
  terms, no tracker ids in code, skill spec, terminal escapes, the docs index,
  documented commands, the lockfile, and that generated files are current.
- `npm run format` applies Biome's formatting. Skill and workflow JSON are not
  formatted, because their bytes are digested into the registry lock.
- `npm run docs:generate` and `npm run registry:index` regenerate the files the
  lint step checks.

## Tests

`npm test` runs every `tests/**/*.test.ts` with `node --test`.

- A test that touches the filesystem or the environment goes through
  `tests/harness/sterile.ts`: `sterile()` builds a `Paths` in a temp dir, and
  `sterileHome()` moves `HOME` for the whole file. Nothing may write under the
  real home. A home-rooted path is always an argument (see `src/kernel/paths.ts`),
  never read from `process.env` by default.
- CLI tests use `tests/cli/support.ts`: `inProject` gives an initialized
  project with its own `HOME`, `PATH`, clock and ids.
- `CliContext` carries test-only seams (`terminal`, `input`, `timers`).
  Production never sets them. A test that would reach a real scheduler,
  terminal or host passes a recorder through one of these instead.

## Commits

One coherent change per commit. The subject states the invariant the change
makes true, in plain words. No attribution trailers, and no tracker ids in
code or comments (`scripts/lint-no-tracker-refs.mjs` enforces that).

## Construct in this repository

Build and deterministic tests do not require a Construct project, a model account,
or maintainer configuration. To use Construct locally, follow the host setup in
[the install guide](docs/first-run-and-hosts.md). The generated project identity,
source map, database and host wiring stay ignored in this repository. Do not copy
another checkout's project identity or initialize over an orphaned database.

Before switching an existing clone across the cleanup of previously tracked
configuration, copy its local configuration and runtime state outside the checkout.
Git can remove files the earlier commit tracked. Restore the configuration matching
an existing store before running setup. A fresh clone should initialize its own
identity only when local Construct use is wanted.

## Agents working here

[AGENTS.md](AGENTS.md) contains portable contributor instructions. Keep session
handoffs, private planning and generated assessment records outside this repository.
When using the native ledger, claim paths before editing and settle or hand off
the claim with the observed checks. Do not add machine-wide preferences here.

Delivery uses the exact candidate tarball plus external Claude Code and Codex
receipts. See [release verification](docs/release-verification.md). Private
corpora and generated traces remain local; sterile deterministic regressions
belong in the normal suite. A structural pass is not semantic qualification.
