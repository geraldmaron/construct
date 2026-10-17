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
code or comments (`scripts/lint-no-bead-refs.mjs` enforces that).

## Agents working here

Agents follow [AGENTS.md](AGENTS.md) and [COORDINATION.md](COORDINATION.md):
claim work with the paths you will change before editing, one writer per
path, and update [HANDOFF.md](HANDOFF.md) at the end of a session.
