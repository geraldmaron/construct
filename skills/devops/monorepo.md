<!--
skills/devops/monorepo.md — Monorepo — Use this skill when selecting monorepo tooling, structuring packages, or optimiz

Use this skill when selecting monorepo tooling, structuring packages, or optimizing affected-only builds. ## Tool Selection
-->
# Monorepo

Use this skill when selecting monorepo tooling, structuring packages, or optimizing affected-only builds.

## Tool Selection

| Tool | Best For | When NOT to Use | Overhead |
|---|---|---|---|
| pnpm workspaces | Simple multi-package repos, shared deps, no task orchestration | Complex task graphs, build caching requirements | Minimal |
| Turborepo | Medium complexity, build/test caching critical, TypeScript/JS-first, works on pnpm/yarn/npm | Polyglot repos with non-JS build systems | Low |
| Nx | Large orgs, polyglot, code generation, fine-grained ownership, plugin ecosystem | Small teams or repos where Nx's concepts add more friction than value | Medium–High |
| Bazel | 10k+ files, strict reproducibility, polyglot, hermetic builds | Any team without a dedicated Bazel expert; startup cost is high | Very High |

Start with pnpm workspaces. Add Turborepo when caching becomes valuable. Reach for Nx only when you need its generator, constraint, or ownership systems.

## Repository Layout

```
apps/
  web/          # deployable applications
  api/
packages/
  shared/       # shared types, utilities consumed by multiple apps or packages
  ui/           # component library
  config/       # shared eslint, tsconfig, prettier configs
  billing/      # domain packages — business logic with no UI
  auth/
```

Keep `apps/` for deployable surfaces and `packages/` for everything importable. Never put deployable entrypoints inside `packages/`. Config packages (`packages/config/`) centralise tooling setup — each app/package extends rather than duplicates.

## Package Boundaries

- One package per domain or product surface (`packages/billing`, `packages/auth`, `apps/web`, `apps/api`).
- Place shared utilities in `packages/utils` or `packages/shared` — never in an app package.
- Never import directly from one `apps/` package to another `apps/` package; extract shared code to `packages/`.
- Each package exposes its public API through a single `index.ts` barrel file; internal modules are private.
- Enforce boundaries with Nx `@nrwl/enforce-module-boundaries` lint rules or ESLint's `import/no-restricted-paths`.

## Affected-only Builds

Turborepo:
```bash
turbo run build --filter=[HEAD^1]
turbo run test --filter=[HEAD^1]...
```

Nx:
```bash
nx affected --target=build --base=origin/main
nx affected --target=test --base=origin/main
```

Both tools build a change graph from the dependency tree. A change to `packages/utils` marks every downstream package as affected. Only affected packages run in CI — unaffected packages use cached results.

CI integration: set `--base` to the merge base of the PR branch (`origin/main` or `$(git merge-base HEAD origin/main)`), not `HEAD^1`, to correctly identify all changed files in the PR.

## Dependency Management

- Use the workspace protocol in pnpm (`workspace:*`) to reference local packages; this guarantees the local version is always used.
- Never duplicate a dependency version across packages unless there is an explicit version conflict. Use a single lock file at the repo root.
- Align peer dependencies across all packages; mismatched React or TypeScript versions produce hard-to-diagnose errors.
- Use `pnpm why <package>` to trace why a transitive dep is installed before removing it.
- Run `pnpm dedupe` after bulk upgrades to collapse duplicate transitive versions.

## Versioning Strategies

| Strategy | Tool | When to Use |
|---|---|---|
| Fixed (all packages same version) | Lerna (`--unified`), Nx Release | Libraries published together; consumers always upgrade the full suite |
| Independent (each package versioned separately) | Changesets, Lerna (`--independent`) | Packages released on different cadences; consumers pick and choose |

Changesets workflow: developers add a changeset file (`pnpm changeset`) describing the change and bump type; CI applies changesets and publishes on merge to main. This keeps version decisions in PRs rather than as a post-merge step.

Generate changelogs automatically from changeset files; do not write changelogs manually.

## CI Optimization

- Cache `.turbo` or Nx's default cache directory (`node_modules/.cache/nx`) between CI runs, keyed to the lock file hash.
- Enable remote caching (Turborepo Remote Cache, Nx Cloud) for team environments — local caches do not transfer between CI runners.
- Run `turbo prune --scope=<app>` to generate a minimal lockfile subset for Docker builds of individual apps.
- Gate PR merges on `affected` tests, not the full suite, to keep CI under 10 minutes for large repos.
