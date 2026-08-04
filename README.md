# Construct

An outcome engine. Point at an outcome; a learning staff of roles fills in the rest. Work happens in the background; only genuine decisions surface; deliverables arrive finished and traceable.

This is a ground-up rebirth — see [STRATEGY.md](STRATEGY.md) for the full direction, [GLOSSARY.md](GLOSSARY.md) for the vocabulary every surface uses, and [CHANGELOG.md](CHANGELOG.md) for what shipped. The code shares nothing with the predecessor (1.x/2.x), which lives on archived and read-only at `construct-legacy`, but the package is the same one: `@geraldmaron/construct`, continuing past `2.1.1` as `3.0.0-alpha.0`. The `construct` CLI command name is unchanged, as it always was.

Nothing installed today changes under you. Alphas publish under the `alpha` tag, so `latest` stays on the predecessor's `2.1.1` until the Phase 5 second-user gate passes and `3.0.0` is promoted deliberately — an existing `npm install @geraldmaron/construct` cannot wander into the rewrite.

## Status

Phase 1 — kernel harvest and predecessor cleanup, in progress. Not yet usable for real outcomes. Versioning: `3.x-alpha` under the `alpha` tag until the Phase 5 second-user gate (STRATEGY.md) passes; no stability is promised before then, and the tag rather than the number is what enforces it. If you have a predecessor install and want it removed, `construct cleanup` is implemented (`--dry-run`, `--yes`, `--scope`, `--keep-state`) but not yet published — it lands in the first alpha, which is the remaining Phase 1 exit criterion (STRATEGY.md, tracker `construct-506`). Once published, `npm install @geraldmaron/construct@alpha` reaches it; the plain install stays on 2.x until the gate passes.

## Development

```bash
npm install
npm test          # sterile suite via node --test, native TS type-stripping
npm run lint       # no-absolute-paths + glossary parity
npm run typecheck
npm run smoke      # packaged-install smoke: build, pack, install, run
```

Requires Node ≥ 22.18. Source is TypeScript using erasable syntax only, so it runs natively via Node's type-stripping in development — no build step for `npm test`. `npm run build` produces the published `dist/` for packaging.

## License

Apache-2.0
